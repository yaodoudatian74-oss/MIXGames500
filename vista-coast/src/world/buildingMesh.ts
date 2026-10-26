// Building geometry: merged per chunk, rendered with the procedural facade material
// (one draw call per chunk). Includes stepped towers, parapets, rooftop units,
// gable roofs for houses, awnings, villas with pools, signs and billboards.

import * as THREE from 'three';
import { Rng } from '../core/rng';
import { ChunkedBuilder, MeshBuilder } from '../render/geom';
import { signTexture } from '../render/textures';
import { CHUNK } from './terrainMesh';
import type { Building, BuildingStyle } from './worldgen';

const STYLE_ID: Record<BuildingStyle, number> = {
  glass: 0,
  office: 1,
  stucco: 2,
  brick: 3,
  industrial: 4,
  house: 5,
  villa: 6,
  poi: 7,
  terminal: 0,
  hangar: 4,
};

const STYLE_GRID: Record<BuildingStyle, [number, number]> = {
  glass: [3.9, 1.6],
  office: [3.8, 2.5],
  stucco: [3.2, 3.0],
  brick: [3.4, 2.7],
  industrial: [6.5, 5.5],
  house: [3.0, 3.2],
  villa: [3.6, 4.2],
  poi: [4.2, 3.2],
  terminal: [11, 4],
  hangar: [9, 6],
};

const ROOF_COLORS = [0x8c4a32, 0x5a5552, 0x3f4449, 0x9b6a4a, 0x6e3b2c];

/** Adds faces with the facade attributes. */
class FacadeWriter {
  constructor(private readonly mb: MeshBuilder) {}
  private c = new THREE.Color();

  wallQuad(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, u0: number, baseY: number, color: number, fac: [number, number, number, number], roof = false): void {
    const mb = this.mb;
    const len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    this.c.setHex(color);
    const i0 = mb.vertex(ax, y0, az, nx, 0, nz, 0, 0, this.c);
    const i1 = mb.vertex(bx, y0, bz, nx, 0, nz, 1, 0, this.c);
    const i2 = mb.vertex(bx, y1, bz, nx, 0, nz, 1, 1, this.c);
    const i3 = mb.vertex(ax, y1, az, nx, 0, nz, 0, 1, this.c);
    for (const [u, y] of [[u0, y0], [u0 + len, y0], [u0 + len, y1], [u0, y1]] as const) {
      mb.attr('aFacade', 4, ...fac);
      mb.attr('aLocal', 3, u, y - baseY, roof ? 1 : 0);
    }
    mb.tri(i0, i1, i2);
    mb.tri(i0, i2, i3);
  }

  flat(x0: number, z0: number, x1: number, z1: number, y: number, color: number, fac: [number, number, number, number], up = true): void {
    const mb = this.mb;
    this.c.setHex(color);
    const ny = up ? 1 : -1;
    const a = mb.vertex(x0, y, z0, 0, ny, 0, 0, 0, this.c);
    const b = mb.vertex(x0, y, z1, 0, ny, 0, 0, 1, this.c);
    const c = mb.vertex(x1, y, z1, 0, ny, 0, 1, 1, this.c);
    const d = mb.vertex(x1, y, z0, 0, ny, 0, 1, 0, this.c);
    for (const [u, v] of [[x0, z0], [x0, z1], [x1, z1], [x1, z0]] as const) {
      mb.attr('aFacade', 4, ...fac);
      mb.attr('aLocal', 3, u, v, 1);
    }
    if (up) {
      mb.tri(a, b, c);
      mb.tri(a, c, d);
    } else {
      mb.tri(a, c, b);
      mb.tri(a, d, c);
    }
  }

  /** Box walls (CCW outward) + top. u runs continuously around the perimeter. */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, baseY: number, color: number, fac: [number, number, number, number], top = true, roofColor?: number): void {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    let u = 0;
    // south (+z) face: from x0 to x1 so the outward normal is +z
    this.wallQuad(x0, z1, x1, z1, y0, y1, u, baseY, color, fac);
    u += w;
    this.wallQuad(x1, z1, x1, z0, y0, y1, u, baseY, color, fac);
    u += d;
    this.wallQuad(x1, z0, x0, z0, y0, y1, u, baseY, color, fac);
    u += w;
    this.wallQuad(x0, z0, x0, z1, y0, y1, u, baseY, color, fac);
    if (top) this.flat(x0, z0, x1, z1, y1, roofColor ?? color, fac);
  }

  gable(cx: number, cz: number, w: number, d: number, y0: number, h: number, color: number, fac: [number, number, number, number]): void {
    // ridge along the longer side
    const mb = this.mb;
    this.c.setHex(color);
    const alongX = w >= d;
    const ov = 0.5;
    const x0 = cx - w / 2 - ov;
    const x1 = cx + w / 2 + ov;
    const z0 = cz - d / 2 - ov;
    const z1 = cz + d / 2 + ov;
    const yr = y0 + h;
    const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
      const i = mb.vertex(x, y, z, nx, ny, nz, 0, 0, this.c);
      mb.attr('aFacade', 4, ...fac);
      mb.attr('aLocal', 3, x, z, 1);
      return i;
    };
    if (alongX) {
      const zm = cz;
      const s = Math.hypot(h, d / 2 + ov);
      const ny = (d / 2 + ov) / s;
      const nz = h / s;
      // north slope
      let a = push(x0, y0, z0, 0, ny, -nz);
      let b = push(x0, yr, zm, 0, ny, -nz);
      let c = push(x1, yr, zm, 0, ny, -nz);
      let e = push(x1, y0, z0, 0, ny, -nz);
      mb.tri(a, b, c);
      mb.tri(a, c, e);
      // south slope
      a = push(x0, y0, z1, 0, ny, nz);
      b = push(x1, y0, z1, 0, ny, nz);
      c = push(x1, yr, zm, 0, ny, nz);
      e = push(x0, yr, zm, 0, ny, nz);
      mb.tri(a, b, c);
      mb.tri(a, c, e);
      // gable ends
      for (const [xx, nx] of [[cx - w / 2, -1], [cx + w / 2, 1]] as const) {
        const p = push(xx, y0, cz - d / 2, nx, 0, 0);
        const q = push(xx, y0, cz + d / 2, nx, 0, 0);
        const r = push(xx, yr - h * (ov / (d / 2 + ov)), zm, nx, 0, 0);
        if (nx < 0) mb.tri(p, q, r);
        else mb.tri(q, p, r);
      }
    } else {
      const xm = cx;
      const s = Math.hypot(h, w / 2 + ov);
      const ny = (w / 2 + ov) / s;
      const nx = h / s;
      let a = push(x0, y0, z1, -nx, ny, 0);
      let b = push(xm, yr, z1, -nx, ny, 0);
      let c = push(xm, yr, z0, -nx, ny, 0);
      let e = push(x0, y0, z0, -nx, ny, 0);
      mb.tri(a, b, c);
      mb.tri(a, c, e);
      a = push(x1, y0, z0, nx, ny, 0);
      b = push(xm, yr, z0, nx, ny, 0);
      c = push(xm, yr, z1, nx, ny, 0);
      e = push(x1, y0, z1, nx, ny, 0);
      mb.tri(a, b, c);
      mb.tri(a, c, e);
      for (const [zz, nz] of [[cz - d / 2, -1], [cz + d / 2, 1]] as const) {
        const p = push(cx - w / 2, y0, zz, 0, 0, nz);
        const q = push(cx + w / 2, y0, zz, 0, 0, nz);
        const r = push(xm, yr - h * (ov / (w / 2 + ov)), zz, 0, 0, nz);
        if (nz > 0) mb.tri(p, q, r);
        else mb.tri(q, p, r);
      }
    }
  }
}

export interface BuildingMeshes {
  group: THREE.Group;
  signs: THREE.Mesh[];
}

export function buildBuildings(buildings: readonly Building[], facade: THREE.Material, poolMat: THREE.Material): BuildingMeshes {
  const cb = new ChunkedBuilder(CHUNK);
  const pools = new MeshBuilder();
  const group = new THREE.Group();
  const signs: THREE.Mesh[] = [];
  for (const b of buildings) {
    const mb = cb.get(b.x, b.z, 'facade');
    const fw = new FacadeWriter(mb);
    const r = new Rng(b.seed);
    const style = STYLE_ID[b.style];
    const [floorH, winW] = STYLE_GRID[b.style];
    const fac: [number, number, number, number] = [style, (b.seed % 997) / 997, floorH, winW];
    const roofFac: [number, number, number, number] = [style, fac[1], floorH, winW];
    const foot = b.baseY - 2.5; // foundation below ground for slopes
    const top = b.baseY + b.h;
    if (b.style === 'house') {
      const wallTop = b.roof === 'gable' ? top - Math.min(2.6, b.h * 0.35) : top;
      fw.box(b.x, b.z, b.w, b.d, foot, wallTop, b.baseY, b.color, fac, b.roof !== 'gable');
      if (b.roof === 'gable') fw.gable(b.x, b.z, b.w, b.d, wallTop, top - wallTop + 0.6, r.pick(ROOF_COLORS), roofFac);
      else fw.box(b.x, b.z, b.w + 0.4, b.d + 0.4, wallTop, wallTop + 0.35, b.baseY, 0x777777, roofFac);
      // porch / garage annex
      if (r.chance(0.5)) {
        const side = r.chance(0.5) ? 1 : -1;
        const gw = 5.5;
        const gx = b.x + side * (b.w / 2 + gw / 2 - 0.1);
        if (Math.abs(gx - b.x) < b.w) fw.box(gx, b.z + 1, gw, Math.min(b.d - 2, 6.5), foot, b.baseY + 3, b.baseY, b.color, [5, fac[1] + 0.3, 3, 3]);
      }
      continue;
    }
    if (b.style === 'villa') {
      fw.box(b.x, b.z, b.w, b.d, foot, b.baseY + 3.6, b.baseY, b.color, fac);
      if (b.tiers > 1) fw.box(b.x - b.w * 0.12, b.z + b.d * 0.08, b.w * 0.7, b.d * 0.75, b.baseY + 3.6, b.baseY + 7.2, b.baseY, b.color, fac);
      // roof slab overhang
      fw.box(b.x, b.z, b.w + 1.6, b.d + 1.6, b.baseY + 3.6 * (b.tiers > 1 ? 2 : 1), b.baseY + 3.6 * (b.tiers > 1 ? 2 : 1) + 0.35, b.baseY, 0xe8e6e2, [2, fac[1], 3, 3]);
      // terrace + pool
      const px = b.x;
      const pz = b.z + b.d / 2 + 6;
      fw.box(px, pz, b.w, 10, foot, b.baseY + 0.25, b.baseY, 0xd8cfc0, [2, 0.1, 3, 3]);
      pools.flatRect(px - b.w * 0.35, pz - 3, px + b.w * 0.35, pz + 3, b.baseY + 0.22, 4);
      continue;
    }
    if (b.style === 'terminal') {
      fw.box(b.x, b.z, b.w, b.d, b.baseY, top, b.baseY, b.color, fac, false);
      // big overhanging roof
      fw.box(b.x, b.z - 4, b.w + 14, b.d + 22, top, top + 1.2, b.baseY, 0xd4d9dd, [2, 0.5, 4, 4]);
      for (let x = b.x - b.w / 2; x <= b.x + b.w / 2; x += 25) fw.box(x, b.z - b.d / 2 - 14, 1, 1, b.baseY, top, b.baseY, 0xcfd4d8, [2, 0.2, 4, 4]);
      continue;
    }
    if (b.style === 'hangar') {
      fw.box(b.x, b.z, b.w, b.d, b.baseY, top - 5, b.baseY, b.color, fac, false);
      fw.gable(b.x, b.z, b.w, b.d, top - 5, 5.5, 0x8f979b, roofFac);
      continue;
    }
    // generic block / tower with tiers
    const tiers = Math.max(1, b.tiers);
    let y = foot;
    let w = b.w;
    let d = b.d;
    const tierH = (top - b.baseY) / (tiers === 1 ? 1 : tiers + 0.6);
    for (let t = 0; t < tiers; t++) {
      const yTop = t === tiers - 1 ? top : b.baseY + tierH * (t + 1) * (t === 0 ? 1.6 : 1);
      fw.box(b.x, b.z, w, d, y, yTop, b.baseY, b.color, fac, true, 0x8a8a88);
      // parapet
      fw.box(b.x, b.z, w + 0.3, d + 0.3, yTop, yTop + 0.9, b.baseY, b.color, [style, fac[1], 999, 999], false);
      y = yTop;
      w *= 0.78;
      d *= 0.78;
    }
    // rooftop equipment
    if (b.h > 14) {
      const n = Math.min(6, Math.floor((w * d) / 120) + 1);
      for (let k = 0; k < n; k++) {
        const ux = b.x + r.range(-w / 2 + 2, w / 2 - 2);
        const uz = b.z + r.range(-d / 2 + 2, d / 2 - 2);
        fw.box(ux, uz, r.range(2, 4.5), r.range(2, 4.5), top, top + r.range(1.2, 2.8), b.baseY, 0x9a9c9e, [4, 0.7, 999, 999]);
      }
      if (b.h > 150 && r.chance(0.6)) fw.box(b.x, b.z, 0.8, 0.8, top, top + r.range(12, 28), b.baseY, 0xb0b0b0, [4, 0.7, 999, 999]);
    }
    // awnings over storefronts
    if (b.storefront && b.h < 60 && (b.style === 'brick' || b.style === 'stucco' || b.style === 'office' || b.style === 'poi')) {
      const ac = r.pick([0x7a1f1f, 0x1f4a7a, 0x2f6b3a, 0x333333, 0xc28b2c]);
      const fy = b.baseY + 3.0;
      const out = 1.6;
      if (b.face === 'n') fw.box(b.x, b.z - b.d / 2 - out / 2, b.w * 0.86, out, fy, fy + 0.25, b.baseY, ac, [4, 0.1, 999, 999]);
      if (b.face === 's') fw.box(b.x, b.z + b.d / 2 + out / 2, b.w * 0.86, out, fy, fy + 0.25, b.baseY, ac, [4, 0.1, 999, 999]);
      if (b.face === 'w') fw.box(b.x - b.w / 2 - out / 2, b.z, out, b.d * 0.86, fy, fy + 0.25, b.baseY, ac, [4, 0.1, 999, 999]);
      if (b.face === 'e') fw.box(b.x + b.w / 2 + out / 2, b.z, out, b.d * 0.86, fy, fy + 0.25, b.baseY, ac, [4, 0.1, 999, 999]);
    }
    // signage for POIs and named buildings
    if (b.sign) signs.push(makeSign(b));
  }
  cb.build({ facade }, { castShadow: true, receiveShadow: true }, group);
  if (!pools.isEmpty()) {
    const pm = new THREE.Mesh(pools.toGeometry(), poolMat);
    pm.receiveShadow = true;
    group.add(pm);
  }
  for (const s of signs) group.add(s);
  return { group, signs };
}

function makeSign(b: Building): THREE.Mesh {
  const text = b.sign ?? '';
  const neon = b.poi?.kind === 'club' || b.poi?.kind === 'restaurant' || b.poi?.kind === 'shop' || b.poi?.kind === 'gas';
  const colors: Record<string, [string, string, string]> = {
    club: ['#0a0a12', '#ff3df2', '#ff3df2'],
    restaurant: ['#2a0d0d', '#ffcf5a', '#ff9a3d'],
    shop: ['#0d3b2a', '#ffffff', '#6dffb5'],
    gas: ['#b3121a', '#ffffff', '#ffffff'],
    police: ['#0e2a52', '#ffffff', '#9cc6ff'],
    hospital: ['#ffffff', '#c8102e', '#ff6b6b'],
    fire: ['#7a0d0d', '#ffffff', '#ffd0a0'],
  };
  const kind = b.poi?.kind ?? 'generic';
  const [bg, fg, glow] = colors[kind] ?? ['#1b1d22', '#f2f2f2', '#ffffff'];
  const tex = signTexture(text, { bg, fg, glow });
  const w = Math.min(b.w * 0.75, Math.max(6, text.length * 1.1));
  const h = w * (192 / 1024) * 1.25;
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: neon ? 1.6 : 0.6, roughness: 0.4 });
  mat.userData['neon'] = neon;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const y = b.baseY + Math.min(b.h - h / 2 - 0.4, Math.max(4.2, b.h * 0.6));
  const off = 0.08;
  if (b.face === 'n') {
    m.position.set(b.x, y, b.z - b.d / 2 - off);
    m.rotation.y = Math.PI;
  } else if (b.face === 's') {
    m.position.set(b.x, y, b.z + b.d / 2 + off);
  } else if (b.face === 'w') {
    m.position.set(b.x - b.w / 2 - off, y, b.z);
    m.rotation.y = -Math.PI / 2;
  } else {
    m.position.set(b.x + b.w / 2 + off, y, b.z);
    m.rotation.y = Math.PI / 2;
  }
  m.userData['signKind'] = kind;
  return m;
}

/** A few rooftop billboards with original brand names. */
export function buildBillboards(buildings: readonly Building[]): THREE.Group {
  const g = new THREE.Group();
  const brands: [string, string, string][] = [
    ['COAST FM 98.7', '#0d1b2a', '#4cc9f0'],
    ['NEXA MOTORS', '#111111', '#f2f2f2'],
    ['SUNSET COLA', '#b3121a', '#ffe14d'],
    ['VISTA AIR', '#1d3557', '#a8dadc'],
    ['PALM BANK', '#0b3d2e', '#f1faee'],
    ['NOVA PHONE', '#14141c', '#c77dff'],
  ];
  let k = 0;
  const cands = buildings.filter((b) => b.h > 18 && b.h < 70 && (b.style === 'office' || b.style === 'brick'));
  for (let i = 0; i < cands.length && k < 26; i += 9) {
    const b = cands[i];
    if (!b) continue;
    const [text, bg, fg] = brands[k % brands.length] as [string, string, string];
    const tex = signTexture(text, { bg, fg, glow: fg, w: 1024, h: 384 });
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.9, roughness: 0.5 });
    mat.userData['neon'] = true;
    const w = Math.min(14, b.w * 0.8);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.375), mat);
    m.position.set(b.x, b.baseY + b.h + 1 + w * 0.19, b.z);
    m.rotation.y = (k % 4) * (Math.PI / 2);
    m.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.375, 0.3), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 }));
    back.position.copy(m.position);
    back.rotation.copy(m.rotation);
    back.translateZ(-0.2);
    g.add(back);
    m.translateZ(0.0);
    g.add(m);
    k++;
  }
  return g;
}
