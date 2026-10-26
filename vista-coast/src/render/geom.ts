// Geometry building helpers: an append-only mesh builder and a chunk-bucketed
// builder so static world geometry is merged per area for frustum culling.

import * as THREE from 'three';

export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  extra: Map<string, { size: number; data: number[] }> = new Map();
  hasColor = false;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c?: THREE.Color): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    if (c) {
      this.hasColor = true;
      this.col.push(c.r, c.g, c.b);
    } else this.col.push(1, 1, 1);
    return this.pos.length / 3 - 1;
  }

  attr(name: string, size: number, ...vals: number[]): void {
    let a = this.extra.get(name);
    if (!a) {
      a = { size, data: [] };
      this.extra.set(name, a);
    }
    a.data.push(...vals);
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Quad with corners in CCW order (as seen from the normal side). */
  quad(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    n: THREE.Vector3,
    uv0: [number, number],
    uv1: [number, number],
    uv2: [number, number],
    uv3: [number, number],
    c?: THREE.Color,
  ): number {
    const a = this.vertex(p0.x, p0.y, p0.z, n.x, n.y, n.z, uv0[0], uv0[1], c);
    const b = this.vertex(p1.x, p1.y, p1.z, n.x, n.y, n.z, uv1[0], uv1[1], c);
    const cc = this.vertex(p2.x, p2.y, p2.z, n.x, n.y, n.z, uv2[0], uv2[1], c);
    const d = this.vertex(p3.x, p3.y, p3.z, n.x, n.y, n.z, uv3[0], uv3[1], c);
    this.idx.push(a, b, cc, a, cc, d);
    return a;
  }

  /** Horizontal rectangle (top facing) with world-space UVs scaled by `tile`. */
  flatRect(x0: number, z0: number, x1: number, z1: number, y: number, tile: number, c?: THREE.Color): void {
    const up = UP;
    this.quad(
      v3(x0, y, z0),
      v3(x0, y, z1),
      v3(x1, y, z1),
      v3(x1, y, z0),
      up,
      [x0 / tile, z0 / tile],
      [x0 / tile, z1 / tile],
      [x1 / tile, z1 / tile],
      [x1 / tile, z0 / tile],
      c,
    );
  }

  /** Axis-aligned box. Faces get world-space UVs (u along face, v up) scaled by tile. */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, tile: number, c?: THREE.Color, skipBottom = true): void {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const y1 = y0 + h;
    // +x
    this.quad(v3(x1, y0, z1), v3(x1, y0, z0), v3(x1, y1, z0), v3(x1, y1, z1), v3(1, 0, 0), [z1 / tile, y0 / tile], [z0 / tile, y0 / tile], [z0 / tile, y1 / tile], [z1 / tile, y1 / tile], c);
    // -x
    this.quad(v3(x0, y0, z0), v3(x0, y0, z1), v3(x0, y1, z1), v3(x0, y1, z0), v3(-1, 0, 0), [z0 / tile, y0 / tile], [z1 / tile, y0 / tile], [z1 / tile, y1 / tile], [z0 / tile, y1 / tile], c);
    // +z
    this.quad(v3(x0, y0, z1), v3(x1, y0, z1), v3(x1, y1, z1), v3(x0, y1, z1), v3(0, 0, 1), [x0 / tile, y0 / tile], [x1 / tile, y0 / tile], [x1 / tile, y1 / tile], [x0 / tile, y1 / tile], c);
    // -z
    this.quad(v3(x1, y0, z0), v3(x0, y0, z0), v3(x0, y1, z0), v3(x1, y1, z0), v3(0, 0, -1), [x1 / tile, y0 / tile], [x0 / tile, y0 / tile], [x0 / tile, y1 / tile], [x1 / tile, y1 / tile], c);
    // top
    this.quad(v3(x0, y1, z0), v3(x0, y1, z1), v3(x1, y1, z1), v3(x1, y1, z0), UP, [x0 / tile, z0 / tile], [x0 / tile, z1 / tile], [x1 / tile, z1 / tile], [x1 / tile, z0 / tile], c);
    if (!skipBottom) this.quad(v3(x0, y0, z1), v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y0, z1), v3(0, -1, 0), [0, 0], [0, 1], [1, 1], [1, 0], c);
  }

  /** Append another geometry transformed by matrix m (expects position/normal/uv, indexed or not). */
  merge(g: THREE.BufferGeometry, m: THREE.Matrix4, c?: THREE.Color): void {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uvA = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const colA = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.vertexCount;
    const tv = new THREE.Vector3();
    const tn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      tv.fromBufferAttribute(p, i).applyMatrix4(m);
      if (n) tn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      else tn.set(0, 1, 0);
      this.pos.push(tv.x, tv.y, tv.z);
      this.nor.push(tn.x, tn.y, tn.z);
      this.uv.push(uvA ? uvA.getX(i) : 0, uvA ? uvA.getY(i) : 0);
      if (colA) {
        this.hasColor = true;
        const cr = colA.getX(i) * (c ? c.r : 1);
        const cg = colA.getY(i) * (c ? c.g : 1);
        const cb = colA.getZ(i) * (c ? c.b : 1);
        this.col.push(cr, cg, cb);
      } else if (c) {
        this.hasColor = true;
        this.col.push(c.r, c.g, c.b);
      } else this.col.push(1, 1, 1);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.hasColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    for (const [name, a] of this.extra) g.setAttribute(name, new THREE.Float32BufferAttribute(a.data, a.size));
    if (this.vertexCount > 65535) g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    else g.setIndex(new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  isEmpty(): boolean {
    return this.idx.length === 0;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpVs: THREE.Vector3[] = [];
let tmpI = 0;
function v3(x: number, y: number, z: number): THREE.Vector3 {
  // small ring buffer of vectors to avoid allocations during building
  if (tmpVs.length < 64) for (let i = tmpVs.length; i < 64; i++) tmpVs.push(new THREE.Vector3());
  const v = tmpVs[tmpI] as THREE.Vector3;
  tmpI = (tmpI + 1) % 64;
  return v.set(x, y, z);
}
export { v3 };

/** Buckets geometry by world chunk and material key. */
export class ChunkedBuilder {
  private buckets = new Map<string, MeshBuilder>();
  constructor(readonly chunkSize: number) {}

  get(x: number, z: number, matKey: string): MeshBuilder {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    const k = cx + ',' + cz + ',' + matKey;
    let b = this.buckets.get(k);
    if (!b) {
      b = new MeshBuilder();
      this.buckets.set(k, b);
    }
    return b;
  }

  build(materials: Record<string, THREE.Material>, opts: { castShadow: boolean; receiveShadow: boolean }, group: THREE.Group): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [k, b] of this.buckets) {
      if (b.isEmpty()) continue;
      const matKey = k.split(',')[2] as string;
      const mat = materials[matKey];
      if (!mat) continue;
      const mesh = new THREE.Mesh(b.toGeometry(), mat);
      mesh.castShadow = opts.castShadow;
      mesh.receiveShadow = opts.receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}
