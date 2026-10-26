// Pedestrian AI: sidewalk loops around blocks, signalised crossings,
// chatting, sitting, entering shops, fleeing, getting knocked down.

import { clamp, dist2, lerp, wrapAngle, yawOf } from '../core/math';
import { Rng } from '../core/rng';
import type { Rect } from '../world/layout';
import { X_LINES, Z_LINES, TOWN_X, TOWN_Z } from '../world/layout';
import type { GroundModel } from '../world/ground';
import type { Block, Door, Prop } from '../world/worldgen';
import type { CollisionWorld, Contact } from './collision';
import type { Axis, RoadGraph } from './roadGraph';

export type PedMode =
  | 'walk'
  | 'waitCross'
  | 'cross'
  | 'idle'
  | 'talk'
  | 'sit'
  | 'flee'
  | 'down'
  | 'getup'
  | 'wander'
  | 'phone'
  | 'toDoor'
  | 'inside'
  | 'lie'
  | 'dance'
  | 'scripted';

export interface WalkBlock {
  idx: number;
  ring: Rect;
  perim: number;
  /** intersection node ids at corners NW, NE, SE, SW */
  cornerNodes: [number, number, number, number];
  /** neighbour block index to the N, E, S, W */
  nb: [number, number, number, number];
}

export interface Ped {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  vx: number;
  vz: number;
  mode: PedMode;
  prevMode: PedMode;
  block: number;
  u: number;
  dir: 1 | -1;
  side: number; // lateral offset on the sidewalk
  timer: number;
  partner: number;
  variant: number;
  phase: number; // walk cycle phase
  cross: { ax: number; az: number; bx: number; bz: number; t: number; toBlock: number; toU: number; node: number; axis: Axis } | null;
  fleeX: number;
  fleeZ: number;
  wanderRect: Rect | null;
  targetX: number;
  targetZ: number;
  door: Door | null;
  visible: boolean;
  fallYaw: number;
  knockVx: number;
  knockVz: number;
  witness: { x: number; z: number; severity: number; timer: number } | null;
  talkId: number;
  panic: number;
  cop: boolean;
  px: number;
  pz: number;
  py: number;
  pyaw: number;
}

const WALK_SPEED = [1.25, 1.35, 1.45, 1.15, 1.55];

export class PedSystem {
  readonly peds: Ped[] = [];
  readonly walkBlocks: WalkBlock[] = [];
  private nextId = 1;
  private rng = new Rng(9911);
  private scratch: Contact[] = [];
  private blockIndexByKey = new Map<string, number>();
  time = 0;
  /** Fired when a witness finishes reporting a crime. */
  onReport: ((x: number, z: number, severity: number) => void) | null = null;

  constructor(
    private readonly ground: GroundModel,
    private readonly graph: RoadGraph,
    private readonly world: CollisionWorld,
    blocks: readonly Block[],
    private readonly doors: readonly Door[],
    private readonly benches: readonly Prop[],
  ) {
    this.buildWalkNetwork(blocks);
  }

  private buildWalkNetwork(blocks: readonly Block[]): void {
    const nodeAt = (x: number, z: number): number => {
      for (const n of this.graph.net.nodes) if (Math.abs(n.x - x) < 0.5 && Math.abs(n.z - z) < 0.5) return n.id;
      return -1;
    };
    for (const b of blocks) {
      const o = b.outer;
      const ring: Rect = { x0: o.x0 + 2.0, z0: o.z0 + 2.0, x1: o.x1 - 2.0, z1: o.z1 - 2.0 };
      const [lx, lz] = b.key.split(',').map(Number) as [number, number];
      const town = b.zone === 'town';
      const xs = town ? TOWN_X : X_LINES;
      const zs = town ? TOWN_Z : Z_LINES;
      const i = xs.indexOf(lx);
      const j = zs.indexOf(lz);
      const x1 = xs[i + 1] as number;
      const z1 = zs[j + 1] as number;
      const idx = this.walkBlocks.length;
      this.blockIndexByKey.set(b.key, idx);
      this.walkBlocks.push({
        idx,
        ring,
        perim: 2 * (ring.x1 - ring.x0 + ring.z1 - ring.z0),
        cornerNodes: [nodeAt(lx, lz), nodeAt(x1, lz), nodeAt(x1, z1), nodeAt(lx, z1)],
        nb: [-1, -1, -1, -1],
      });
    }
    for (const b of blocks) {
      const idx = this.blockIndexByKey.get(b.key) as number;
      const wb = this.walkBlocks[idx] as WalkBlock;
      const [lx, lz] = b.key.split(',').map(Number) as [number, number];
      const town = b.zone === 'town';
      const xs = town ? TOWN_X : X_LINES;
      const zs = town ? TOWN_Z : Z_LINES;
      const i = xs.indexOf(lx);
      const j = zs.indexOf(lz);
      const get = (ii: number, jj: number): number => {
        const kx = xs[ii];
        const kz = zs[jj];
        if (kx === undefined || kz === undefined) return -1;
        return this.blockIndexByKey.get(kx + ',' + kz) ?? -1;
      };
      wb.nb = [j > 0 ? get(i, j - 1) : -1, get(i + 1, j), get(i, j + 1), i > 0 ? get(i - 1, j) : -1];
    }
  }

  /** Point on a block ring at perimeter coordinate u (clockwise from NW). */
  ringPoint(wb: WalkBlock, u: number, out: { x: number; z: number; yaw: number }): void {
    const r = wb.ring;
    const W = r.x1 - r.x0;
    const D = r.z1 - r.z0;
    let t = u % wb.perim;
    if (t < 0) t += wb.perim;
    if (t < W) {
      out.x = r.x0 + t;
      out.z = r.z0;
      out.yaw = Math.PI / 2;
    } else if (t < W + D) {
      out.x = r.x1;
      out.z = r.z0 + (t - W);
      out.yaw = 0;
    } else if (t < 2 * W + D) {
      out.x = r.x1 - (t - W - D);
      out.z = r.z1;
      out.yaw = -Math.PI / 2;
    } else {
      out.x = r.x0;
      out.z = r.z1 - (t - 2 * W - D);
      out.yaw = Math.PI;
    }
  }

  /** Closest perimeter coordinate on a block ring to (x,z). */
  projectRing(wb: WalkBlock, x: number, z: number): number {
    const r = wb.ring;
    const W = r.x1 - r.x0;
    const D = r.z1 - r.z0;
    const cx = clamp(x, r.x0, r.x1);
    const cz = clamp(z, r.z0, r.z1);
    const dN = Math.abs(cz - r.z0);
    const dS = Math.abs(r.z1 - cz);
    const dW = Math.abs(cx - r.x0);
    const dE = Math.abs(r.x1 - cx);
    const m = Math.min(dN, dS, dW, dE);
    if (m === dN) return cx - r.x0;
    if (m === dE) return W + (cz - r.z0);
    if (m === dS) return W + D + (r.x1 - cx);
    return 2 * W + D + (r.z1 - cz);
  }

  blockIndexAt(x: number, z: number): number {
    const b = this.ground.blockAt(x, z);
    if (!b) return -1;
    return this.blockIndexByKey.get(b.key) ?? -1;
  }

  spawnOnBlock(blockIdx: number, u: number, variant: number): Ped | null {
    const wb = this.walkBlocks[blockIdx];
    if (!wb) return null;
    const pt = { x: 0, z: 0, yaw: 0 };
    this.ringPoint(wb, u, pt);
    const dir: 1 | -1 = this.rng.chance(0.5) ? 1 : -1;
    const p = this.makePed(pt.x, pt.z, variant);
    p.block = blockIdx;
    p.u = u;
    p.dir = dir;
    p.side = 0.55 + this.rng.range(-0.25, 0.25); // keep right
    p.speed = WALK_SPEED[variant % WALK_SPEED.length] as number;
    p.yaw = pt.yaw + (dir === 1 ? 0 : Math.PI);
    return p;
  }

  spawnWanderer(rect: Rect, variant: number, mode: PedMode = 'wander'): Ped {
    const x = this.rng.range(rect.x0, rect.x1);
    const z = this.rng.range(rect.z0, rect.z1);
    const p = this.makePed(x, z, variant);
    p.mode = mode;
    p.wanderRect = rect;
    p.targetX = x;
    p.targetZ = z;
    p.speed = 1.1;
    p.timer = this.rng.range(2, 10);
    return p;
  }

  private makePed(x: number, z: number, variant: number): Ped {
    const y = this.ground.groundAt(x, z, 50);
    const p: Ped = {
      id: this.nextId++,
      x,
      y,
      z,
      yaw: 0,
      speed: 1.3,
      vx: 0,
      vz: 0,
      mode: 'walk',
      prevMode: 'walk',
      block: -1,
      u: 0,
      dir: 1,
      side: 0,
      timer: 0,
      partner: -1,
      variant,
      phase: this.rng.range(0, 6.28),
      cross: null,
      fleeX: 0,
      fleeZ: 0,
      wanderRect: null,
      targetX: x,
      targetZ: z,
      door: null,
      visible: true,
      fallYaw: 0,
      knockVx: 0,
      knockVz: 0,
      witness: null,
      talkId: 0,
      panic: 0,
      cop: false,
      px: x,
      pz: z,
      py: y,
      pyaw: 0,
    };
    this.peds.push(p);
    return p;
  }

  remove(p: Ped): void {
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
    if (p.partner >= 0) {
      const q = this.peds.find((o) => o.id === p.partner);
      if (q) {
        q.partner = -1;
        if (q.mode === 'talk') q.mode = q.block >= 0 ? 'walk' : 'wander';
      }
    }
  }

  /** Scare peds around a point (gunshot-like event, crash, explosion, fight). */
  scare(x: number, z: number, radius: number, severity: number): void {
    const r2 = radius * radius;
    for (const p of this.peds) {
      if (!p.visible || p.mode === 'down' || p.mode === 'getup' || p.cop) continue;
      if (dist2(p.x, p.z, x, z) > r2) continue;
      this.startFlee(p, x, z);
      p.panic = Math.max(p.panic, severity);
    }
  }

  /** Register a crime that nearby peds may witness and report. */
  crime(x: number, y: number, z: number, severity: number, radius: number): void {
    const r2 = radius * radius;
    for (const p of this.peds) {
      if (!p.visible || p.mode === 'down' || p.cop) continue;
      if (dist2(p.x, p.z, x, z) > r2) continue;
      if (!this.world.lineOfSight(p.x, p.y + 1.6, p.z, x, y + 1, z)) continue;
      if (!p.witness || p.witness.severity < severity) p.witness = { x, z, severity, timer: 2.5 + this.rng.range(0, 2) };
    }
  }

  startFlee(p: Ped, fx: number, fz: number): void {
    if (p.mode === 'inside' || p.mode === 'scripted') return;
    if (p.partner >= 0) this.breakTalk(p);
    p.prevMode = p.block >= 0 ? 'walk' : 'wander';
    p.mode = 'flee';
    p.fleeX = fx;
    p.fleeZ = fz;
    p.timer = this.rng.range(4, 8);
    p.cross = null;
  }

  knockDown(p: Ped, vx: number, vz: number): void {
    if (p.mode === 'down' || p.mode === 'inside') return;
    if (p.partner >= 0) this.breakTalk(p);
    p.mode = 'down';
    p.timer = 4 + this.rng.range(0, 2);
    p.knockVx = vx * 0.6;
    p.knockVz = vz * 0.6;
    p.fallYaw = yawOf(vx, vz);
    p.cross = null;
  }

  private breakTalk(p: Ped): void {
    const q = this.peds.find((o) => o.id === p.partner);
    p.partner = -1;
    if (q) {
      q.partner = -1;
      if (q.mode === 'talk') q.mode = q.block >= 0 ? 'walk' : 'wander';
    }
  }

  update(dt: number, playerX: number, playerZ: number): void {
    this.time += dt;
    const pt = { x: 0, z: 0, yaw: 0 };
    for (const p of this.peds) {
      p.px = p.x;
      p.pz = p.z;
      p.py = p.y;
      p.pyaw = p.yaw;
      // witnesses phone the police
      if (p.witness && p.mode !== 'down') {
        p.witness.timer -= dt;
        if (p.mode !== 'flee' && p.mode !== 'phone' && p.witness.timer < 2) {
          p.mode = 'phone';
          p.timer = 2.5;
        }
        if (p.witness.timer <= 0) {
          this.onReport?.(p.witness.x, p.witness.z, p.witness.severity);
          p.witness = null;
        }
      }
      let moveSpeed = 0;
      switch (p.mode) {
        case 'walk': {
          const wb = this.walkBlocks[p.block];
          if (!wb) {
            p.mode = 'wander';
            break;
          }
          const prevU = p.u;
          p.u += p.dir * p.speed * dt;
          if (p.u < 0) p.u += wb.perim;
          if (p.u >= wb.perim) p.u -= wb.perim;
          // corner check
          const corner = this.cornerCrossed(wb, prevU, p.u, p.dir);
          if (corner >= 0 && this.rng.chance(0.3)) this.beginCrossing(p, wb, corner);
          this.ringPoint(wb, p.u, pt);
          // lateral side offset toward the street (outer) or the buildings
          const yaw = pt.yaw + (p.dir === 1 ? 0 : Math.PI);
          const rx = -Math.cos(yaw);
          const rz = Math.sin(yaw);
          const tx = pt.x + rx * p.side;
          const tz = pt.z + rz * p.side;
          p.vx = (tx - p.x) / dt;
          p.vz = (tz - p.z) / dt;
          if (Math.hypot(p.vx, p.vz) > 8) {
            p.vx = 0;
            p.vz = 0;
          }
          p.x = tx;
          p.z = tz;
          p.yaw = p.yaw + wrapAngle(yaw - p.yaw) * clamp(dt * 8, 0, 1);
          moveSpeed = p.speed;
          // random events
          if (this.rng.chance(dt * 0.012)) {
            p.mode = 'idle';
            p.timer = this.rng.range(2, 7);
          } else if (this.rng.chance(dt * 0.02)) this.tryStartTalk(p);
          else if (this.rng.chance(dt * 0.03)) this.tryUseBenchOrShop(p);
          break;
        }
        case 'waitCross': {
          const c = p.cross;
          if (!c) {
            p.mode = 'walk';
            break;
          }
          p.yaw = p.yaw + wrapAngle(yawOf(c.bx - c.ax, c.bz - c.az) - p.yaw) * clamp(dt * 6, 0, 1);
          if (c.node < 0 || this.graph.pedWalk(c.node, c.axis, this.time)) {
            // only start if enough green time remains: rough check by sampling a bit ahead
            if (c.node < 0 || this.graph.pedWalk(c.node, c.axis, this.time + 8)) p.mode = 'cross';
          }
          p.timer += dt;
          if (p.timer > 45) {
            p.cross = null;
            p.mode = 'walk';
          }
          break;
        }
        case 'cross': {
          const c = p.cross;
          if (!c) {
            p.mode = 'walk';
            break;
          }
          const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
          c.t += (p.speed * 1.15 * dt) / Math.max(len, 0.1);
          const t = Math.min(1, c.t);
          const nx = lerp(c.ax, c.bx, t);
          const nz = lerp(c.az, c.bz, t);
          p.vx = (nx - p.x) / dt;
          p.vz = (nz - p.z) / dt;
          p.x = nx;
          p.z = nz;
          p.yaw = yawOf(c.bx - c.ax, c.bz - c.az);
          moveSpeed = p.speed * 1.15;
          if (t >= 1) {
            p.block = c.toBlock;
            p.u = c.toU;
            p.cross = null;
            p.mode = 'walk';
          }
          break;
        }
        case 'idle':
        case 'phone':
        case 'sit':
        case 'lie':
        case 'dance': {
          p.vx = 0;
          p.vz = 0;
          p.timer -= dt;
          if (p.timer <= 0 && p.mode !== 'lie' && p.mode !== 'dance') {
            if (p.mode === 'sit') p.side = 0.55;
            p.mode = p.block >= 0 ? 'walk' : 'wander';
            if (p.block >= 0) this.resnap(p);
          } else if (p.timer <= 0) p.timer = 30;
          break;
        }
        case 'talk': {
          p.vx = 0;
          p.vz = 0;
          const q = this.peds.find((o) => o.id === p.partner);
          if (!q) {
            p.partner = -1;
            p.mode = p.block >= 0 ? 'walk' : 'wander';
            break;
          }
          p.yaw = p.yaw + wrapAngle(yawOf(q.x - p.x, q.z - p.z) - p.yaw) * clamp(dt * 5, 0, 1);
          p.timer -= dt;
          if (p.timer <= 0) this.breakTalk(p);
          break;
        }
        case 'toDoor': {
          const d = p.door;
          if (!d) {
            p.mode = 'walk';
            break;
          }
          moveSpeed = this.seek(p, d.x, d.z, p.speed, dt);
          if (dist2(p.x, p.z, d.x, d.z) < 1.2) {
            p.mode = 'inside';
            p.visible = false;
            p.timer = this.rng.range(15, 50);
          }
          break;
        }
        case 'inside': {
          p.timer -= dt;
          if (p.timer <= 0) {
            p.visible = true;
            p.mode = p.block >= 0 ? 'walk' : 'wander';
            if (p.block >= 0) this.resnap(p);
          }
          break;
        }
        case 'wander': {
          const r = p.wanderRect;
          if (!r) {
            // lost: attach to nearest block
            const bi = this.blockIndexAt(p.x, p.z);
            if (bi >= 0) {
              p.block = bi;
              this.resnap(p);
              p.mode = 'walk';
            }
            break;
          }
          p.timer -= dt;
          if (dist2(p.x, p.z, p.targetX, p.targetZ) < 1 || p.timer <= 0) {
            if (this.rng.chance(0.3)) {
              p.mode = 'idle';
              p.timer = this.rng.range(3, 10);
              p.prevMode = 'wander';
            }
            p.targetX = this.rng.range(r.x0, r.x1);
            p.targetZ = this.rng.range(r.z0, r.z1);
            p.timer = this.rng.range(8, 20);
          }
          moveSpeed = this.seek(p, p.targetX, p.targetZ, p.speed, dt);
          if (this.rng.chance(dt * 0.015)) this.tryStartTalk(p);
          break;
        }
        case 'flee': {
          const dx = p.x - p.fleeX;
          const dz = p.z - p.fleeZ;
          const l = Math.hypot(dx, dz) || 1;
          moveSpeed = this.seek(p, p.x + (dx / l) * 10, p.z + (dz / l) * 10, 4.6, dt);
          p.timer -= dt;
          if (p.timer <= 0) {
            p.panic = 0;
            const bi = this.blockIndexAt(p.x, p.z);
            if (bi >= 0) {
              p.block = bi;
              this.resnap(p);
              p.mode = 'walk';
            } else if (p.wanderRect) p.mode = 'wander';
            else {
              p.timer = 3;
            }
          }
          break;
        }
        case 'down': {
          p.knockVx *= 1 - clamp(dt * 3, 0, 1);
          p.knockVz *= 1 - clamp(dt * 3, 0, 1);
          p.x += p.knockVx * dt;
          p.z += p.knockVz * dt;
          p.vx = 0;
          p.vz = 0;
          p.timer -= dt;
          if (p.timer <= 0) {
            p.mode = 'getup';
            p.timer = 1.4;
          }
          break;
        }
        case 'getup': {
          p.timer -= dt;
          if (p.timer <= 0) {
            if (p.cop) p.mode = 'scripted';
            else this.startFlee(p, playerX, playerZ);
          }
          break;
        }
        case 'scripted':
          // controlled by game code (police officers on foot)
          break;
      }
      // collisions for free-moving modes
      if (p.mode === 'flee' || p.mode === 'wander' || p.mode === 'toDoor' || p.mode === 'down' || p.mode === 'scripted') {
        this.world.resolveCircle(p, 0.3, p.y, 1.7, this.scratch);
      }
      p.y = lerp(p.y, this.ground.groundAt(p.x, p.z, p.y + 1), clamp(dt * 12, 0, 1));
      p.phase += moveSpeed * dt * 3.2;
    }
    this.separate();
  }

  private seek(p: Ped, tx: number, tz: number, speed: number, dt: number): number {
    const dx = tx - p.x;
    const dz = tz - p.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.05) {
      p.vx = 0;
      p.vz = 0;
      return 0;
    }
    const sp = Math.min(speed, l / dt);
    p.vx = (dx / l) * sp;
    p.vz = (dz / l) * sp;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.yaw = p.yaw + wrapAngle(yawOf(dx, dz) - p.yaw) * clamp(dt * 8, 0, 1);
    return sp;
  }

  private resnap(p: Ped): void {
    const wb = this.walkBlocks[p.block];
    if (!wb) return;
    p.u = this.projectRing(wb, p.x, p.z);
  }

  /** Returns corner index 0..3 (NW, NE, SE, SW) if a corner was passed this step. */
  private cornerCrossed(wb: WalkBlock, u0: number, u1: number, dir: 1 | -1): number {
    const r = wb.ring;
    const W = r.x1 - r.x0;
    const D = r.z1 - r.z0;
    const corners = [0, W, W + D, 2 * W + D];
    for (let k = 0; k < 4; k++) {
      const c = corners[k] as number;
      if (dir === 1) {
        if ((u0 < c && u1 >= c) || (k === 0 && u0 > u1)) return k;
      } else {
        if ((u0 > c && u1 <= c) || (k === 0 && u1 > u0)) return k;
      }
    }
    return -1;
  }

  private beginCrossing(p: Ped, wb: WalkBlock, corner: number): void {
    // candidate directions from each corner: [dirIndex into nb (N,E,S,W)]
    const opts: Record<number, [number, number]> = { 0: [0, 3], 1: [0, 1], 2: [1, 2], 3: [2, 3] };
    const choice = (opts[corner] as [number, number])[this.rng.chance(0.5) ? 0 : 1];
    const toIdx = wb.nb[choice];
    if (toIdx === undefined || toIdx < 0) return;
    const to = this.walkBlocks[toIdx];
    if (!to) return;
    const r = wb.ring;
    const cornersXY: [number, number][] = [
      [r.x0, r.z0],
      [r.x1, r.z0],
      [r.x1, r.z1],
      [r.x0, r.z1],
    ];
    const [ax, az] = cornersXY[corner] as [number, number];
    // matching corner on the neighbour
    const tr = to.ring;
    let bx = ax;
    let bz = az;
    let axis: Axis;
    if (choice === 0) {
      bz = tr.z1;
      axis = 'x'; // crossing a road that runs along x
    } else if (choice === 2) {
      bz = tr.z0;
      axis = 'x';
    } else if (choice === 1) {
      bx = tr.x0;
      axis = 'z';
    } else {
      bx = tr.x1;
      axis = 'z';
    }
    const len = Math.hypot(bx - ax, bz - az);
    if (len > 40 || len < 4) return;
    p.cross = {
      ax,
      az,
      bx,
      bz,
      t: 0,
      toBlock: toIdx,
      toU: this.projectRing(to, bx, bz),
      node: wb.cornerNodes[corner] ?? -1,
      axis,
    };
    p.x = ax;
    p.z = az;
    p.mode = 'waitCross';
    p.timer = 0;
  }

  private tryStartTalk(p: Ped): void {
    if (p.partner >= 0) return;
    for (const q of this.peds) {
      if (q === p || q.partner >= 0 || !q.visible) continue;
      if (q.mode !== 'walk' && q.mode !== 'wander' && q.mode !== 'idle') continue;
      if (dist2(p.x, p.z, q.x, q.z) > 6) continue;
      const t = this.rng.range(6, 15);
      p.mode = 'talk';
      q.mode = 'talk';
      p.partner = q.id;
      q.partner = p.id;
      p.timer = t;
      q.timer = t;
      p.talkId = Math.floor(this.rng.next() * 1e6);
      q.talkId = p.talkId;
      return;
    }
  }

  private tryUseBenchOrShop(p: Ped): void {
    for (const d of this.doors) {
      if (dist2(p.x, p.z, d.x, d.z) < 64) {
        p.door = d;
        p.mode = 'toDoor';
        return;
      }
    }
    for (const b of this.benches) {
      if (dist2(p.x, p.z, b.x, b.z) < 9) {
        p.mode = 'sit';
        p.x = b.x;
        p.z = b.z;
        p.yaw = b.yaw;
        p.timer = this.rng.range(8, 25);
        return;
      }
    }
  }

  /** Keep peds from overlapping each other (cheap pairwise on a hashed grid). */
  private separate(): void {
    const cell = 2;
    const grid = new Map<number, Ped[]>();
    for (const p of this.peds) {
      if (!p.visible || p.mode === 'down' || p.mode === 'talk' || p.mode === 'sit' || p.mode === 'lie') continue;
      const k = Math.floor(p.x / cell) * 73856093 ^ Math.floor(p.z / cell) * 19349663;
      const arr = grid.get(k);
      if (arr) arr.push(p);
      else grid.set(k, [p]);
    }
    for (const arr of grid.values()) {
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i] as Ped;
          const b = arr[j] as Ped;
          const dx = a.x - b.x;
          const dz = a.z - b.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.6 && d > 1e-4) {
            const push = (0.6 - d) * 0.5;
            a.x += (dx / d) * push;
            a.z += (dz / d) * push;
            b.x -= (dx / d) * push;
            b.z -= (dz / d) * push;
          }
        }
      }
    }
  }
}
