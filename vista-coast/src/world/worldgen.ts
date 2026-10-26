// Deterministic placement of blocks, buildings, vegetation and street props.
// Pure data: rendering builders and colliders read from this.

import { clamp, dist } from '../core/math';
import { resamplePolyline } from '../core/poly';
import { Rng, hash2 } from '../core/rng';
import { fbm, noise2 } from '../core/noise';
import { POIS, type Face, type PoiDef } from '../data/pois';
import type { RoadGraph } from '../sim/roadGraph';
import { offsetPolyline } from '../sim/roadGraph';
import { HeightField } from './heightmap';
import {
  AIRPORT_RECT,
  CITY_Y,
  FREEWAY,
  FREEWAY_X,
  LAKE,
  PORT,
  ROAD_SPECS,
  SIGN_POS,
  TOWN_X,
  TOWN_Z,
  X_LINES,
  Z_LINES,
  coastDistance,
  deckHeight,
  freewayHalfWidth,
  gridLineClass,
  inPort,
  roadHalfWidth,
  type P2,
  type Rect,
  type RoadClass,
} from './layout';

export type Zone =
  | 'downtown'
  | 'midtown'
  | 'residential'
  | 'beachfront'
  | 'industrial'
  | 'fwstrip'
  | 'town'
  | 'poi';

export interface Block {
  key: string;
  outer: Rect; // to road edges (includes sidewalk)
  inner: Rect; // buildable
  zone: Zone;
  poi: PoiDef | null;
  ground: 'concrete' | 'grass';
  sidewalkW: number;
}

export type BuildingStyle = 'glass' | 'office' | 'stucco' | 'brick' | 'industrial' | 'house' | 'villa' | 'poi' | 'terminal' | 'hangar';

export interface Building {
  id: number;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  baseY: number;
  style: BuildingStyle;
  color: number;
  roof: 'flat' | 'gable';
  tiers: number; // stepped towers
  seed: number;
  poi: PoiDef | null;
  sign: string | null;
  face: Face;
  storefront: boolean;
}

export type TreeType = 0 | 1 | 2 | 3 | 4 | 5; // palm, oak, pine, cypress, bush, small palm

export interface Tree {
  x: number;
  y: number;
  z: number;
  type: TreeType;
  scale: number;
  rot: number;
}

export interface StreetLight {
  x: number;
  y: number;
  z: number;
  yaw: number; // arm points along this yaw
  double: boolean;
}

export interface SignalHead {
  x: number;
  y: number;
  z: number;
  yaw: number; // facing direction (toward approaching traffic)
  node: number;
  axis: 'x' | 'z';
}

export interface Prop {
  kind: 'canopy' | 'bench' | 'bin' | 'hydrant' | 'busstop' | 'umbrella' | 'lifeguard' | 'towel' | 'rock' | 'container' | 'crane' | 'tank' | 'barrier' | 'cone' | 'pump' | 'chimney' | 'fountain' | 'planter';
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  color: number;
}

export interface ParkingSlot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  p: number; // occupancy probability
}

export interface Door {
  x: number;
  y: number;
  z: number;
  yaw: number; // facing outward
  interior: string;
  poi: PoiDef;
}

export interface WorldData {
  blocks: Block[];
  buildings: Building[];
  trees: Tree[];
  lights: StreetLight[];
  signals: SignalHead[];
  props: Prop[];
  parking: ParkingSlot[];
  lots: Rect[];
  plazas: Rect[];
  pillars: { x: number; z: number; h: number }[];
  doors: Door[];
  collectibles: { x: number; y: number; z: number }[];
  hillTrees: number;
}

const OFFICE_COLORS = [0xc9c4ba, 0xb7b2a8, 0xd8d2c4, 0x9c9a95, 0xe0d6c2, 0xaeb4b8, 0x8f8a80];
const GLASS_COLORS = [0x6f8796, 0x5e7380, 0x7d929c, 0x4f6470, 0x8aa0a8, 0x3f5560, 0x6a7f73];
const STUCCO_COLORS = [0xf3e3c8, 0xf1d2b6, 0xe8efe7, 0xf6e9d7, 0xe9d8c6, 0xdff0f0, 0xf4dcd2, 0xfff4e0];
const HOUSE_COLORS = [0xeadfc8, 0xd9cdb5, 0xc9d3d6, 0xe7e3dc, 0xd2c1a6, 0xb9c4b0, 0xe8d3c0, 0xcfc8bd];
const BRICK_COLORS = [0x9a5a44, 0x8b4f3c, 0xa6694f, 0x7d4a3a];
const INDUSTRIAL_COLORS = [0xa9aeb1, 0x8c9599, 0xb8b2a3, 0x7f8b8f, 0xc2c6c4];

export class WorldGen {
  readonly data: WorldData;
  private rng = new Rng(20261026);
  private bid = 0;

  constructor(
    private readonly hf: HeightField,
    private readonly graph: RoadGraph,
  ) {
    this.data = {
      blocks: [],
      buildings: [],
      trees: [],
      lights: [],
      signals: [],
      props: [],
      parking: [],
      lots: [],
      plazas: [],
      pillars: [],
      doors: [],
      collectibles: [],
      hillTrees: 0,
    };
  }

  generate(): WorldData {
    this.makeBlocks();
    for (const b of this.data.blocks) this.fillBlock(b);
    this.makeVillas();
    this.makeAirport();
    this.makePort();
    this.makeFreewayPillars();
    this.makeStreetFurniture();
    this.makeBeach();
    this.makeNature();
    this.makeCollectibles();
    return this.data;
  }

  // ----------------------------------------------------------------- blocks
  private makeBlocks(): void {
    const addGrid = (xs: number[], zs: number[], town: boolean): void => {
      for (let i = 0; i < xs.length - 1; i++) {
        for (let j = 0; j < zs.length - 1; j++) {
          const x0 = xs[i] as number;
          const x1 = xs[i + 1] as number;
          const z0 = zs[j] as number;
          const z1 = zs[j + 1] as number;
          const cx0: RoadClass = town ? 'street' : gridLineClass(x0);
          const cx1: RoadClass = town ? 'street' : gridLineClass(x1);
          const cz0: RoadClass = town ? 'street' : gridLineClass(z0);
          const cz1: RoadClass = town ? 'street' : gridLineClass(z1);
          const outer: Rect = {
            x0: x0 + roadHalfWidth(cx0),
            x1: x1 - roadHalfWidth(cx1),
            z0: z0 + roadHalfWidth(cz0),
            z1: z1 - roadHalfWidth(cz1),
          };
          const sw = 4.5;
          const inner: Rect = { x0: outer.x0 + sw, x1: outer.x1 - sw, z0: outer.z0 + sw, z1: outer.z1 - sw };
          const cx = (x0 + x1) / 2;
          const cz = (z0 + z1) / 2;
          const poi = POIS.find((p) => p.block && p.block[0] === x0 && p.block[1] === z0) ?? null;
          let zone: Zone;
          if (town) zone = 'town';
          else if (x0 === 600 && x1 === 750) zone = 'fwstrip';
          else if (cx > -150 && cx < 450 && cz > -750 && cz < -150) zone = 'downtown';
          else if (x0 === 750 && cz < 600) zone = 'beachfront';
          else if (cz > 600 && cx > -300 && cx < 600) zone = 'industrial';
          else if (cx > -450 && cx < 750 && cz > -900 && cz < 450) zone = 'midtown';
          else zone = 'residential';
          const ground = zone === 'residential' || zone === 'town' ? 'grass' : 'concrete';
          this.data.blocks.push({ key: x0 + ',' + z0, outer, inner, zone: poi ? 'poi' : zone, poi, ground: poi?.kind === 'park' ? 'grass' : ground, sidewalkW: sw });
          void cx;
        }
      }
    };
    addGrid(X_LINES, Z_LINES, false);
    addGrid(TOWN_X, TOWN_Z, true);
  }

  private addBuilding(b: Omit<Building, 'id' | 'seed' | 'baseY'> & { baseY?: number }): Building | null {
    // reject overlaps with existing buildings in the same area
    for (const o of this.data.buildings) {
      if (Math.abs(o.x - b.x) * 2 < o.w + b.w + 1.5 && Math.abs(o.z - b.z) * 2 < o.d + b.d + 1.5) return null;
    }
    if (Math.abs(b.x - FREEWAY_X) * 2 < b.w + freewayHalfWidth() * 2 + 4 && b.z > FREEWAY.zNorthGround - 20 && b.z < FREEWAY.zSouthGround + 20) return null;
    const baseY = b.baseY ?? this.minCornerHeight(b.x, b.z, b.w, b.d);
    const nb: Building = { ...b, id: this.bid++, seed: Math.floor(this.rng.next() * 1e6), baseY };
    this.data.buildings.push(nb);
    return nb;
  }

  private minCornerHeight(x: number, z: number, w: number, d: number): number {
    let m = Infinity;
    for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0]] as const) {
      m = Math.min(m, this.hf.heightAt(x + dx * w, z + dz * d));
    }
    return m;
  }

  private fillBlock(b: Block): void {
    const r = this.rng;
    const I = b.inner;
    const W = I.x1 - I.x0;
    const D = I.z1 - I.z0;
    if (W < 8 || D < 8) return;
    if (b.poi) {
      this.placePoi(b);
      return;
    }
    switch (b.zone) {
      case 'downtown': {
        const nx = 2;
        const nz = 2;
        const gap = 7;
        const lw = (W - gap * (nx - 1)) / nx;
        const ld = (D - gap * (nz - 1)) / nz;
        for (let i = 0; i < nx; i++) {
          for (let j = 0; j < nz; j++) {
            const cx = I.x0 + lw / 2 + i * (lw + gap);
            const cz = I.z0 + ld / 2 + j * (ld + gap);
            if (r.chance(0.12)) {
              this.data.plazas.push({ x0: cx - lw / 2, x1: cx + lw / 2, z0: cz - ld / 2, z1: cz + ld / 2 });
              this.addTree(cx - lw * 0.3, cz - ld * 0.3, 1, 1.1);
              this.addTree(cx + lw * 0.3, cz + ld * 0.3, 1, 1.0);
              this.addTree(cx + lw * 0.3, cz - ld * 0.3, 0, 1.0);
              this.addProp('fountain', cx, cz, 0, 1, 0xdddddd);
              continue;
            }
            const dc = dist(cx, cz, 150, -450);
            const f = clamp(1 - dc / 520, 0, 1);
            const h = 40 + 235 * Math.pow(f, 1.35) * r.range(0.55, 1.15);
            const glass = r.chance(0.62);
            const w = lw * r.range(0.74, 0.95);
            const d = ld * r.range(0.74, 0.95);
            this.addBuilding({
              x: cx,
              z: cz,
              w,
              d,
              h,
              style: glass ? 'glass' : 'office',
              color: glass ? r.pick(GLASS_COLORS) : r.pick(OFFICE_COLORS),
              roof: 'flat',
              tiers: h > 120 && r.chance(0.55) ? r.int(2, 3) : 1,
              poi: null,
              sign: null,
              face: 'n',
              storefront: true,
            });
          }
        }
        break;
      }
      case 'midtown':
      case 'fwstrip':
      case 'beachfront':
      case 'town':
      case 'residential':
      case 'industrial':
        this.perimeterBuildings(b);
        break;
      case 'poi':
        break;
    }
  }

  private perimeterBuildings(b: Block): void {
    const r = this.rng;
    const I = b.inner;
    const zone = b.zone;
    const W = I.x1 - I.x0;
    const D = I.z1 - I.z0;
    if (zone === 'industrial') {
      // a few big warehouses + tanks
      const n = r.int(2, 3);
      for (let k = 0; k < n; k++) {
        const w = r.range(34, 62);
        const d = r.range(26, 48);
        const x = r.range(I.x0 + w / 2, I.x1 - w / 2);
        const z = r.range(I.z0 + d / 2, I.z1 - d / 2);
        this.addBuilding({ x, z, w, d, h: r.range(9, 16), style: 'industrial', color: r.pick(INDUSTRIAL_COLORS), roof: r.chance(0.4) ? 'gable' : 'flat', tiers: 1, poi: null, sign: null, face: 'n', storefront: false });
      }
      for (let k = 0; k < 3; k++) {
        const x = r.range(I.x0 + 8, I.x1 - 8);
        const z = r.range(I.z0 + 8, I.z1 - 8);
        if (this.freeSpot(x, z, 7)) this.addProp('tank', x, z, 0, r.range(0.8, 1.3), 0xd7d9d6);
      }
      if (r.chance(0.5)) {
        const x = r.range(I.x0 + 6, I.x1 - 6);
        const z = r.range(I.z0 + 6, I.z1 - 6);
        if (this.freeSpot(x, z, 4)) this.addProp('chimney', x, z, 0, r.range(0.9, 1.4), 0x9c6b55);
      }
      this.data.lots.push({ x0: I.x0, x1: I.x1, z0: I.z0, z1: I.z1 });
      return;
    }
    if (zone === 'beachfront') {
      const n = r.int(2, 3);
      const seg = D / n;
      for (let k = 0; k < n; k++) {
        const d = seg * r.range(0.55, 0.8);
        const w = Math.min(W * 0.8, r.range(28, 46));
        const z = I.z0 + seg * (k + 0.5);
        const x = I.x1 - w / 2 - r.range(2, 8);
        this.addBuilding({ x, z, w, d, h: r.range(18, 72), style: 'stucco', color: r.pick(STUCCO_COLORS), roof: 'flat', tiers: r.chance(0.3) ? 2 : 1, poi: null, sign: null, face: 'e', storefront: r.chance(0.5) });
        this.addTree(x - w / 2 - 3, z, 0, r.range(0.9, 1.2));
      }
      this.addLotParking({ x0: I.x0, x1: I.x0 + Math.min(40, W * 0.35), z0: I.z0 + 4, z1: I.z1 - 4 });
      return;
    }
    const residential = zone === 'residential' || zone === 'town';
    const frontMin = residential ? 19 : 22;
    const frontMax = residential ? 26 : 42;
    const depthMin = residential ? 26 : 26;
    const depthMax = residential ? 34 : 44;
    const sides: Face[] = ['n', 's', 'w', 'e'];
    const depthN = Math.min(D / 2 - 2, r.range(depthMin, depthMax));
    const depthS = Math.min(D / 2 - 2, r.range(depthMin, depthMax));
    const depthW = Math.min(W / 2 - 2, r.range(depthMin, depthMax));
    const depthE = Math.min(W / 2 - 2, r.range(depthMin, depthMax));
    const aptBlock = residential && r.chance(0.18);
    for (const side of sides) {
      const alongX = side === 'n' || side === 's';
      const start = alongX ? I.x0 : I.z0 + depthN;
      const end = alongX ? I.x1 : I.z1 - depthS;
      const depth = side === 'n' ? depthN : side === 's' ? depthS : side === 'w' ? depthW : depthE;
      let p = start;
      while (end - p > frontMin * 0.8) {
        let f = r.range(frontMin, frontMax);
        if (end - p - f < frontMin * 0.8) f = end - p;
        const c = p + f / 2;
        let cx: number;
        let cz: number;
        if (side === 'n') {
          cx = c;
          cz = I.z0 + depth / 2;
        } else if (side === 's') {
          cx = c;
          cz = I.z1 - depth / 2;
        } else if (side === 'w') {
          cx = I.x0 + depth / 2;
          cz = c;
        } else {
          cx = I.x1 - depth / 2;
          cz = c;
        }
        const lotW = alongX ? f : depth;
        const lotD = alongX ? depth : f;
        if (residential && !aptBlock) {
          // house set back from the street, yard behind
          const hw = alongX ? f - r.range(5, 8) : r.range(10, 14);
          const hd = alongX ? r.range(10, 14) : f - r.range(5, 8);
          const setback = r.range(5, 8);
          let hx = cx;
          let hz = cz;
          if (side === 'n') hz = I.z0 + setback + hd / 2;
          if (side === 's') hz = I.z1 - setback - hd / 2;
          if (side === 'w') hx = I.x0 + setback + hw / 2;
          if (side === 'e') hx = I.x1 - setback - hw / 2;
          const bb = this.addBuilding({ x: hx, z: hz, w: hw, d: hd, h: r.chance(0.4) ? r.range(6.5, 8) : r.range(4, 5), style: 'house', color: r.pick(HOUSE_COLORS), roof: r.chance(0.75) ? 'gable' : 'flat', tiers: 1, poi: null, sign: null, face: side, storefront: false });
          if (bb) {
            // trees in the back yard and front yard
            const backX = side === 'w' ? hx + hw / 2 + 5 : side === 'e' ? hx - hw / 2 - 5 : hx + r.range(-4, 4);
            const backZ = side === 'n' ? hz + hd / 2 + 5 : side === 's' ? hz - hd / 2 - 5 : hz + r.range(-4, 4);
            if (r.chance(0.8)) this.addTree(backX, backZ, r.chance(0.4) ? 0 : r.chance(0.5) ? 1 : 3, r.range(0.8, 1.2));
            if (r.chance(0.45)) {
              const fx = side === 'w' ? I.x0 + 2.5 : side === 'e' ? I.x1 - 2.5 : hx + (r.chance(0.5) ? -1 : 1) * hw * 0.4;
              const fz = side === 'n' ? I.z0 + 2.5 : side === 's' ? I.z1 - 2.5 : hz + (r.chance(0.5) ? -1 : 1) * hd * 0.4;
              this.addTree(fx, fz, r.chance(0.5) ? 5 : 4, r.range(0.8, 1.2));
            }
          }
        } else {
          const w = lotW * r.range(0.86, 0.98);
          const d = lotD * r.range(0.8, 0.98);
          let h: number;
          let style: BuildingStyle;
          let color: number;
          if (aptBlock) {
            h = r.range(12, 22);
            style = r.chance(0.5) ? 'stucco' : 'brick';
            color = style === 'stucco' ? r.pick(STUCCO_COLORS) : r.pick(BRICK_COLORS);
          } else if (zone === 'fwstrip') {
            h = r.range(6, 14);
            style = r.chance(0.5) ? 'brick' : 'office';
            color = style === 'brick' ? r.pick(BRICK_COLORS) : r.pick(OFFICE_COLORS);
          } else {
            h = r.range(12, 52);
            const roll = r.next();
            style = roll < 0.45 ? 'office' : roll < 0.7 ? 'brick' : roll < 0.85 ? 'stucco' : 'glass';
            color = style === 'office' ? r.pick(OFFICE_COLORS) : style === 'brick' ? r.pick(BRICK_COLORS) : style === 'stucco' ? r.pick(STUCCO_COLORS) : r.pick(GLASS_COLORS);
          }
          // keep buildings flush with the sidewalk
          let bx = cx;
          let bz = cz;
          if (side === 'n') bz = I.z0 + d / 2;
          if (side === 's') bz = I.z1 - d / 2;
          if (side === 'w') bx = I.x0 + w / 2;
          if (side === 'e') bx = I.x1 - w / 2;
          this.addBuilding({ x: bx, z: bz, w, d, h, style, color, roof: 'flat', tiers: 1, poi: null, sign: null, face: side, storefront: zone !== 'fwstrip' || r.chance(0.5) });
        }
        p += f;
      }
    }
    // interior of the block: parking lot for commercial blocks
    if (!residential || aptBlock) {
      const inner: Rect = { x0: I.x0 + depthW + 2, x1: I.x1 - depthE - 2, z0: I.z0 + depthN + 2, z1: I.z1 - depthS - 2 };
      if (inner.x1 - inner.x0 > 14 && inner.z1 - inner.z0 > 14) this.addLotParking(inner);
    }
  }

  private placePoi(b: Block): void {
    const poi = b.poi as PoiDef;
    const I = b.inner;
    if (poi.kind === 'park') {
      this.data.plazas.push({ x0: I.x0 + 50, x1: I.x1 - 50, z0: I.z0 + 50, z1: I.z1 - 50 });
      this.addProp('fountain', (I.x0 + I.x1) / 2, (I.z0 + I.z1) / 2, 0, 1.6, 0xdddddd);
      for (let k = 0; k < 70; k++) {
        const x = this.rng.range(I.x0 + 3, I.x1 - 3);
        const z = this.rng.range(I.z0 + 3, I.z1 - 3);
        if (Math.abs(x - (I.x0 + I.x1) / 2) < 14 && Math.abs(z - (I.z0 + I.z1) / 2) < 14) continue;
        if (Math.abs(x - (I.x0 + I.x1) / 2) < 3 || Math.abs(z - (I.z0 + I.z1) / 2) < 3) continue;
        this.addTree(x, z, this.rng.chance(0.3) ? 0 : this.rng.chance(0.2) ? 4 : 1, this.rng.range(0.8, 1.35));
      }
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const cx = (I.x0 + I.x1) / 2 + Math.cos(a) * 18;
        const cz = (I.z0 + I.z1) / 2 + Math.sin(a) * 18;
        this.addProp('bench', cx, cz, -a + Math.PI / 2, 1, 0x6b4a2f);
      }
      return;
    }
    if (poi.kind === 'parking') {
      if (poi.lot) {
        this.addLotParking({ x0: I.x0 + 2, x1: I.x1 - 2, z0: I.z0 + 2, z1: I.z1 - 2 });
        return;
      }
    }
    const w = Math.min(poi.bw, I.x1 - I.x0 - 2);
    const d = Math.min(poi.bd, I.z1 - I.z0 - 2);
    let x = (I.x0 + I.x1) / 2;
    let z = (I.z0 + I.z1) / 2;
    const set = 6;
    if (poi.face === 'n') z = I.z0 + set + d / 2;
    if (poi.face === 's') z = I.z1 - set - d / 2;
    if (poi.face === 'w') x = I.x0 + set + w / 2;
    if (poi.face === 'e') x = I.x1 - set - w / 2;
    if (poi.kind === 'gas') {
      // shop at the back, canopy+pumps in front
      const back = 30;
      if (poi.face === 'n') z = I.z0 + back + d / 2;
      if (poi.face === 's') z = I.z1 - back - d / 2;
      if (poi.face === 'w') x = I.x0 + back + w / 2;
      if (poi.face === 'e') x = I.x1 - back - w / 2;
      const fx = poi.face === 'w' ? x - w / 2 - 14 : poi.face === 'e' ? x + w / 2 + 14 : x;
      const fz = poi.face === 'n' ? z - d / 2 - 14 : poi.face === 's' ? z + d / 2 + 14 : z;
      for (let k = -1; k <= 1; k++) {
        const alongX = poi.face === 'n' || poi.face === 's';
        this.addProp('pump', fx + (alongX ? k * 7 : 0), fz + (alongX ? 0 : k * 7), alongX ? 0 : Math.PI / 2, 1, 0xe03a2f);
      }
      this.addProp('canopy', fx, fz, poi.face === 'n' || poi.face === 's' ? 0 : Math.PI / 2, 1, 0xf2f2f2);
    }
    const bld = this.addBuilding({
      x,
      z,
      w,
      d,
      h: poi.bh,
      style: 'poi',
      color: poi.color,
      roof: poi.kind === 'property' && poi.id === 'house' ? 'gable' : 'flat',
      tiers: poi.kind === 'hospital' ? 2 : 1,
      poi,
      sign: poi.sign ?? null,
      face: poi.face,
      storefront: true,
    });
    if (bld) this.addDoor(bld);
    if (poi.lot) {
      const lot: Rect = { ...I };
      if (poi.face === 'n') lot.z0 = z + d / 2 + 3;
      if (poi.face === 's') lot.z1 = z - d / 2 - 3;
      if (poi.face === 'w') lot.x0 = x + w / 2 + 3;
      if (poi.face === 'e') lot.x1 = x - w / 2 - 3;
      if (lot.x1 - lot.x0 > 14 && lot.z1 - lot.z0 > 14) this.addLotParking({ x0: lot.x0 + 1, x1: lot.x1 - 1, z0: lot.z0 + 1, z1: lot.z1 - 1 });
    }
    // fill the rest of POI blocks with a couple of buildings if room
    if (poi.kind !== 'mall' && poi.kind !== 'hospital' && !poi.lot && poi.kind !== 'cityhall') {
      this.perimeterBuildings({ ...b, zone: 'midtown' });
    }
    if (poi.kind === 'cityhall') {
      this.data.plazas.push({ x0: x - w / 2, x1: x + w / 2, z0: z + d / 2, z1: I.z1 });
      this.addProp('fountain', x, (z + d / 2 + I.z1) / 2, 0, 1.4, 0xdddddd);
      for (const dx of [-0.4, 0.4]) this.addTree(x + dx * w, (z + d / 2 + I.z1) / 2, 0, 1.2);
    }
  }

  private addDoor(b: Building): void {
    if (!b.poi || !b.poi.interior) return;
    let x = b.x;
    let z = b.z;
    let yaw = 0;
    if (b.face === 'n') {
      z = b.z - b.d / 2 - 1.2;
      yaw = Math.PI;
    } else if (b.face === 's') {
      z = b.z + b.d / 2 + 1.2;
      yaw = 0;
    } else if (b.face === 'w') {
      x = b.x - b.w / 2 - 1.2;
      yaw = -Math.PI / 2;
    } else {
      x = b.x + b.w / 2 + 1.2;
      yaw = Math.PI / 2;
    }
    this.data.doors.push({ x, y: this.hf.heightAt(x, z), z, yaw, interior: b.poi.interior, poi: b.poi });
  }

  private addLotParking(r: Rect): void {
    this.data.lots.push(r);
    // rows of slots: 5.2 m deep, 2.7 m wide; aisles 7 m
    const W = r.x1 - r.x0;
    const D = r.z1 - r.z0;
    const alongX = W >= D;
    const rowDepth = 5.4;
    const aisle = 7;
    const span = alongX ? D : W;
    const len = alongX ? W : D;
    let p = 1;
    let row = 0;
    while (p + rowDepth <= span - 1) {
      const c = p + rowDepth / 2;
      const nSlots = Math.floor((len - 2) / 2.8);
      for (let k = 0; k < nSlots; k++) {
        const a = 1 + 1.4 + k * 2.8;
        const x = alongX ? r.x0 + a : r.x0 + c;
        const z = alongX ? r.z0 + c : r.z0 + a;
        const facing = row % 2 === 0 ? 0 : Math.PI;
        const yaw = alongX ? facing : facing + Math.PI / 2;
        this.data.parking.push({ x, y: CITY_Y, z, yaw, p: 0.45 });
      }
      p += rowDepth;
      row++;
      if (row % 2 === 0) p += aisle;
    }
  }

  // ------------------------------------------------------------- outskirts
  private makeVillas(): void {
    const roads = this.graph.net.roads.filter((r) => r.name === 'Vista Hills Dr' || r.name === 'Ridge Rd' || r.name === 'Canyon Rd' || r.name === 'Lakeshore Dr');
    // the property villa (placed first so generated villas avoid it)
    const v = POIS.find((p) => p.id === 'villa');
    if (v && v.at) {
      const bld = this.addBuilding({ x: v.at.x, z: v.at.z, w: v.bw, d: v.bd, h: v.bh, style: 'villa', color: v.color, roof: 'flat', tiers: 2, poi: v, sign: null, face: v.face, storefront: false });
      if (bld) this.addDoor(bld);
    }
    let n = 0;
    for (const road of roads) {
      const pts = resamplePolyline(road.pts, 6);
      const hw = roadHalfWidth(road.cls);
      for (const side of [1, -1]) {
        const off = offsetPolyline(pts, side * (hw + 22));
        for (let i = 8; i < off.length - 8; i += 12) {
          const p = off[i] as P2;
          if (hash2(i, side, road.id) < 0.35) continue;
          if (this.graph.roadClearance(p.x, p.z) < 8) continue;
          if (this.hf.slopeAt(p.x, p.z) > 0.32) continue;
          if (dist(p.x, p.z, LAKE.x, LAKE.z) < LAKE.r + 40) continue;
          const h0 = this.hf.heightAt(p.x, p.z);
          if (h0 < 2) continue;
          const w = this.rng.range(18, 28);
          const d = this.rng.range(13, 19);
          const bld = this.addBuilding({ x: p.x, z: p.z, w, d, h: this.rng.range(6.5, 9), style: 'villa', color: this.rng.pick([0xf4f4f2, 0xe9e4da, 0xdedbd5, 0xf2ede4]), roof: 'flat', tiers: this.rng.chance(0.5) ? 2 : 1, poi: null, sign: null, face: 'n', storefront: false });
          if (bld) {
            n++;
            this.addTree(p.x + w / 2 + 4, p.z, 0, this.rng.range(1, 1.3));
            this.addTree(p.x - w / 2 - 4, p.z + 3, 3, this.rng.range(0.9, 1.2));
          }
        }
      }
    }
    void n;
  }

  private makeAirport(): void {
    const A = AIRPORT_RECT;
    const term = POIS.find((p) => p.id === 'airport');
    if (term && term.at) {
      this.addBuilding({ x: term.at.x, z: term.at.z, w: term.bw, d: term.bd, h: term.bh, style: 'terminal', color: term.color, roof: 'flat', tiers: 1, poi: term, sign: term.sign ?? null, face: 'n', storefront: true, baseY: CITY_Y });
    }
    // control tower and hangars
    this.addBuilding({ x: -1205, z: 820, w: 12, d: 12, h: 46, style: 'office', color: 0xd9dde0, roof: 'flat', tiers: 1, poi: null, sign: null, face: 'n', storefront: false, baseY: CITY_Y });
    for (let k = 0; k < 3; k++) {
      this.addBuilding({ x: -1780 + k * 72, z: 830, w: 60, d: 50, h: 18, style: 'hangar', color: 0xbfc5c8, roof: 'gable', tiers: 1, poi: null, sign: null, face: 's', storefront: false, baseY: CITY_Y });
    }
    // terminal parking
    this.addLotParking({ x0: -1600, x1: -1420, z0: 640, z1: 692 });
    this.addLotParking({ x0: -1330, x1: -1180, z0: 640, z1: 692 });
    // fence line props along the runway (barriers)
    for (let x = A.x0 + 10; x < A.x1 - 10; x += 40) this.addProp('barrier', x, A.z1 - 8, 0, 1, 0xd0d0d0);
  }

  private makePort(): void {
    const r = this.rng;
    // container stacks
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 9; col++) {
        const x = 975 + col * 16;
        const z = 790 + row * 44;
        if (z > 1150 || (z > 880 && z < 920)) continue;
        if (r.chance(0.15)) continue;
        const stack = r.int(1, 4);
        const color = r.pick([0xb23b2b, 0x2a5d8f, 0x2f7d4f, 0xd08a2a, 0x8c8c8c, 0x6b3f7a, 0xc9c2b0, 0x1f4b6e]);
        for (let s = 0; s < stack; s++) {
          this.addProp('container', x, z, 0, s, s === 0 ? color : r.pick([0xb23b2b, 0x2a5d8f, 0x2f7d4f, 0xd08a2a, 0x8c8c8c]));
        }
      }
    }
    // cranes along the quay
    for (let k = 0; k < 4; k++) this.addProp('crane', PORT.x1 - 12, 760 + k * 110, Math.PI / 2, 1, k % 2 === 0 ? 0xd04a2a : 0x2a6fd0);
    // warehouses
    this.addBuilding({ x: 960, z: 1120, w: 70, d: 44, h: 14, style: 'industrial', color: 0x9aa4a6, roof: 'gable', tiers: 1, poi: null, sign: 'PIER 9', face: 'w', storefront: false, baseY: CITY_Y + 0.3 });
    this.addBuilding({ x: 1100, z: 1150, w: 60, d: 34, h: 12, style: 'industrial', color: 0xb5ab98, roof: 'flat', tiers: 1, poi: null, sign: null, face: 'w', storefront: false, baseY: CITY_Y + 0.3 });
    this.data.lots.push({ x0: PORT.x0, x1: PORT.x1, z0: PORT.z0, z1: PORT.z1 });
  }

  private makeFreewayPillars(): void {
    for (let z = FREEWAY.zNorthDeck - 100; z <= FREEWAY.zSouthDeck + 100; z += 32) {
      const nearRoad = Z_LINES.some((zl) => Math.abs(zl - z) < 16);
      if (nearRoad) continue;
      const h = CITY_Y + deckHeight(z);
      if (h < CITY_Y + 3) continue;
      this.data.pillars.push({ x: FREEWAY_X, z, h });
    }
  }

  // --------------------------------------------------------- street props
  private makeStreetFurniture(): void {
    const net = this.graph.net;
    const r = this.rng;
    for (const road of net.roads) {
      const spec = ROAD_SPECS[road.cls];
      const hw = roadHalfWidth(road.cls);
      const pts = resamplePolyline(road.pts, 2);
      const L = pts.length * 2;
      const spacing = road.cls === 'freeway' ? 44 : road.cls === 'rural' ? 60 : 34;
      const endClear = road.grid ? 16 : 6;
      const sides = road.cls === 'freeway' ? [0] : road.cls === 'rural' ? [1] : [1, -1];
      for (const side of sides) {
        const off = side === 0 ? pts : offsetPolyline(pts, side * (hw + (spec.sidewalkW > 0 ? 0.8 : 1.2)));
        for (let s = endClear; s < L - endClear; s += spacing) {
          const i = Math.min(off.length - 2, Math.floor(s / 2));
          const p = off[i] as P2;
          const q = off[i + 1] as P2;
          const along = Math.atan2(q.x - p.x, q.z - p.z);
          const armYaw = side === 0 ? along + Math.PI / 2 : side === 1 ? along - Math.PI / 2 : along + Math.PI / 2;
          const y = road.elevated ? CITY_Y + 0.05 + deckHeight(p.z) : this.hf.heightAt(p.x, p.z);
          if (!road.elevated && inPort(p.x, p.z) && road.cls !== 'street') continue;
          this.data.lights.push({ x: p.x, y, z: p.z, yaw: armYaw, double: side === 0 });
        }
        // parking slots in parking lanes of streets
        if (road.cls === 'street' && road.grid && side !== 0) {
          const parkOff = offsetPolyline(pts, side * (hw - spec.parkingW / 2));
          for (let s = endClear + 6; s < L - endClear - 6; s += 6.6) {
            const i = Math.min(parkOff.length - 2, Math.floor(s / 2));
            const p = parkOff[i] as P2;
            const q = parkOff[i + 1] as P2;
            const along = Math.atan2(q.x - p.x, q.z - p.z);
            // parked cars face along travel direction of their side (right-hand traffic)
            const yaw = side === 1 ? along : along + Math.PI;
            if (inPort(p.x, p.z)) continue;
            this.data.parking.push({ x: p.x, y: this.hf.heightAt(p.x, p.z), z: p.z, yaw, p: 0.32 });
          }
        }
        // benches, bins and hydrants on sidewalks
        if (spec.sidewalkW > 0 && side !== 0) {
          const walkOff = offsetPolyline(pts, side * (hw + spec.sidewalkW - 1.0));
          for (let s = endClear + 10; s < L - endClear; s += 22) {
            const i = Math.min(walkOff.length - 2, Math.floor(s / 2));
            const p = walkOff[i] as P2;
            const q = walkOff[i + 1] as P2;
            const along = Math.atan2(q.x - p.x, q.z - p.z);
            const roll = hash2(Math.floor(p.x), Math.floor(p.z), 5);
            const y = this.hf.heightAt(p.x, p.z) + 0.15;
            if (roll < 0.12) this.addProp('bench', p.x, p.z, along + (side === 1 ? -Math.PI / 2 : Math.PI / 2), 1, 0x5d4632, y);
            else if (roll < 0.24) this.addProp('bin', p.x, p.z, along, 1, 0x2f4f3f, y);
            else if (roll < 0.31) {
              const cp = offsetPolyline([p, q], side * (-(spec.sidewalkW - 1.6)))[0] as P2;
              this.addProp('hydrant', cp.x, cp.z, along, 1, 0xd8b23a, y);
            } else if (roll < 0.34 && road.cls === 'avenue') this.addProp('busstop', p.x, p.z, along + (side === 1 ? Math.PI / 2 : -Math.PI / 2), 1, 0x2a3440, y);
            else if (roll < 0.5 && road.grid) {
              const tp = offsetPolyline([p, q], side * (-(spec.sidewalkW - 2.2)))[0] as P2;
              const ocean = road.name === 'Ocean Drive' || road.name === 'Marina Blvd' || road.name === 'Sunset Blvd';
              this.addTree(tp.x, tp.z, ocean || r.chance(0.55) ? 0 : 1, r.range(0.85, 1.25), y);
            }
          }
        }
      }
    }
    // Ocean Drive palms on the beach side (dense, iconic)
    for (let z = -890; z < 640; z += 16) {
      this.addTree(900 + roadHalfWidth('avenue') + 2.2, z, 0, r.range(1.0, 1.35));
    }
    // signal heads
    for (const n of net.nodes) {
      if (!n.lights) continue;
      const ins = this.graph.lanesByNodeIn.get(n.id) ?? [];
      const doneRoads = new Set<number>();
      for (const lid of ins) {
        const lane = this.graph.pieces[lid];
        if (!lane || doneRoads.has(lane.roadId * 2 + (lane.dir === 1 ? 1 : 0))) continue;
        doneRoads.add(lane.roadId * 2 + (lane.dir === 1 ? 1 : 0));
        const road = net.roads[lane.roadId];
        if (!road) continue;
        const k = lane.xs.length - 1;
        const ex = lane.xs[k] as number;
        const ez = lane.zs[k] as number;
        const dx = ex - (lane.xs[k - 1] as number);
        const dz = ez - (lane.zs[k - 1] as number);
        const l = Math.hypot(dx, dz) || 1;
        const fx = dx / l;
        const fz = dz / l;
        // pole on the far-right corner after the stop line
        const hw = roadHalfWidth(road.cls);
        const rx = -fz;
        const rz = fx;
        const laneOff = ROAD_SPECS[road.cls].medianW / 2 + ROAD_SPECS[road.cls].laneW * (lane.laneIndex + 0.5);
        const px = ex + rx * (hw + 1.2 - laneOff);
        const pz = ez + rz * (hw + 1.2 - laneOff);
        this.data.signals.push({ x: px, y: this.hf.heightAt(px, pz), z: pz, yaw: Math.atan2(-fx, -fz), node: n.id, axis: lane.approachAxis ?? 'x' });
      }
    }
  }

  private makeBeach(): void {
    const r = this.rng;
    for (let z = -880; z < 620; z += 26) {
      const cx = (900 + 12 + Math.min(1090, 1080 + 25 * Math.sin(z / 180))) / 2;
      for (let k = 0; k < 2; k++) {
        const x = cx + r.range(-25, 30);
        const zz = z + r.range(-8, 8);
        if (coastDistance(x, zz) < 12) continue;
        const roll = r.next();
        const y = this.hf.heightAt(x, zz);
        if (roll < 0.45) this.addProp('umbrella', x, zz, r.range(0, 6.28), 1, r.pick([0xe94f37, 0x2a9d8f, 0xf4a261, 0x3a86ff, 0xffffff, 0xffbe0b]), y);
        else if (roll < 0.7) this.addProp('towel', x, zz, r.range(0, 6.28), 1, r.pick([0xe63946, 0x457b9d, 0xf1c453, 0x8ac926, 0xff70a6]), y);
      }
      if (Math.abs(z % 312) < 13) {
        const x = cx + 18;
        this.addProp('lifeguard', x, z, -Math.PI / 2, 1, 0x7ec8e3, this.hf.heightAt(x, z));
      }
      if (r.chance(0.35)) this.addTree(cx - 30 + r.range(-6, 6), z + r.range(-6, 6), 0, r.range(1.0, 1.4));
    }
  }

  private makeNature(): void {
    const r = new Rng(777);
    const step = 11;
    let count = 0;
    for (let z = -1990; z < 1500; z += step) {
      for (let x = -1990; x < 1400; x += step) {
        const jx = x + (hash2(x, z, 1) - 0.5) * step * 0.9;
        const jz = z + (hash2(x, z, 2) - 0.5) * step * 0.9;
        if (inRectXZ(jx, jz, -1120, -970, 1215, 1215)) continue; // city grid handled elsewhere
        if (inRectXZ(jx, jz, AIRPORT_RECT.x0, AIRPORT_RECT.z0, AIRPORT_RECT.x1, AIRPORT_RECT.z1)) continue;
        if (inRectXZ(jx, jz, -1730, -330, -1270, 330)) continue;
        const dc = coastDistance(jx, jz);
        if (dc < 40) continue;
        const h = this.hf.heightAt(jx, jz);
        if (h < 1.5 || h > 300) continue;
        const dl = dist(jx, jz, LAKE.x, LAKE.z);
        if (dl < LAKE.r + 6) continue;
        const slope = this.hf.slopeAt(jx, jz);
        if (slope > 0.75) continue;
        const pChance = forestChance(jx, jz, h);
        if (hash2(x, z, 3) > pChance) {
          // sparse chaparral on bare hills
          if (hash2(x, z, 9) < 0.06) {
            if (this.graph.roadClearance(jx, jz) > 2) this.data.trees.push({ x: jx, y: h, z: jz, type: 4, scale: r.range(0.8, 1.5), rot: r.range(0, 6.28) });
          } else if (hash2(x, z, 11) < 0.012 && slope > 0.25) {
            this.addProp('rock', jx, jz, r.range(0, 6.28), r.range(1, 3.5), 0x8a8173, h);
          }
          continue;
        }
        if (this.graph.roadClearance(jx, jz) < 3) continue;
        const pineBias = clamp((h - 40) / 120, 0, 1) + (jz < -1300 ? 0.3 : 0);
        const type: TreeType = hash2(x, z, 4) < 0.25 + pineBias * 0.6 ? 2 : hash2(x, z, 5) < 0.15 ? 3 : 1;
        this.data.trees.push({ x: jx, y: h, z: jz, type, scale: 0.75 + hash2(x, z, 6) * 0.65, rot: hash2(x, z, 7) * 6.28 });
        count++;
      }
    }
    this.data.hillTrees = count;
    // boulders by the lake and coast cliffs
    for (let k = 0; k < 140; k++) {
      const a = r.range(0, Math.PI * 2);
      const rr = LAKE.r + r.range(4, 60);
      const x = LAKE.x + Math.cos(a) * rr;
      const z = LAKE.z + Math.sin(a) * rr;
      if (this.graph.roadClearance(x, z) < 3) continue;
      this.addProp('rock', x, z, r.range(0, 6.28), r.range(0.8, 2.6), 0x8b8478, this.hf.heightAt(x, z));
    }
    void noise2;
    void SIGN_POS;
  }

  private makeCollectibles(): void {
    const spots: P2[] = [
      { x: 1040, z: -300 }, { x: 1010, z: 450 }, { x: SIGN_POS.x + 30, z: SIGN_POS.z + 40 }, { x: LAKE.x + 190, z: LAKE.z + 40 },
      { x: -1520, z: 120 }, { x: -1300, z: 1000 }, { x: 1120, z: 1000 }, { x: 150, z: -450 }, { x: -75, z: 375 },
      { x: 675, z: 300 }, { x: -980, z: 960 }, { x: 500, z: 980 }, { x: 960, z: -1380 }, { x: 330, z: -1590 },
      { x: -620, z: -1150 }, { x: -1450, z: -820 }, { x: -380, z: -60 }, { x: 260, z: 220 }, { x: 830, z: 220 }, { x: -1700, z: 1100 },
    ];
    for (const p of spots) {
      const y = p.x === 675 && p.z === 300 ? CITY_Y + FREEWAY.deckH + 0.05 : this.hf.heightAt(p.x, p.z);
      this.data.collectibles.push({ x: p.x, y: y + 1.2, z: p.z });
    }
  }

  // ---------------------------------------------------------------- helpers
  private freeSpot(x: number, z: number, rad: number): boolean {
    for (const o of this.data.buildings) {
      if (Math.abs(o.x - x) < o.w / 2 + rad && Math.abs(o.z - z) < o.d / 2 + rad) return false;
    }
    return true;
  }

  private addTree(x: number, z: number, type: TreeType, scale: number, y?: number): void {
    if (!this.freeSpot(x, z, 1.5)) return;
    if (this.graph.roadAt(x, z)) return;
    this.data.trees.push({ x, y: y ?? this.hf.heightAt(x, z), z, type, scale, rot: hash2(Math.floor(x * 7), Math.floor(z * 7), 3) * 6.28 });
  }

  private addProp(kind: Prop['kind'], x: number, z: number, yaw: number, s: number, color: number, y?: number): void {
    this.data.props.push({ kind, x, y: y ?? this.hf.heightAt(x, z), z, yaw, s, color });
  }
}

/** Probability of a wild tree at (x,z) given terrain height h (shared with the terrain canopy tint). */
export function forestChance(x: number, z: number, h: number): number {
  const dl = dist(x, z, LAKE.x, LAKE.z);
  const forest = Math.max(0, fbm(x / 520 + 4, z / 520 - 2, 3) * 1.4 + (dl < 600 ? 0.6 * (1 - dl / 600) : 0) + (z < -1100 && x < -500 ? 0.35 : 0) - 0.15);
  return clamp(forest * 1.25, 0, 0.92) * (h > 200 ? 0.4 : 1);
}

/** Wild-forest canopy coverage (0..1) for terrain tinting: same rules as makeNature's placement. */
export function canopyAt(hf: HeightField, x: number, z: number): number {
  if (inRectXZ(x, z, -1120, -970, 1215, 1215)) return 0;
  if (inRectXZ(x, z, AIRPORT_RECT.x0, AIRPORT_RECT.z0, AIRPORT_RECT.x1, AIRPORT_RECT.z1)) return 0;
  if (inRectXZ(x, z, -1730, -330, -1270, 330)) return 0;
  if (x > 1400 || z > 1500) return 0;
  if (coastDistance(x, z) < 40) return 0;
  const h = hf.heightAt(x, z);
  if (h < 1.5 || h > 300) return 0;
  if (dist(x, z, LAKE.x, LAKE.z) < LAKE.r + 6) return 0;
  if (hf.slopeAt(x, z) > 0.75) return 0;
  return forestChance(x, z, h);
}

function inRectXZ(x: number, z: number, x0: number, z0: number, x1: number, z1: number): boolean {
  return x >= x0 && x <= x1 && z >= z0 && z <= z1;
}

