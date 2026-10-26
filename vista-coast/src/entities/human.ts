// Procedural skinned human: one draw call per person, rigid-skinned body parts,
// varied body shape / skin / hair / clothes, and a procedural animation system
// (idle, walk, run, jump, sit, drive, talk, phone, knocked down, swim, dance...).

import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import { Rng } from '../core/rng';

export const BONE = {
  root: 0,
  hips: 1,
  spine: 2,
  chest: 3,
  neck: 4,
  head: 5,
  hair: 6,
  lids: 7,
  armL: 8,
  foreL: 9,
  handL: 10,
  armR: 11,
  foreR: 12,
  handR: 13,
  thighL: 14,
  shinL: 15,
  footL: 16,
  thighR: 17,
  shinR: 18,
  footR: 19,
  jaw: 20,
} as const;
const BONE_COUNT = 21;

// parent index and offset from parent in bind pose (metres)
const RIG: [number, number, number, number][] = [
  [-1, 0, 0, 0], // root
  [0, 0, 0.98, 0], // hips
  [1, 0, 0.11, 0], // spine
  [2, 0, 0.2, 0], // chest
  [3, 0, 0.24, 0], // neck
  [4, 0, 0.09, 0.01], // head (neck top)
  [5, 0, 0.12, 0], // hair
  [5, 0, 0.122, 0.0], // lids (eye height)
  [3, 0.19, 0.19, 0], // armL (shoulder)
  [8, 0, -0.29, 0], // foreL
  [9, 0, -0.26, 0], // handL
  [3, -0.19, 0.19, 0], // armR
  [11, 0, -0.29, 0], // foreR
  [12, 0, -0.26, 0], // handR
  [1, 0.095, -0.06, 0], // thighL
  [14, 0, -0.44, 0], // shinL
  [15, 0, -0.43, 0], // footL
  [1, -0.095, -0.06, 0], // thighR
  [17, 0, -0.44, 0], // shinR
  [18, 0, -0.43, 0], // footR
  [5, 0, 0.0, 0.06], // jaw
];

export interface HumanLook {
  female: boolean;
  height: number; // scale ~0.92..1.08
  build: number; // 0.85..1.2 width
  skin: number;
  hair: number;
  hairStyle: 0 | 1 | 2 | 3 | 4; // short, long, bun, bald, curly
  shirt: number;
  pants: number;
  shoes: number;
  jacket: boolean;
  hat: boolean;
  shorts: boolean;
  skirt: boolean;
  beard: boolean;
  uniform: 'none' | 'police' | 'medic';
}

const SKINS = [0xf1d2bd, 0xe8bfa0, 0xd9a37f, 0xc68863, 0xa86b48, 0x8a5536, 0x6b3f27, 0xf5dcc8, 0xe0b18f];
const HAIRS = [0x1b1612, 0x2e221a, 0x4a3324, 0x6b4a2e, 0x9a7148, 0xc9a26b, 0x3b3b3b, 0xb8b8b8, 0x5c2f1d];
const SHIRTS = [0xe9e6df, 0x2a3446, 0x7a1f22, 0x2f6b4a, 0xd9a21b, 0x3f88c5, 0x111111, 0xc75b39, 0x8a7aa8, 0xf2b6c6, 0x4d5a64, 0x96c3d6, 0xe25a5a];
const PANTS = [0x2a3446, 0x1c1c1c, 0x4b4f54, 0x6b5a46, 0x3a4a63, 0x8c8577, 0xd0c4a8, 0x283a2e];
const SHOES = [0x1a1a1a, 0xf2f2f2, 0x6b4a2f, 0x2e3a4a, 0xc92a2a];

export function randomLook(seed: number): HumanLook {
  const r = new Rng(seed * 7919 + 13);
  const female = r.chance(0.5);
  return {
    female,
    height: r.range(0.93, 1.07) * (female ? 0.95 : 1),
    build: r.range(0.88, 1.18),
    skin: r.pick(SKINS),
    hair: r.pick(HAIRS),
    hairStyle: female ? r.pick([1, 2, 1, 4, 0] as const) : r.pick([0, 0, 3, 4, 0] as const),
    shirt: r.pick(SHIRTS),
    pants: r.pick(PANTS),
    shoes: r.pick(SHOES),
    jacket: r.chance(0.25),
    hat: r.chance(0.12),
    shorts: r.chance(0.25),
    skirt: female && r.chance(0.3),
    beard: !female && r.chance(0.25),
    uniform: 'none',
  };
}

class PartBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  private bindWorld: THREE.Vector3[] = [];

  constructor(bindWorld: THREE.Vector3[]) {
    this.bindWorld = bindWorld;
  }

  /** Add geometry positioned relative to a bone's bind-pose world position. */
  add(geo: THREE.BufferGeometry, bone: number, local: THREE.Matrix4, color: number): void {
    const g = geo.index ? geo : geo;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const origin = this.bindWorld[bone] as THREE.Vector3;
    const m = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).multiply(local);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const c = new THREE.Color(color);
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    const vn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      vn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(vn.x, vn.y, vn.z);
      this.col.push(c.r, c.g, c.b);
      this.si.push(bone, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 0.6;
    return g;
  }
}

function bindPositions(scaleY: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const [parent, x, y, z] = RIG[i] as [number, number, number, number];
    const v = new THREE.Vector3(x, y * scaleY, z);
    if (parent >= 0) v.add(out[parent] as THREE.Vector3);
    out.push(v);
  }
  return out;
}

const M = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

const geoCache = new Map<string, THREE.BufferGeometry>();
function cg(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Build the merged, skinned body geometry for a look. */
export function buildHumanGeometry(look: HumanLook): THREE.BufferGeometry {
  const sy = look.height;
  const bw = look.build;
  const bp = bindPositions(sy);
  const pb = new PartBuilder(bp);
  const sph = cg('sph', () => new THREE.SphereGeometry(1, 14, 10));
  const sphLo = cg('sphlo', () => new THREE.SphereGeometry(1, 8, 6));
  const cyl = cg('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 10, 1));
  const cap = cg('cap', () => new THREE.CapsuleGeometry(1, 1, 4, 10));
  const box = cg('box', () => new THREE.BoxGeometry(1, 1, 1));
  const skin = look.skin;
  const shirt = look.uniform === 'police' ? 0x1d2b44 : look.uniform === 'medic' ? 0xf2f2f2 : look.shirt;
  const pants = look.uniform === 'police' ? 0x1d2b44 : look.uniform === 'medic' ? 0x2f5f8f : look.pants;
  const f = look.female;
  const torsoW = (f ? 0.15 : 0.17) * bw;
  const torsoD = (f ? 0.1 : 0.11) * bw;
  const jacket = look.jacket || look.uniform === 'police';
  const thick = jacket ? 1.12 : 1;

  // head
  pb.add(sph, BONE.head, M(0, 0.1, 0, 0.092, 0.115, 0.104), skin);
  pb.add(sphLo, BONE.jaw, M(0, 0.03, 0.025, 0.07, 0.06, 0.07), skin);
  pb.add(box, BONE.head, M(0, 0.085, 0.104, 0.022, 0.045, 0.03, 0.25), skin); // nose
  pb.add(sphLo, BONE.head, M(0.091, 0.095, 0.0, 0.016, 0.028, 0.012), skin); // ears
  pb.add(sphLo, BONE.head, M(-0.091, 0.095, 0.0, 0.016, 0.028, 0.012), skin);
  for (const sx of [1, -1]) {
    pb.add(sphLo, BONE.head, M(sx * 0.035, 0.122, 0.088, 0.017, 0.012, 0.01), 0xf4f1ea); // eye white
    pb.add(sphLo, BONE.head, M(sx * 0.035, 0.122, 0.096, 0.008, 0.008, 0.005), 0x2b2118); // iris
    pb.add(box, BONE.head, M(sx * 0.036, 0.142, 0.094, 0.03, 0.006, 0.01), look.hair); // brow
    pb.add(box, BONE.lids, M(sx * 0.035, 0.122 * (1 - sy), 0.0995, 0.036, 0.026, 0.008), skin); // eyelid (scaled by bone)
  }
  pb.add(box, BONE.jaw, M(0, 0.032, 0.094, 0.034, 0.006, 0.008), 0x8a4a42); // lips
  if (look.beard) pb.add(sphLo, BONE.jaw, M(0, 0.02, 0.05, 0.075, 0.05, 0.065), look.hair);
  // hair
  const hc = look.hair;
  if (look.hairStyle !== 3) {
    pb.add(sph, BONE.hair, M(0, 0.0, -0.01, 0.1, 0.075, 0.11), hc);
    pb.add(sph, BONE.hair, M(0, -0.03, -0.035, 0.098, 0.08, 0.09), hc);
    if (look.hairStyle === 1) pb.add(cap, BONE.hair, M(0, -0.14, -0.06, 0.085, 0.07, 0.055), hc);
    if (look.hairStyle === 2) pb.add(sph, BONE.hair, M(0, 0.02, -0.11, 0.05, 0.05, 0.05), hc);
    if (look.hairStyle === 4) for (let k = 0; k < 7; k++) pb.add(sphLo, BONE.hair, M(Math.cos(k) * 0.07, 0.01 + Math.sin(k * 2) * 0.02, Math.sin(k) * 0.07 - 0.02, 0.05, 0.05, 0.05), hc);
  }
  if (look.hat || look.uniform === 'police') {
    const hatC = look.uniform === 'police' ? 0x1d2b44 : look.shirt;
    pb.add(cyl, BONE.hair, M(0, 0.03, -0.005, 0.105, 0.06, 0.115), hatC);
    pb.add(box, BONE.hair, M(0, 0.0, 0.11, 0.17, 0.01, 0.08), hatC);
  }
  // neck
  pb.add(cyl, BONE.neck, M(0, 0.05, 0, 0.045, 0.12, 0.045), skin);
  // torso (chest + abdomen)
  pb.add(cap, BONE.chest, M(0, 0.1, 0, torsoW * thick, 0.11, torsoD * thick), shirt);
  pb.add(cap, BONE.spine, M(0, 0.07, 0, torsoW * 0.92 * thick, 0.08, torsoD * 0.95 * thick), shirt);
  if (f) pb.add(sph, BONE.chest, M(0, 0.06, torsoD * 0.6, torsoW * 0.75, 0.06, 0.06), shirt);
  // shoulders
  pb.add(sph, BONE.chest, M(0.16 * bw, 0.18, 0, 0.065 * thick, 0.055, 0.06 * thick), shirt);
  pb.add(sph, BONE.chest, M(-0.16 * bw, 0.18, 0, 0.065 * thick, 0.055, 0.06 * thick), shirt);
  // pelvis
  pb.add(cap, BONE.hips, M(0, -0.01, 0, torsoW * 0.95, 0.06, torsoD * 1.02), look.skirt ? shirt : pants);
  if (look.skirt) pb.add(cyl, BONE.hips, M(0, -0.12, 0, 0.17 * bw, 0.22, 0.13), pants);
  if (look.uniform === 'police') pb.add(cyl, BONE.hips, M(0, 0.05, 0, torsoW * 1.0, 0.04, torsoD * 1.06), 0x111111); // belt
  // arms
  const sleeve = jacket ? shirt : shirt;
  for (const [arm, fore, hand] of [[BONE.armL, BONE.foreL, BONE.handL], [BONE.armR, BONE.foreR, BONE.handR]] as const) {
    pb.add(cap, arm, M(0, -0.14, 0, 0.047 * bw * thick, 0.16, 0.047 * bw * thick), sleeve);
    const longSleeve = jacket || look.uniform !== 'none';
    pb.add(cap, fore, M(0, -0.12, 0, 0.04 * bw * (longSleeve ? thick : 1), 0.14, 0.04 * bw), longSleeve ? sleeve : skin);
    pb.add(box, hand, M(0, -0.05, 0.005, 0.05, 0.09, 0.025), skin);
    pb.add(box, hand, M(0, -0.06, 0.025, 0.015, 0.05, 0.02, 0.6), skin); // thumb
  }
  // legs
  for (const [thigh, shin, foot] of [[BONE.thighL, BONE.shinL, BONE.footL], [BONE.thighR, BONE.shinR, BONE.footR]] as const) {
    const legC = look.skirt ? skin : pants;
    pb.add(cap, thigh, M(0, -0.22, 0, 0.07 * bw, 0.25, 0.072 * bw), look.skirt ? skin : pants);
    pb.add(cap, shin, M(0, -0.21, -0.005, 0.052 * bw, 0.27, 0.055 * bw), look.shorts || look.skirt ? skin : legC);
    if (look.shorts && !look.skirt) pb.add(cap, thigh, M(0, -0.12, 0, 0.076 * bw, 0.14, 0.078 * bw), pants);
    pb.add(box, foot, M(0, -0.025, 0.05, 0.09, 0.07, 0.24), look.shoes);
    pb.add(box, foot, M(0, -0.055, 0.05, 0.095, 0.015, 0.25), 0xe8e8e8); // sole
  }
  // police badge / medic cross
  if (look.uniform === 'police') pb.add(box, BONE.chest, M(0.07, 0.15, torsoD + 0.005, 0.03, 0.035, 0.01), 0xd8b23a);
  if (look.uniform === 'medic') pb.add(box, BONE.chest, M(0, 0.12, torsoD + 0.005, 0.06, 0.06, 0.01), 0xc8102e);
  return pb.geometry();
}

export interface HumanRig {
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  blinkT: number;
}

export function createHuman(geo: THREE.BufferGeometry, mat: THREE.Material, height = 1): HumanRig {
  const bp = bindPositions(height);
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const b = new THREE.Bone();
    const [parent] = RIG[i] as [number, number, number, number];
    const wp = bp[i] as THREE.Vector3;
    const pp = parent >= 0 ? (bp[parent] as THREE.Vector3) : new THREE.Vector3();
    b.position.copy(wp).sub(pp);
    if (parent >= 0) (bones[parent] as THREE.Bone).add(b);
    bones.push(b);
  }
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(bones[0] as THREE.Bone);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  return { mesh, bones, blinkT: Math.random() * 3 };
}

export type PoseMode =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'jump'
  | 'fall'
  | 'sit'
  | 'drive'
  | 'ride'
  | 'talk'
  | 'phone'
  | 'down'
  | 'getup'
  | 'punch'
  | 'swim'
  | 'dance'
  | 'lie'
  | 'cower'
  | 'wave';

export interface PoseState {
  mode: PoseMode;
  phase: number; // locomotion cycle phase (radians)
  speed: number; // m/s
  t: number; // time in this mode
  time: number; // global time
  lean: number; // turning lean (-1..1)
  talk: number; // 0..1 mouth/gesture activity
  steer: number; // for driving
  seed: number;
}

/** Apply a procedural pose directly to the bones. */
export function applyPose(rig: HumanRig, p: PoseState, dt: number): void {
  const b = rig.bones;
  const hips = b[BONE.hips] as THREE.Bone;
  const root = b[BONE.root] as THREE.Bone;
  // reset rotations
  for (const bone of b) bone.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);
  hips.position.y = RIG[BONE.hips]?.[2] ?? 0.98;
  const set = (i: number, x: number, y: number, z: number): void => {
    (b[i] as THREE.Bone).rotation.set(x, y, z);
  };
  const breathe = Math.sin(p.time * 1.6 + p.seed) * 0.02;
  // relaxed arms default
  set(BONE.armL, 0.05, 0, 0.12);
  set(BONE.armR, 0.05, 0, -0.12);
  set(BONE.foreL, -0.15, 0, 0);
  set(BONE.foreR, -0.15, 0, 0);
  set(BONE.chest, breathe, 0, 0);
  const s = clamp(p.speed, 0, 9);
  switch (p.mode) {
    case 'idle':
    case 'talk':
    case 'wave': {
      const sway = Math.sin(p.time * 0.7 + p.seed) * 0.03;
      set(BONE.hips, 0, sway, 0);
      set(BONE.thighL, -0.03, 0, 0.03);
      set(BONE.thighR, 0.02, 0, -0.04);
      set(BONE.shinL, 0.06, 0, 0);
      set(BONE.shinR, 0.04, 0, 0);
      set(BONE.head, Math.sin(p.time * 0.5 + p.seed) * 0.05, Math.sin(p.time * 0.31 + p.seed * 2) * 0.25, 0);
      if (p.mode === 'talk') {
        const g = Math.sin(p.time * 3.1 + p.seed) * 0.5 + 0.5;
        set(BONE.armR, -0.3 - g * 0.5, 0, -0.25);
        set(BONE.foreR, -0.9 - g * 0.4, 0, 0);
        set(BONE.armL, -0.1 - (1 - g) * 0.3, 0, 0.2);
        set(BONE.foreL, -0.7, 0, 0);
        set(BONE.jaw, Math.max(0, Math.sin(p.time * 14 + p.seed)) * 0.18 * p.talk, 0, 0);
        set(BONE.head, Math.sin(p.time * 1.7) * 0.06, Math.sin(p.time * 0.9) * 0.2, Math.sin(p.time * 1.3) * 0.05);
      }
      if (p.mode === 'wave') {
        set(BONE.armR, -0.2, 0, -2.6);
        set(BONE.foreR, 0, 0, -0.4 + Math.sin(p.time * 9) * 0.35);
      }
      break;
    }
    case 'walk':
    case 'run':
    case 'sprint': {
      const run = p.mode !== 'walk';
      const amp = run ? lerp(0.6, 0.9, clamp((s - 3) / 4, 0, 1)) : lerp(0.25, 0.48, clamp(s / 1.6, 0, 1));
      const ph = p.phase;
      const sL = Math.sin(ph);
      const sR = Math.sin(ph + Math.PI);
      set(BONE.thighL, -sL * amp, 0, 0.02);
      set(BONE.thighR, -sR * amp, 0, -0.02);
      const knee = run ? 1.4 : 0.7;
      set(BONE.shinL, Math.max(0, Math.sin(ph - 1.2)) * amp * knee + 0.05, 0, 0);
      set(BONE.shinR, Math.max(0, Math.sin(ph + Math.PI - 1.2)) * amp * knee + 0.05, 0, 0);
      set(BONE.footL, sL * amp * 0.3, 0, 0);
      set(BONE.footR, sR * amp * 0.3, 0, 0);
      const armAmp = amp * (run ? 1.1 : 0.8);
      set(BONE.armL, sL * armAmp, 0, 0.1);
      set(BONE.armR, sR * armAmp, 0, -0.1);
      set(BONE.foreL, -(run ? 1.3 : 0.35) - Math.max(0, sL) * 0.3, 0, 0);
      set(BONE.foreR, -(run ? 1.3 : 0.35) - Math.max(0, sR) * 0.3, 0, 0);
      const lean = run ? 0.14 + (p.mode === 'sprint' ? 0.08 : 0) : 0.03;
      set(BONE.spine, lean, Math.sin(ph) * 0.08 * amp, -p.lean * 0.08);
      set(BONE.hips, 0, -Math.sin(ph) * 0.1 * amp, Math.sin(ph * 2) * 0.02);
      set(BONE.head, -lean * 0.6, 0, 0);
      hips.position.y += Math.abs(Math.cos(ph)) * (run ? 0.06 : 0.025) - (run ? 0.05 : 0.01);
      break;
    }
    case 'jump':
    case 'fall': {
      const k = p.mode === 'jump' ? clamp(p.t * 3, 0, 1) : 1;
      set(BONE.thighL, -0.6 * k, 0, 0.05);
      set(BONE.thighR, -0.2 * k, 0, -0.05);
      set(BONE.shinL, 0.9 * k, 0, 0);
      set(BONE.shinR, 0.5 * k, 0, 0);
      set(BONE.armL, -0.6 * k, 0, 0.5);
      set(BONE.armR, -0.6 * k, 0, -0.5);
      if (p.mode === 'fall') {
        set(BONE.armL, -2.4 + Math.sin(p.time * 9) * 0.3, 0, 0.6);
        set(BONE.armR, -2.4 + Math.cos(p.time * 9) * 0.3, 0, -0.6);
      }
      break;
    }
    case 'sit':
    case 'drive':
    case 'ride': {
      set(BONE.thighL, -1.5, 0, 0.08);
      set(BONE.thighR, -1.5, 0, -0.08);
      set(BONE.shinL, 1.45, 0, 0);
      set(BONE.shinR, 1.45, 0, 0);
      hips.position.y -= p.mode === 'sit' ? 0.5 : 0.48;
      if (p.mode === 'drive') {
        const st = p.steer * 0.35;
        set(BONE.armL, -1.05 + st * 0.6, 0, 0.18);
        set(BONE.armR, -1.05 - st * 0.6, 0, -0.18);
        set(BONE.foreL, -0.55, 0, 0);
        set(BONE.foreR, -0.55, 0, 0);
        set(BONE.head, 0, -p.steer * 0.25, 0);
      } else if (p.mode === 'ride') {
        set(BONE.thighL, -1.2, 0, 0.3);
        set(BONE.thighR, -1.2, 0, -0.3);
        set(BONE.shinL, 1.7, 0, 0);
        set(BONE.shinR, 1.7, 0, 0);
        set(BONE.spine, 0.55, 0, p.steer * 0.1);
        set(BONE.armL, -1.25, 0, 0.35);
        set(BONE.armR, -1.25, 0, -0.35);
        set(BONE.foreL, -0.3, 0, 0);
        set(BONE.foreR, -0.3, 0, 0);
        set(BONE.head, -0.45, 0, 0);
      } else {
        set(BONE.armL, -0.4, 0, 0.15);
        set(BONE.armR, -0.4, 0, -0.15);
        set(BONE.foreL, -0.9, 0, 0);
        set(BONE.foreR, -0.9, 0, 0);
        set(BONE.head, Math.sin(p.time * 0.4 + p.seed) * 0.08, Math.sin(p.time * 0.23 + p.seed) * 0.4, 0);
      }
      break;
    }
    case 'phone': {
      set(BONE.armR, -0.35, 0, -0.35);
      set(BONE.foreR, -2.35, 0.3, 0);
      set(BONE.handR, 0, 0, 0.4);
      set(BONE.head, 0.05, 0.15, -0.12);
      set(BONE.jaw, Math.max(0, Math.sin(p.time * 12)) * 0.12, 0, 0);
      break;
    }
    case 'punch': {
      const k = Math.sin(clamp(p.t / 0.35, 0, 1) * Math.PI);
      set(BONE.armR, -1.5 * k, 0, -0.15);
      set(BONE.foreR, -0.25 * (1 - k) - 0.1, 0, 0);
      set(BONE.armL, -0.9, 0, 0.4);
      set(BONE.foreL, -1.6, 0, 0);
      set(BONE.spine, 0.1, -0.5 * k, 0);
      set(BONE.thighL, -0.35, 0, 0.05);
      set(BONE.thighR, 0.25, 0, -0.05);
      set(BONE.shinL, 0.3, 0, 0);
      break;
    }
    case 'down':
    case 'lie': {
      root.rotation.x = -Math.PI / 2;
      root.position.y = 0.16;
      root.position.z = -0.9;
      set(BONE.armL, -0.4, 0, 1.2);
      set(BONE.armR, -0.3, 0, -1.1);
      set(BONE.thighL, 0.05, 0, 0.18);
      set(BONE.thighR, -0.1, 0, -0.15);
      set(BONE.shinL, 0.3, 0, 0);
      set(BONE.head, 0, p.mode === 'lie' ? 0.2 : 0.5, 0);
      if (p.mode === 'down') {
        // gentle stirring
        set(BONE.armR, -0.3, 0, -1.1 + Math.sin(p.time * 2) * 0.05);
      }
      break;
    }
    case 'getup': {
      const k = clamp(p.t / 1.4, 0, 1);
      root.rotation.x = -Math.PI / 2 * (1 - k);
      root.position.y = 0.16 * (1 - k);
      root.position.z = -0.9 * (1 - k);
      set(BONE.thighL, -1.4 * Math.sin(k * Math.PI), 0, 0);
      set(BONE.shinL, 1.6 * Math.sin(k * Math.PI), 0, 0);
      set(BONE.armL, -0.6 * (1 - k), 0, 0.4);
      set(BONE.armR, -0.6 * (1 - k), 0, -0.4);
      break;
    }
    case 'swim': {
      root.rotation.x = -1.25;
      root.position.y = 0.6;
      const ph = p.time * 2.4;
      set(BONE.armL, -2.6 + Math.sin(ph) * 1.6, 0, 0.3);
      set(BONE.armR, -2.6 + Math.sin(ph + Math.PI) * 1.6, 0, -0.3);
      set(BONE.thighL, Math.sin(ph * 2) * 0.3, 0, 0.05);
      set(BONE.thighR, Math.sin(ph * 2 + Math.PI) * 0.3, 0, -0.05);
      set(BONE.head, 0.9, 0, 0);
      break;
    }
    case 'dance': {
      const ph = p.time * 4.2 + p.seed;
      set(BONE.hips, 0, Math.sin(ph) * 0.3, Math.sin(ph * 2) * 0.08);
      set(BONE.spine, 0, -Math.sin(ph) * 0.2, 0);
      set(BONE.armL, -1.2 - Math.sin(ph) * 0.8, 0, 0.9);
      set(BONE.armR, -1.2 + Math.sin(ph) * 0.8, 0, -0.9);
      set(BONE.foreL, -1.0, 0, 0);
      set(BONE.foreR, -1.0, 0, 0);
      set(BONE.thighL, -0.2 - Math.max(0, Math.sin(ph)) * 0.4, 0, 0.05);
      set(BONE.thighR, -0.2 - Math.max(0, -Math.sin(ph)) * 0.4, 0, -0.05);
      set(BONE.shinL, 0.4, 0, 0);
      set(BONE.shinR, 0.4, 0, 0);
      set(BONE.head, Math.sin(ph * 2) * 0.12, 0, 0);
      hips.position.y += Math.abs(Math.sin(ph)) * 0.05 - 0.05;
      break;
    }
    case 'cower': {
      hips.position.y -= 0.35;
      set(BONE.thighL, -1.3, 0, 0.2);
      set(BONE.thighR, -1.3, 0, -0.2);
      set(BONE.shinL, 2.1, 0, 0);
      set(BONE.shinR, 2.1, 0, 0);
      set(BONE.spine, 0.6, 0, 0);
      set(BONE.armL, -2.5, 0, 0.6);
      set(BONE.armR, -2.5, 0, -0.6);
      set(BONE.foreL, -1.6, 0, 0);
      set(BONE.foreR, -1.6, 0, 0);
      break;
    }
  }
  // hair lag and blinking
  set(BONE.hair, -clamp(s * 0.012, 0, 0.08), 0, 0);
  rig.blinkT -= dt;
  const lids = b[BONE.lids] as THREE.Bone;
  let blink = 0;
  if (rig.blinkT < 0.12) blink = 1;
  if (rig.blinkT < 0) rig.blinkT = 2 + ((p.seed * 13.7 + p.time) % 3);
  lids.scale.set(1, blink > 0 ? 1 : 0.05, 1);
}

/** Standard human material (vertex coloured, slight sheen for skin and fabric). */
export function makeHumanMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 });
  return m;
}
