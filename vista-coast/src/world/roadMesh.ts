// Road surfaces, intersections, lane markings, crosswalks, sidewalks/curbs,
// parking lots, plazas and the elevated freeway structure.

import * as THREE from 'three';
import { resamplePolyline } from '../core/poly';
import { ChunkedBuilder, v3 } from '../render/geom';
import { patchWet } from '../render/shaderlib';
import type { TextureLib } from '../render/textures';
import type { RoadGraph } from '../sim/roadGraph';
import { offsetPolyline, trimPolyline } from '../sim/roadGraph';
import { CURB_H } from './ground';
import { HeightField, ROAD_DECK_LIFT } from './heightmap';
import { CITY_Y, FREEWAY, FREEWAY_X, ROAD_LIFT, ROAD_SPECS, deckHeight, freewayHalfWidth, roadHalfWidth, type P2, type RoadDef } from './layout';
import { CHUNK } from './terrainMesh';
import type { WorldData } from './worldgen';

const WHITE = new THREE.Color(0.92, 0.92, 0.9);
const YELLOW = new THREE.Color(0.95, 0.72, 0.12);

export interface RoadMaterials {
  asphalt: THREE.MeshStandardMaterial;
  marking: THREE.MeshStandardMaterial;
  pavers: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
}

export function makeRoadMaterials(tex: TextureLib): RoadMaterials {
  const asphalt = new THREE.MeshStandardMaterial({ map: tex.asphalt.map, normalMap: tex.asphalt.normalMap, roughnessMap: tex.asphalt.roughnessMap, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  asphalt.normalScale.set(0.28, 0.28);
  patchWet(asphalt, 1);
  const marking = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, map: tex.asphalt.map });
  marking.onBeforeCompile = (shader) => {
    // markings: mostly vertex colour, slightly modulated by asphalt texture for wear
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '  diffuseColor.rgb *= mix(vec3(1.0), texture2D(map, vMapUv).rgb * 3.0, 0.35);');
  };
  patchWet(marking, 0.8);
  const pavers = new THREE.MeshStandardMaterial({ map: tex.pavers.map, normalMap: tex.pavers.normalMap, roughnessMap: tex.pavers.roughnessMap, roughness: 1, metalness: 0 });
  patchWet(pavers, 0.6);
  const grass = new THREE.MeshStandardMaterial({ map: tex.grass.map, normalMap: tex.grass.normalMap, roughness: 0.95, metalness: 0 });
  const concrete = new THREE.MeshStandardMaterial({ map: tex.concrete.map, normalMap: tex.concrete.normalMap, roughnessMap: tex.concrete.roughnessMap, roughness: 1, metalness: 0 });
  patchWet(concrete, 0.7);
  const curb = new THREE.MeshStandardMaterial({ map: tex.concrete.map, color: 0xd8d6d0, roughness: 0.85 });
  const deck = new THREE.MeshStandardMaterial({ map: tex.concrete.map, normalMap: tex.concrete.normalMap, color: 0xc9c6bf, roughness: 0.9 });
  return { asphalt, marking, pavers, grass, concrete, curb, deck };
}

export class RoadBuilder {
  private cb = new ChunkedBuilder(CHUNK);

  constructor(
    private readonly hf: HeightField,
    private readonly graph: RoadGraph,
    private readonly wd: WorldData,
  ) {}

  private y(x: number, z: number, r: RoadDef | null): number {
    if (r && r.elevated) {
      const dh = deckHeight(z);
      return Math.max(CITY_Y + ROAD_DECK_LIFT + dh, this.hf.heightAt(x, z) + ROAD_LIFT);
    }
    return this.hf.heightAt(x, z) + ROAD_LIFT;
  }

  build(mats: RoadMaterials, group: THREE.Group): void {
    const net = this.graph.net;
    for (const r of net.roads) this.buildRoad(r);
    for (const n of net.nodes) this.buildNode(n.id);
    this.buildBlocks();
    this.buildLots();
    this.buildFreewayStructure();
    this.buildAirportPavement();
    this.cb.build(mats as unknown as Record<string, THREE.Material>, { castShadow: false, receiveShadow: true }, group);
    // deck pieces and barriers cast shadows: built into the 'deck' bucket with castShadow later
    for (const m of group.children) {
      const mesh = m as THREE.Mesh;
      if (mesh.material === mats.deck) mesh.castShadow = true; // curbs are too low to matter: skip them in the shadow pass
    }
  }

  private trimFor(r: RoadDef, atA: boolean): number {
    const node = atA ? r.a : r.b;
    const deg = this.graph.nodeDegree[node] ?? 0;
    if (deg === 2 && (this.graph.nodeClearance[node] ?? 0) < 1) return 0;
    if (deg === 1) return 0;
    return Math.max(0, (this.graph.nodeClearance[node] ?? 2) - 2.2);
  }

  private buildRoad(r: RoadDef): void {
    const hw = roadHalfWidth(r.cls);
    const spec = ROAD_SPECS[r.cls];
    const step = r.grid ? 12 : 4;
    const pts0 = resamplePolyline(r.pts, step);
    const pts = trimPolyline(pts0, this.trimFor(r, true), this.trimFor(r, false));
    if (pts.length < 2) return;
    const left = offsetPolyline(pts, -hw);
    const right = offsetPolyline(pts, hw);
    // surface ribbon
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as P2;
      const b = pts[i + 1] as P2;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const la = left[i] as P2;
      const lb = left[i + 1] as P2;
      const ra = right[i] as P2;
      const rb = right[i + 1] as P2;
      const mb = this.cb.get((a.x + b.x) / 2, (a.z + b.z) / 2, 'asphalt');
      const tile = 4.5;
      mb.quad(
        v3(ra.x, this.y(ra.x, ra.z, r), ra.z),
        v3(rb.x, this.y(rb.x, rb.z, r), rb.z),
        v3(lb.x, this.y(lb.x, lb.z, r), lb.z),
        v3(la.x, this.y(la.x, la.z, r), la.z),
        v3(0, 1, 0),
        [ra.x / tile, ra.z / tile],
        [rb.x / tile, rb.z / tile],
        [lb.x / tile, lb.z / tile],
        [la.x / tile, la.z / tile],
      );
      s += L;
    }
    // markings
    const lift = 0.015;
    const line = (offset: number, width: number, color: THREE.Color, dash: number, gap: number): void => {
      const c = offsetPolyline(pts, offset);
      let acc = 0;
      for (let i = 0; i < c.length - 1; i++) {
        const a = c[i] as P2;
        const b = c[i + 1] as P2;
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 1e-3) continue;
        const dx = (b.x - a.x) / L;
        const dz = (b.z - a.z) / L;
        let t = 0;
        let guard = 0;
        while (t < L - 1e-3 && guard++ < 10000) {
          let len: number;
          if (gap > 0) {
            const period = dash + gap;
            const pos = acc + t;
            const k = Math.floor(pos / period + 1e-9);
            const dashEnd = k * period + dash;
            if (pos >= dashEnd - 1e-4) {
              t = (k + 1) * period - acc + 1e-4;
              continue;
            }
            len = Math.min(dashEnd - pos, L - t);
          } else len = L - t;
          if (len < 1e-3) {
            t += 1e-3;
            continue;
          }
          const x0 = a.x + dx * t;
          const z0 = a.z + dz * t;
          const x1 = x0 + dx * len;
          const z1 = z0 + dz * len;
          const rx = -dz * width * 0.5;
          const rz = dx * width * 0.5;
          const mb = this.cb.get(x0, z0, 'marking');
          mb.quad(
            v3(x0 + rx, this.y(x0 + rx, z0 + rz, r) + lift, z0 + rz),
            v3(x1 + rx, this.y(x1 + rx, z1 + rz, r) + lift, z1 + rz),
            v3(x1 - rx, this.y(x1 - rx, z1 - rz, r) + lift, z1 - rz),
            v3(x0 - rx, this.y(x0 - rx, z0 - rz, r) + lift, z0 - rz),
            v3(0, 1, 0),
            [x0 / 7, z0 / 7],
            [x1 / 7, z1 / 7],
            [x1 / 7, z1 / 7],
            [x0 / 7, z0 / 7],
            color,
          );
          t += len;
        }
        acc += L;
      }
    };
    const twoWay = true;
    if (twoWay) {
      if (spec.medianW > 0.5) {
        line(-spec.medianW / 2 + 0.12, 0.12, YELLOW, 1, 0);
        line(spec.medianW / 2 - 0.12, 0.12, YELLOW, 1, 0);
      } else {
        line(-0.12, 0.1, YELLOW, r.cls === 'rural' ? 3 : 1, r.cls === 'rural' ? 6 : 0);
        line(0.12, 0.1, YELLOW, r.cls === 'rural' ? 3 : 1, r.cls === 'rural' ? 6 : 0);
      }
      for (let k = 1; k < spec.lanesPerDir; k++) {
        const off = spec.medianW / 2 + spec.laneW * k;
        line(off, 0.12, WHITE, 3, 9);
        line(-off, 0.12, WHITE, 3, 9);
      }
      if (r.cls === 'freeway' || r.cls === 'highway' || r.cls === 'rural') {
        const edge = spec.medianW / 2 + spec.laneW * spec.lanesPerDir + 0.1;
        line(edge, 0.14, WHITE, 1, 0);
        line(-edge, 0.14, WHITE, 1, 0);
      }
      if (r.cls === 'street') {
        // parking lane edge (dashed short)
        const pe = spec.laneW * spec.lanesPerDir + 0.05;
        line(pe, 0.1, WHITE, 0.6, 5.4);
        line(-pe, 0.1, WHITE, 0.6, 5.4);
      }
    }
  }

  private buildNode(nodeId: number): void {
    const n = this.graph.net.nodes[nodeId];
    if (!n) return;
    const deg = this.graph.nodeDegree[nodeId] ?? 0;
    const roads = this.graph.net.roads.filter((r) => r.a === nodeId || r.b === nodeId);
    if (deg < 2 && roads.length === 1) {
      // dead end: round cul-de-sac pad
      const r0 = roads[0] as RoadDef;
      this.disc(n.x, n.z, roadHalfWidth(r0.cls) + 1.5, r0);
      return;
    }
    const clearance = this.graph.nodeClearance[nodeId] ?? 2;
    if (deg === 2 && clearance < 1) return;
    // axis aligned rectangle for grid-like junctions, disc otherwise
    let hx = 0;
    let hz = 0;
    let allGrid = true;
    for (const r of roads) {
      const p0 = r.a === nodeId ? (r.pts[0] as P2) : (r.pts[r.pts.length - 1] as P2);
      const p1 = r.a === nodeId ? (r.pts[1] as P2) : (r.pts[r.pts.length - 2] as P2);
      const dx = Math.abs(p1.x - p0.x);
      const dz = Math.abs(p1.z - p0.z);
      const hw = roadHalfWidth(r.cls);
      if (dx > 0.01 && dz > 0.01) allGrid = false;
      if (dx > dz) hz = Math.max(hz, hw);
      else hx = Math.max(hx, hw);
    }
    const r0 = roads[0] ?? null;
    if (allGrid) {
      const half = Math.max(clearance - 2.2, 0);
      // cover the junction square plus the trimmed approach (to clearance)
      const x0 = n.x - Math.max(hx, half);
      const x1 = n.x + Math.max(hx, half);
      const z0 = n.z - Math.max(hz, half);
      const z1 = n.z + Math.max(hz, half);
      const mb = this.cb.get(n.x, n.z, 'asphalt');
      const y = this.y(n.x, n.z, r0 && r0.elevated ? r0 : null);
      // centre cross: two rectangles avoid covering sidewalk corners
      mb.flatRect(n.x - hx, z0, n.x + hx, z1, y, 7);
      mb.flatRect(x0, n.z - hz, n.x - hx, n.z + hz, y, 7);
      mb.flatRect(n.x + hx, n.z - hz, x1, n.z + hz, y, 7);
      // crosswalks + stop lines on each approach of signalised nodes
      if (n.lights) {
        for (const r of roads) {
          const p0 = r.a === nodeId ? (r.pts[0] as P2) : (r.pts[r.pts.length - 1] as P2);
          const p1 = r.a === nodeId ? (r.pts[1] as P2) : (r.pts[r.pts.length - 2] as P2);
          const along = Math.abs(p1.x - p0.x) > Math.abs(p1.z - p0.z) ? 'x' : 'z';
          const dir = along === 'x' ? Math.sign(p1.x - p0.x) : Math.sign(p1.z - p0.z);
          const hw = roadHalfWidth(r.cls);
          const start = (along === 'x' ? hx : hz) + 0.6;
          const cwW = 3.2;
          // zebra stripes across the road
          for (let k = -hw + 0.4; k < hw - 0.3; k += 1.1) {
            if (along === 'x') {
              const xa = n.x + dir * start;
              const xb = n.x + dir * (start + cwW);
              this.markRect(Math.min(xa, xb), n.z + k, Math.max(xa, xb), n.z + k + 0.55, y, WHITE);
            } else {
              const za = n.z + dir * start;
              const zb = n.z + dir * (start + cwW);
              this.markRect(n.x + k, Math.min(za, zb), n.x + k + 0.55, Math.max(za, zb), y, WHITE);
            }
          }
          // stop line on the inbound half (right side of traffic approaching the node)
          const sl = start + cwW + 0.3;
          const inboundSign = -dir; // traffic coming toward the node travels in -dir
          // right of travel for direction d along x: right = (-dz, dx) -> for travel along x with sign s: right z = s
          if (along === 'x') {
            const zs = inboundSign; // travel dir sign along x = inboundSign => right side z = inboundSign
            const zA = n.z;
            const zB = n.z + zs * hw;
            const xa = n.x + dir * sl;
            this.markRect(Math.min(xa, xa + dir * 0.45), Math.min(zA, zB), Math.max(xa, xa + dir * 0.45), Math.max(zA, zB), y, WHITE);
          } else {
            const xs = -inboundSign;
            const xA = n.x;
            const xB = n.x + xs * hw;
            const za = n.z + dir * sl;
            this.markRect(Math.min(xA, xB), Math.min(za, za + dir * 0.45), Math.max(xA, xB), Math.max(za, za + dir * 0.45), y, WHITE);
          }
        }
      }
    } else {
      let maxHw = 0;
      for (const r of roads) maxHw = Math.max(maxHw, roadHalfWidth(r.cls));
      this.disc(n.x, n.z, Math.max(clearance, maxHw + 1), r0);
    }
  }

  private markRect(x0: number, z0: number, x1: number, z1: number, y: number, c: THREE.Color): void {
    const mb = this.cb.get((x0 + x1) / 2, (z0 + z1) / 2, 'marking');
    mb.flatRect(x0, z0, x1, z1, y + 0.016, 7, c);
  }

  private disc(x: number, z: number, rad: number, r: RoadDef | null): void {
    const mb = this.cb.get(x, z, 'asphalt');
    const seg = 20;
    const c = mb.vertex(x, this.y(x, z, r) + 0.002, z, 0, 1, 0, x / 7, z / 7);
    const ring: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const px = x + Math.cos(a) * rad;
      const pz = z + Math.sin(a) * rad;
      ring.push(mb.vertex(px, this.y(px, pz, r) + 0.002, pz, 0, 1, 0, px / 7, pz / 7));
    }
    for (let i = 0; i < seg; i++) mb.tri(c, ring[i + 1] as number, ring[i] as number);
  }

  private buildBlocks(): void {
    const top = CITY_Y + CURB_H;
    for (const b of this.wd.blocks) {
      const o = b.outer;
      const sw = b.sidewalkW;
      // sidewalk ring
      const ring: [number, number, number, number][] = [
        [o.x0, o.z0, o.x1, o.z0 + sw],
        [o.x0, o.z1 - sw, o.x1, o.z1],
        [o.x0, o.z0 + sw, o.x0 + sw, o.z1 - sw],
        [o.x1 - sw, o.z0 + sw, o.x1, o.z1 - sw],
      ];
      for (const [x0, z0, x1, z1] of ring) this.cb.get((x0 + x1) / 2, (z0 + z1) / 2, 'pavers').flatRect(x0, z0, x1, z1, top, 1);
      // inner lot
      const inner = b.inner;
      this.cb.get((inner.x0 + inner.x1) / 2, (inner.z0 + inner.z1) / 2, b.ground === 'grass' ? 'grass' : 'concrete').flatRect(inner.x0, inner.z0, inner.x1, inner.z1, top, b.ground === 'grass' ? 5 : 6);
      // curb faces (vertical) down to road level
      const cmb = this.cb.get((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2, 'curb');
      const y0 = CITY_Y - 0.05;
      const n = new THREE.Vector3();
      n.set(0, 0, -1);
      cmb.quad(v3(o.x1, y0, o.z0), v3(o.x0, y0, o.z0), v3(o.x0, top, o.z0), v3(o.x1, top, o.z0), n, [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
      n.set(0, 0, 1);
      cmb.quad(v3(o.x0, y0, o.z1), v3(o.x1, y0, o.z1), v3(o.x1, top, o.z1), v3(o.x0, top, o.z1), n, [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
      n.set(-1, 0, 0);
      cmb.quad(v3(o.x0, y0, o.z0), v3(o.x0, y0, o.z1), v3(o.x0, top, o.z1), v3(o.x0, top, o.z0), n, [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
      n.set(1, 0, 0);
      cmb.quad(v3(o.x1, y0, o.z1), v3(o.x1, y0, o.z0), v3(o.x1, top, o.z0), v3(o.x1, top, o.z1), n, [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
    }
  }

  private buildLots(): void {
    for (const r of this.wd.lots) {
      const y = this.hf.heightAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
      const inCity = this.wd.blocks.some((b) => r.x0 >= b.outer.x0 - 1 && r.x1 <= b.outer.x1 + 1 && r.z0 >= b.outer.z0 - 1 && r.z1 <= b.outer.z1 + 1);
      const yy = (inCity ? CITY_Y + CURB_H : Math.max(y, CITY_Y + 0.3)) + 0.012;
      this.cb.get((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 'asphalt').flatRect(r.x0, r.z0, r.x1, r.z1, yy, 7);
    }
    // painted slot lines for lot slots
    for (const p of this.wd.parking) {
      if (p.p < 0.4) continue;
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      const rx = -fz;
      const rz = fx;
      const y = (this.wd.blocks.some((b) => p.x >= b.outer.x0 && p.x <= b.outer.x1 && p.z >= b.outer.z0 && p.z <= b.outer.z1) ? CITY_Y + CURB_H : Math.max(this.hf.heightAt(p.x, p.z), CITY_Y + 0.3)) + 0.03;
      for (const side of [-1, 1]) {
        const cx = p.x + rx * 1.38 * side;
        const cz = p.z + rz * 1.38 * side;
        const ax = cx - fx * 2.5;
        const az = cz - fz * 2.5;
        const bx = cx + fx * 2.5;
        const bz = cz + fz * 2.5;
        const w = 0.06;
        const mb = this.cb.get(cx, cz, 'marking');
        mb.quad(v3(ax + rx * w, y, az + rz * w), v3(bx + rx * w, y, bz + rz * w), v3(bx - rx * w, y, bz - rz * w), v3(ax - rx * w, y, az - rz * w), v3(0, 1, 0), [0, 0], [1, 0], [1, 1], [0, 1], WHITE);
      }
    }
    for (const r of this.wd.plazas) {
      this.cb.get((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 'pavers').flatRect(r.x0, r.z0, r.x1, r.z1, CITY_Y + CURB_H + 0.01, 1);
    }
  }

  private buildFreewayStructure(): void {
    const hw = freewayHalfWidth();
    for (let z = FREEWAY.zNorthGround; z < FREEWAY.zSouthGround; z += 8) {
      const z1 = Math.min(z + 8, FREEWAY.zSouthGround);
      const d0 = deckHeight(z);
      const d1 = deckHeight(z1);
      if (d0 < 0.3 && d1 < 0.3) continue;
      const y0 = CITY_Y + d0;
      const y1 = CITY_Y + d1;
      const mb = this.cb.get(FREEWAY_X, (z + z1) / 2, 'deck');
      const thick = 1.3;
      // underside
      mb.quad(v3(FREEWAY_X - hw, y0 - thick, z), v3(FREEWAY_X + hw, y0 - thick, z), v3(FREEWAY_X + hw, y1 - thick, z1), v3(FREEWAY_X - hw, y1 - thick, z1), v3(0, -1, 0), [0, 0], [1, 0], [1, 1], [0, 1]);
      // side faces
      mb.quad(v3(FREEWAY_X + hw, y0 - thick, z), v3(FREEWAY_X + hw, y0 + 1.05, z), v3(FREEWAY_X + hw, y1 + 1.05, z1), v3(FREEWAY_X + hw, y1 - thick, z1), v3(1, 0, 0), [z / 6, 0], [z / 6, 0.4], [z1 / 6, 0.4], [z1 / 6, 0]);
      mb.quad(v3(FREEWAY_X - hw, y0 - thick, z1), v3(FREEWAY_X - hw, y1 + 1.05, z1), v3(FREEWAY_X - hw, y0 + 1.05, z), v3(FREEWAY_X - hw, y0 - thick, z), v3(-1, 0, 0), [z1 / 6, 0], [z1 / 6, 0.4], [z / 6, 0.4], [z / 6, 0]);
      // barrier tops and inner faces
      for (const side of [-1, 1]) {
        const xo = FREEWAY_X + side * hw;
        const xi = FREEWAY_X + side * (hw - 0.45);
        mb.quad(v3(xi, y0 + 1.05, z), v3(xo, y0 + 1.05, z), v3(xo, y1 + 1.05, z1), v3(xi, y1 + 1.05, z1), v3(0, 1, 0), [0, 0], [1, 0], [1, 1], [0, 1]);
        if (side === 1) mb.quad(v3(xi, y1 + 1.05, z1), v3(xi, y1 + ROAD_DECK_LIFT, z1), v3(xi, y0 + ROAD_DECK_LIFT, z), v3(xi, y0 + 1.05, z), v3(-1, 0, 0), [0, 0], [1, 0], [1, 1], [0, 1]);
        else mb.quad(v3(xi, y0 + 1.05, z), v3(xi, y0 + ROAD_DECK_LIFT, z), v3(xi, y1 + ROAD_DECK_LIFT, z1), v3(xi, y1 + 1.05, z1), v3(1, 0, 0), [0, 0], [1, 0], [1, 1], [0, 1]);
      }
    }
    for (const p of this.wd.pillars) {
      const mb = this.cb.get(p.x, p.z, 'deck');
      const top = p.h - 1.3;
      // two columns and a cap beam
      for (const side of [-1, 1]) mb.box(p.x + side * 4.5, CITY_Y - 0.2, p.z, 1.6, top - CITY_Y + 0.2, 1.6, 2);
      mb.box(p.x, top - 1.2, p.z, freewayHalfWidth() * 2 - 1, 1.2, 2.2, 2);
    }
  }

  private buildAirportPavement(): void {
    const y = CITY_Y + 0.03;
    const asphalt = this.cb.get(-1500, 1180, 'asphalt');
    // runway (x along) + taxiway + apron
    asphalt.flatRect(-1840, 1150, -1160, 1210, y, 8);
    this.cb.get(-1500, 1060, 'asphalt').flatRect(-1800, 1040, -1200, 1062, y, 8);
    this.cb.get(-1450, 900, 'concrete').flatRect(-1700, 785, -1180, 1020, y - 0.005, 6);
    for (let x = -1800; x <= -1220; x += 145) this.cb.get(x, 1100, 'asphalt').flatRect(x - 10, 1062, x + 10, 1150, y, 8);
    // runway centre dashes and threshold bars
    for (let x = -1800; x < -1200; x += 30) this.markRect(x, 1179, x + 18, 1181, y, WHITE);
    for (const xEnd of [-1830, -1190]) {
      for (let k = 0; k < 8; k++) {
        const z0 = 1155 + k * 6.5;
        this.markRect(Math.min(xEnd, xEnd + (xEnd < 0 && xEnd < -1500 ? 25 : -25)), z0, Math.max(xEnd, xEnd + (xEnd < -1500 ? 25 : -25)), z0 + 3, y, WHITE);
      }
    }
    for (let x = -1800; x < -1200; x += 4) this.markRect(x, 1050.6, x + 2.5, 1051.4, y, YELLOW);
  }
}
