// Physics-driving AI controllers (police pursuit, fleeing targets, race rivals).
// They produce VehicleInput for the shared vehicle physics.

import { clamp, wrapAngle, yawOf } from '../core/math';
import { Rng } from '../core/rng';
import type { VehicleSpec } from '../data/vehicles';
import type { P2 } from '../world/layout';
import type { PathPiece, RoadGraph } from '../sim/roadGraph';
import { forwardSpeed, type VehicleInput, type VehicleState } from '../sim/vehiclePhysics';

/** Concatenate lane + connector points following a node route. */
export function lanePathForRoute(graph: RoadGraph, nodes: number[]): P2[] {
  const out: P2[] = [];
  const push = (p: PathPiece): void => {
    for (let i = 0; i < p.xs.length; i++) {
      const x = p.xs[i] as number;
      const z = p.zs[i] as number;
      const last = out[out.length - 1];
      if (!last || Math.hypot(last.x - x, last.z - z) > 2) out.push({ x, z });
    }
  };
  let prevLane: PathPiece | null = null;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i] as number;
    const b = nodes[i + 1] as number;
    const outs = (graph.lanesByNodeOut.get(a) ?? []).map((id) => graph.pieces[id] as PathPiece).filter((p) => p.toNode === b);
    if (outs.length === 0) continue;
    let lane = outs[outs.length - 1] as PathPiece;
    if (prevLane) {
      // prefer a lane reachable by a connector from the previous lane
      for (const cid of prevLane.next) {
        const c = graph.pieces[cid] as PathPiece;
        const target = outs.find((o) => o.id === c.toLane);
        if (target) {
          push(c);
          lane = target;
          break;
        }
      }
    }
    push(lane);
    prevLane = lane;
  }
  return out;
}

/** Greedy lane walk that passes near each checkpoint in order. */
export function lanePathThrough(graph: RoadGraph, cps: readonly P2[], start: P2, startYaw: number): P2[] {
  const out: P2[] = [{ x: start.x, z: start.z }];
  const near = graph.nearestLane(start.x, start.z, 30, startYaw);
  if (!near) return cps.map((c) => ({ x: c.x, z: c.z }));
  let piece: PathPiece = near.piece;
  let startS = near.s;
  let ci = 0;
  let guard = 0;
  while (ci < cps.length && guard++ < 800) {
    for (let i = 0; i < piece.xs.length; i++) {
      if (piece.ss[i] !== undefined && (piece.ss[i] as number) < startS) continue;
      const x = piece.xs[i] as number;
      const z = piece.zs[i] as number;
      const last = out[out.length - 1] as P2;
      if (Math.hypot(last.x - x, last.z - z) > 2) out.push({ x, z });
      const cp = cps[ci] as P2;
      if (Math.hypot(cp.x - x, cp.z - z) < 16) ci++;
      if (ci >= cps.length) break;
    }
    startS = -1;
    if (ci >= cps.length) break;
    // choose the continuation that gets closest to the next checkpoint
    const target = cps[ci] as P2;
    let best: PathPiece | null = null;
    let bestD = Infinity;
    for (const nid of piece.next) {
      const c = graph.pieces[nid] as PathPiece;
      const lane = c.kind === 'conn' ? (graph.pieces[c.toLane] as PathPiece) : c;
      const e = lane.xs.length - 1;
      const d = Math.min(
        Math.hypot((lane.xs[e] as number) - target.x, (lane.zs[e] as number) - target.z),
        Math.hypot((lane.xs[Math.floor(e / 2)] as number) - target.x, (lane.zs[Math.floor(e / 2)] as number) - target.z),
      );
      const penalty = c.turn === 'U' ? 500 : 0;
      if (d + penalty < bestD) {
        bestD = d + penalty;
        best = c;
      }
    }
    if (!best) break;
    piece = best;
  }
  const last = cps[cps.length - 1];
  if (last) out.push({ x: last.x, z: last.z });
  return out;
}

export class PathDriver {
  path: P2[] = [];
  idx = 0;
  stuck = 0;
  reverseT = 0;
  maxSpeed = 30;
  aggression = 1;

  setPath(p: P2[]): void {
    this.path = p;
    this.idx = 0;
  }

  /** Advance the index to the closest point ahead. */
  private progress(x: number, z: number): void {
    const n = this.path.length;
    let best = this.idx;
    let bd = Infinity;
    for (let i = this.idx; i < Math.min(n, this.idx + 25); i++) {
      const p = this.path[i] as P2;
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    this.idx = best;
  }

  done(): boolean {
    return this.path.length === 0 || this.idx >= this.path.length - 2;
  }

  remaining(): number {
    return this.path.length - this.idx;
  }

  /** Pure-pursuit steering with curvature-based speed. */
  drive(spec: VehicleSpec, st: VehicleState, dt: number, out: VehicleInput, speedCap = Infinity): void {
    out.handbrake = false;
    if (this.path.length < 2) {
      out.throttle = 0;
      out.brake = 1;
      out.steer = 0;
      return;
    }
    this.progress(st.x, st.z);
    const v = forwardSpeed(st);
    const look = clamp(6 + Math.abs(v) * 0.55, 6, 30);
    let acc = 0;
    let tx = st.x;
    let tz = st.z;
    for (let i = this.idx; i < this.path.length - 1; i++) {
      const a = this.path[i] as P2;
      const b = this.path[i + 1] as P2;
      acc += Math.hypot(b.x - a.x, b.z - a.z);
      tx = b.x;
      tz = b.z;
      if (acc >= look) break;
    }
    // curvature ahead (sum of heading changes over ~45 m)
    let turn = 0;
    let dist = 0;
    for (let i = this.idx; i < this.path.length - 2 && dist < 45; i++) {
      const a = this.path[i] as P2;
      const b = this.path[i + 1] as P2;
      const c = this.path[i + 2] as P2;
      const y1 = yawOf(b.x - a.x, b.z - a.z);
      const y2 = yawOf(c.x - b.x, c.z - b.z);
      turn += Math.abs(wrapAngle(y2 - y1)) * (1 - dist / 60);
      dist += Math.hypot(b.x - a.x, b.z - a.z);
    }
    let target = Math.min(this.maxSpeed, spec.topSpeed * 0.95, speedCap);
    target = Math.min(target, Math.max(9, this.maxSpeed * (1 - clamp(turn / (1.4 * this.aggression), 0, 0.75))));
    steerToward(st, tx, tz, v, target, out);
    // stuck recovery
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      out.throttle = 0;
      out.brake = 1;
      out.steer = -out.steer;
      return;
    }
    if (Math.abs(v) < 1.0 && out.throttle > 0.3) {
      this.stuck += dt;
      if (this.stuck > 1.6) {
        this.reverseT = 1.4;
        this.stuck = 0;
      }
    } else this.stuck = Math.max(0, this.stuck - dt);
  }
}

export function steerToward(st: VehicleState, tx: number, tz: number, v: number, target: number, out: VehicleInput): void {
  const desired = yawOf(tx - st.x, tz - st.z);
  const diff = wrapAngle(desired - st.yaw); // + = target is to the left
  out.steer = clamp(-diff * 2.2, -1, 1);
  if (v < target - 0.5) {
    out.throttle = clamp((target - v) * 0.25 + 0.35, 0, 1);
    out.brake = 0;
  } else if (v > target + 2) {
    out.throttle = 0;
    out.brake = clamp((v - target) * 0.12, 0, 1);
  } else {
    out.throttle = 0.25;
    out.brake = 0;
  }
  if (Math.abs(diff) > 1.6 && v < 6) {
    // target behind: three-point turn style
    out.throttle = 0.6;
    out.steer = diff > 0 ? -1 : 1;
  }
}

/** Fleeing driver: keeps driving fast to random far destinations away from the chaser. */
export class FleeDriver {
  readonly pd = new PathDriver();
  private rng: Rng;
  private replan = 0;
  constructor(
    private readonly graph: RoadGraph,
    seed: number,
    speed: number,
  ) {
    this.rng = new Rng(seed);
    this.pd.maxSpeed = speed;
    this.pd.aggression = 1.3;
  }

  update(spec: VehicleSpec, st: VehicleState, dt: number, out: VehicleInput, chaserX: number, chaserZ: number): void {
    this.replan -= dt;
    if (this.pd.done() || this.replan <= 0) {
      this.replan = 25;
      const from = this.graph.nearestNode(st.x + Math.sin(st.yaw) * 30, st.z + Math.cos(st.yaw) * 30);
      // pick a destination 500-1200 m away, preferably away from the chaser
      let bestNode = from;
      let bestScore = -Infinity;
      const nodes = this.graph.net.nodes;
      for (let k = 0; k < 40; k++) {
        const n = nodes[Math.floor(this.rng.next() * nodes.length)];
        if (!n) continue;
        const d = Math.hypot(n.x - st.x, n.z - st.z);
        if (d < 400 || d > 1400) continue;
        const away = Math.hypot(n.x - chaserX, n.z - chaserZ) - d * 0.5;
        if (away > bestScore) {
          bestScore = away;
          bestNode = n.id;
        }
      }
      const route = this.graph.route(from, bestNode);
      const path = lanePathForRoute(this.graph, route);
      if (path.length > 2) this.pd.setPath(path);
    }
    this.pd.drive(spec, st, dt, out);
  }
}

/** Police pursuit: route along roads when far, direct pursuit when close. */
export class ChaseDriver {
  readonly pd = new PathDriver();
  private replan = 0;
  private lastGoal = -1;
  constructor(private readonly graph: RoadGraph) {
    this.pd.maxSpeed = 40;
    this.pd.aggression = 1.2;
  }

  update(spec: VehicleSpec, st: VehicleState, dt: number, out: VehicleInput, tx: number, tz: number, tvx: number, tvz: number, los: boolean): void {
    const d = Math.hypot(tx - st.x, tz - st.z);
    const v = forwardSpeed(st);
    if (d < 75 && los) {
      const lead = clamp(d / 25, 0, 1.2);
      const px = tx + tvx * lead;
      const pz = tz + tvz * lead;
      const tSpeed = Math.hypot(tvx, tvz);
      const target = d < 10 && tSpeed < 2 ? 0 : Math.min(spec.topSpeed, Math.max(tSpeed + 8, 16));
      steerToward(st, px, pz, v, target, out);
      if (d < 9 && tSpeed < 2) {
        out.throttle = 0;
        out.brake = 1;
      }
      out.handbrake = false;
      return;
    }
    this.replan -= dt;
    const goal = this.graph.nearestNode(tx, tz);
    if (this.replan <= 0 || goal !== this.lastGoal || this.pd.done()) {
      this.replan = 3;
      this.lastGoal = goal;
      const from = this.graph.nearestNode(st.x + Math.sin(st.yaw) * 15, st.z + Math.cos(st.yaw) * 15);
      const route = this.graph.route(from, goal);
      const path = lanePathForRoute(this.graph, route);
      path.push({ x: tx, z: tz });
      this.pd.setPath(path);
    }
    this.pd.drive(spec, st, dt, out);
  }
}
