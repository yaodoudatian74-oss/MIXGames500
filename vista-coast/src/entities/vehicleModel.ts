// Procedural vehicle models built from each spec: extruded side profiles with
// tapered greenhouse, wheel arches, lights, trim, interior, liveries.
// One body mesh (per-vertex material ids) + one glass mesh per vehicle;
// wheels are drawn by a shared instanced pool.

import * as THREE from 'three';
import { MeshBuilder } from '../render/geom';
import { signTexture } from '../render/textures';
import type { BodyShape, VehicleSpec } from '../data/vehicles';

export const MAT = {
  paint: 0,
  trim: 1,
  chrome: 2,
  head: 3,
  tail: 4,
  interior: 5,
  indL: 6,
  indR: 7,
  sirenR: 8,
  sirenB: 9,
  white: 10,
  rubber: 11,
  reverse: 12,
  grille: 13,
} as const;

interface Profile {
  belt: number;
  roof: number;
  cowl: number; // z fraction of windshield base
  roofFront: number;
  roofRear: number;
  rearBase: number;
  nose: number; // front top height
  tail: number; // rear top height
  bottom: number;
  noseZ: number; // where hood meets nose
  tailZ: number;
  cargo?: { z0: number; z1: number; top: number } | undefined; // van/truck boxes
  bed?: { z0: number; z1: number } | undefined;
  taper: number;
}

function profileFor(spec: VehicleSpec): Profile {
  const H = spec.height;
  const c = spec.clearance;
  const s: BodyShape = spec.shape;
  switch (s) {
    case 'coupe':
      return { belt: H * 0.68, roof: H, cowl: 0.1, roofFront: -0.04, roofRear: -0.22, rearBase: -0.38, nose: H * 0.5, tail: H * 0.62, bottom: c + 0.06, noseZ: 0.44, tailZ: -0.46, taper: 0.78 };
    case 'wedge':
      return { belt: H * 0.64, roof: H, cowl: 0.16, roofFront: 0.02, roofRear: -0.14, rearBase: -0.34, nose: H * 0.38, tail: H * 0.66, bottom: c + 0.05, noseZ: 0.46, tailZ: -0.47, taper: 0.74 };
    case 'sedan':
      return { belt: H * 0.64, roof: H, cowl: 0.2, roofFront: 0.07, roofRear: -0.14, rearBase: -0.28, nose: H * 0.5, tail: H * 0.6, bottom: c + 0.06, noseZ: 0.45, tailZ: -0.47, taper: 0.8 };
    case 'hatch':
      return { belt: H * 0.6, roof: H, cowl: 0.24, roofFront: 0.12, roofRear: -0.38, rearBase: -0.47, nose: H * 0.5, tail: H * 0.62, bottom: c + 0.06, noseZ: 0.44, tailZ: -0.49, taper: 0.82 };
    case 'suv':
      return { belt: H * 0.6, roof: H, cowl: 0.24, roofFront: 0.12, roofRear: -0.42, rearBase: -0.48, nose: H * 0.55, tail: H * 0.6, bottom: c + 0.08, noseZ: 0.45, tailZ: -0.49, taper: 0.86 };
    case 'jeep':
      return { belt: H * 0.56, roof: H, cowl: 0.18, roofFront: 0.14, roofRear: -0.44, rearBase: -0.47, nose: H * 0.52, tail: H * 0.58, bottom: c + 0.08, noseZ: 0.46, tailZ: -0.49, taper: 0.9 };
    case 'pickup':
      return { belt: H * 0.58, roof: H, cowl: 0.26, roofFront: 0.16, roofRear: -0.06, rearBase: -0.08, nose: H * 0.55, tail: H * 0.56, bottom: c + 0.08, noseZ: 0.46, tailZ: -0.49, bed: { z0: -0.48, z1: -0.1 }, taper: 0.9 };
    case 'van':
      return { belt: H * 0.47, roof: H, cowl: 0.34, roofFront: 0.26, roofRear: 0.1, rearBase: 0.12, nose: H * 0.42, tail: H * 0.95, bottom: c + 0.08, noseZ: 0.47, tailZ: -0.5, cargo: { z0: -0.5, z1: 0.12, top: H }, taper: 0.94 };
    case 'box':
      return { belt: H * 0.5, roof: H * 0.88, cowl: 0.42, roofFront: 0.38, roofRear: 0.24, rearBase: 0.24, nose: H * 0.42, tail: H * 0.5, bottom: c + 0.12, noseZ: 0.49, tailZ: -0.5, cargo: { z0: -0.5, z1: 0.2, top: H }, taper: 0.97 };
    case 'bus':
      return { belt: H * 0.4, roof: H * 0.97, cowl: 0.495, roofFront: 0.49, roofRear: -0.49, rearBase: -0.495, nose: H * 0.4, tail: H * 0.4, bottom: c + 0.1, noseZ: 0.5, tailZ: -0.5, taper: 0.99 };
    case 'bike':
      return { belt: 0.8, roof: 1.0, cowl: 0.3, roofFront: 0.2, roofRear: -0.1, rearBase: -0.2, nose: 0.8, tail: 0.8, bottom: 0.3, noseZ: 0.45, tailZ: -0.45, taper: 1 };
  }
}

function extrudeProfile(pts: THREE.Vector2[], width: number, bevel: number, taperFrom: number, taperTo: number, taper: number): THREE.BufferGeometry {
  // pts are (z, y) in metres. Shape X = z, Shape Y = y. Extrude along shape Z -> world x.
  const shape = new THREE.Shape(pts);
  const depth = Math.max(0.05, width - bevel * 2);
  // bevelOffset pulls the rounded edge inside the profile so the silhouette (and lights/trim placed on it) stays exact
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelOffset: -bevel * 0.9, bevelSegments: 3, curveSegments: 8, steps: 1 });
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const sx = p.getX(i);
    const sy = p.getY(i);
    const sz = p.getZ(i);
    let x = sz - depth / 2;
    const t = Math.min(1, Math.max(0, (sy - taperFrom) / Math.max(0.01, taperTo - taperFrom)));
    x *= 1 - (1 - taper) * t;
    p.setXYZ(i, x, sy, sx);
  }
  g.deleteAttribute('uv');
  // swapping the x/z axes mirrors the mesh, which flips triangle winding: restore
  // outward-facing triangles or the panels are back-face culled (car looks hollow)
  flipWinding(g);
  g.computeVertexNormals();
  return g;
}

function flipWinding(g: THREE.BufferGeometry): void {
  if (g.index) {
    const ix = g.index.array;
    for (let i = 0; i + 2 < ix.length; i += 3) {
      const t = ix[i + 1] as number;
      ix[i + 1] = ix[i + 2] as number;
      ix[i + 2] = t;
    }
    g.index.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const n = a.itemSize;
    const arr = a.array;
    for (let v = 0; v + 2 < a.count; v += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (v + 1) * n + k;
        const i2 = (v + 2) * n + k;
        const t = arr[i1] as number;
        arr[i1] = arr[i2] as number;
        arr[i2] = t;
      }
    }
    a.needsUpdate = true;
  }
}

function addWithMat(mb: MeshBuilder, g: THREE.BufferGeometry, m: THREE.Matrix4, mat: number, color: number): void {
  const before = mb.vertexCount;
  mb.merge(g, m, new THREE.Color(color));
  const added = mb.vertexCount - before;
  for (let i = 0; i < added; i++) mb.attr('aMat', 1, mat);
}

const T = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, y, z);
const TRS = (x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

export interface VehicleGeometry {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  wheels: { x: number; z: number; r: number; w: number; front: boolean }[];
  seat: THREE.Vector3; // driver head position (first person) local
  driverPos: THREE.Vector3; // hips position for the driver model
  exhaust: THREE.Vector3;
  steering: THREE.Vector3;
  lights: { headL: THREE.Vector3; headR: THREE.Vector3; tail: THREE.Vector3 };
  decal: THREE.Texture | null;
  decalPanels: { pos: THREE.Vector3; rotY: number; w: number; h: number }[];
  wipers: THREE.Vector3[];
}

const cache = new Map<string, VehicleGeometry>();

export function vehicleGeometry(spec: VehicleSpec): VehicleGeometry {
  const c = cache.get(spec.id);
  if (c) return c;
  const g = spec.shape === 'bike' ? buildBike(spec) : buildCar(spec);
  cache.set(spec.id, g);
  return g;
}

function buildCar(spec: VehicleSpec): VehicleGeometry {
  const L = spec.length;
  const W = spec.width;
  const P = profileFor(spec);
  const mb = new MeshBuilder();
  const glass = new MeshBuilder();
  const zf = (f: number): number => f * L;
  const wb = spec.wheelbase;
  const wf = wb * 0.52; // front axle z
  const wr = -wb * 0.48; // rear axle z
  const wR = spec.wheelR;
  const archR = wR + 0.07;
  const axleY = wR;
  const trimC = 0x1b1c1e;
  // ----- lower body side profile with wheel arches
  const pts: THREE.Vector2[] = [];
  const bottom = P.bottom;
  pts.push(new THREE.Vector2(zf(-0.5) + 0.06, bottom));
  // rear arch
  const arch = (zc: number): void => {
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI - (i / steps) * Math.PI;
      pts.push(new THREE.Vector2(zc + Math.cos(a) * archR, Math.max(bottom, axleY + Math.sin(a) * archR)));
    }
  };
  arch(wr);
  arch(wf);
  pts.push(new THREE.Vector2(zf(0.5) - 0.04, bottom + 0.02));
  pts.push(new THREE.Vector2(zf(0.5), P.nose * 0.6));
  pts.push(new THREE.Vector2(zf(0.5) - 0.06, P.nose));
  pts.push(new THREE.Vector2(zf(P.noseZ), P.nose + 0.03));
  if (P.cargo) {
    // tall cab/cargo vans: hood up to the windshield base then up to roof handled by greenhouse
    pts.push(new THREE.Vector2(zf(P.cowl), P.belt));
    pts.push(new THREE.Vector2(zf(P.cargo.z1), P.belt));
    pts.push(new THREE.Vector2(zf(P.cargo.z1), P.cargo.top - 0.05));
    pts.push(new THREE.Vector2(zf(P.cargo.z0) + 0.05, P.cargo.top - 0.05));
    pts.push(new THREE.Vector2(zf(P.cargo.z0), P.cargo.top - 0.15));
    pts.push(new THREE.Vector2(zf(P.cargo.z0), bottom + 0.1));
  } else {
    pts.push(new THREE.Vector2(zf(P.cowl), P.belt));
    pts.push(new THREE.Vector2(zf(P.rearBase), P.belt));
    pts.push(new THREE.Vector2(zf(P.tailZ) + 0.12, P.tail + 0.02));
    pts.push(new THREE.Vector2(zf(-0.5), P.tail - 0.04));
    pts.push(new THREE.Vector2(zf(-0.5) - 0.02, P.tail * 0.55));
    pts.push(new THREE.Vector2(zf(-0.5), bottom + 0.08));
  }
  const bevel = Math.min(0.08, W * 0.05);
  const lower = extrudeProfile(pts, W, bevel, P.belt * 0.75, P.roof, 0.96);
  addWithMat(mb, lower, new THREE.Matrix4(), MAT.paint, 0xffffff);

  // ----- greenhouse (glass) + roof + pillars
  if (spec.shape === 'bus') {
    const gh = [new THREE.Vector2(zf(-0.495), P.belt), new THREE.Vector2(zf(0.495), P.belt), new THREE.Vector2(zf(0.49), P.roof - 0.1), new THREE.Vector2(zf(-0.49), P.roof - 0.1)];
    const gg = extrudeProfile(gh, W - 0.04, 0.02, P.belt, P.roof, 0.99);
    glass.merge(gg, new THREE.Matrix4());
    const roofG = new THREE.BoxGeometry(W - 0.02, 0.18, L - 0.06);
    addWithMat(mb, roofG, T(0, P.roof - 0.02, 0), MAT.paint, 0xffffff);
    for (let z = -L / 2 + 0.6; z < L / 2 - 0.3; z += 1.4) addWithMat(mb, new THREE.BoxGeometry(W + 0.01, P.roof - P.belt - 0.1, 0.09), T(0, (P.belt + P.roof) / 2 - 0.05, z), MAT.trim, trimC);
  } else {
    const gtop = P.roof - 0.06;
    const gh = [new THREE.Vector2(zf(P.rearBase), P.belt - 0.02), new THREE.Vector2(zf(P.cowl), P.belt - 0.02), new THREE.Vector2(zf(P.roofFront), gtop), new THREE.Vector2(zf(P.roofRear), gtop)];
    const gg = extrudeProfile(gh, W - 0.06, 0.04, P.belt, P.roof, P.taper);
    glass.merge(gg, new THREE.Matrix4());
    // roof panel
    const roofLen = zf(P.roofFront) - zf(P.roofRear) + 0.12;
    const rw = (W - 0.06) * P.taper;
    const roofShape = [new THREE.Vector2(zf(P.roofRear) - 0.06, gtop - 0.02), new THREE.Vector2(zf(P.roofFront) + 0.06, gtop - 0.02), new THREE.Vector2(zf(P.roofFront) + 0.02, P.roof + 0.015), new THREE.Vector2(zf(P.roofRear) - 0.02, P.roof + 0.015)];
    void roofLen;
    addWithMat(mb, extrudeProfile(roofShape, rw + 0.02, 0.02, 0, 10, 1), new THREE.Matrix4(), MAT.paint, 0xffffff);
    // pillars: A (along windshield edges), B (middle), C (rear)
    const pillar = (z0: number, y0: number, z1: number, y1: number, side: number, w: number): void => {
      const dz = z1 - z0;
      const dy = y1 - y0;
      const len = Math.hypot(dz, dy);
      const a = Math.atan2(dz, dy);
      const tx = side * ((W - 0.06) / 2) * (1 - (1 - P.taper) * 0.5) + side * 0.01;
      addWithMat(mb, new THREE.BoxGeometry(0.05, len, w), TRS(tx, (y0 + y1) / 2, (z0 + z1) / 2, a, 0, 0), MAT.paint, 0xffffff);
    };
    for (const side of [-1, 1]) {
      pillar(zf(P.cowl), P.belt, zf(P.roofFront), gtop, side, 0.08);
      pillar(zf(P.rearBase), P.belt, zf(P.roofRear), gtop, side, 0.12);
      const bz = (zf(P.roofFront) + zf(P.roofRear)) / 2 + 0.05;
      if (spec.shape !== 'coupe' && spec.shape !== 'wedge') pillar(bz, P.belt, bz, gtop, side, 0.09);
    }
  }
  // ----- pickup bed / cargo details
  if (P.bed) {
    const bz0 = zf(P.bed.z0);
    const bz1 = zf(P.bed.z1);
    addWithMat(mb, new THREE.BoxGeometry(W - 0.2, 0.04, bz1 - bz0 - 0.1), T(0, P.belt + 0.002, (bz0 + bz1) / 2), MAT.interior, 0x202224);
  }
  // ----- bumpers, grille, lights
  const frontZ = zf(0.5);
  const rearZ = zf(-0.5);
  const bumperY = P.bottom + 0.12;
  addWithMat(mb, new THREE.BoxGeometry(W * 0.96, 0.16, 0.12), T(0, bumperY, frontZ - 0.02), MAT.trim, trimC);
  addWithMat(mb, new THREE.BoxGeometry(W * 0.96, 0.16, 0.12), T(0, bumperY, rearZ + 0.02), MAT.trim, trimC);
  const grilleH = Math.max(0.12, P.nose * 0.22);
  addWithMat(mb, new THREE.BoxGeometry(W * 0.45, grilleH, 0.04), T(0, P.nose * 0.62, frontZ + 0.005), MAT.grille, 0x111214);
  const headY = P.nose * 0.85;
  const headL = new THREE.Vector3(W * 0.33, headY, frontZ - 0.03);
  const headR = new THREE.Vector3(-W * 0.33, headY, frontZ - 0.03);
  for (const hp of [headL, headR]) {
    addWithMat(mb, new THREE.BoxGeometry(W * 0.2, Math.max(0.07, P.nose * 0.12), 0.08), T(hp.x, hp.y, hp.z + 0.02), MAT.head, 0xf2f4f6);
    addWithMat(mb, new THREE.BoxGeometry(0.1, 0.05, 0.06), T(hp.x + Math.sign(hp.x) * W * 0.09, hp.y - 0.08, hp.z + 0.03), hp.x > 0 ? MAT.indL : MAT.indR, 0xffa51f);
  }
  const tailY = P.tail * (P.cargo ? 0.35 : 0.85);
  for (const sx of [1, -1]) {
    addWithMat(mb, new THREE.BoxGeometry(W * 0.22, 0.1, 0.06), T(sx * W * 0.34, tailY, rearZ - 0.0), MAT.tail, 0x8a0b0b);
    addWithMat(mb, new THREE.BoxGeometry(0.08, 0.06, 0.05), T(sx * W * 0.2, tailY - 0.03, rearZ - 0.005), MAT.reverse, 0xdddddd);
    addWithMat(mb, new THREE.BoxGeometry(0.1, 0.06, 0.05), T(sx * W * 0.44, tailY + 0.07, rearZ - 0.005), sx > 0 ? MAT.indL : MAT.indR, 0xb06010);
  }
  // side skirts + mirrors + door handles
  for (const sx of [1, -1]) {
    addWithMat(mb, new THREE.BoxGeometry(0.06, 0.08, wf - wr - archR * 2 - 0.1), T(sx * (W / 2 - 0.01), P.bottom + 0.05, (wf + wr) / 2), MAT.trim, trimC);
    const mz = zf(P.cowl) - 0.12;
    addWithMat(mb, new THREE.BoxGeometry(0.2, 0.11, 0.08), T(sx * (W / 2 + 0.07), P.belt + 0.06, mz), MAT.paint, 0xffffff);
    addWithMat(mb, new THREE.BoxGeometry(0.17, 0.09, 0.01), T(sx * (W / 2 + 0.08), P.belt + 0.06, mz - 0.045), MAT.chrome, 0xd0d4d8);
    addWithMat(mb, new THREE.BoxGeometry(0.02, 0.025, 0.14), T(sx * (W / 2 + 0.005), P.belt - 0.12, zf(P.cowl) - 0.6), MAT.chrome, 0xd0d4d8);
  }
  // exhaust
  const exhaust = new THREE.Vector3(-W * 0.28, P.bottom + 0.05, rearZ - 0.05);
  addWithMat(mb, new THREE.CylinderGeometry(0.045, 0.045, 0.16, 8), TRS(exhaust.x, exhaust.y, exhaust.z + 0.05, Math.PI / 2, 0, 0), MAT.chrome, 0xb8bcc0);
  // ----- interior: dashboard, seats
  const dashZ = zf(P.cowl) - 0.25;
  addWithMat(mb, new THREE.BoxGeometry(W * 0.86, 0.22, 0.38), T(0, P.belt - 0.08, dashZ), MAT.interior, 0x1d1e21);
  const seatZ = (zf(P.roofFront) + zf(P.roofRear)) / 2 - (P.cargo ? -0.15 : 0.15);
  const seatX = W * 0.22;
  const seatBase = P.bottom + 0.28;
  for (const sx of [1, -1]) {
    addWithMat(mb, new THREE.BoxGeometry(0.48, 0.14, 0.5), T(sx * seatX, seatBase, seatZ), MAT.interior, 0x2a2b2e);
    addWithMat(mb, new THREE.BoxGeometry(0.48, 0.62, 0.12), TRS(sx * seatX, seatBase + 0.36, seatZ - 0.28, -0.18, 0, 0), MAT.interior, 0x2a2b2e);
  }
  if (spec.seats >= 4 && !P.bed && !P.cargo) addWithMat(mb, new THREE.BoxGeometry(W * 0.8, 0.5, 0.45), T(0, seatBase + 0.15, seatZ - 0.9), MAT.interior, 0x2a2b2e);
  // ----- liveries & special equipment
  let decal: THREE.Texture | null = null;
  const decalPanels: { pos: THREE.Vector3; rotY: number; w: number; h: number }[] = [];
  if (spec.category === 'police') {
    // white doors + light bar
    for (const sx of [1, -1]) addWithMat(mb, new THREE.BoxGeometry(0.02, P.belt - P.bottom - 0.25, wf - wr - 0.6), T(sx * (W / 2 + 0.012), (P.belt + P.bottom) / 2 + 0.05, (wf + wr) / 2), MAT.white, 0xf4f4f4);
    const barY = P.roof + 0.1;
    const barZ = (zf(P.roofFront) + zf(P.roofRear)) / 2;
    addWithMat(mb, new THREE.BoxGeometry(W * 0.75, 0.1, 0.3), T(0, barY - 0.02, barZ), MAT.trim, trimC);
    addWithMat(mb, new THREE.BoxGeometry(W * 0.34, 0.1, 0.26), T(W * 0.2, barY + 0.06, barZ), MAT.sirenR, 0xff2020);
    addWithMat(mb, new THREE.BoxGeometry(W * 0.34, 0.1, 0.26), T(-W * 0.2, barY + 0.06, barZ), MAT.sirenB, 0x2040ff);
    addWithMat(mb, new THREE.BoxGeometry(W * 0.9, 0.3, 0.1), T(0, bumperY + 0.12, frontZ + 0.1), MAT.trim, trimC); // push bar
    decal = signTexture('VCPD  POLICE', { bg: '#f4f4f4', fg: '#0e2a52', w: 1024, h: 160 });
    for (const sx of [1, -1]) decalPanels.push({ pos: new THREE.Vector3(sx * (W / 2 + 0.03), P.belt - 0.25, (wf + wr) / 2), rotY: sx > 0 ? Math.PI / 2 : -Math.PI / 2, w: 1.7, h: 0.27 });
  } else if (spec.category === 'ambulance') {
    for (const sx of [1, -1]) addWithMat(mb, new THREE.BoxGeometry(0.02, 0.22, L * 0.7), T(sx * (W / 2 + 0.01), P.belt + 0.1, -L * 0.1), MAT.sirenR, 0xd01818);
    addWithMat(mb, new THREE.BoxGeometry(W * 0.6, 0.1, 0.25), T(W * 0.15, P.roof + 0.04, zf(P.roofFront) - 0.1), MAT.sirenR, 0xff2020);
    addWithMat(mb, new THREE.BoxGeometry(W * 0.3, 0.1, 0.25), T(-W * 0.25, P.roof + 0.04, zf(P.roofFront) - 0.1), MAT.sirenB, 0x2040ff);
    decal = signTexture('AMBULANCE  ✚', { bg: '#f4f4f4', fg: '#c8102e', w: 1024, h: 160 });
    for (const sx of [1, -1]) decalPanels.push({ pos: new THREE.Vector3(sx * (W / 2 + 0.03), P.belt + 0.55, -L * 0.15), rotY: sx > 0 ? Math.PI / 2 : -Math.PI / 2, w: 2.6, h: 0.42 });
  } else if (spec.category === 'fire') {
    addWithMat(mb, new THREE.BoxGeometry(0.6, 0.16, L * 0.75), T(0, spec.height + 0.12, -L * 0.1), MAT.chrome, 0xc8ccd0); // ladder
    for (let z = -L * 0.45; z < L * 0.25; z += 0.5) addWithMat(mb, new THREE.BoxGeometry(0.62, 0.05, 0.05), T(0, spec.height + 0.22, z), MAT.chrome, 0xc8ccd0);
    addWithMat(mb, new THREE.BoxGeometry(W * 0.7, 0.12, 0.3), T(0, P.roof + 0.06, zf(0.38)), MAT.sirenR, 0xff2020);
    for (const sx of [1, -1]) addWithMat(mb, new THREE.BoxGeometry(0.03, 0.18, L * 0.72), T(sx * (W / 2 + 0.01), P.belt - 0.1, -L * 0.1), MAT.white, 0xf2f2f2);
  } else if (spec.category === 'taxi') {
    addWithMat(mb, new THREE.BoxGeometry(0.7, 0.2, 0.25), T(0, P.roof + 0.1, (zf(P.roofFront) + zf(P.roofRear)) / 2), MAT.head, 0xfff7d6);
    for (const sx of [1, -1]) addWithMat(mb, new THREE.BoxGeometry(0.02, 0.1, wf - wr - 0.7), T(sx * (W / 2 + 0.01), P.belt - 0.3, (wf + wr) / 2), MAT.trim, 0x111111);
  } else if (spec.category === 'bus') {
    addWithMat(mb, new THREE.BoxGeometry(W * 0.7, 0.28, 0.06), T(0, P.roof - 0.25, frontZ + 0.01), MAT.head, 0xffb000);
  } else if (spec.category === 'truck') {
    decal = signTexture('HAULER LOGISTICS', { bg: '#f2f2f2', fg: '#2856a3', w: 1024, h: 160 });
    for (const sx of [1, -1]) decalPanels.push({ pos: new THREE.Vector3(sx * (W / 2 + 0.03), spec.height * 0.68, -L * 0.15), rotY: sx > 0 ? Math.PI / 2 : -Math.PI / 2, w: 4.4, h: 0.7 });
  }
  // wipers positions (on windshield base)
  const wipers = [new THREE.Vector3(W * 0.22, P.belt + 0.03, zf(P.cowl) - 0.05), new THREE.Vector3(-W * 0.12, P.belt + 0.03, zf(P.cowl) - 0.05)];
  const body = mb.toGeometry();
  const gl = glass.toGeometry();
  const wheels = [
    { x: W / 2 - spec.wheelW / 2 - 0.02, z: wf, r: wR, w: spec.wheelW, front: true },
    { x: -(W / 2 - spec.wheelW / 2 - 0.02), z: wf, r: wR, w: spec.wheelW, front: true },
    { x: W / 2 - spec.wheelW / 2 - 0.02, z: wr, r: wR, w: spec.wheelW, front: false },
    { x: -(W / 2 - spec.wheelW / 2 - 0.02), z: wr, r: wR, w: spec.wheelW, front: false },
  ];
  if (spec.length > 9) {
    wheels.push({ x: W / 2 - spec.wheelW / 2 - 0.02, z: wr - 1.35, r: wR, w: spec.wheelW, front: false });
    wheels.push({ x: -(W / 2 - spec.wheelW / 2 - 0.02), z: wr - 1.35, r: wR, w: spec.wheelW, front: false });
  }
  return {
    body,
    glass: gl,
    wheels,
    seat: new THREE.Vector3(seatX, seatBase + 0.78, seatZ - 0.05),
    driverPos: new THREE.Vector3(seatX, seatBase + 0.07, seatZ + 0.02),
    exhaust,
    steering: new THREE.Vector3(seatX, P.belt - 0.02, dashZ - 0.32),
    lights: { headL, headR, tail: new THREE.Vector3(0, tailY, rearZ) },
    decal,
    decalPanels,
    wipers,
  };
}

function buildBike(spec: VehicleSpec): VehicleGeometry {
  const mb = new MeshBuilder();
  const glass = new MeshBuilder();
  const wR = spec.wheelR;
  const wf = spec.wheelbase / 2;
  const wr = -spec.wheelbase / 2;
  const trim = 0x1b1c1e;
  // frame + tank + seat + fairing
  addWithMat(mb, new THREE.BoxGeometry(0.12, 0.12, spec.wheelbase * 0.8), TRS(0, wR + 0.25, 0, -0.15, 0, 0), MAT.trim, trim);
  addWithMat(mb, new THREE.SphereGeometry(0.2, 14, 10), TRS(0, wR + 0.52, 0.18, 0, 0, 0, 1, 0.75, 1.5), MAT.paint, 0xffffff);
  addWithMat(mb, new THREE.BoxGeometry(0.26, 0.08, 0.6), TRS(0, wR + 0.52, -0.32, 0.12, 0, 0), MAT.interior, 0x111111);
  addWithMat(mb, new THREE.BoxGeometry(0.36, 0.32, 0.42), TRS(0, wR + 0.32, 0.05, 0, 0, 0), MAT.trim, 0x333538); // engine
  addWithMat(mb, new THREE.ConeGeometry(0.22, 0.5, 10), TRS(0, wR + 0.58, wf - 0.18, -1.3, 0, 0, 1.1, 1, 0.8), MAT.paint, 0xffffff); // fairing
  addWithMat(mb, new THREE.BoxGeometry(0.2, 0.18, 0.5), TRS(0, wR + 0.45, -0.62, 0.35, 0, 0), MAT.paint, 0xffffff); // tail
  addWithMat(mb, new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), TRS(0, wR + 0.78, wf - 0.32, 0, 0, Math.PI / 2), MAT.chrome, 0xcccccc); // handlebar
  for (const z of [wf, wr]) addWithMat(mb, new THREE.CylinderGeometry(0.025, 0.025, wR * 1.9, 6), TRS(0.07, wR + 0.3, z + (z > 0 ? -0.1 : 0.1), z > 0 ? 0.45 : -0.6, 0, 0), MAT.chrome, 0xbbbbbb);
  addWithMat(mb, new THREE.BoxGeometry(0.14, 0.08, 0.05), T(0, wR + 0.62, wf + 0.08), MAT.head, 0xffffff);
  addWithMat(mb, new THREE.BoxGeometry(0.12, 0.05, 0.04), T(0, wR + 0.55, -0.86), MAT.tail, 0x8a0b0b);
  addWithMat(mb, new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), TRS(-0.15, wR + 0.12, -0.45, Math.PI / 2 - 0.2, 0, 0), MAT.chrome, 0xc0c0c0);
  glass.merge(new THREE.BoxGeometry(0.3, 0.2, 0.02), TRS(0, wR + 0.85, wf - 0.28, -0.6, 0, 0));
  return {
    body: mb.toGeometry(),
    glass: glass.toGeometry(),
    wheels: [
      { x: 0, z: wf, r: wR, w: spec.wheelW, front: true },
      { x: 0, z: wr, r: wR, w: spec.wheelW, front: false },
    ],
    seat: new THREE.Vector3(0, wR + 1.35, -0.25),
    driverPos: new THREE.Vector3(0, wR + 0.58, -0.3),
    exhaust: new THREE.Vector3(-0.15, wR + 0.12, -0.75),
    steering: new THREE.Vector3(0, wR + 0.78, wf - 0.32),
    lights: { headL: new THREE.Vector3(0, wR + 0.62, wf + 0.1), headR: new THREE.Vector3(0, wR + 0.62, wf + 0.1), tail: new THREE.Vector3(0, wR + 0.55, -0.88) },
    decal: null,
    decalPanels: [],
    wipers: [],
  };
}

/** Body material: per-vertex material ids select paint / trim / chrome / lights. */
export function makeBodyMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.65, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4 });
  m.userData['uniforms'] = null;
  return m;
}

export interface BodyUniforms {
  uPaint: { value: THREE.Color };
  uHead: { value: number };
  uTail: { value: number };
  uIndL: { value: number };
  uIndR: { value: number };
  uSirenR: { value: number };
  uSirenB: { value: number };
  uReverse: { value: number };
  uDirt: { value: number };
}

export function bodyMaterialFor(base: THREE.MeshPhysicalMaterial, paint: number): { mat: THREE.MeshPhysicalMaterial; u: BodyUniforms } {
  const mat = base.clone();
  const u: BodyUniforms = {
    uPaint: { value: new THREE.Color(paint) },
    uHead: { value: 0.2 },
    uTail: { value: 0.2 },
    uIndL: { value: 0 },
    uIndR: { value: 0 },
    uSirenR: { value: 0 },
    uSirenB: { value: 0 },
    uReverse: { value: 0 },
    uDirt: { value: 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMat;\nvarying float vMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vMat = aMat;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uPaint; uniform float uHead; uniform float uTail; uniform float uIndL; uniform float uIndR;
uniform float uSirenR; uniform float uSirenB; uniform float uReverse; uniform float uDirt;
varying float vMat;
float matIs(float id) { return 1.0 - step(0.5, abs(vMat - id)); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  if (matIs(0.0) > 0.5) diffuseColor.rgb = uPaint;
  diffuseColor.rgb *= 1.0 - uDirt * 0.35;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = matIs(0.0) * mix(0.28, 0.6, uDirt) + matIs(1.0) * 0.7 + matIs(2.0) * 0.12 + matIs(3.0) * 0.05 + matIs(4.0) * 0.15
    + matIs(5.0) * 0.85 + (matIs(6.0) + matIs(7.0)) * 0.2 + (matIs(8.0) + matIs(9.0)) * 0.15 + matIs(10.0) * 0.3 + matIs(11.0) * 0.9 + matIs(12.0) * 0.1 + matIs(13.0) * 0.6;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
  metalnessFactor = matIs(0.0) * 0.55 + matIs(2.0) * 1.0 + matIs(13.0) * 0.4;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += matIs(3.0) * vec3(1.0, 0.96, 0.88) * uHead
    + matIs(4.0) * vec3(1.0, 0.04, 0.02) * uTail
    + matIs(6.0) * vec3(1.0, 0.55, 0.05) * uIndL
    + matIs(7.0) * vec3(1.0, 0.55, 0.05) * uIndR
    + matIs(8.0) * vec3(1.0, 0.05, 0.03) * uSirenR
    + matIs(9.0) * vec3(0.05, 0.2, 1.0) * uSirenB
    + matIs(12.0) * vec3(1.0) * uReverse;`,
      );
    // clearcoat only on paint
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clearcoat_normal_fragment_begin>',
      `#include <clearcoat_normal_fragment_begin>`,
    );
  };
  mat.customProgramCacheKey = () => 'vbody-v2';
  return { mat, u };
}

/** Wheel geometry (tire + rim), radius 1, width 1, axle along x. */
export function wheelGeometries(): { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const tire = new THREE.TorusGeometry(0.78, 0.24, 10, 28);
  tire.scale(1, 1, 2.0);
  tire.rotateY(Math.PI / 2);
  const tireCyl = new THREE.CylinderGeometry(0.98, 0.98, 0.92, 28, 1, true).rotateZ(Math.PI / 2);
  const tmb = new MeshBuilder();
  tmb.merge(tire, new THREE.Matrix4());
  tmb.merge(tireCyl, new THREE.Matrix4());
  const rmb = new MeshBuilder();
  rmb.merge(new THREE.CylinderGeometry(0.66, 0.66, 0.6, 24).rotateZ(Math.PI / 2), new THREE.Matrix4());
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    rmb.merge(new THREE.BoxGeometry(0.1, 0.62, 0.14), new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(0.33, 0.3, 0)));
    rmb.merge(new THREE.BoxGeometry(0.1, 0.62, 0.14), new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(-0.33, 0.3, 0)));
  }
  rmb.merge(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 12).rotateZ(Math.PI / 2), new THREE.Matrix4());
  return { tire: tmb.toGeometry(), rim: rmb.toGeometry() };
}
