// Lane graph built from the road network: lanes, intersection connectors,
// traffic signals, spatial queries and A* routing. Pure simulation data.

import { clamp, lerp, pointSegDist, wrapAngle, yawOf } from '../core/math';
import { resamplePolyline } from '../core/poly';
import { hash1 } from '../core/rng';
import { HeightField, ROAD_DECK_LIFT } from '../world/heightmap';
import {
  CITY_Y,
  ROAD_LIFT,
  ROAD_SPECS,
  buildRoadNetwork,
  deckHeight,
  roadHalfWidth,
  type NodeDef,
  type P2,
  type RoadDef,
  type RoadNetworkDef,
} from '../world/layout';

export type Axis = 'x' | 'z';
export type Turn = 'S' | 'L' | 'R' | 'U';

export interface PathPiece {
  id: number;
  kind: 'lane' | 'conn';
  xs: Float32Array;
  ys: Float32Array;
  zs: Float32Array;
  ss: Float32Array;
  length: number;
  speed: number;
  next: number[]; // ids of following pieces
  // lane-only
  roadId: number;
  dir: 1 | -1;
  laneIndex: number;
  lanesPerDir: number;
  fromNode: number;
  toNode: number;
  /** For lanes: axis of approach to the end node, for signals. */
  approachAxis: Axis | null;
  /** For connectors: the turn type and lane ids. */
  turn: Turn;
  fromLane: number;
  toLane: number;
  /** Sibling lanes on the same road and direction (for lane changes). */
  siblings: number[];
}

export type SignalColor = 'G' | 'Y' | 'R';

const GREEN = 17;
const YELLOW = 3;
const ALL_RED = 1.5;
export const SIGNAL_CYCLE = 2 * (GREEN + YELLOW + ALL_RED);

export class RoadGraph {
  readonly net: RoadNetworkDef;
  readonly pieces: PathPiece[] = [];
  readonly lanesByNodeOut = new Map<number, number[]>();
  readonly lanesByNodeIn = new Map<number, number[]>();
  readonly nodeClearance: number[] = [];
  readonly nodeDegree: number[] = [];
  private signalOffset: number[] = [];
  private grid = new Map<number, number[]>(); // cell -> packed piece<<12|pointIndex
  private readonly CELL = 40;
  private roadSegGrid = new Map<number, number[]>(); // cell -> packed road<<12|seg
  private roadPts: P2[][] = [];

  constructor(private readonly hf: HeightField) {
    this.net = buildRoadNetwork();
    this.build();
  }

  // ------------------------------------------------------------------ build
  private build(): void {
    const { nodes, roads } = this.net;
    for (const n of nodes) {
      this.nodeDegree[n.id] = 0;
      this.signalOffset[n.id] = hash1(n.id, 77) * SIGNAL_CYCLE;
    }
    for (const r of roads) {
      this.nodeDegree[r.a] = (this.nodeDegree[r.a] ?? 0) + 1;
      this.nodeDegree[r.b] = (this.nodeDegree[r.b] ?? 0) + 1;
    }
    // clearance per node = widest road half width at node (for 3+ way), small otherwise
    for (const n of nodes) {
      const deg = this.nodeDegree[n.id] ?? 0;
      let maxHalf = 0;
      for (const r of roads) if (r.a === n.id || r.b === n.id) maxHalf = Math.max(maxHalf, roadHalfWidth(r.cls));
      let c = 2;
      if (deg >= 3) c = maxHalf + (n.lights ? 5 : 3);
      else if (deg === 1) c = 4;
      else if (deg === 2) c = this.isStraightThrough(n) ? 0.5 : maxHalf * 0.6 + 1;
      this.nodeClearance[n.id] = c;
    }
    // lanes
    for (const r of roads) {
      const pts = resamplePolyline(r.pts, r.grid ? 25 : 6);
      this.roadPts[r.id] = pts;
      const spec = ROAD_SPECS[r.cls];
      for (const dir of [1, -1] as const) {
        const siblingIds: number[] = [];
        for (let k = 0; k < spec.lanesPerDir; k++) {
          const off = spec.medianW / 2 + spec.laneW * (k + 0.5);
          const base = dir === 1 ? pts : pts.slice().reverse();
          const fromNode = dir === 1 ? r.a : r.b;
          const toNode = dir === 1 ? r.b : r.a;
          const lanePts = offsetPolyline(base, off);
          const trimmed = trimPolyline(lanePts, this.nodeClearance[fromNode] ?? 2, this.nodeClearance[toNode] ?? 2);
          if (trimmed.length < 2) continue;
          const piece = this.makePiece('lane', trimmed, r, spec.speed);
          piece.dir = dir;
          piece.laneIndex = k;
          piece.lanesPerDir = spec.lanesPerDir;
          piece.fromNode = fromNode;
          piece.toNode = toNode;
          const n = trimmed.length;
          const end = trimmed[n - 1] as P2;
          const prev = trimmed[n - 2] as P2;
          piece.approachAxis = Math.abs(end.x - prev.x) > Math.abs(end.z - prev.z) ? 'x' : 'z';
          siblingIds.push(piece.id);
          pushMap(this.lanesByNodeOut, fromNode, piece.id);
          pushMap(this.lanesByNodeIn, toNode, piece.id);
        }
        for (const id of siblingIds) {
          const p = this.pieces[id];
          if (p) p.siblings = siblingIds.filter((s) => s !== id);
        }
      }
      // road segment index for surface queries
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i] as P2;
        const b = pts[i + 1] as P2;
        const hw = roadHalfWidth(r.cls) + 0.5;
        this.indexSeg(this.roadSegGrid, a, b, hw, (r.id << 12) | i);
      }
    }
    // connectors
    for (const n of nodes) this.buildConnectors(n);
    // spatial grid of lane points
    for (const p of this.pieces) {
      if (p.kind !== 'lane') continue;
      for (let i = 0; i < p.xs.length; i++) {
        const key = this.key(Math.floor((p.xs[i] as number) / this.CELL), Math.floor((p.zs[i] as number) / this.CELL));
        pushMap(this.grid, key, (p.id << 12) | i);
      }
      // dense sampling along long segments
      for (let i = 0; i < p.xs.length - 1; i++) {
        const L = (p.ss[i + 1] as number) - (p.ss[i] as number);
        const steps = Math.floor(L / (this.CELL * 0.5));
        for (let k = 1; k <= steps; k++) {
          const t = k / (steps + 1);
          const x = lerp(p.xs[i] as number, p.xs[i + 1] as number, t);
          const z = lerp(p.zs[i] as number, p.zs[i + 1] as number, t);
          pushMap(this.grid, this.key(Math.floor(x / this.CELL), Math.floor(z / this.CELL)), (p.id << 12) | i);
        }
      }
    }
  }

  private isStraightThrough(n: NodeDef): boolean {
    const dirs: number[] = [];
    for (const r of this.net.roads) {
      if (r.a === n.id) {
        const p1 = r.pts[1] as P2;
        dirs.push(yawOf(p1.x - n.x, p1.z - n.z));
      } else if (r.b === n.id) {
        const p1 = r.pts[r.pts.length - 2] as P2;
        dirs.push(yawOf(p1.x - n.x, p1.z - n.z));
      }
    }
    if (dirs.length !== 2) return false;
    return Math.abs(Math.abs(wrapAngle((dirs[0] as number) - (dirs[1] as number))) - Math.PI) < 0.2;
  }

  private indexSeg(grid: Map<number, number[]>, a: P2, b: P2, pad: number, packed: number): void {
    const x0 = Math.min(a.x, b.x) - pad;
    const x1 = Math.max(a.x, b.x) + pad;
    const z0 = Math.min(a.z, b.z) - pad;
    const z1 = Math.max(a.z, b.z) + pad;
    for (let cz = Math.floor(z0 / this.CELL); cz <= Math.floor(z1 / this.CELL); cz++) {
      for (let cx = Math.floor(x0 / this.CELL); cx <= Math.floor(x1 / this.CELL); cx++) {
        pushMap(grid, this.key(cx, cz), packed);
      }
    }
  }

  private makePiece(kind: 'lane' | 'conn', pts: P2[], r: RoadDef | null, speed: number, ys?: number[]): PathPiece {
    const n = pts.length;
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    const yv = new Float32Array(n);
    const ss = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i] as P2;
      xs[i] = p.x;
      zs[i] = p.z;
      yv[i] = ys ? (ys[i] as number) : this.roadY(p.x, p.z, r);
      ss[i] = i === 0 ? 0 : (ss[i - 1] as number) + Math.hypot(p.x - (xs[i - 1] as number), p.z - (zs[i - 1] as number));
    }
    const piece: PathPiece = {
      id: this.pieces.length,
      kind,
      xs,
      ys: yv,
      zs,
      ss,
      length: ss[n - 1] as number,
      speed,
      next: [],
      roadId: r ? r.id : -1,
      dir: 1,
      laneIndex: 0,
      lanesPerDir: 1,
      fromNode: -1,
      toNode: -1,
      approachAxis: null,
      turn: 'S',
      fromLane: -1,
      toLane: -1,
      siblings: [],
    };
    this.pieces.push(piece);
    return piece;
  }

  /** Road surface height at a point of road r (null = generic terrain). */
  roadY(x: number, z: number, r: RoadDef | null): number {
    if (r && r.elevated) {
      const dh = deckHeight(z);
      return Math.max(CITY_Y + ROAD_DECK_LIFT + dh, this.hf.heightAt(x, z) + ROAD_LIFT);
    }
    return this.hf.heightAt(x, z) + ROAD_LIFT;
  }

  private buildConnectors(n: NodeDef): void {
    const ins = this.lanesByNodeIn.get(n.id) ?? [];
    const outs = this.lanesByNodeOut.get(n.id) ?? [];
    const deg = this.nodeDegree[n.id] ?? 0;
    for (const inId of ins) {
      const a = this.pieces[inId] as PathPiece;
      const ia = a.xs.length - 1;
      const inYaw = yawOf((a.xs[ia] as number) - (a.xs[ia - 1] as number), (a.zs[ia] as number) - (a.zs[ia - 1] as number));
      for (const outId of outs) {
        const b = this.pieces[outId] as PathPiece;
        const isSameRoad = b.roadId === a.roadId;
        if (isSameRoad && deg > 1) continue;
        const outYaw = yawOf((b.xs[1] as number) - (b.xs[0] as number), (b.zs[1] as number) - (b.zs[0] as number));
        const d = wrapAngle(outYaw - inYaw);
        let turn: Turn;
        if (isSameRoad) turn = 'U';
        else if (deg === 2 || Math.abs(d) < 0.55) turn = 'S';
        else if (Math.abs(d) > 2.6) continue; // sharp reverse onto another road: skip
        else turn = d < 0 ? 'R' : 'L';
        // lane discipline
        const lastA = a.lanesPerDir - 1;
        const lastB = b.lanesPerDir - 1;
        if (turn === 'S' || turn === 'U') {
          if (Math.min(a.laneIndex, lastB) !== b.laneIndex) continue;
        } else if (turn === 'R') {
          if (a.laneIndex !== lastA || b.laneIndex !== lastB) continue;
        } else {
          if (a.laneIndex !== 0 || b.laneIndex !== 0) continue;
        }
        const conn = this.makeConnector(a, b, turn, n);
        a.next.push(conn.id);
      }
      if (a.next.length === 0) {
        // Fallback so no lane is a dead end: pick the outgoing lane with the closest heading.
        let best: PathPiece | null = null;
        let bestD = Infinity;
        for (const outId of outs) {
          const b = this.pieces[outId] as PathPiece;
          if (b.roadId === a.roadId && deg > 1) continue;
          const outYaw = yawOf((b.xs[1] as number) - (b.xs[0] as number), (b.zs[1] as number) - (b.zs[0] as number));
          const d = Math.abs(wrapAngle(outYaw - inYaw));
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
        if (best) {
          const dd = wrapAngle(
            yawOf((best.xs[1] as number) - (best.xs[0] as number), (best.zs[1] as number) - (best.zs[0] as number)) - inYaw,
          );
          const turn: Turn = best.roadId === a.roadId ? 'U' : Math.abs(dd) < 0.55 ? 'S' : dd < 0 ? 'R' : 'L';
          a.next.push(this.makeConnector(a, best, turn, n).id);
        }
      }
    }
  }

  private makeConnector(a: PathPiece, b: PathPiece, turn: Turn, n: NodeDef): PathPiece {
    const ia = a.xs.length - 1;
    const p0 = { x: a.xs[ia] as number, z: a.zs[ia] as number };
    const p2 = { x: b.xs[0] as number, z: b.zs[0] as number };
    const dIn = norm2((a.xs[ia] as number) - (a.xs[ia - 1] as number), (a.zs[ia] as number) - (a.zs[ia - 1] as number));
    const dOut = norm2((b.xs[1] as number) - (b.xs[0] as number), (b.zs[1] as number) - (b.zs[0] as number));
    const pts: P2[] = [];
    const y0 = a.ys[ia] as number;
    const y2 = b.ys[0] as number;
    const ys: number[] = [];
    const span = Math.hypot(p2.x - p0.x, p2.z - p0.z);
    const N = Math.max(4, Math.min(14, Math.ceil(span / 2.5)));
    if (turn === 'U') {
      const c1 = { x: p0.x + dIn.x * 7, z: p0.z + dIn.z * 7 };
      const c2 = { x: p2.x - dOut.x * 7, z: p2.z - dOut.z * 7 };
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const u = 1 - t;
        pts.push({
          x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
          z: u * u * u * p0.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * p2.z,
        });
        ys.push(lerp(y0, y2, t));
      }
    } else {
      let c = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
      const cross = dIn.x * dOut.z - dIn.z * dOut.x;
      if (Math.abs(cross) > 0.05) {
        // intersection of the two lines
        const t = ((p2.x - p0.x) * dOut.z - (p2.z - p0.z) * dOut.x) / cross;
        if (t > 0 && t < span * 2) c = { x: p0.x + dIn.x * t, z: p0.z + dIn.z * t };
      }
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const u = 1 - t;
        pts.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * c.z + t * t * p2.z });
        ys.push(lerp(y0, y2, t));
      }
    }
    const speed = turn === 'S' ? Math.min(a.speed, b.speed) : turn === 'U' ? 4 : 7;
    const piece = this.makePiece('conn', pts, null, speed, ys);
    piece.turn = turn;
    piece.fromLane = a.id;
    piece.toLane = b.id;
    piece.fromNode = n.id;
    piece.toNode = n.id;
    piece.next = [b.id];
    return piece;
  }

  // ------------------------------------------------------------------ queries
  private key(cx: number, cz: number): number {
    return (cx + 2000) * 8192 + (cz + 2000);
  }

  signal(nodeId: number, axis: Axis, time: number): SignalColor {
    const node = this.net.nodes[nodeId];
    if (!node || !node.lights) return 'G';
    let t = (time + (this.signalOffset[nodeId] ?? 0)) % SIGNAL_CYCLE;
    if (t < 0) t += SIGNAL_CYCLE;
    const half = GREEN + YELLOW + ALL_RED;
    const zPhase = t < half;
    const local = zPhase ? t : t - half;
    const mine = (axis === 'z') === zPhase;
    if (!mine) return 'R';
    if (local < GREEN) return 'G';
    if (local < GREEN + YELLOW) return 'Y';
    return 'R';
  }

  /** Pedestrians may cross a road running along `roadAxis` when its traffic is red. */
  pedWalk(nodeId: number, roadAxis: Axis, time: number): boolean {
    const node = this.net.nodes[nodeId];
    if (!node || !node.lights) return true;
    const other: Axis = roadAxis === 'x' ? 'z' : 'x';
    return this.signal(nodeId, other, time) === 'G' && this.signal(nodeId, roadAxis, time) === 'R';
  }

  /** Point at arc length s along piece. Writes into out. */
  sample(p: PathPiece, s: number, out: { x: number; y: number; z: number; yaw: number }): void {
    const n = p.xs.length;
    s = clamp(s, 0, p.length);
    // binary search segment
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((p.ss[mid] as number) <= s) lo = mid;
      else hi = mid;
    }
    const s0 = p.ss[lo] as number;
    const s1 = p.ss[hi] as number;
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    out.x = lerp(p.xs[lo] as number, p.xs[hi] as number, t);
    out.y = lerp(p.ys[lo] as number, p.ys[hi] as number, t);
    out.z = lerp(p.zs[lo] as number, p.zs[hi] as number, t);
    out.yaw = yawOf((p.xs[hi] as number) - (p.xs[lo] as number), (p.zs[hi] as number) - (p.zs[lo] as number));
  }

  /** Nearest lane (and arc length) to a point, optionally aligned with a heading. */
  nearestLane(x: number, z: number, maxDist = 40, heading?: number, refY?: number): { piece: PathPiece; s: number; d: number } | null {
    let best: { piece: PathPiece; s: number; d: number } | null = null;
    const cx = Math.floor(x / this.CELL);
    const cz = Math.floor(z / this.CELL);
    const tmp = { t: 0 };
    const seen = new Set<number>();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this.grid.get(this.key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const packed of arr) {
          if (seen.has(packed)) continue;
          seen.add(packed);
          const p = this.pieces[packed >>> 12] as PathPiece;
          const i = packed & 0xfff;
          if (i >= p.xs.length - 1) continue;
          const ax = p.xs[i] as number;
          const az = p.zs[i] as number;
          const bx = p.xs[i + 1] as number;
          const bz = p.zs[i + 1] as number;
          let d = pointSegDist(x, z, ax, az, bx, bz, tmp);
          if (refY !== undefined) {
            const y = lerp(p.ys[i] as number, p.ys[i + 1] as number, tmp.t);
            if (Math.abs(y - refY) > 3.5) continue;
          }
          if (heading !== undefined) {
            const yaw = yawOf(bx - ax, bz - az);
            const diff = Math.abs(wrapAngle(yaw - heading));
            if (diff > Math.PI / 2) continue;
            d += diff * 4;
          }
          if (d < maxDist && (!best || d < best.d)) {
            best = { piece: p, s: lerp(p.ss[i] as number, p.ss[i + 1] as number, tmp.t), d };
          }
        }
      }
    }
    return best;
  }

  /** True if (x,z) lies on any road surface. Returns road class or null. */
  roadAt(x: number, z: number): RoadDef | null {
    const arr = this.roadSegGrid.get(this.key(Math.floor(x / this.CELL), Math.floor(z / this.CELL)));
    if (!arr) return null;
    const tmp = { t: 0 };
    for (const packed of arr) {
      const r = this.net.roads[packed >>> 12] as RoadDef;
      const pts = this.roadPts[r.id] as P2[];
      const i = packed & 0xfff;
      const a = pts[i] as P2;
      const b = pts[i + 1] as P2;
      const d = pointSegDist(x, z, a.x, a.z, b.x, b.z, tmp);
      if (d <= roadHalfWidth(r.cls)) return r;
    }
    return null;
  }

  /** Distance to the nearest road edge (negative inside). Coarse, for placement. */
  roadClearance(x: number, z: number): number {
    const arr = this.roadSegGrid.get(this.key(Math.floor(x / this.CELL), Math.floor(z / this.CELL)));
    if (!arr) return 99;
    let best = 99;
    const tmp = { t: 0 };
    for (const packed of arr) {
      const r = this.net.roads[packed >>> 12] as RoadDef;
      const pts = this.roadPts[r.id] as P2[];
      const i = packed & 0xfff;
      const a = pts[i] as P2;
      const b = pts[i + 1] as P2;
      const d = pointSegDist(x, z, a.x, a.z, b.x, b.z, tmp) - roadHalfWidth(r.cls) - ROAD_SPECS[r.cls].sidewalkW;
      if (d < best) best = d;
    }
    return best;
  }

  nodePos(id: number): P2 {
    const n = this.net.nodes[id];
    return n ? { x: n.x, z: n.z } : { x: 0, z: 0 };
  }

  nearestNode(x: number, z: number): number {
    let best = 0;
    let bd = Infinity;
    for (const n of this.net.nodes) {
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  /** A* over intersections. Returns node id path (inclusive) or empty array. */
  route(fromNode: number, toNode: number): number[] {
    if (fromNode === toNode) return [fromNode];
    const nodes = this.net.nodes;
    const adj = this.adjacency();
    const g = new Map<number, number>();
    const came = new Map<number, number>();
    const open: { id: number; f: number }[] = [];
    const goal = nodes[toNode] as NodeDef;
    const h = (id: number): number => {
      const n = nodes[id] as NodeDef;
      return Math.hypot(n.x - goal.x, n.z - goal.z);
    };
    g.set(fromNode, 0);
    open.push({ id: fromNode, f: h(fromNode) });
    const closed = new Set<number>();
    let guard = 0;
    while (open.length > 0 && guard++ < 20000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if ((open[i] as { f: number }).f < (open[bi] as { f: number }).f) bi = i;
      const cur = open.splice(bi, 1)[0] as { id: number; f: number };
      if (cur.id === toNode) {
        const path = [toNode];
        let c = toNode;
        while (came.has(c)) {
          c = came.get(c) as number;
          path.push(c);
        }
        return path.reverse();
      }
      if (closed.has(cur.id)) continue;
      closed.add(cur.id);
      for (const e of adj[cur.id] ?? []) {
        const ng = (g.get(cur.id) ?? 0) + e.len;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng);
          came.set(e.to, cur.id);
          open.push({ id: e.to, f: ng + h(e.to) });
        }
      }
    }
    return [];
  }

  private adjCache: { to: number; len: number; road: number }[][] | null = null;
  adjacency(): { to: number; len: number; road: number }[][] {
    if (this.adjCache) return this.adjCache;
    const adj: { to: number; len: number; road: number }[][] = [];
    for (const n of this.net.nodes) adj[n.id] = [];
    for (const r of this.net.roads) {
      let len = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1] as P2;
        const b = r.pts[i] as P2;
        len += Math.hypot(b.x - a.x, b.z - a.z);
      }
      (adj[r.a] as { to: number; len: number; road: number }[]).push({ to: r.b, len, road: r.id });
      (adj[r.b] as { to: number; len: number; road: number }[]).push({ to: r.a, len, road: r.id });
    }
    this.adjCache = adj;
    return adj;
  }

  lanes(): PathPiece[] {
    return this.pieces.filter((p) => p.kind === 'lane');
  }
}

function pushMap(m: Map<number, number[]>, k: number, v: number): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function norm2(x: number, z: number): P2 {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

/** Offset a polyline to the right of its travel direction. */
export function offsetPolyline(pts: readonly P2[], off: number): P2[] {
  const out: P2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i] as P2;
    const a = pts[Math.max(0, i - 1)] as P2;
    const b = pts[Math.min(n - 1, i + 1)] as P2;
    const d = norm2(b.x - a.x, b.z - a.z);
    // right vector for direction d (see math.ts: right = (-cos yaw, sin yaw) with fwd=(sin,cos))
    const rx = -d.z;
    const rz = d.x;
    out.push({ x: p.x + rx * off, z: p.z + rz * off });
  }
  return out;
}

/** Remove `a` meters from the start and `b` meters from the end. */
export function trimPolyline(pts: readonly P2[], a: number, b: number): P2[] {
  const total = polyLen(pts);
  if (total <= a + b + 1) return [];
  const out: P2[] = [];
  let s = 0;
  const startS = a;
  const endS = total - b;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i] as P2;
    const q = pts[i + 1] as P2;
    const L = Math.hypot(q.x - p.x, q.z - p.z);
    const s0 = s;
    const s1 = s + L;
    if (s1 >= startS && s0 <= endS) {
      if (out.length === 0) {
        const t = L > 0 ? clamp((startS - s0) / L, 0, 1) : 0;
        out.push({ x: lerp(p.x, q.x, t), z: lerp(p.z, q.z, t) });
      }
      if (s1 <= endS) out.push({ x: q.x, z: q.z });
      else {
        const t = L > 0 ? clamp((endS - s0) / L, 0, 1) : 0;
        out.push({ x: lerp(p.x, q.x, t), z: lerp(p.z, q.z, t) });
        break;
      }
    }
    s = s1;
  }
  // drop duplicates
  const res: P2[] = [];
  for (const p of out) {
    const last = res[res.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.05) res.push(p);
  }
  return res;
}

function polyLen(pts: readonly P2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as P2;
    const b = pts[i] as P2;
    L += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return L;
}
