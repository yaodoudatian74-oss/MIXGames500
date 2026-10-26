// Traffic AI: lane following with the Intelligent Driver Model, traffic lights,
// yielding for left turns, lane changes, pulling over for sirens.

import { clamp, lerp, wrapAngle } from '../core/math';
import { Rng } from '../core/rng';
import type { VehicleSpec } from '../data/vehicles';
import type { PathPiece, RoadGraph } from './roadGraph';
import { makeVehicleState, type VehicleState } from './vehiclePhysics';

export type AgentMode = 'drive' | 'dynamic' | 'parked';

export interface TrafficAgent {
  id: number;
  spec: VehicleSpec;
  color: number;
  mode: AgentMode;
  piece: number;
  s: number;
  speed: number;
  desire: number; // driver aggressiveness multiplier
  nextPiece: number; // chosen continuation (-1 = none)
  lateral: number; // lateral offset (lane changes / pull over), metres to the right
  laneChangeCooldown: number;
  stopTimer: number;
  blinker: number; // -1 left, 0 off, 1 right
  braking: boolean;
  hazard: boolean;
  horn: number; // seconds remaining
  state: VehicleState;
  hasDriver: boolean;
  emergency: boolean; // siren running
  pullOver: number;
  stuck: number;
  wrecked: boolean;
}

export interface Obstacle {
  x: number;
  y: number;
  z: number;
  r: number;
  vx: number;
  vz: number;
  emergency: boolean;
}

const tmpS = { x: 0, y: 0, z: 0, yaw: 0 };

export class TrafficSystem {
  readonly agents: TrafficAgent[] = [];
  private nextId = 1;
  private occupancy = new Map<number, TrafficAgent[]>();
  private rng = new Rng(4242);
  time = 0;

  constructor(readonly graph: RoadGraph) {}

  spawn(spec: VehicleSpec, color: number, pieceId: number, s: number, speed: number): TrafficAgent | null {
    const p = this.graph.pieces[pieceId];
    if (!p) return null;
    this.graph.sample(p, s, tmpS);
    const st = makeVehicleState(tmpS.x, tmpS.y, tmpS.z, tmpS.yaw);
    const a: TrafficAgent = {
      id: this.nextId++,
      spec,
      color,
      mode: 'drive',
      piece: pieceId,
      s,
      speed,
      desire: this.rng.range(0.85, 1.12),
      nextPiece: -1,
      lateral: 0,
      laneChangeCooldown: this.rng.range(3, 8),
      stopTimer: 0,
      blinker: 0,
      braking: false,
      hazard: false,
      horn: 0,
      state: st,
      hasDriver: true,
      emergency: false,
      pullOver: 0,
      stuck: 0,
      wrecked: false,
    };
    a.nextPiece = this.chooseNext(p);
    st.vx = Math.sin(tmpS.yaw) * speed;
    st.vz = Math.cos(tmpS.yaw) * speed;
    this.agents.push(a);
    return a;
  }

  remove(a: TrafficAgent): void {
    const i = this.agents.indexOf(a);
    if (i >= 0) this.agents.splice(i, 1);
  }

  /** Is there enough room around arc length s on a piece to spawn? */
  canSpawn(pieceId: number, s: number, gap = 14): boolean {
    for (const a of this.agents) {
      if (a.mode !== 'drive') {
        const p = this.graph.pieces[pieceId];
        if (!p) return false;
        this.graph.sample(p, s, tmpS);
        if (Math.hypot(a.state.x - tmpS.x, a.state.z - tmpS.z) < gap) return false;
        continue;
      }
      if (a.piece === pieceId && Math.abs(a.s - s) < gap) return false;
    }
    return true;
  }

  chooseNext(p: PathPiece): number {
    if (p.next.length === 0) return -1;
    if (p.next.length === 1) return p.next[0] as number;
    let total = 0;
    const w: number[] = [];
    for (const id of p.next) {
      const c = this.graph.pieces[id] as PathPiece;
      const ww = c.turn === 'S' ? 6 : c.turn === 'U' ? 0.2 : 2;
      w.push(ww);
      total += ww;
    }
    let r = this.rng.next() * total;
    for (let i = 0; i < p.next.length; i++) {
      r -= w[i] as number;
      if (r <= 0) return p.next[i] as number;
    }
    return p.next[p.next.length - 1] as number;
  }

  private rebuildOccupancy(): void {
    this.occupancy.clear();
    for (const a of this.agents) {
      if (a.mode !== 'drive') continue;
      const arr = this.occupancy.get(a.piece);
      if (arr) arr.push(a);
      else this.occupancy.set(a.piece, [a]);
    }
    for (const arr of this.occupancy.values()) arr.sort((p, q) => p.s - q.s);
  }

  /** Gap and speed of the nearest agent ahead in a piece starting from s (exclusive of self). */
  private leaderIn(pieceId: number, fromS: number, self: TrafficAgent | null): { gap: number; v: number } | null {
    const arr = this.occupancy.get(pieceId);
    if (!arr) return null;
    for (const o of arr) {
      if (o === self) continue;
      if (o.s > fromS) return { gap: o.s - fromS - o.spec.length * 0.5, v: o.speed };
    }
    return null;
  }

  update(dt: number, obstacles: readonly Obstacle[], wetness: number): void {
    this.time += dt;
    this.rebuildOccupancy();
    const g = this.graph;
    for (const a of this.agents) {
      if (a.mode !== 'drive') continue;
      const p = g.pieces[a.piece];
      if (!p) continue;
      const st = a.state;
      st.px = st.x;
      st.py = st.y;
      st.pz = st.z;
      st.pyaw = st.yaw;
      const halfLen = a.spec.length * 0.5;
      let v0 = p.speed * a.desire * (1 - wetness * 0.15);
      if (a.spec.category === 'truck' || a.spec.category === 'bus') v0 = Math.min(v0, 19);
      // curvature ahead: slow for connectors
      let gap = 1e9;
      let lv = 0;
      // 1) leader on the same piece
      const lead = this.leaderIn(a.piece, a.s, a);
      if (lead) {
        gap = lead.gap - halfLen;
        lv = lead.v;
      } else {
        const remain = p.length - a.s;
        const nxt = a.nextPiece >= 0 ? g.pieces[a.nextPiece] : undefined;
        if (nxt) {
          const l2 = this.leaderIn(nxt.id, -1e-3, a);
          if (l2) {
            gap = remain + l2.gap - halfLen;
            lv = l2.v;
          } else {
            const nn = nxt.next.length === 1 ? g.pieces[nxt.next[0] as number] : undefined;
            if (nn) {
              const l3 = this.leaderIn(nn.id, -1e-3, a);
              if (l3) {
                gap = remain + nxt.length + l3.gap - halfLen;
                lv = l3.v;
              }
            }
          }
          if (nxt.kind === 'conn' && remain < 40) v0 = Math.min(v0, lerp(nxt.speed, v0, clamp(remain / 40, 0, 1)));
        } else if (remain < 25) {
          // dead end without connection: stop
          if (remain - halfLen < gap) {
            gap = remain - halfLen;
            lv = 0;
          }
        }
      }
      // 2) traffic signal / yielding at the end of a lane
      a.blinker = 0;
      if (p.kind === 'lane') {
        const remain = p.length - a.s;
        const nxt = a.nextPiece >= 0 ? g.pieces[a.nextPiece] : undefined;
        if (nxt && remain < 35) a.blinker = nxt.turn === 'L' ? -1 : nxt.turn === 'R' ? 1 : 0;
        if (remain < 60 && p.approachAxis) {
          const col = g.signal(p.toNode, p.approachAxis, this.time);
          let mustStop = false;
          if (col === 'R') mustStop = true;
          else if (col === 'Y') mustStop = remain - halfLen > (a.speed * a.speed) / (2 * 4.5) + 1;
          // yield for left turns against oncoming traffic
          if (!mustStop && nxt && nxt.turn === 'L' && remain < 12) mustStop = this.oncomingNear(p, a);
          // don't block the box
          if (!mustStop && nxt && remain < 12) {
            const exitId = nxt.next[0];
            if (exitId !== undefined) {
              const occ = this.leaderIn(exitId, -1e-3, a);
              if (occ && occ.gap < a.spec.length + 2 && occ.v < 2) mustStop = true;
            }
          }
          if (mustStop && !a.emergency) {
            const stopGap = remain - halfLen - 1.0;
            if (stopGap < gap) {
              gap = stopGap;
              lv = 0;
            }
          }
        }
      }
      // 3) dynamic obstacles (player, peds, wrecks, police)
      const fx = Math.sin(st.yaw);
      const fz = Math.cos(st.yaw);
      a.pullOver = Math.max(0, a.pullOver - dt);
      for (const o of obstacles) {
        const dx = o.x - st.x;
        const dz = o.z - st.z;
        if (Math.abs(o.y - st.y) > 3) continue;
        const along = dx * fx + dz * fz;
        if (along < -40 || along > 45) continue;
        const lateral = -dx * fz + dz * fx; // right = (-fz, fx)
        if (o.emergency && along < -3 && along > -40 && Math.abs(lateral) < 6) {
          a.pullOver = 3;
          continue;
        }
        if (along <= 0) continue;
        const width = a.spec.width * 0.5 + o.r + 0.4;
        if (Math.abs(lateral - a.lateral) > width) continue;
        const ogap = along - halfLen - o.r;
        if (ogap < gap) {
          gap = ogap;
          const ov = o.vx * fx + o.vz * fz;
          lv = Math.max(0, ov);
        }
      }
      if (a.pullOver > 0) v0 = Math.min(v0, 3);
      // IDM
      const aMax = a.spec.mass > 5000 ? 1.1 : 2.4 * a.desire;
      const bComf = 3.2;
      const s0 = 2.2;
      const T = 1.25 / a.desire;
      const dv = a.speed - lv;
      const sStar = s0 + Math.max(0, a.speed * T + (a.speed * dv) / (2 * Math.sqrt(aMax * bComf)));
      const freeTerm = Math.pow(a.speed / Math.max(v0, 0.1), 4);
      const gapC = Math.max(gap, 0.1);
      let acc = aMax * (1 - freeTerm - (sStar / gapC) * (sStar / gapC));
      if (gap < 0.5) acc = -9;
      acc = clamp(acc, -9, aMax);
      a.braking = acc < -0.6 || a.speed < 0.1;
      a.speed = Math.max(0, a.speed + acc * dt);
      if (a.speed < 0.05 && gap > 6 && acc > 0) a.speed = 0.05;
      // stuck detection: honk if stuck behind an obstacle for long
      if (a.speed < 0.3 && gap < 8) {
        a.stuck += dt;
        if (a.stuck > 6 && a.horn <= 0 && this.rng.chance(0.02)) a.horn = 0.6;
      } else a.stuck = 0;
      a.horn = Math.max(0, a.horn - dt);
      // advance along the path
      a.s += a.speed * dt;
      let guard = 0;
      while (a.s > (g.pieces[a.piece] as PathPiece).length && guard++ < 4) {
        const cur = g.pieces[a.piece] as PathPiece;
        const overflow = a.s - cur.length;
        if (a.nextPiece < 0) {
          a.s = cur.length;
          a.speed = 0;
          break;
        }
        a.piece = a.nextPiece;
        a.s = overflow;
        const np = g.pieces[a.piece] as PathPiece;
        a.nextPiece = this.chooseNext(np);
      }
      // lane change
      a.laneChangeCooldown -= dt;
      const cp = g.pieces[a.piece] as PathPiece;
      if (cp.kind === 'lane' && cp.siblings.length > 0 && a.laneChangeCooldown <= 0 && gap < 30 && lv < v0 * 0.6 && a.s > 10 && cp.length - a.s > 40) {
        for (const sid of cp.siblings) {
          const sib = g.pieces[sid] as PathPiece;
          if (Math.abs(sib.laneIndex - cp.laneIndex) !== 1) continue;
          const ns = (a.s / cp.length) * sib.length;
          const occ = this.occupancy.get(sid) ?? [];
          let free = true;
          for (const o of occ) if (o.s > ns - 12 && o.s < ns + 18) free = false;
          if (!free) continue;
          const off = (sib.laneIndex - cp.laneIndex) * 3.5;
          a.lateral -= off; // keep visual position continuous, then ease to 0
          a.piece = sid;
          a.s = ns;
          a.nextPiece = this.chooseNext(sib);
          a.laneChangeCooldown = this.rng.range(6, 14);
          break;
        }
      }
      if (Math.abs(a.lateral) > 0.01) a.blinker = a.lateral > 0 ? -1 : 1;
      const targetLat = a.pullOver > 0 ? 1.3 : 0;
      a.lateral = lerp(a.lateral, targetLat, clamp(dt * 1.1, 0, 1));
      // write world pose
      const piece = g.pieces[a.piece] as PathPiece;
      g.sample(piece, a.s, tmpS);
      const rx = -Math.cos(tmpS.yaw);
      const rz = Math.sin(tmpS.yaw);
      const nx = tmpS.x + rx * a.lateral;
      const nz = tmpS.z + rz * a.lateral;
      // smooth heading through polyline corners
      const yaw = st.yaw + wrapAngle(tmpS.yaw - st.yaw) * clamp(dt * 9, 0, 1);
      st.vx = (nx - st.x) / dt;
      st.vz = (nz - st.z) / dt;
      if (Math.hypot(st.vx, st.vz) > 60) {
        st.vx = Math.sin(yaw) * a.speed;
        st.vz = Math.cos(yaw) * a.speed;
      }
      st.yawRate = wrapAngle(yaw - st.yaw) / dt;
      st.x = nx;
      st.z = nz;
      st.y = tmpS.y;
      st.yaw = yaw;
      st.wheelSpin += (a.speed / a.spec.wheelR) * dt;
      st.steerAngle = clamp(-st.yawRate * a.spec.wheelbase / Math.max(a.speed, 1), -0.5, 0.5);
      st.rpm = 900 + (a.speed / a.spec.topSpeed) * (a.spec.redline - 900) * 1.6;
      st.pitch = lerp(st.pitch, clamp(acc * 0.006, -0.03, 0.03), clamp(dt * 4, 0, 1));
    }
  }

  private oncomingNear(p: PathPiece, self: TrafficAgent): boolean {
    // lanes arriving at the same node from the opposite direction
    const ins = this.graph.lanesByNodeIn.get(p.toNode) ?? [];
    const end = p.xs.length - 1;
    const myYaw = Math.atan2((p.xs[end] as number) - (p.xs[end - 1] as number), (p.zs[end] as number) - (p.zs[end - 1] as number));
    for (const id of ins) {
      if (id === p.id) continue;
      const q = this.graph.pieces[id] as PathPiece;
      const e = q.xs.length - 1;
      const yaw = Math.atan2((q.xs[e] as number) - (q.xs[e - 1] as number), (q.zs[e] as number) - (q.zs[e - 1] as number));
      if (Math.abs(Math.abs(wrapAngle(yaw - myYaw)) - Math.PI) > 0.5) continue;
      const occ = this.occupancy.get(id);
      if (!occ) continue;
      for (const o of occ) {
        if (o === self) continue;
        const remain = q.length - o.s;
        if (remain < 35 && o.speed > 1.5) return true;
      }
    }
    // also cars currently crossing in the intersection on straight connectors from the opposite side
    return false;
  }

  /** Re-attach a dynamic (physics) agent to the nearest lane when it is calm and aligned. */
  tryResume(a: TrafficAgent): boolean {
    const st = a.state;
    const spd = Math.hypot(st.vx, st.vz);
    if (spd > 2 || a.wrecked || !a.hasDriver) return false;
    const near = this.graph.nearestLane(st.x, st.z, 3, st.yaw, st.y);
    if (!near) return false;
    const p = near.piece;
    this.graph.sample(p, near.s, tmpS);
    if (Math.abs(wrapAngle(tmpS.yaw - st.yaw)) > 0.45) return false;
    if (!this.canSpawn(p.id, near.s, 7)) return false;
    a.mode = 'drive';
    a.piece = p.id;
    a.s = near.s;
    a.speed = spd;
    a.lateral = 0;
    a.nextPiece = this.chooseNext(p);
    return true;
  }
}
