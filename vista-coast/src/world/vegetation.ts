// Trees and grass: procedural palm / oak / pine / cypress / bush models,
// instanced per chunk with near/far LOD, wind sway, leaf translucency and
// alpha-tested shadows. Grass clumps follow the player.

import * as THREE from 'three';
import { Rng } from '../core/rng';
import { MeshBuilder } from '../render/geom';
import { patchWind } from '../render/shaderlib';
import type { TextureLib } from '../render/textures';
import { CHUNK } from './terrainMesh';
import type { GroundModel } from './ground';
import type { Tree, TreeType } from './worldgen';

/** Colour given in sRGB-ish authoring values -> linear (vertex colours are linear in three.js). */
function lin(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color(r, g, b).convertSRGBToLinear().multiplyScalar(1.35);
}

interface TreeModel {
  trunk: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  height: number;
  leafMat: 'palm' | 'broad' | 'pine';
}

function tube(mb: MeshBuilder, path: THREE.Vector3[], r0: number, r1: number, seg: number, vScale: number, c?: THREE.Color): void {
  const n = path.length;
  const base = mb.vertexCount;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const p = path[i] as THREE.Vector3;
    const nxt = path[Math.min(n - 1, i + 1)] as THREE.Vector3;
    const prv = path[Math.max(0, i - 1)] as THREE.Vector3;
    const t = new THREE.Vector3().subVectors(nxt, prv).normalize();
    const side = new THREE.Vector3().crossVectors(t, Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    const bin = new THREE.Vector3().crossVectors(side, t).normalize();
    const r = r0 + (r1 - r0) * (i / (n - 1));
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const nx = side.x * Math.cos(a) + bin.x * Math.sin(a);
      const ny = side.y * Math.cos(a) + bin.y * Math.sin(a);
      const nz = side.z * Math.cos(a) + bin.z * Math.sin(a);
      mb.vertex(p.x + nx * r, p.y + ny * r, p.z + nz * r, nx, ny, nz, k / seg, (i / (n - 1)) * vScale, c);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = base + i * (seg + 1) + k;
      const b = a + seg + 1;
      mb.tri(a, b, a + 1);
      mb.tri(a + 1, b, b + 1);
    }
  }
}

/** A leaf card (quad) centred at c, facing direction n, with soft spherical normals from `center`. */
function card(mb: MeshBuilder, c: THREE.Vector3, size: number, rotY: number, tilt: number, center: THREE.Vector3): void {
  const right = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
  const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(right, tilt);
  const h = size / 2;
  const corners = [
    c.clone().addScaledVector(right, -h).addScaledVector(up, -h),
    c.clone().addScaledVector(right, h).addScaledVector(up, -h),
    c.clone().addScaledVector(right, h).addScaledVector(up, h),
    c.clone().addScaledVector(right, -h).addScaledVector(up, h),
  ];
  const uvs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const idx: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = corners[i] as THREE.Vector3;
    const nn = new THREE.Vector3().subVectors(p, center).normalize();
    nn.y = nn.y * 0.6 + 0.4;
    nn.normalize();
    const uv = uvs[i] as [number, number];
    idx.push(mb.vertex(p.x, p.y, p.z, nn.x, nn.y, nn.z, uv[0], uv[1]));
  }
  mb.tri(idx[0] as number, idx[1] as number, idx[2] as number);
  mb.tri(idx[0] as number, idx[2] as number, idx[3] as number);
}

function buildPalm(r: Rng, small: boolean): TreeModel {
  const H = small ? 3.2 : 10.5;
  const trunk = new MeshBuilder();
  const leaves = new MeshBuilder();
  const path: THREE.Vector3[] = [];
  const lean = small ? 0.2 : r.range(0.6, 1.4);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    path.push(new THREE.Vector3(Math.sin(t * 1.3) * lean, t * H, 0));
  }
  tube(trunk, path, small ? 0.22 : 0.3, small ? 0.16 : 0.2, 7, H / 1.2);
  const top = path[path.length - 1] as THREE.Vector3;
  const fronds = small ? 8 : 13;
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + r.range(-0.2, 0.2);
    const len = (small ? 2.2 : 5.2) * r.range(0.85, 1.1);
    const width = small ? 1.1 : 2.1;
    const droop = r.range(0.45, 0.95);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const segs = 7;
    const base = leaves.vertexCount;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const along = dir.clone().multiplyScalar(t * len);
      const y = Math.sin(t * Math.PI * 0.55) * len * 0.35 - t * t * len * droop;
      const p = top.clone().add(along).add(new THREE.Vector3(0, y, 0));
      const n = new THREE.Vector3(0, 1, 0).addScaledVector(dir, 0.3).normalize();
      for (const s of [-1, 1]) {
        const q = p.clone().addScaledVector(side, (s * width) / 2).add(new THREE.Vector3(0, -Math.abs(s) * 0.25 * t, 0));
        leaves.vertex(q.x, q.y, q.z, n.x, n.y, n.z, s < 0 ? 0 : 1, t);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      leaves.tri(a, a + 1, a + 3);
      leaves.tri(a, a + 3, a + 2);
    }
  }
  // far: trunk line + small crown blob
  const far = new MeshBuilder();
  tube(far, [path[0] as THREE.Vector3, top], 0.3, 0.2, 4, 1, lin(0.32, 0.26, 0.2));
  const crown = new THREE.IcosahedronGeometry(small ? 1.4 : 3.6, 0);
  far.merge(crown, new THREE.Matrix4().makeTranslation(top.x, top.y - 0.4, top.z).multiply(new THREE.Matrix4().makeScale(1, 0.45, 1)), lin(0.25, 0.34, 0.14));
  return { trunk: trunk.toGeometry(), leaves: leaves.toGeometry(), far: far.toGeometry(), height: H + 1, leafMat: 'palm' };
}

function buildOak(r: Rng, bush: boolean): TreeModel {
  const trunk = new MeshBuilder();
  const leaves = new MeshBuilder();
  const H = bush ? 0.4 : 4.2;
  const cr = bush ? 1.1 : 3.6;
  const cy = bush ? 0.9 : 6.8;
  if (!bush) {
    tube(trunk, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, H * 0.6, 0.05), new THREE.Vector3(-0.1, H, 0)], 0.36, 0.24, 7, 3);
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI * 2 + r.range(0, 0.6);
      tube(trunk, [new THREE.Vector3(0, H * 0.8, 0), new THREE.Vector3(Math.sin(a) * 1.6, H + 1.5, Math.cos(a) * 1.6), new THREE.Vector3(Math.sin(a) * 2.4, H + 2.6, Math.cos(a) * 2.4)], 0.17, 0.07, 5, 2);
    }
  }
  const center = new THREE.Vector3(0, cy, 0);
  const n = bush ? 10 : 30;
  for (let i = 0; i < n; i++) {
    const u = r.range(-1, 1);
    const a = r.range(0, Math.PI * 2);
    const rr = Math.sqrt(1 - u * u);
    const p = new THREE.Vector3(Math.cos(a) * rr * cr, u * cr * 0.75, Math.sin(a) * rr * cr).multiplyScalar(r.range(0.55, 1.0)).add(center);
    card(leaves, p, bush ? 1.6 : r.range(2.6, 3.6), r.range(0, Math.PI), r.range(-0.6, 0.6), center);
  }
  const far = new MeshBuilder();
  if (!bush) tube(far, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, H, 0)], 0.35, 0.25, 4, 1, lin(0.3, 0.24, 0.18));
  far.merge(new THREE.IcosahedronGeometry(cr * 1.05, 1), new THREE.Matrix4().makeTranslation(0, cy, 0).multiply(new THREE.Matrix4().makeScale(1, 0.82, 1)), lin(0.2, 0.3, 0.13));
  return { trunk: trunk.toGeometry(), leaves: leaves.toGeometry(), far: far.toGeometry(), height: cy + cr, leafMat: 'broad' };
}

function buildPine(r: Rng, cypress: boolean): TreeModel {
  const trunk = new MeshBuilder();
  const leaves = new MeshBuilder();
  const H = cypress ? 9 : 15;
  tube(trunk, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, H, 0)], cypress ? 0.22 : 0.34, 0.08, 6, 5);
  const tiers = cypress ? 9 : 7;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const y = (cypress ? 1.2 : 3.2) + f * (H - (cypress ? 1.5 : 3.6));
    const rad = cypress ? 1.3 * (1 - f * 0.65) : 3.6 * (1 - f * 0.85) + 0.4;
    const cards = cypress ? 5 : 7;
    for (let k = 0; k < cards; k++) {
      const a = (k / cards) * Math.PI * 2 + t * 0.7;
      const p = new THREE.Vector3(Math.sin(a) * rad * 0.55, y, Math.cos(a) * rad * 0.55);
      card(leaves, p, rad * 1.25 + 0.6, a + Math.PI / 2, cypress ? 0.2 : 0.75, new THREE.Vector3(0, y + 1, 0));
    }
  }
  const far = new MeshBuilder();
  far.merge(new THREE.ConeGeometry(cypress ? 1.4 : 3.8, H * 0.92, 7, 1), new THREE.Matrix4().makeTranslation(0, H * 0.54, 0), lin(0.13, 0.22, 0.12));
  return { trunk: trunk.toGeometry(), leaves: leaves.toGeometry(), far: far.toGeometry(), height: H, leafMat: 'pine' };
}

interface ChunkTrees {
  near: THREE.InstancedMesh[];
  far: THREE.InstancedMesh[];
  center: THREE.Vector3;
}

export class Vegetation {
  readonly group = new THREE.Group();
  private chunks: ChunkTrees[] = [];
  private models: TreeModel[];
  private barkMat: THREE.MeshStandardMaterial;
  private leafMats: Record<'palm' | 'broad' | 'pine', THREE.MeshStandardMaterial>;
  private leafDepth: Record<'palm' | 'broad' | 'pine', THREE.MeshDepthMaterial>;
  private farMat: THREE.MeshStandardMaterial;
  nearDist = 220;
  farDist = 800;
  // grass
  private grass: THREE.InstancedMesh | null = null;
  private grassCenter = new THREE.Vector2(1e9, 1e9);

  constructor(
    trees: readonly Tree[],
    tex: TextureLib,
    private readonly ground: GroundModel,
    grass: boolean,
  ) {
    const r = new Rng(99);
    // model per type: 0 palm, 1 oak, 2 pine, 3 cypress, 4 bush, 5 small palm
    this.models = [buildPalm(r, false), buildOak(r, false), buildPine(r, false), buildPine(r, true), buildOak(r, true), buildPalm(r, true)];
    this.barkMat = new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normalMap, roughness: 0.95 });
    const leaf = (map: THREE.Texture, color: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82, color, metalness: 0 });
    this.leafMats = { palm: leaf(tex.palmLeaf, 0xffffff), broad: leaf(tex.broadLeaf, 0xffffff), pine: leaf(tex.pineLeaf, 0xffffff) };
    this.leafDepth = {
      palm: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex.palmLeaf, alphaTest: 0.45 }),
      broad: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex.broadLeaf, alphaTest: 0.45 }),
      pine: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex.pineLeaf, alphaTest: 0.45 }),
    };
    patchWind(this.leafMats.palm, 11, 0.35, true);
    patchWind(this.leafMats.broad, 10, 0.18, true);
    patchWind(this.leafMats.pine, 15, 0.12, true);
    patchWind(this.leafDepth.palm, 11, 0.35, false);
    patchWind(this.leafDepth.broad, 10, 0.18, false);
    patchWind(this.leafDepth.pine, 15, 0.12, false);
    this.farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: false });
    this.buildChunks(trees);
    if (grass) this.buildGrass(tex);
  }

  private buildChunks(trees: readonly Tree[]): void {
    const buckets = new Map<string, Tree[]>();
    for (const t of trees) {
      const k = Math.floor(t.x / CHUNK) + ',' + Math.floor(t.z / CHUNK);
      const arr = buckets.get(k);
      if (arr) arr.push(t);
      else buckets.set(k, [t]);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    for (const [k, list] of buckets) {
      const [cx, cz] = k.split(',').map(Number) as [number, number];
      const ct: ChunkTrees = { near: [], far: [], center: new THREE.Vector3((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK) };
      let ysum = 0;
      for (const t of list) ysum += t.y;
      ct.center.y = ysum / list.length;
      const byType = new Map<TreeType, Tree[]>();
      for (const t of list) {
        const arr = byType.get(t.type);
        if (arr) arr.push(t);
        else byType.set(t.type, [t]);
      }
      for (const [type, arr] of byType) {
        const model = this.models[type] as TreeModel;
        const trunk = new THREE.InstancedMesh(model.trunk, this.barkMat, arr.length);
        const leaves = new THREE.InstancedMesh(model.leaves, this.leafMats[model.leafMat], arr.length);
        leaves.customDepthMaterial = this.leafDepth[model.leafMat];
        const far = new THREE.InstancedMesh(model.far, this.farMat, arr.length);
        arr.forEach((t, i) => {
          q.setFromAxisAngle(Y, t.rot);
          s.setScalar(t.scale);
          p.set(t.x, t.y - 0.1, t.z);
          m.compose(p, q, s);
          trunk.setMatrixAt(i, m);
          leaves.setMatrixAt(i, m);
          far.setMatrixAt(i, m);
        });
        for (const im of [trunk, leaves, far]) {
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          im.frustumCulled = true;
          this.group.add(im);
        }
        trunk.castShadow = true;
        leaves.castShadow = true;
        trunk.receiveShadow = true;
        leaves.receiveShadow = true;
        far.castShadow = false;
        far.receiveShadow = true;
        far.visible = false;
        ct.near.push(trunk, leaves);
        ct.far.push(far);
      }
      this.chunks.push(ct);
    }
  }

  private buildGrass(tex: TextureLib): void {
    // a clump = 3 crossed blades quads
    const mb = new MeshBuilder();
    const blades = 5;
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * Math.PI;
      const dx = Math.cos(a) * 0.45;
      const dz = Math.sin(a) * 0.45;
      const h = 0.55 + (i % 2) * 0.2;
      const c0 = lin(0.2, 0.28, 0.08);
      const c1 = lin(0.48, 0.58, 0.22);
      const b = mb.vertexCount;
      mb.vertex(-dx, 0, -dz, 0, 1, 0, 0, 0, c0);
      mb.vertex(dx, 0, dz, 0, 1, 0, 1, 0, c0);
      mb.vertex(dx * 0.3, h, dz * 0.3, 0, 1, 0, 1, 1, c1);
      mb.vertex(-dx * 0.3, h, -dz * 0.3, 0, 1, 0, 0, 1, c1);
      mb.tri(b, b + 1, b + 2);
      mb.tri(b, b + 2, b + 3);
    }
    const geo = mb.toGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, map: tex.grass.map });
    patchWind(mat, 0.7, 0.25, true);
    const N = 5000;
    this.grass = new THREE.InstancedMesh(geo, mat, N);
    this.grass.count = 0;
    this.grass.frustumCulled = false;
    this.grass.receiveShadow = true;
    this.group.add(this.grass);
  }

  private refreshGrass(cx: number, cz: number): void {
    const g = this.grass;
    if (!g) return;
    const R = 46;
    const step = 1.35;
    let n = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const gx0 = Math.floor((cx - R) / step);
    const gz0 = Math.floor((cz - R) / step);
    for (let j = 0; j < (2 * R) / step; j++) {
      for (let i = 0; i < (2 * R) / step; i++) {
        if (n >= g.instanceMatrix.count) break;
        const gi = gx0 + i;
        const gj = gz0 + j;
        const hx = ((Math.imul(gi, 73856093) ^ Math.imul(gj, 19349663)) >>> 0) / 4294967296;
        const hz = ((Math.imul(gi, 83492791) ^ Math.imul(gj, 2971215073)) >>> 0) / 4294967296;
        const x = (gi + hx) * step;
        const z = (gj + hz) * step;
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz > R * R) continue;
        if (hx > 0.75) continue;
        const kind = this.ground.surfaceKind(x, z, 50);
        if (kind !== 'grass') continue;
        const y = this.ground.groundAt(x, z, 50);
        q.setFromAxisAngle(Y, hz * 6.28);
        s.setScalar(0.7 + hx * 0.8);
        p.set(x, y - 0.02, z);
        m.compose(p, q, s);
        g.setMatrixAt(n++, m);
      }
    }
    g.count = n;
    g.instanceMatrix.needsUpdate = true;
  }

  update(cam: THREE.Vector3, focus: THREE.Vector3): void {
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - cam.x, c.center.z - cam.z) - CHUNK * 0.5;
      const near = d < this.nearDist;
      const far = !near && d < this.farDist;
      for (const m of c.near) m.visible = near;
      for (const m of c.far) m.visible = far;
    }
    if (this.grass && (Math.abs(focus.x - this.grassCenter.x) > 9 || Math.abs(focus.z - this.grassCenter.y) > 9)) {
      this.grassCenter.set(focus.x, focus.z);
      this.refreshGrass(focus.x, focus.z);
    }
  }

  setGrassVisible(v: boolean): void {
    if (this.grass) this.grass.visible = v;
  }
}
