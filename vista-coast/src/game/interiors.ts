// Building interiors: shops, diner, club, dealership, garage, police, hospital,
// homes and the mall. Each is a self-contained room placed far below the world,
// with its own colliders, lights, NPCs and interaction points.

import * as THREE from 'three';
import { Rng } from '../core/rng';
import { MeshBuilder } from '../render/geom';
import { signTexture, type TextureLib } from '../render/textures';
import { CollisionWorld } from '../sim/collision';
import { applyPose, buildHumanGeometry, createHuman, makeHumanMaterial, randomLook, type HumanRig, type PoseState } from '../entities/human';

export type InteractKind = 'exit' | 'shop' | 'outfit' | 'dealer' | 'repair' | 'garage' | 'bed' | 'wardrobe' | 'heal' | 'police' | 'dance';

export interface InteractPoint {
  x: number;
  z: number;
  r: number;
  kind: InteractKind;
  label: string;
  shop?: string;
}

export interface Interior {
  id: string;
  name: string;
  group: THREE.Group;
  world: CollisionWorld;
  spawn: { x: number; z: number; yaw: number };
  points: InteractPoint[];
  floorY: number;
  npcs: { rig: HumanRig; pose: PoseState; x: number; z: number; yaw: number; wander: boolean; tx: number; tz: number }[];
  animate: ((t: number) => void) | null;
  reverb: number;
  ambient: number;
}

const BASE_Y = -400;

export class InteriorLibrary {
  private built = new Map<string, Interior>();
  private index = 0;
  private humanMat = makeHumanMaterial();
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
  private glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  private rng = new Rng(4040);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly tex: TextureLib,
  ) {}

  get(id: string): Interior {
    const ex = this.built.get(id);
    if (ex) return ex;
    const it = this.build(id);
    this.built.set(id, it);
    it.group.visible = false;
    this.scene.add(it.group);
    return it;
  }

  private room(mb: MeshBuilder, cw: CollisionWorld, oy: number, w: number, d: number, h: number, wall: number, floor: number, ceil: number): void {
    const c = new THREE.Color();
    // floor & ceiling
    c.setHex(floor);
    mb.flatRect(-w / 2, -d / 2, w / 2, d / 2, oy, 2, c);
    c.setHex(ceil);
    const a = mb.vertexCount;
    for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as const) mb.vertex(x, oy + h, z, 0, -1, 0, 0, 0, c);
    mb.tri(a, a + 1, a + 2);
    mb.tri(a, a + 2, a + 3);
    // walls (inward facing)
    c.setHex(wall);
    const wq = (x0: number, z0: number, x1: number, z1: number): void => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const nx = -(z1 - z0) / len;
      const nz = (x1 - x0) / len;
      const b = mb.vertexCount;
      mb.vertex(x0, oy, z0, nx, 0, nz, 0, 0, c);
      mb.vertex(x1, oy, z1, nx, 0, nz, 1, 0, c);
      mb.vertex(x1, oy + h, z1, nx, 0, nz, 1, 1, c);
      mb.vertex(x0, oy + h, z0, nx, 0, nz, 0, 1, c);
      mb.tri(b, b + 1, b + 2);
      mb.tri(b, b + 2, b + 3);
    };
    wq(-w / 2, -d / 2, w / 2, -d / 2);
    wq(w / 2, -d / 2, w / 2, d / 2);
    wq(w / 2, d / 2, -w / 2, d / 2);
    wq(-w / 2, d / 2, -w / 2, -d / 2);
    // skirting
    c.setHex(0x333333);
    // colliders: walls as thin boxes
    const t = 0.5;
    cw.addBox(-w / 2 - t, -d / 2 - t, w / 2 + t, -d / 2, oy - 1, oy + h);
    cw.addBox(-w / 2 - t, d / 2, w / 2 + t, d / 2 + t, oy - 1, oy + h);
    cw.addBox(-w / 2 - t, -d / 2, -w / 2, d / 2, oy - 1, oy + h);
    cw.addBox(w / 2, -d / 2, w / 2 + t, d / 2, oy - 1, oy + h);
  }

  private box(mb: MeshBuilder, cw: CollisionWorld | null, x: number, y: number, z: number, w: number, h: number, d: number, color: number, solid = true): void {
    mb.box(x, y, z, w, h, d, 1, new THREE.Color(color), true);
    if (cw && solid) cw.addBox(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y - 0.2, y + h);
  }

  private npc(it: Interior, look: number, x: number, z: number, yaw: number, mode: PoseState['mode'], wander = false, uniform: 'none' | 'police' | 'medic' = 'none'): void {
    const l = randomLook(look);
    l.uniform = uniform;
    const rig = createHuman(buildHumanGeometry(l), this.humanMat, l.height);
    rig.mesh.position.set(x, it.floorY, z);
    rig.mesh.rotation.y = yaw;
    it.group.add(rig.mesh);
    it.npcs.push({ rig, pose: { mode, phase: 0, speed: 0, t: 0, time: 0, lean: 0, talk: 0, steer: 0, seed: look * 0.77 }, x, z, yaw, wander, tx: x, tz: z });
  }

  private addLight(g: THREE.Group, x: number, y: number, z: number, color: number, intensity: number, dist: number): THREE.PointLight {
    const l = new THREE.PointLight(color, intensity, dist, 1.6);
    l.position.set(x, y, z);
    g.add(l);
    return l;
  }

  private sign(g: THREE.Group, text: string, x: number, y: number, z: number, rotY: number, w: number, fg: string, bg: string): void {
    const tex = signTexture(text, { bg, fg, glow: fg });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.19), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    g.add(m);
  }

  private build(id: string): Interior {
    const oy = BASE_Y - this.index++ * 30;
    const g = new THREE.Group();
    const cw = new CollisionWorld(8);
    const mb = new MeshBuilder();
    const glowB = new MeshBuilder();
    const it: Interior = { id, name: id, group: g, world: cw, spawn: { x: 0, z: 0, yaw: 0 }, points: [], floorY: oy, npcs: [], animate: null, reverb: 0.4, ambient: 0.6 };
    const hemi = new THREE.HemisphereLight(0xfff4e6, 0x403830, 0.9);
    hemi.position.set(0, oy + 5, 0);
    g.add(hemi);
    const r = this.rng;
    const shelfColors = [0xd9452f, 0x2f7dd9, 0xf2c94c, 0x41a85f, 0xeeeeee, 0x9b51e0, 0xf2994a];
    const ceilingPanels = (w: number, d: number, h: number, step: number): void => {
      for (let x = -w / 2 + step / 2; x < w / 2; x += step) for (let z = -d / 2 + step / 2; z < d / 2; z += step) glowB.box(x, oy + h - 0.06, z, 1.2, 0.05, 0.6, 1, new THREE.Color(1.6, 1.55, 1.45));
    };
    switch (id) {
      case 'mart': {
        it.name = 'VISTA MART';
        this.room(mb, cw, oy, 18, 14, 3.6, 0xf2f2ee, 0xd8d6d0, 0xf8f8f8);
        for (let row = -1; row <= 1; row++) {
          const x = row * 4.5;
          this.box(mb, cw, x, oy, -0.5, 1.1, 1.7, 7, 0xdedede);
          for (let lv = 0; lv < 3; lv++) for (let k = 0; k < 10; k++) for (const side of [-1, 1]) this.box(mb, null, x + side * 0.42, oy + 0.35 + lv * 0.5, -3.7 + k * 0.72, 0.25, 0.3, 0.55, r.pick(shelfColors), false);
        }
        // fridges along the back wall
        for (let k = 0; k < 6; k++) {
          this.box(mb, cw, -7.5 + k * 2.2, oy, -6.4, 2.0, 2.2, 1.0, 0xbfc6cc);
          glowB.box(-7.5 + k * 2.2, oy + 0.2, -5.88, 1.7, 1.8, 0.02, 1, new THREE.Color(0.75, 0.9, 1.1));
        }
        this.box(mb, cw, 5.5, oy, 4.5, 4, 1.05, 1.0, 0x8a6a4a);
        this.npc(it, 301, 5.5, 5.6, Math.PI, 'idle');
        it.points.push({ x: 5.5, z: 3.4, r: 1.6, kind: 'shop', label: '買い物する', shop: 'mart' });
        it.spawn = { x: 0, z: 6, yaw: Math.PI };
        it.points.push({ x: 0, z: 6.6, r: 1.2, kind: 'exit', label: '外に出る' });
        ceilingPanels(18, 14, 3.6, 3);
        this.addLight(g, 0, oy + 3.2, 0, 0xffffff, 18, 18);
        break;
      }
      case 'diner':
      case 'pizza': {
        const pizza = id === 'pizza';
        it.name = pizza ? 'Pizza Vista' : 'Sunset Diner';
        this.room(mb, cw, oy, 20, 12, 3.4, pizza ? 0xe9dcc5 : 0xf3e6d0, pizza ? 0x8a3b2a : 0x2b2b2b, 0xf2efe8);
        // checkered floor stripe
        for (let x = -10; x < 10; x += 1) for (let z = -6; z < 6; z += 1) if (((x + z) & 1) === 0) mb.flatRect(x, z, x + 1, z + 1, oy + 0.005, 1, new THREE.Color(pizza ? 0xe8d9c0 : 0xf2f2f2));
        // booths along the window wall
        for (let k = 0; k < 4; k++) {
          const z = -4 + k * 2.6;
          this.box(mb, cw, -8.2, oy, z, 1.2, 0.75, 0.9, 0xb3121a);
          this.box(mb, cw, -6.6, oy, z, 1.1, 0.78, 1.0, 0xdcd6cc);
          this.box(mb, null, -6.6, oy + 0.78, z, 1.1, 0.04, 1.0, 0x9aa0a6, false);
        }
        // counter + stools
        this.box(mb, cw, 3, oy, -2.5, 9, 1.05, 1.0, pizza ? 0x6b3f2a : 0xd0d4d8);
        for (let k = 0; k < 6; k++) this.box(mb, null, -0.5 + k * 1.4, oy, -1.4, 0.45, 0.75, 0.45, 0xb3121a, false);
        this.box(mb, cw, 3, oy, -5.4, 9, 2.2, 1.0, 0xc0c4c8); // kitchen
        this.npc(it, pizza ? 410 : 402, 3, -3.6, 0, 'idle');
        for (let k = 0; k < 3; k++) this.npc(it, 420 + k, -7.3, -4 + k * 2.6, Math.PI / 2, 'sit');
        it.points.push({ x: 3, z: -1.4, r: 1.8, kind: 'shop', label: '注文する', shop: pizza ? 'pizza' : 'diner' });
        it.spawn = { x: 6, z: 4.5, yaw: Math.PI };
        it.points.push({ x: 6, z: 5.4, r: 1.2, kind: 'exit', label: '外に出る' });
        this.sign(g, pizza ? 'PIZZA VISTA' : 'SUNSET DINER', 3, oy + 2.6, -5.88, 0, 5, pizza ? '#ffcf5a' : '#ff9a3d', '#1a0d0d');
        ceilingPanels(20, 12, 3.4, 3.5);
        this.addLight(g, 0, oy + 3, 0, 0xffe2b8, 16, 20);
        break;
      }
      case 'clothes': {
        it.name = 'MODA VISTA';
        this.room(mb, cw, oy, 16, 12, 3.8, 0x2b2b30, 0xd9d4cc, 0x1d1d20);
        for (let k = 0; k < 4; k++) {
          const x = -5 + k * 3.3;
          this.box(mb, cw, x, oy + 1.5, -1, 2.2, 0.05, 0.05, 0xc0c0c0);
          for (let h = 0; h < 8; h++) this.box(mb, null, x - 1 + h * 0.28, oy + 0.55, -1, 0.22, 0.95, 0.5, r.pick([0x1d4fa8, 0xb3121a, 0xf2f2f2, 0x111111, 0xf29f4c, 0x5b2c83, 0x2f7d4f]), false);
        }
        this.box(mb, cw, 0, oy, -5.4, 4, 1.0, 1, 0x111111);
        glowB.box(-7.9, oy + 0.3, 2, 0.02, 2.2, 1.2, 1, new THREE.Color(0.8, 0.85, 0.9)); // mirror
        this.npc(it, 501, 0, -5.9, 0, 'idle');
        it.points.push({ x: 0, z: -4.3, r: 1.8, kind: 'outfit', label: '服を選ぶ' });
        it.spawn = { x: 0, z: 4.5, yaw: Math.PI };
        it.points.push({ x: 0, z: 5.4, r: 1.2, kind: 'exit', label: '外に出る' });
        ceilingPanels(16, 12, 3.8, 2.5);
        this.addLight(g, 0, oy + 3.3, 0, 0xffffff, 14, 16);
        break;
      }
      case 'dealer': {
        it.name = 'NEXA MOTORS';
        this.room(mb, cw, oy, 30, 20, 6, 0xeef1f4, 0xbfc5cc, 0xffffff);
        for (const [x, z] of [[-9, -2], [0, -3], [9, -2]] as const) {
          this.box(mb, null, x, oy, z, 6, 0.15, 3.4, 0x2a2f36, false);
          glowB.box(x, oy + 0.16, z, 6.2, 0.02, 3.6, 1, new THREE.Color(0.6, 0.8, 1.2));
          cw.addBox(x - 2.4, z - 1, x + 2.4, z + 1, oy, oy + 1.5);
        }
        this.box(mb, cw, 10, oy, 7, 4, 1.0, 1.4, 0xffffff);
        this.npc(it, 601, 10, 8, Math.PI, 'idle');
        it.points.push({ x: 10, z: 5.8, r: 2, kind: 'dealer', label: '車を購入する' });
        it.spawn = { x: 0, z: 8.5, yaw: Math.PI };
        it.points.push({ x: 0, z: 9.4, r: 1.3, kind: 'exit', label: '外に出る' });
        this.sign(g, 'NEXA MOTORS', 0, oy + 4.6, -9.9, 0, 9, '#ffffff', '#111111');
        ceilingPanels(30, 20, 6, 4);
        this.addLight(g, 0, oy + 5.5, 0, 0xffffff, 40, 30);
        break;
      }
      case 'mechanic': {
        it.name = "Marco's Garage";
        this.room(mb, cw, oy, 24, 16, 6, 0x8c8a86, 0x6e6c68, 0x4a4a4a);
        for (const x of [-6, 4]) {
          this.box(mb, null, x, oy, 0, 4.2, 0.12, 6, 0xd04a2a, false);
          for (const sx of [-1, 1]) this.box(mb, cw, x + sx * 2.3, oy, 0, 0.3, 2.5, 0.3, 0xd04a2a);
        }
        for (let k = 0; k < 5; k++) this.box(mb, cw, -10 + k * 1.4, oy, -7.2, 1.2, 1.6, 0.8, 0xb3121a); // tool chests
        this.box(mb, cw, 9, oy, -6, 3, 1, 1.2, 0x5a4a3a);
        this.npc(it, 701, 9, -6.9, 0, 'idle');
        it.points.push({ x: 9, z: -4.8, r: 2, kind: 'repair', label: '修理・塗装' });
        it.spawn = { x: 0, z: 6.5, yaw: Math.PI };
        it.points.push({ x: 0, z: 7.4, r: 1.3, kind: 'exit', label: '外に出る' });
        this.addLight(g, -6, oy + 5, 0, 0xfff1dd, 20, 20);
        this.addLight(g, 6, oy + 5, 0, 0xfff1dd, 20, 20);
        it.reverb = 0.8;
        break;
      }
      case 'club': {
        it.name = 'CLUB NEON';
        it.ambient = 0.12;
        this.room(mb, cw, oy, 28, 22, 7, 0x0d0d14, 0x111118, 0x08080c);
        // dance floor tiles (animated emissive)
        const tiles = new THREE.Group();
        const tileMats: THREE.MeshBasicMaterial[] = [];
        for (let i = -4; i < 4; i++) {
          for (let j = -3; j < 3; j++) {
            const m = new THREE.MeshBasicMaterial({ color: 0x220033 });
            tileMats.push(m);
            const t = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1.45).rotateX(-Math.PI / 2), m);
            t.position.set(i * 1.5 + 0.75, oy + 0.01, j * 1.5 + 0.75);
            tiles.add(t);
          }
        }
        g.add(tiles);
        this.box(mb, cw, 0, oy, -9.5, 6, 1.4, 1.8, 0x1a1a22); // DJ booth
        glowB.box(0, oy + 1.4, -9.5, 6.1, 0.06, 1.9, 1, new THREE.Color(1.5, 0.2, 1.6));
        this.box(mb, cw, 11, oy, 3, 1.2, 1.1, 10, 0x2a1e2e); // bar
        glowB.box(11, oy + 1.1, 3, 1.3, 0.04, 10.1, 1, new THREE.Color(0.2, 1.2, 1.6));
        this.npc(it, 801, 0, -10.2, 0, 'dance');
        for (let k = 0; k < 14; k++) this.npc(it, 820 + k, r.range(-5, 5), r.range(-4, 4), r.range(0, 6.28), 'dance');
        this.npc(it, 850, 11.8, 3, -Math.PI / 2, 'idle');
        it.points.push({ x: 10, z: 3, r: 1.8, kind: 'shop', label: 'ドリンクを注文', shop: 'club' });
        it.points.push({ x: 0, z: 0, r: 4.5, kind: 'dance', label: '踊る' });
        it.spawn = { x: 0, z: 9.5, yaw: Math.PI };
        it.points.push({ x: 0, z: 10.4, r: 1.3, kind: 'exit', label: '外に出る' });
        this.sign(g, 'CLUB NEON', 0, oy + 5, -10.9, 0, 9, '#ff3df2', '#05050a');
        const spots: THREE.SpotLight[] = [];
        const cols = [0xff2bd6, 0x2bd6ff, 0x8a2bff, 0xffd12b];
        for (let k = 0; k < 4; k++) {
          const s = new THREE.SpotLight(cols[k], 90, 30, 0.35, 0.4, 1.2);
          s.position.set(-6 + k * 4, oy + 6.6, -6);
          s.target.position.set(0, oy, 0);
          g.add(s, s.target);
          spots.push(s);
        }
        it.animate = (t: number): void => {
          tileMats.forEach((m, i) => {
            const v = Math.sin(t * 4 + i * 1.7) * 0.5 + 0.5;
            const hue = (t * 0.1 + i * 0.07) % 1;
            m.color.setHSL(hue, 1, 0.12 + v * 0.45);
          });
          spots.forEach((s, i) => {
            s.target.position.set(Math.sin(t * 0.9 + i) * 6, oy, Math.cos(t * 1.1 + i * 2) * 5);
            s.target.updateMatrixWorld();
          });
        };
        it.reverb = 1;
        break;
      }
      case 'police':
      case 'hospital':
      case 'fire': {
        const isP = id === 'police';
        const isH = id === 'hospital';
        it.name = isP ? 'VCPD 中央警察署' : isH ? '総合病院 ロビー' : '消防署 第7分署';
        this.room(mb, cw, oy, 22, 16, 4.2, isH ? 0xf4f6f6 : isP ? 0xd6dbe0 : 0xd9d1c4, isH ? 0xe8ecec : 0x8a8f96, 0xf8f8f8);
        this.box(mb, cw, 0, oy, -4, 6, 1.1, 1.2, isP ? 0x1d2b44 : isH ? 0xffffff : 0xb3121a);
        for (let k = 0; k < 5; k++) this.box(mb, cw, -8 + k * 1.2, oy, 3, 0.9, 0.5, 0.9, 0x5a6470); // chairs
        if (id === 'fire') {
          this.box(mb, cw, 5, oy, 2, 3, 3, 8, 0xc0151a);
          this.box(mb, null, 5, oy + 3, 2, 0.8, 0.2, 7, 0xc8ccd0, false);
        }
        this.npc(it, isP ? 901 : 911, 0, -5, 0, 'idle', false, isP ? 'police' : isH ? 'medic' : 'none');
        if (isP) it.points.push({ x: 0, z: -2.8, r: 1.8, kind: 'police', label: '窓口（罰金を払って手配解除）' });
        if (isH) it.points.push({ x: 0, z: -2.8, r: 1.8, kind: 'heal', label: '治療を受ける' });
        it.spawn = { x: 0, z: 6.5, yaw: Math.PI };
        it.points.push({ x: 0, z: 7.4, r: 1.3, kind: 'exit', label: '外に出る' });
        this.sign(g, isP ? 'VISTA COAST POLICE DEPT.' : isH ? 'GENERAL HOSPITAL' : 'STATION 7', 0, oy + 3.2, -7.9, 0, 8, isP ? '#9cc6ff' : isH ? '#c8102e' : '#ffd0a0', '#111111');
        ceilingPanels(22, 16, 4.2, 3);
        this.addLight(g, 0, oy + 3.8, 0, 0xffffff, 20, 20);
        break;
      }
      case 'underground': {
        it.name = '地下駐車場';
        it.ambient = 0.35;
        this.room(mb, cw, oy, 40, 30, 3.2, 0x9a9c9e, 0x5c5e60, 0x7a7c7e);
        for (let x = -15; x <= 15; x += 7.5) for (const z of [-6, 6]) this.box(mb, cw, x, oy, z, 0.8, 3.2, 0.8, 0xb5b7b9);
        for (let x = -18; x <= 18; x += 3) {
          mb.flatRect(x - 0.06, -14, x + 0.06, -9, oy + 0.01, 1, new THREE.Color(0.95, 0.95, 0.95));
          mb.flatRect(x - 0.06, 9, x + 0.06, 14, oy + 0.01, 1, new THREE.Color(0.95, 0.95, 0.95));
        }
        for (let x = -18; x <= 18; x += 6) glowB.box(x, oy + 3.1, 0, 2.4, 0.05, 0.25, 1, new THREE.Color(1.4, 1.5, 1.6));
        it.points.push({ x: 0, z: -12, r: 2.5, kind: 'garage', label: '保管した車を出す' });
        it.spawn = { x: 0, z: 12, yaw: Math.PI };
        it.points.push({ x: 0, z: 13.6, r: 1.4, kind: 'exit', label: '地上に出る' });
        this.addLight(g, -10, oy + 2.9, 0, 0xe8f0ff, 10, 18);
        this.addLight(g, 10, oy + 2.9, 0, 0xe8f0ff, 10, 18);
        it.reverb = 1;
        break;
      }
      case 'apt':
      case 'house':
      case 'villa': {
        const big = id === 'villa' ? 1.6 : id === 'house' ? 1.25 : 1;
        it.name = id === 'apt' ? 'Bayview アパート' : id === 'house' ? 'Maple 一戸建て' : 'Vista Hills ヴィラ';
        const W = 14 * big;
        const D = 10 * big;
        this.room(mb, cw, oy, W, D, 3.2, id === 'villa' ? 0xf4f4f2 : 0xe8dfd0, id === 'villa' ? 0xd9d2c4 : 0x8a6a4a, 0xffffff);
        this.box(mb, cw, -W / 2 + 1.5, oy, -D / 2 + 1.4, 2.2, 0.55, 2.6, 0xf2f2f2); // bed
        this.box(mb, null, -W / 2 + 1.5, oy + 0.55, -D / 2 + 0.5, 2.2, 0.25, 0.6, 0x9ab0c8, false);
        this.box(mb, cw, W / 2 - 1.2, oy, -D / 2 + 0.6, 2, 2.2, 0.8, 0x6b4a2f); // wardrobe
        this.box(mb, cw, 0, oy, 1, 3, 0.45, 1, 0x3a3f46); // sofa
        this.box(mb, null, 0, oy + 0.45, 1.45, 3, 0.45, 0.2, 0x3a3f46, false);
        this.box(mb, cw, 0, oy, -1.2, 1.2, 0.4, 0.7, 0x5a4a3a); // table
        this.box(mb, cw, 0, oy, -D / 2 + 0.3, 2.4, 1.4, 0.15, 0x111111); // TV
        glowB.box(0, oy + 0.75, -D / 2 + 0.39, 2.2, 1.2, 0.02, 1, new THREE.Color(0.25, 0.45, 0.8));
        if (id === 'villa') glowB.box(0, oy + 1.6, D / 2 - 0.05, W * 0.8, 2.2, 0.02, 1, new THREE.Color(0.9, 1.0, 1.15)); // window wall
        it.points.push({ x: -W / 2 + 1.5, z: -D / 2 + 3.2, r: 1.6, kind: 'bed', label: '寝る（セーブ・時間を進める）' });
        it.points.push({ x: W / 2 - 1.2, z: -D / 2 + 1.6, r: 1.5, kind: 'wardrobe', label: '着替える' });
        it.points.push({ x: W / 2 - 1.5, z: D / 2 - 1.5, r: 1.5, kind: 'garage', label: 'ガレージ（保管した車）' });
        it.spawn = { x: 0, z: D / 2 - 1.2, yaw: Math.PI };
        it.points.push({ x: -2, z: D / 2 - 0.6, r: 1.2, kind: 'exit', label: '外に出る' });
        this.addLight(g, 0, oy + 2.9, 0, 0xffe7c8, 12, 16);
        break;
      }
      case 'mall':
      default: {
        it.name = 'Vista Grand Mall';
        const W = 60;
        const D = 40;
        this.room(mb, cw, oy, W, D, 12, 0xf2efe8, 0xe9e5dc, 0xffffff);
        // upper gallery
        this.box(mb, null, 0, oy + 5.6, -D / 2 + 4, W, 0.4, 8, 0xe0dcd2, false);
        this.box(mb, null, 0, oy + 5.6, D / 2 - 4, W, 0.4, 8, 0xe0dcd2, false);
        glowB.box(0, oy + 11.9, 0, 20, 0.05, 14, 1, new THREE.Color(1.3, 1.35, 1.4)); // skylight
        const stores: [string, number, InteractKind, string | undefined][] = [
          ['MODA VISTA', -20, 'outfit', undefined],
          ['FOOD COURT', 0, 'shop', 'diner'],
          ['VISTA MART', 20, 'shop', 'mart'],
        ];
        for (const [name, x, kind, shop] of stores) {
          this.box(mb, cw, x, oy, -D / 2 + 1, 14, 4, 2, 0xd8d2c4);
          glowB.box(x, oy + 1.8, -D / 2 + 2.02, 12, 3, 0.02, 1, new THREE.Color(1.0, 0.95, 0.85));
          this.sign(g, name, x, oy + 4.6, -D / 2 + 2.1, 0, 8, '#ffffff', '#1b1d22');
          it.points.push({ x, z: -D / 2 + 3.6, r: 2.5, kind, label: name + 'で買い物', shop });
        }
        // planters with palms (simple), benches, fountain
        for (const x of [-14, 14]) {
          this.box(mb, cw, x, oy, 4, 3, 0.8, 3, 0x9a8f80);
          this.box(mb, null, x, oy + 0.8, 4, 0.4, 5, 0.4, 0x6b4a2f, false);
          this.box(mb, null, x, oy + 5.6, 4, 4, 0.6, 4, 0x3f7a3a, false);
        }
        this.box(mb, cw, 0, oy, 6, 6, 0.7, 6, 0xd9d4c8);
        glowB.box(0, oy + 0.72, 6, 5.2, 0.02, 5.2, 1, new THREE.Color(0.3, 0.7, 0.9));
        for (let k = 0; k < 12; k++) this.npc(it, 1000 + k, r.range(-25, 25), r.range(-10, 14), r.range(0, 6.28), 'walk', true);
        it.spawn = { x: 0, z: D / 2 - 2, yaw: Math.PI };
        it.points.push({ x: 0, z: D / 2 - 0.8, r: 1.5, kind: 'exit', label: '外に出る' });
        for (let x = -24; x <= 24; x += 12) this.addLight(g, x, oy + 10, 0, 0xffffff, 40, 34);
        it.reverb = 0.9;
        break;
      }
    }
    const m = new THREE.Mesh(mb.toGeometry(), this.mat);
    m.receiveShadow = true;
    g.add(m);
    if (!glowB.isEmpty()) g.add(new THREE.Mesh(glowB.toGeometry(), this.glow));
    void this.tex;
    return it;
  }

  /** Animate NPCs and effects inside the active interior. */
  update(it: Interior, dt: number, t: number): void {
    it.animate?.(t);
    for (const n of it.npcs) {
      if (n.wander) {
        const dx = n.tx - n.x;
        const dz = n.tz - n.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          n.tx = this.rng.range(-25, 25);
          n.tz = this.rng.range(-10, 14);
        } else {
          n.x += (dx / d) * 1.2 * dt;
          n.z += (dz / d) * 1.2 * dt;
          n.yaw = Math.atan2(dx, dz);
        }
        n.pose.speed = 1.2;
        n.pose.phase += 1.2 * dt * 3.2;
        n.rig.mesh.position.set(n.x, it.floorY, n.z);
        n.rig.mesh.rotation.y = n.yaw;
      }
      n.pose.time = t;
      n.pose.t += dt;
      applyPose(n.rig, n.pose, dt);
    }
  }
}
