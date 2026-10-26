// Terrain height field. Baked once into a Float32Array (4 m spacing) and sampled
// bilinearly by physics and mesh builders, so rendering and simulation agree.

import { clamp, lerp, pointSegDist, smoothstep } from '../core/math';
import { resamplePolyline } from '../core/poly';
import { fbm, noise2, ridged } from '../core/noise';
import {
  CITY_Y,
  LAKE,
  PORT,
  WORLD_HALF,
  buildRoadNetwork,
  coastDistance,
  deckHeight,
  flatMask,
  freewayHalfWidth,
  FREEWAY_X,
  inPort,
  roadHalfWidth,
  type P2,
  type RoadDef,
} from './layout';

export const HM_RES = 4; // meters per sample
export const HM_N = Math.round((WORLD_HALF * 2) / HM_RES) + 1; // samples per side

export interface RoadProfile {
  road: RoadDef;
  xs: Float32Array;
  zs: Float32Array;
  hs: Float32Array;
  ss: Float32Array; // arc length
  halfW: number;
}

export class HeightField {
  readonly data: Float32Array;
  lakeLevel = 30;
  readonly profiles: RoadProfile[] = [];
  private segGrid = new Map<number, number[]>(); // cell -> packed (profileIdx<<16 | segIdx)
  private readonly SEG_CELL = 64;

  constructor() {
    this.data = new Float32Array(HM_N * HM_N);
  }

  /** Raw procedural land height before roads/lake/coast shaping. */
  static landHeight(x: number, z: number): number {
    const fm = flatMask(x, z);
    if (fm >= 1) return CITY_Y;
    const rolling = 5 + 9 * fbm(x / 430 + 3.1, z / 430 - 1.7, 4) + 2.5 * fbm(x / 95, z / 95, 3);
    const nf = smoothstep(-1080, -1960, z);
    const wf = smoothstep(-1760, -1995, x);
    const m = Math.max(nf, wf);
    const mountain = m * m * (80 + 320 * ridged(x / 640 + 11.3, z / 640 - 7.1, 5));
    // gentle hills just north of the grid (Vista Hills)
    const hills = smoothstep(-940, -1150, z) * (1 - nf) * 18 * (0.6 + 0.4 * noise2(x / 260, z / 260));
    const relief = Math.max(0, rolling) + mountain + hills;
    return CITY_Y + (1 - fm) * relief;
  }

  /** Bake the full height field. `onProgress` gets 0..1. */
  bake(onProgress?: (p: number) => void): void {
    this.buildProfiles();
    // lake level: lowest land on a ring around the lake, minus a margin
    let ringMin = Infinity;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ringMin = Math.min(ringMin, HeightField.landHeight(LAKE.x + Math.cos(a) * 215, LAKE.z + Math.sin(a) * 215));
    }
    this.lakeLevel = ringMin - 1.2;
    const N = HM_N;
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + j * HM_RES;
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * HM_RES;
        this.data[j * N + i] = this.computeHeight(x, z);
      }
      if (onProgress && (j & 63) === 0) onProgress(j / N);
    }
    onProgress?.(1);
  }

  private computeHeight(x: number, z: number): number {
    let h = HeightField.landHeight(x, z);
    // Lake basin
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < 240) {
      const bed = this.lakeLevel - 0.6 - 9 * Math.max(0, 1 - (dl / LAKE.r) * (dl / LAKE.r));
      h = lerp(bed, h, smoothstep(LAKE.r - 15, 235, dl));
    }
    // Roads outside the flat city cut into the terrain.
    h = this.applyRoadFlatten(x, z, h);
    // Coast
    const dc = coastDistance(x, z);
    if (inPort(x, z) && z < PORT.z1 + 10) {
      if (x > PORT.x1) return -13;
      return Math.max(h, CITY_Y + 0.3);
    }
    if (dc < 140) {
      if (dc >= 0) {
        const shore = 0.28 + 0.15 * noise2(x / 30, z / 30);
        h = lerp(shore, h, smoothstep(0, 140, dc));
      } else {
        const ripple = 0.25 * noise2(x / 12, z / 12);
        h = Math.max(-46, 0.28 + dc * 0.055 + ripple);
      }
    }
    return h;
  }

  private buildProfiles(): void {
    const net = buildRoadNetwork();
    for (const road of net.roads) {
      if (road.grid || road.elevated) continue;
      const pts = resamplePolyline(road.pts, 4);
      const n = pts.length;
      const xs = new Float32Array(n);
      const zs = new Float32Array(n);
      const hs = new Float32Array(n);
      const ss = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = pts[i] as P2;
        xs[i] = p.x;
        zs[i] = p.z;
        hs[i] = HeightField.landHeight(p.x, p.z);
        ss[i] = i === 0 ? 0 : (ss[i - 1] as number) + Math.hypot(p.x - (xs[i - 1] as number), p.z - (zs[i - 1] as number));
      }
      // smooth heights (moving average, 3 passes)
      const W = 14;
      for (let pass = 0; pass < 3; pass++) {
        const copy = hs.slice();
        for (let i = 0; i < n; i++) {
          let sum = 0;
          let cnt = 0;
          for (let k = -W; k <= W; k++) {
            const idx = clamp(i + k, 0, n - 1);
            sum += copy[idx] as number;
            cnt++;
          }
          hs[i] = sum / cnt;
        }
      }
      // endpoints touching the flat city must match CITY_Y exactly
      for (let i = 0; i < n; i++) {
        const fm = flatMask(xs[i] as number, zs[i] as number, 60);
        hs[i] = lerp(hs[i] as number, CITY_Y, fm);
      }
      // grade limit (forward and backward passes)
      const maxGrade = 0.11;
      for (let it = 0; it < 2; it++) {
        for (let i = 1; i < n; i++) {
          const ds = (ss[i] as number) - (ss[i - 1] as number);
          hs[i] = clamp(hs[i] as number, (hs[i - 1] as number) - maxGrade * ds, (hs[i - 1] as number) + maxGrade * ds);
        }
        for (let i = n - 2; i >= 0; i--) {
          const ds = (ss[i + 1] as number) - (ss[i] as number);
          hs[i] = clamp(hs[i] as number, (hs[i + 1] as number) - maxGrade * ds, (hs[i + 1] as number) + maxGrade * ds);
        }
      }
      const pi = this.profiles.length;
      this.profiles.push({ road, xs, zs, hs, ss, halfW: roadHalfWidth(road.cls) });
      for (let i = 0; i < n - 1; i++) {
        const x0 = Math.min(xs[i] as number, xs[i + 1] as number) - 40;
        const x1 = Math.max(xs[i] as number, xs[i + 1] as number) + 40;
        const z0 = Math.min(zs[i] as number, zs[i + 1] as number) - 40;
        const z1 = Math.max(zs[i] as number, zs[i + 1] as number) + 40;
        for (let cz = Math.floor(z0 / this.SEG_CELL); cz <= Math.floor(z1 / this.SEG_CELL); cz++) {
          for (let cx = Math.floor(x0 / this.SEG_CELL); cx <= Math.floor(x1 / this.SEG_CELL); cx++) {
            const key = this.cellKey(cx, cz);
            let arr = this.segGrid.get(key);
            if (!arr) {
              arr = [];
              this.segGrid.set(key, arr);
            }
            arr.push((pi << 16) | i);
          }
        }
      }
    }
  }

  private cellKey(cx: number, cz: number): number {
    return (cx + 1000) * 4096 + (cz + 1000);
  }

  private tmpT = { t: 0 };

  /** Nearest rural road centerline: returns distance and profile height, or null. */
  nearestRural(x: number, z: number): { d: number; h: number; halfW: number } | null {
    const arr = this.segGrid.get(this.cellKey(Math.floor(x / this.SEG_CELL), Math.floor(z / this.SEG_CELL)));
    if (!arr) return null;
    let best = Infinity;
    let bestH = 0;
    let bestW = 0;
    for (const packed of arr) {
      const pi = packed >>> 16;
      const si = packed & 0xffff;
      const p = this.profiles[pi];
      if (!p) continue;
      const d = pointSegDist(x, z, p.xs[si] as number, p.zs[si] as number, p.xs[si + 1] as number, p.zs[si + 1] as number, this.tmpT);
      if (d < best) {
        best = d;
        bestH = lerp(p.hs[si] as number, p.hs[si + 1] as number, this.tmpT.t);
        bestW = p.halfW;
      }
    }
    if (best === Infinity) return null;
    return { d: best, h: bestH, halfW: bestW };
  }

  private applyRoadFlatten(x: number, z: number, h: number): number {
    const nr = this.nearestRural(x, z);
    if (!nr) return h;
    const inner = nr.halfW + 2.5;
    const outer = nr.halfW + 30;
    if (nr.d >= outer) return h;
    const w = 1 - smoothstep(inner, outer, nr.d);
    return lerp(h, nr.h, w);
  }

  /** Bilinear terrain height. */
  heightAt(x: number, z: number): number {
    const fx = clamp((x + WORLD_HALF) / HM_RES, 0, HM_N - 1.0001);
    const fz = clamp((z + WORLD_HALF) / HM_RES, 0, HM_N - 1.0001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const N = HM_N;
    const d = this.data;
    const h00 = d[j * N + i] as number;
    const h10 = d[j * N + i + 1] as number;
    const h01 = d[(j + 1) * N + i] as number;
    const h11 = d[(j + 1) * N + i + 1] as number;
    // split the cell into two triangles the same way PlaneGeometry does
    if (tx + tz < 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  /** Approximate slope magnitude (rise/run). */
  slopeAt(x: number, z: number): number {
    const e = HM_RES;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  /**
   * Ground height for something at (x,z) currently at height refY.
   * Takes the elevated freeway deck into account.
   */
  groundAt(x: number, z: number, refY: number): number {
    const t = this.heightAt(x, z);
    if (Math.abs(x - FREEWAY_X) < freewayHalfWidth() + 0.8) {
      const dh = deckHeight(z);
      if (dh > 0.05) {
        const deckY = CITY_Y + ROAD_DECK_LIFT + dh;
        if (refY > deckY - 2.6) return Math.max(deckY, t);
      }
    }
    return t;
  }

  /** True if (x,z) is on the freeway deck at height refY. */
  onDeck(x: number, z: number, refY: number): boolean {
    if (Math.abs(x - FREEWAY_X) > freewayHalfWidth() + 0.8) return false;
    const dh = deckHeight(z);
    return dh > 0.05 && refY > CITY_Y + dh - 2.6;
  }
}

export const ROAD_DECK_LIFT = 0.05;

