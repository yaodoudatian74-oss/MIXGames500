// Landmarks: hillside VISTA COAST letters, airliners (parked + one taking off),
// a docked cargo ship, the beach pier with lights, and a lighthouse.

import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import fontJson from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { MeshBuilder } from '../render/geom';
import { signTexture } from '../render/textures';
import type { CollisionWorld } from '../sim/collision';
import type { GroundModel } from './ground';
import { HeightField } from './heightmap';
import { CITY_Y, PORT, SIGN_POS } from './layout';

export class Landmarks {
  readonly group = new THREE.Group();
  private plane: THREE.Group | null = null;
  private planeT = 0;
  private pierLights: THREE.MeshStandardMaterial;
  private lighthouseBeam: THREE.Mesh | null = null;

  constructor(hf: HeightField, world: CollisionWorld, private readonly ground: GroundModel) {
    this.pierLights = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: new THREE.Color(1, 0.85, 0.6), emissiveIntensity: 0 });
    this.buildSign(hf);
    this.buildPlanes(world);
    this.buildShip(world);
    this.buildPier(hf, world);
    this.buildLighthouse(hf, world);
  }

  private buildSign(hf: HeightField): void {
    const font = new FontLoader().parse(fontJson as unknown as Parameters<FontLoader['parse']>[0]);
    const geo = new TextGeometry('VISTA COAST', { font, size: 16, depth: 2.2, curveSegments: 3, bevelEnabled: false });
    geo.computeBoundingBox();
    const bb = geo.boundingBox as THREE.Box3;
    geo.translate(-(bb.max.x + bb.min.x) / 2, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 });
    const m = new THREE.Mesh(geo, mat);
    const y = hf.heightAt(SIGN_POS.x, SIGN_POS.z) - 3;
    m.position.set(SIGN_POS.x, y, SIGN_POS.z);
    m.rotation.x = -0.28; // leaning back against the slope, facing the city (south, +z)
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    // support posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.7 });
    for (let x = -95; x <= 95; x += 14) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 10, 0.4), postMat);
      p.position.set(SIGN_POS.x + x, hf.heightAt(SIGN_POS.x + x, SIGN_POS.z - 2) + 2, SIGN_POS.z - 3);
      this.group.add(p);
    }
    // radio tower on the ridge
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.2, 60, 6), new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.6, metalness: 0.4 }));
    const tx = SIGN_POS.x + 160;
    const tz = SIGN_POS.z - 120;
    tower.position.set(tx, hf.heightAt(tx, tz) + 30, tz);
    tower.castShadow = true;
    this.group.add(tower);
  }

  private airliner(livery: number): THREE.Group {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.3, metalness: 0.2 });
    const tail = new THREE.MeshStandardMaterial({ color: livery, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.3 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 38, 18), white);
    fus.rotation.x = Math.PI / 2;
    fus.position.y = 4.2;
    g.add(fus);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(2.0, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), white);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 4.2, 19);
    nose.scale.set(1, 1, 1.6);
    g.add(nose);
    const tailCone = new THREE.Mesh(new THREE.ConeGeometry(2.0, 7, 18), white);
    tailCone.rotation.x = -Math.PI / 2;
    tailCone.position.set(0, 4.6, -22.5);
    g.add(tailCone);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(34, 0.5, 6), white);
    wing.position.set(0, 3.2, 1);
    g.add(wing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 5), tail);
    fin.position.set(0, 9, -21);
    fin.rotation.x = -0.35;
    g.add(fin);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 3), white);
    stab.position.set(0, 5.2, -22);
    g.add(stab);
    for (const sx of [-1, 1]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.0, 4, 14), dark);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(sx * 7, 2.2, 3);
      g.add(eng);
      const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 10), dark);
      gear.rotation.z = Math.PI / 2;
      gear.position.set(sx * 2.5, 0.5, 0);
      g.add(gear);
    }
    const ng = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.4, 10), dark);
    ng.rotation.z = Math.PI / 2;
    ng.position.set(0, 0.45, 14);
    g.add(ng);
    // windows strip
    const win = new THREE.Mesh(new THREE.BoxGeometry(4.05, 0.35, 28), dark);
    win.position.set(0, 4.9, 1);
    g.add(win);
    const logo = signTexture('VISTA AIR', { bg: '#f4f6f8', fg: '#1d3557', w: 1024, h: 160 });
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), new THREE.MeshStandardMaterial({ map: logo, roughness: 0.3 }));
      p.position.set(sx * 2.03, 5.6, 6);
      p.rotation.y = sx * Math.PI / 2;
      g.add(p);
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return g;
  }

  private buildPlanes(world: CollisionWorld): void {
    const spots: [number, number, number][] = [
      [-1560, 900, 0],
      [-1470, 900, 0],
      [-1380, 900, 0],
      [-1290, 905, 0.2],
    ];
    const liveries = [0x1d3557, 0xc8102e, 0x2a9d8f, 0xf4a261];
    spots.forEach(([x, z, yaw], i) => {
      const p = this.airliner(liveries[i % 4] as number);
      p.position.set(x, CITY_Y + 0.03, z);
      p.rotation.y = yaw + Math.PI;
      this.group.add(p);
      world.addBox(x - 2.2, z - 22, x + 2.2, z + 22, CITY_Y, CITY_Y + 7);
      world.addBox(x - 17, z - 2, x + 17, z + 4, CITY_Y + 2.6, CITY_Y + 3.8);
    });
    this.plane = this.airliner(0x1d3557);
    this.group.add(this.plane);
  }

  private buildShip(world: CollisionWorld): void {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(28, 12, 180), new THREE.MeshStandardMaterial({ color: 0x23395b, roughness: 0.6 }));
    hull.position.y = 2;
    g.add(hull);
    const red = new THREE.Mesh(new THREE.BoxGeometry(28.2, 4, 180.2), new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.7 }));
    red.position.y = -2;
    g.add(red);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
    bridge.position.set(0, 15, -78);
    g.add(bridge);
    const win = new THREE.Mesh(new THREE.BoxGeometry(24.2, 1.4, 14.2), new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.1 }));
    win.position.set(0, 20, -78);
    g.add(win);
    const cols = [0xb23b2b, 0x2a5d8f, 0x2f7d4f, 0xd08a2a, 0x8c8c8c];
    for (let row = 0; row < 12; row++) {
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.6 * (1 + (row + k) % 3), 12), new THREE.MeshStandardMaterial({ color: cols[(row * 3 + k) % cols.length], roughness: 0.6 }));
        c.position.set(-8 + k * 8, 8 + 1.3 * (1 + (row + k) % 3), -60 + row * 13);
        g.add(c);
      }
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const x = PORT.x1 + 20;
    const z = 930;
    g.position.set(x, 0, z);
    this.group.add(g);
    world.addBox(x - 14, z - 90, x + 14, z + 90, -10, 30);
  }

  private buildPier(hf: HeightField, world: CollisionWorld): void {
    // wooden pier from the beach into the sea at z = -300
    const z = -300;
    const x0 = 1040;
    const x1 = 1300;
    const deckY = 3.2;
    const mb = new MeshBuilder();
    const wood = new THREE.Color(0x8a6a4a);
    mb.box((x0 + x1) / 2, deckY - 0.3, z, x1 - x0, 0.3, 9, 2, wood);
    for (let x = x0; x <= x1; x += 10) {
      for (const s of [-1, 1]) mb.box(x, -6, z + s * 4, 0.5, deckY + 6 - 0.3, 0.5, 2, new THREE.Color(0x5a4632));
    }
    for (const s of [-1, 1]) mb.box((x0 + x1) / 2, deckY, z + s * 4.4, x1 - x0, 1.1, 0.15, 2, new THREE.Color(0xd9d2c4));
    // ramp from the sand
    const sandY = hf.heightAt(x0 - 12, z);
    const ramp = new THREE.BoxGeometry(14, 0.3, 9);
    const rm = new THREE.Mesh(ramp, new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 }));
    rm.position.set(x0 - 7, (sandY + deckY) / 2 - 0.2, z);
    rm.rotation.z = Math.atan2(deckY - sandY, 14);
    this.group.add(rm);
    const m = new THREE.Mesh(mb.toGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    for (let x = x0 + 5; x <= x1; x += 20) {
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.5, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
        post.position.set(x, deckY + 1.75, z + s * 4.2);
        this.group.add(post);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.pierLights);
        bulb.position.set(x, deckY + 3.6, z + s * 4.2);
        this.group.add(bulb);
      }
    }
    // the pier deck and its ramp are walkable/drivable platforms
    this.ground.addPlatform({ x0, z0: z - 4.4, x1, z1: z + 4.4, h0: deckY, h1: deckY });
    this.ground.addPlatform({ x0: x0 - 14, z0: z - 4.4, x1: x0, z1: z + 4.4, h0: sandY, h1: deckY });
    // railings
    world.addBox(x0, z - 4.6, x1, z - 4.3, deckY, deckY + 1.1);
    world.addBox(x0, z + 4.3, x1, z + 4.6, deckY, deckY + 1.1);
  }

  private buildLighthouse(hf: HeightField, world: CollisionWorld): void {
    const x = 985;
    const z = -1265;
    const y = hf.heightAt(x, z);
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.4, 22, 20), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }));
    tower.position.y = 11;
    g.add(tower);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 4, 20), new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.6 }));
    band.position.y = 15;
    g.add(band);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.4, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(1, 0.95, 0.7), emissiveIntensity: 2 }));
    lamp.position.y = 23.2;
    g.add(lamp);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2, 16), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    roof.position.y = 25.4;
    g.add(roof);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(6, 220, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.rotation.z = Math.PI / 2;
    beam.position.set(110, 23.2, 0);
    const pivot = new THREE.Group();
    pivot.add(beam);
    g.add(pivot);
    this.lighthouseBeam = beam;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o !== beam) o.castShadow = true;
    });
    g.position.set(x, y, z);
    this.group.add(g);
    world.addCircle(x, z, 3.3, y - 2, y + 26, 'prop');
  }

  update(dt: number, night: number, time: number): void {
    this.pierLights.emissiveIntensity = night * 5;
    if (this.lighthouseBeam) {
      const pivot = this.lighthouseBeam.parent as THREE.Object3D;
      pivot.rotation.y = time * 0.6;
      (this.lighthouseBeam.material as THREE.MeshBasicMaterial).opacity = 0.09 * night;
      this.lighthouseBeam.visible = night > 0.05;
    }
    // airliner: taxi -> take off along the runway -> climb -> loop
    const p = this.plane;
    if (!p) return;
    this.planeT = (this.planeT + dt) % 120;
    const t = this.planeT;
    const rz = 1180;
    let x: number;
    let y = CITY_Y + 0.03;
    let pitch = 0;
    if (t < 20) {
      x = -1820;
      y = -500; // parked off-world (hidden) waiting
      p.visible = false;
    } else if (t < 45) {
      p.visible = true;
      const k = (t - 20) / 25;
      x = -1820 + k * k * 560;
      if (k > 0.8) {
        y += (k - 0.8) * 25;
        pitch = -0.12 * ((k - 0.8) / 0.2);
      }
    } else if (t < 90) {
      const k = (t - 45) / 45;
      x = -1260 + k * 3500;
      y = CITY_Y + 5 + k * 600;
      pitch = -0.14;
    } else {
      p.visible = false;
      x = 3000;
      y = -500;
    }
    p.position.set(x, y, rz);
    p.rotation.set(0, Math.PI / 2, 0);
    p.rotateX(pitch);
    void dt;
  }
}
