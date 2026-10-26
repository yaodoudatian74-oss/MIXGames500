// Unified ground model used by vehicles, the player and pedestrians:
// terrain + raised city blocks (curbs) + freeway deck, plus surface friction.

import { clamp } from '../core/math';
import type { RoadGraph } from '../sim/roadGraph';
import type { Ground } from '../sim/vehiclePhysics';
import { HeightField } from './heightmap';
import { CITY_Y, LAKE, PORT, SEA_LEVEL, TOWN_X, TOWN_Z, X_LINES, Z_LINES, AIRPORT_RECT, coastDistance, inRect } from './layout';
import type { Block } from './worldgen';

export const CURB_H = 0.15;

export type SurfaceKind = 'asphalt' | 'concrete' | 'grass' | 'dirt' | 'sand' | 'rock' | 'water';

export interface Platform {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h0: number; // height at x0
  h1: number; // height at x1
}

export class GroundModel implements Ground {
  wetness = 0;
  readonly platforms: Platform[] = [];
  private cityBlocks: (Block | null)[][] = [];
  private townBlocks: (Block | null)[][] = [];

  constructor(
    readonly hf: HeightField,
    readonly graph: RoadGraph,
    blocks: Block[],
  ) {
    for (let i = 0; i < X_LINES.length - 1; i++) {
      this.cityBlocks.push(new Array<Block | null>(Z_LINES.length - 1).fill(null));
    }
    for (let i = 0; i < TOWN_X.length - 1; i++) {
      this.townBlocks.push(new Array<Block | null>(TOWN_Z.length - 1).fill(null));
    }
    for (const b of blocks) {
      const [sx, sz] = b.key.split(',').map(Number) as [number, number];
      let i = X_LINES.indexOf(sx);
      let j = Z_LINES.indexOf(sz);
      if (i >= 0 && j >= 0 && b.zone !== 'town') {
        const row = this.cityBlocks[i];
        if (row) row[j] = b;
        continue;
      }
      i = TOWN_X.indexOf(sx);
      j = TOWN_Z.indexOf(sz);
      if (i >= 0 && j >= 0) {
        const row = this.townBlocks[i];
        if (row) row[j] = b;
      }
    }
  }

  /** The block whose outer rect (sidewalk + lots) contains (x,z), if any. */
  blockAt(x: number, z: number): Block | null {
    const find = (lines: number[], v: number): number => {
      if (v < (lines[0] as number) || v > (lines[lines.length - 1] as number)) return -1;
      for (let k = 0; k < lines.length - 1; k++) if (v >= (lines[k] as number) && v <= (lines[k + 1] as number)) return k;
      return -1;
    };
    let i = find(X_LINES, x);
    let j = find(Z_LINES, z);
    let b: Block | null = null;
    if (i >= 0 && j >= 0) b = this.cityBlocks[i]?.[j] ?? null;
    else {
      i = find(TOWN_X, x);
      j = find(TOWN_Z, z);
      if (i >= 0 && j >= 0) b = this.townBlocks[i]?.[j] ?? null;
    }
    if (!b) return null;
    const o = b.outer;
    if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1) return b;
    return null;
  }

  addPlatform(p: Platform): void {
    this.platforms.push(p);
  }

  groundAt(x: number, z: number, refY: number): number {
    let g = this.hf.groundAt(x, z, refY);
    for (const p of this.platforms) {
      if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
      const h = p.h0 + ((p.h1 - p.h0) * (x - p.x0)) / Math.max(0.01, p.x1 - p.x0);
      if (refY > h - 2.2) g = Math.max(g, h);
    }
    if (g > CITY_Y + 0.5) return g; // deck or hills
    const b = this.blockAt(x, z);
    if (b) return Math.max(g, CITY_Y + CURB_H);
    return g;
  }

  /** Water surface height at (x,z) or -Infinity when there is no water. */
  waterAt(x: number, z: number): number {
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < LAKE.r + 30) return this.hf.lakeLevel;
    if (coastDistance(x, z) < 25 || (x > PORT.x1 && z > PORT.z0 - 30)) return SEA_LEVEL;
    return -Infinity;
  }

  surfaceKind(x: number, z: number, y: number): SurfaceKind {
    if (this.hf.onDeck(x, z, y)) return 'asphalt';
    const t = this.hf.heightAt(x, z);
    const w = this.waterAt(x, z);
    if (w > t + 0.4) return 'water';
    if (this.graph.roadAt(x, z)) return 'asphalt';
    if (this.blockAt(x, z)) {
      const b = this.blockAt(x, z) as Block;
      if (b.ground === 'grass') {
        const o = b.outer;
        const edge = Math.min(x - o.x0, o.x1 - x, z - o.z0, o.z1 - z);
        return edge < b.sidewalkW ? 'concrete' : 'grass';
      }
      return 'concrete';
    }
    if (x >= PORT.x0 - 5 && z >= PORT.z0 - 10 && z <= PORT.z1 + 10) return 'concrete';
    if (inRect(AIRPORT_RECT, x, z)) {
      if (Math.abs(z - 1180) < 32 || (z > 700 && z < 1020 && x > -1700)) return 'asphalt';
      return 'grass';
    }
    const dc = coastDistance(x, z);
    if (dc < 150 && t < 3.5) return 'sand';
    const slope = this.hf.slopeAt(x, z);
    if (slope > 0.62 || t > 230) return 'rock';
    if (t > 60) return 'dirt';
    return 'grass';
  }

  surface(x: number, z: number, y: number): { mu: number; roll: number; offroad: boolean } {
    const k = this.surfaceKind(x, z, y);
    switch (k) {
      case 'asphalt':
        return { mu: 1.0, roll: 0.013, offroad: false };
      case 'concrete':
        return { mu: 0.95, roll: 0.015, offroad: false };
      case 'grass':
        return { mu: clamp(0.62 - this.wetness * 0.1, 0.4, 1), roll: 0.05, offroad: true };
      case 'dirt':
        return { mu: 0.7 - this.wetness * 0.15, roll: 0.045, offroad: true };
      case 'sand':
        return { mu: 0.52, roll: 0.09, offroad: true };
      case 'rock':
        return { mu: 0.82, roll: 0.03, offroad: true };
      case 'water':
        return { mu: 0.25, roll: 0.35, offroad: true };
    }
  }
}
