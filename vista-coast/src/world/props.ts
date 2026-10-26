// Street furniture and props: streetlights (breakable, night light pools),
// traffic signals with live lamps, benches, hydrants, bus stops, beach items,
// port containers and cranes, tanks, fountains, gas station canopies.

import * as THREE from 'three';
import { MeshBuilder } from '../render/geom';
import { U } from '../render/shaderlib';
import type { TextureLib } from '../render/textures';
import type { RoadGraph, SignalColor } from '../sim/roadGraph';
import { CHUNK } from './terrainMesh';
import type { Prop, SignalHead, StreetLight } from './worldgen';

function colored(geo: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const cc = new THREE.Color(c);
  for (let i = 0; i < n; i++) {
    col[i * 3] = cc.r;
    col[i * 3 + 1] = cc.g;
    col[i * 3 + 2] = cc.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function mergeParts(parts: { geo: THREE.BufferGeometry; m: THREE.Matrix4; c: number }[]): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  for (const p of parts) mb.merge(colored(p.geo, p.c), p.m);
  return mb.toGeometry();
}

const T = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, y, z);
const TR = (x: number, y: number, z: number, rx: number, ry: number, rz: number): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

// ------------------------------------------------------------------ models
function streetlightPole(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(0.11, 0.16, 8.5, 8), m: T(0, 4.25, 0), c: 0x5b5f63 },
    { geo: new THREE.CylinderGeometry(0.28, 0.3, 0.6, 8), m: T(0, 0.3, 0), c: 0x4a4d50 },
    { geo: new THREE.CylinderGeometry(0.06, 0.07, 2.4, 6), m: TR(0, 8.3, 1.1, Math.PI / 2 - 0.15, 0, 0), c: 0x5b5f63 },
    { geo: new THREE.BoxGeometry(0.45, 0.16, 0.9), m: T(0, 8.45, 2.25), c: 0x3d4044 },
  ]);
}
function streetlightLamp(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.34, 0.05, 0.72).translate(0, 8.35, 2.25);
}
function signalPole(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(0.12, 0.14, 6.2, 8), m: T(0, 3.1, 0), c: 0x3b3e42 },
    { geo: new THREE.CylinderGeometry(0.07, 0.07, 4.6, 6), m: TR(0, 5.9, 2.2, Math.PI / 2, 0, 0), c: 0x3b3e42 },
    { geo: new THREE.BoxGeometry(0.42, 1.25, 0.32), m: T(0, 5.3, 3.6), c: 0x24272a },
    { geo: new THREE.BoxGeometry(0.34, 0.9, 0.25), m: T(0, 2.8, 0.2), c: 0x24272a },
  ]);
}

function bench(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.BoxGeometry(1.8, 0.06, 0.45), m: T(0, 0.45, 0), c: 0x7a5a3a },
    { geo: new THREE.BoxGeometry(1.8, 0.45, 0.05), m: TR(0, 0.72, -0.22, -0.15, 0, 0), c: 0x7a5a3a },
    { geo: new THREE.BoxGeometry(0.06, 0.45, 0.45), m: T(-0.8, 0.22, 0), c: 0x333333 },
    { geo: new THREE.BoxGeometry(0.06, 0.45, 0.45), m: T(0.8, 0.22, 0), c: 0x333333 },
  ]);
}
function bin(): THREE.BufferGeometry {
  return mergeParts([{ geo: new THREE.CylinderGeometry(0.3, 0.27, 0.95, 10), m: T(0, 0.47, 0), c: 0x2f4f3f }, { geo: new THREE.CylinderGeometry(0.32, 0.32, 0.06, 10), m: T(0, 0.97, 0), c: 0x223a2f }]);
}
function hydrant(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(0.15, 0.17, 0.7, 10), m: T(0, 0.35, 0), c: 0xd8b23a },
    { geo: new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m: T(0, 0.7, 0), c: 0xd8b23a },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8), m: TR(0, 0.48, 0, 0, 0, Math.PI / 2), c: 0xc9a22f },
  ]);
}
function busstop(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.BoxGeometry(3.6, 0.08, 1.5), m: T(0, 2.5, 0), c: 0x2a3440 },
    { geo: new THREE.BoxGeometry(0.08, 2.5, 1.5), m: T(-1.76, 1.25, 0), c: 0x6a8796 },
    { geo: new THREE.BoxGeometry(3.6, 2.2, 0.06), m: T(0, 1.3, -0.7), c: 0x8fb3c4 },
    { geo: new THREE.BoxGeometry(2.6, 0.06, 0.4), m: T(0, 0.48, -0.45), c: 0x555555 },
  ]);
}
function umbrella(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6), m: T(0, 1.15, 0), c: 0xdddddd },
    { geo: new THREE.ConeGeometry(1.25, 0.55, 12, 1, true), m: T(0, 2.25, 0), c: 0xffffff },
  ]);
}
function towel(): THREE.BufferGeometry {
  return mergeParts([{ geo: new THREE.BoxGeometry(0.9, 0.02, 1.8), m: T(0, 0.02, 0), c: 0xffffff }]);
}
function lifeguard(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; m: THREE.Matrix4; c: number }[] = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) parts.push({ geo: new THREE.BoxGeometry(0.16, 2.2, 0.16), m: T(x * 1.1, 1.1, z * 1.1), c: 0xe9e2d0 });
  parts.push({ geo: new THREE.BoxGeometry(2.8, 0.15, 2.8), m: T(0, 2.25, 0), c: 0xe0d8c8 });
  parts.push({ geo: new THREE.BoxGeometry(2.4, 1.6, 2.2), m: T(0, 3.1, 0.1), c: 0x7ec8e3 });
  parts.push({ geo: new THREE.BoxGeometry(2.8, 0.12, 2.8), m: TR(0, 4.05, 0, 0.12, 0, 0), c: 0xf2f2f2 });
  parts.push({ geo: new THREE.BoxGeometry(0.9, 0.08, 2.4), m: TR(0, 1.2, 2.4, 0.85, 0, 0), c: 0xe9e2d0 });
  parts.push({ geo: new THREE.BoxGeometry(1.2, 0.5, 0.05), m: T(0, 3.3, 1.22), c: 0xd03a2a });
  return mergeParts(parts);
}
function rock(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = 0.75 + 0.35 * Math.sin(x * 4.1 + z * 2.3) * Math.cos(y * 3.7);
    p.setXYZ(i, x * n * 1.2, y * n * 0.7 + 0.2, z * n);
  }
  g.computeVertexNormals();
  return mergeParts([{ geo: g, m: new THREE.Matrix4(), c: 0x8a8173 }]);
}
function container(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.BoxGeometry(2.44, 2.59, 12.19), m: T(0, 1.3, 0), c: 0xffffff },
    { geo: new THREE.BoxGeometry(2.5, 2.65, 0.1), m: T(0, 1.3, 6.08), c: 0xdddddd },
  ]);
}
function crane(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; m: THREE.Matrix4; c: number }[] = [];
  for (const [x, z] of [[-9, -6], [9, -6], [-9, 6], [9, 6]] as const) parts.push({ geo: new THREE.BoxGeometry(1.4, 36, 1.4), m: T(x, 18, z), c: 0xffffff });
  parts.push({ geo: new THREE.BoxGeometry(20, 3, 15), m: T(0, 37, 0), c: 0xffffff });
  parts.push({ geo: new THREE.BoxGeometry(3, 3, 80), m: T(0, 40, 22), c: 0xffffff });
  parts.push({ geo: new THREE.BoxGeometry(5, 5, 6), m: T(0, 36, 2), c: 0xdddddd });
  parts.push({ geo: new THREE.BoxGeometry(1, 22, 1), m: TR(0, 50, 0, 0, 0, 0), c: 0xffffff });
  for (let k = 0; k < 6; k++) parts.push({ geo: new THREE.BoxGeometry(18.5, 0.6, 0.6), m: TR(0, 6 + k * 5, -6, 0, 0, k % 2 ? 0.45 : -0.45), c: 0xffffff });
  return mergeParts(parts);
}
function tank(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(6, 6, 12, 24), m: T(0, 6, 0), c: 0xd7d9d6 },
    { geo: new THREE.SphereGeometry(6, 24, 8, 0, Math.PI * 2, 0, Math.PI / 6), m: T(0, 6.8, 0), c: 0xc9cbc8 },
  ]);
}
function chimney(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(1.4, 2.2, 38, 14), m: T(0, 19, 0), c: 0x9c6b55 },
    { geo: new THREE.CylinderGeometry(1.5, 1.5, 1.5, 14), m: T(0, 36, 0), c: 0xd8d8d8 },
    { geo: new THREE.CylinderGeometry(1.5, 1.5, 1.5, 14), m: T(0, 31, 0), c: 0xc03a2a },
  ]);
}
function fountain(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(4, 4.2, 0.7, 24), m: T(0, 0.35, 0), c: 0xd9d4c8 },
    { geo: new THREE.CylinderGeometry(3.6, 3.6, 0.1, 24), m: T(0, 0.62, 0), c: 0x3f7f9a },
    { geo: new THREE.CylinderGeometry(0.4, 0.6, 1.8, 12), m: T(0, 1.2, 0), c: 0xd9d4c8 },
    { geo: new THREE.CylinderGeometry(1.4, 0.5, 0.35, 16), m: T(0, 2.1, 0), c: 0xd9d4c8 },
  ]);
}
function canopy(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; m: THREE.Matrix4; c: number }[] = [];
  parts.push({ geo: new THREE.BoxGeometry(26, 1.0, 14), m: T(0, 5.4, 0), c: 0xf2f2f2 });
  parts.push({ geo: new THREE.BoxGeometry(26.2, 0.35, 14.2), m: T(0, 4.95, 0), c: 0xc8102e });
  for (const x of [-9, 9]) for (const z of [-4, 4]) parts.push({ geo: new THREE.BoxGeometry(0.5, 5, 0.5), m: T(x, 2.5, z), c: 0xdddddd });
  return mergeParts(parts);
}
function pump(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.BoxGeometry(1.0, 0.25, 2.2), m: T(0, 0.12, 0), c: 0xbbbbbb },
    { geo: new THREE.BoxGeometry(0.7, 1.7, 0.5), m: T(0, 1.05, 0), c: 0xe03a2f },
    { geo: new THREE.BoxGeometry(0.72, 0.35, 0.52), m: T(0, 1.75, 0), c: 0xf2f2f2 },
  ]);
}
function barrier(): THREE.BufferGeometry {
  return mergeParts([{ geo: new THREE.BoxGeometry(30, 1.5, 0.08), m: T(0, 0.75, 0), c: 0xc9c9c9 }]);
}
function planter(): THREE.BufferGeometry {
  return mergeParts([{ geo: new THREE.BoxGeometry(1.4, 0.6, 1.4), m: T(0, 0.3, 0), c: 0x9a8f80 }]);
}
function cone(): THREE.BufferGeometry {
  return mergeParts([{ geo: new THREE.ConeGeometry(0.2, 0.7, 10), m: T(0, 0.35, 0), c: 0xff6a00 }]);
}

const PROP_MODELS: Record<Prop['kind'], () => THREE.BufferGeometry> = {
  canopy,
  bench,
  bin,
  hydrant,
  busstop,
  umbrella,
  lifeguard,
  towel,
  rock,
  container,
  crane,
  tank,
  barrier,
  cone,
  pump,
  chimney,
  fountain,
  planter,
};

export interface LightInstanceRef {
  chunk: string;
  index: number;
}

interface LightChunk {
  pole: THREE.InstancedMesh;
  lamp: THREE.InstancedMesh;
  pool: THREE.InstancedMesh;
  center: THREE.Vector3;
  lights: StreetLight[];
}

export class PropsSystem {
  readonly group = new THREE.Group();
  private lightChunks = new Map<string, LightChunk>();
  private lightRefs: LightInstanceRef[] = [];
  private lampMat: THREE.MeshStandardMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  readonly broken = new Set<number>();
  private signalLamps: THREE.InstancedMesh | null = null;
  private signalHeads: readonly SignalHead[] = [];
  private signalTimer = 0;
  private propMeshes: { mesh: THREE.InstancedMesh; center: THREE.Vector3 }[] = [];
  private fallen = new Map<number, { t: number; yaw: number }>();
  readonly lightPositions: StreetLight[];

  constructor(lights: readonly StreetLight[], signals: readonly SignalHead[], props: readonly Prop[], tex: TextureLib) {
    this.lightPositions = lights.slice();
    const poleGeo = streetlightPole();
    const lampGeo = streetlightLamp();
    const poleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.6 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: new THREE.Color(1.0, 0.82, 0.55), emissiveIntensity: 0, roughness: 0.3 });
    this.poolMat = new THREE.MeshBasicMaterial({ map: tex.lightPool, color: new THREE.Color(1.0, 0.72, 0.42), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, fog: true });
    const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // bucket lights by chunk
    const buckets = new Map<string, number[]>();
    lights.forEach((l, i) => {
      const k = Math.floor(l.x / CHUNK) + ',' + Math.floor(l.z / CHUNK);
      const arr = buckets.get(k);
      if (arr) arr.push(i);
      else buckets.set(k, [i]);
    });
    const m = new THREE.Matrix4();
    for (const [k, ids] of buckets) {
      const pole = new THREE.InstancedMesh(poleGeo, poleMat, ids.length);
      const lamp = new THREE.InstancedMesh(lampGeo, this.lampMat, ids.length);
      const pool = new THREE.InstancedMesh(poolGeo, this.poolMat, ids.length);
      const center = new THREE.Vector3();
      const ls: StreetLight[] = [];
      ids.forEach((li, j) => {
        const l = lights[li] as StreetLight;
        ls.push(l);
        this.lightRefs[li] = { chunk: k, index: j };
        m.compose(new THREE.Vector3(l.x, l.y, l.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.yaw), new THREE.Vector3(1, 1, 1));
        pole.setMatrixAt(j, m);
        lamp.setMatrixAt(j, m);
        const px = l.x + Math.sin(l.yaw) * 2.6;
        const pz = l.z + Math.cos(l.yaw) * 2.6;
        pool.setMatrixAt(j, new THREE.Matrix4().compose(new THREE.Vector3(px, l.y + 0.1, pz), new THREE.Quaternion(), new THREE.Vector3(15, 1, 15)));
        center.x += l.x;
        center.z += l.z;
        center.y += l.y;
      });
      center.divideScalar(ids.length);
      for (const im of [pole, lamp, pool]) {
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        this.group.add(im);
      }
      pole.castShadow = true;
      pole.receiveShadow = true;
      pool.renderOrder = 2;
      this.lightChunks.set(k, { pole, lamp, pool, center, lights: ls });
    }
    // traffic signals
    this.signalHeads = signals;
    if (signals.length > 0) {
      const sp = new THREE.InstancedMesh(signalPole(), poleMat, signals.length);
      const lampG = new THREE.IcosahedronGeometry(0.13, 0); // 20 tris: 2,200+ lamps share one instanced draw
      const lampM = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.signalLamps = new THREE.InstancedMesh(lampG, lampM, signals.length * 3);
      signals.forEach((s, i) => {
        // s.yaw faces approaching traffic; the arm reaches left of travel, over the lanes
        const armYaw = s.yaw - Math.PI / 2;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), armYaw);
        m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(1, 1, 1));
        sp.setMatrixAt(i, m);
        const ax = Math.sin(armYaw);
        const az = Math.cos(armYaw);
        const fx = Math.sin(s.yaw);
        const fz = Math.cos(s.yaw);
        for (let k = 0; k < 3; k++) {
          const lx = s.x + ax * 3.6 + fx * 0.18;
          const lz = s.z + az * 3.6 + fz * 0.18;
          const ly = s.y + 5.72 - k * 0.4;
          (this.signalLamps as THREE.InstancedMesh).setMatrixAt(i * 3 + k, new THREE.Matrix4().makeTranslation(lx, ly, lz));
          (this.signalLamps as THREE.InstancedMesh).setColorAt(i * 3 + k, new THREE.Color(0.05, 0.05, 0.05));
        }
      });
      sp.instanceMatrix.needsUpdate = true;
      sp.computeBoundingSphere();
      sp.castShadow = true;
      this.signalLamps.instanceMatrix.needsUpdate = true;
      this.signalLamps.computeBoundingSphere();
      this.group.add(sp, this.signalLamps);
    }
    // other props instanced per kind per chunk
    const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
    const containerMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.corrugated.map, normalMap: tex.corrugated.normalMap, roughness: 0.6, metalness: 0.3 });
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.rock.map, normalMap: tex.rock.normalMap, roughness: 0.9 });
    const geoCache = new Map<string, THREE.BufferGeometry>();
    const pb = new Map<string, Prop[]>();
    for (const p of props) {
      const k = p.kind + '|' + Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK);
      const arr = pb.get(k);
      if (arr) arr.push(p);
      else pb.set(k, [p]);
    }
    for (const [k, list] of pb) {
      const kind = k.split('|')[0] as Prop['kind'];
      let geo = geoCache.get(kind);
      if (!geo) {
        geo = PROP_MODELS[kind]();
        geoCache.set(kind, geo);
      }
      const mat = kind === 'container' ? containerMat : kind === 'rock' ? rockMat : propMat;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const center = new THREE.Vector3();
      list.forEach((p, i) => {
        const y = kind === 'container' ? p.y + p.s * 2.6 : p.y;
        const scale = kind === 'container' ? 1 : kind === 'rock' ? p.s : p.s;
        m.compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(scale, kind === 'rock' ? scale * 0.8 : scale, scale));
        im.setMatrixAt(i, m);
        im.setColorAt(i, new THREE.Color(p.color));
        center.add(new THREE.Vector3(p.x, p.y, p.z));
      });
      center.divideScalar(list.length);
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = kind !== 'towel';
      im.receiveShadow = true;
      this.group.add(im);
      this.propMeshes.push({ mesh: im, center });
    }
  }

  /** Knock over a streetlight (index into the world light list). */
  breakLight(index: number, impactYaw: number): void {
    if (this.broken.has(index)) return;
    this.broken.add(index);
    this.fallen.set(index, { t: 0, yaw: impactYaw });
  }

  private applyFallen(dt: number): void {
    for (const [i, f] of this.fallen) {
      f.t = Math.min(1, f.t + dt * 1.6);
      const ref = this.lightRefs[i];
      const l = this.lightPositions[i];
      if (!ref || !l) continue;
      const ch = this.lightChunks.get(ref.chunk);
      if (!ch) continue;
      const tilt = (Math.PI / 2 - 0.12) * f.t * f.t;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw)), tilt);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.yaw));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, l.z), q, new THREE.Vector3(1, 1, 1));
      ch.pole.setMatrixAt(ref.index, m);
      ch.lamp.setMatrixAt(ref.index, m);
      ch.pole.instanceMatrix.needsUpdate = true;
      ch.lamp.instanceMatrix.needsUpdate = true;
      // hide the light pool
      ch.pool.setMatrixAt(ref.index, new THREE.Matrix4().makeScale(0, 0, 0));
      ch.pool.instanceMatrix.needsUpdate = true;
      if (f.t >= 1) this.fallen.delete(i);
    }
  }

  update(dt: number, cam: THREE.Vector3, graph: RoadGraph, time: number, viewDist: number): void {
    const night = U.uNight.value;
    this.lampMat.emissiveIntensity = night * 6;
    this.poolMat.opacity = night * 0.55 * (1 - U.uRain.value * 0.2) + U.uWet.value * night * 0.25;
    for (const ch of this.lightChunks.values()) {
      const d = Math.hypot(ch.center.x - cam.x, ch.center.z - cam.z);
      const vis = d < viewDist * 0.75;
      ch.pole.visible = vis;
      ch.lamp.visible = vis;
      ch.pool.visible = vis && night > 0.02 && d < 700;
    }
    for (const pm of this.propMeshes) {
      const d = Math.hypot(pm.center.x - cam.x, pm.center.z - cam.z);
      pm.mesh.visible = d < viewDist * 0.7;
    }
    this.applyFallen(dt);
    // signals: update lamp colours near the camera a few times per second
    this.signalTimer -= dt;
    if (this.signalTimer <= 0 && this.signalLamps) {
      this.signalTimer = 0.2;
      const c = new THREE.Color();
      for (let i = 0; i < this.signalHeads.length; i++) {
        const s = this.signalHeads[i] as SignalHead;
        if (Math.abs(s.x - cam.x) > 450 || Math.abs(s.z - cam.z) > 450) continue;
        const col: SignalColor = graph.signal(s.node, s.axis, time);
        const on = [col === 'R', col === 'Y', col === 'G'];
        const hues: [number, number, number][] = [
          [6, 0.25, 0.15],
          [5, 3.2, 0.2],
          [0.2, 4.5, 2.2],
        ];
        for (let k = 0; k < 3; k++) {
          const h = hues[k] as [number, number, number];
          if (on[k]) c.setRGB(h[0], h[1], h[2]);
          else c.setRGB(h[0] * 0.012, h[1] * 0.012, h[2] * 0.012);
          this.signalLamps.setColorAt(i * 3 + k, c);
        }
      }
      if (this.signalLamps.instanceColor) this.signalLamps.instanceColor.needsUpdate = true;
    }
  }

  /** Nearest unbroken streetlights to a point (for real-time point lights at night). */
  nearestLights(x: number, z: number, n: number, out: StreetLight[]): void {
    out.length = 0;
    const cand: { l: StreetLight; d: number }[] = [];
    for (const ch of this.lightChunks.values()) {
      if (Math.abs(ch.center.x - x) > CHUNK * 1.2 || Math.abs(ch.center.z - z) > CHUNK * 1.2) continue;
      for (const l of ch.lights) {
        const d = (l.x - x) * (l.x - x) + (l.z - z) * (l.z - z);
        if (d < 120 * 120) cand.push({ l, d });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(n, cand.length); i++) {
      const c = cand[i];
      if (!c) continue;
      const idx = this.lightPositions.indexOf(c.l);
      if (this.broken.has(idx)) continue;
      out.push(c.l);
    }
  }
}
