// Weather and particle effects: rain streaks + splashes around the camera,
// smoke / fire / sparks / dust particles, tyre skid marks, explosion flashes.

import * as THREE from 'three';
import { Rng } from '../core/rng';
import { U } from './shaderlib';

export class RainFX {
  readonly mesh: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;
  readonly splashes: THREE.InstancedMesh;
  private splashMat: THREE.MeshBasicMaterial;
  private rng = new Rng(77);
  private splashT: number[] = [];

  constructor(count: number) {
    const pos = new Float32Array(count * 2 * 3);
    const off = new Float32Array(count * 2);
    const r = new Rng(5);
    for (let i = 0; i < count; i++) {
      const x = r.range(-40, 40);
      const y = r.range(0, 30);
      const z = r.range(-40, 40);
      for (let k = 0; k < 2; k++) {
        pos[(i * 2 + k) * 3] = x;
        pos[(i * 2 + k) * 3 + 1] = y;
        pos[(i * 2 + k) * 3 + 2] = z;
        off[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(off, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uRain: U.uRain, uWind: U.uWind, uCam: { value: new THREE.Vector3() }, uNight: U.uNight },
      vertexShader: `
        attribute float aEnd; uniform float uTime; uniform float uWind; uniform vec3 uCam; varying float vA;
        void main(){
          vec3 p = position;
          float fall = 22.0;
          float y = mod(p.y - uTime * fall, 30.0);
          vec3 wp = vec3(uCam.x + mod(p.x - uCam.x + 40.0, 80.0) - 40.0, uCam.y - 8.0 + y, uCam.z + mod(p.z - uCam.z + 40.0, 80.0) - 40.0);
          vec3 dir = normalize(vec3(uWind * 0.35, -1.0, uWind * 0.15));
          wp += dir * aEnd * 0.9;
          vA = 1.0 - aEnd * 0.6;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `uniform float uRain; uniform float uNight; varying float vA;
        void main(){ gl_FragColor = vec4(vec3(0.78, 0.82, 0.88) * mix(1.0, 0.55, uNight), 0.32 * uRain * vA); }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.splashMat = new THREE.MeshBasicMaterial({ color: 0xdde6ee, transparent: true, opacity: 0.35, depthWrite: false });
    const ring = new THREE.RingGeometry(0.06, 0.1, 12).rotateX(-Math.PI / 2);
    this.splashes = new THREE.InstancedMesh(ring, this.splashMat, 220);
    this.splashes.frustumCulled = false;
    for (let i = 0; i < 220; i++) this.splashT.push(this.rng.next());
  }

  update(dt: number, cam: THREE.Vector3, groundAt: (x: number, z: number) => number, rain: number): void {
    (this.mat.uniforms['uCam'] as THREE.IUniform<THREE.Vector3>).value.copy(cam);
    this.mesh.visible = rain > 0.02;
    this.splashes.visible = rain > 0.05;
    if (!this.splashes.visible) return;
    const m = new THREE.Matrix4();
    const n = Math.floor(220 * Math.min(1, rain * 1.3));
    for (let i = 0; i < 220; i++) {
      let t = (this.splashT[i] as number) + dt * 2.5;
      if (t > 1) {
        t -= 1;
        // respawn somewhere near the camera
        const x = cam.x + this.rng.range(-14, 14);
        const z = cam.z + this.rng.range(-14, 14);
        const y = groundAt(x, z) + 0.04;
        m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        this.splashes.setMatrixAt(i, m);
      } else {
        this.splashes.getMatrixAt(i, m);
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        const s = 0.4 + t * 2.2;
        m.compose(p, new THREE.Quaternion(), new THREE.Vector3(s, 1, s));
        this.splashes.setMatrixAt(i, i < n ? m : new THREE.Matrix4().makeScale(0, 0, 0));
      }
      this.splashT[i] = t;
    }
    this.splashes.instanceMatrix.needsUpdate = true;
    this.splashMat.opacity = 0.32 * rain;
  }
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

class ParticlePool {
  readonly points: THREE.Points;
  private ps: Particle[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private geo: THREE.BufferGeometry;
  constructor(
    private readonly cap: number,
    tex: THREE.Texture,
    additive: boolean,
  ) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 600 } },
      vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.5, -mv.z); }`,
      fragmentShader: `uniform sampler2D uTex; varying vec4 vC;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  emit(p: Particle): void {
    if (this.ps.length >= this.cap) this.ps.shift();
    this.ps.push(p);
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i] as Particle;
      p.life += dt;
      if (p.life >= p.max) {
        this.ps.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - dt * 0.8;
      p.vz *= 1 - dt * 0.8;
      p.size += p.grow * dt;
    }
    for (const p of this.ps) {
      const k = p.life / p.max;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r;
      this.col[n * 4 + 1] = p.g;
      this.col[n * 4 + 2] = p.b;
      this.col[n * 4 + 3] = p.a * (1 - k) * Math.min(1, p.life * 8);
      this.size[n] = p.size;
      n++;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Effects {
  readonly group = new THREE.Group();
  private smoke: ParticlePool;
  private glow: ParticlePool;
  private rng = new Rng(31337);
  private skids: THREE.InstancedMesh;
  private skidI = 0;
  private skidAge: number[] = [];
  flashes: { x: number; y: number; z: number; t: number }[] = [];
  readonly flashLight: THREE.PointLight;

  constructor(soft: THREE.Texture, skidTex: THREE.Texture) {
    this.smoke = new ParticlePool(900, soft, false);
    this.glow = new ParticlePool(700, soft, true);
    this.group.add(this.smoke.points, this.glow.points);
    const mat = new THREE.MeshBasicMaterial({ map: skidTex, transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    this.skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.9).rotateX(-Math.PI / 2), mat, 1200);
    this.skids.frustumCulled = false;
    this.skids.count = 0;
    this.group.add(this.skids);
    this.flashLight = new THREE.PointLight(0xffa040, 0, 90, 2);
    this.group.add(this.flashLight);
  }

  smokePuff(x: number, y: number, z: number, dark: number, size = 1): void {
    const c = 0.75 - dark * 0.6;
    this.smoke.emit({ x, y, z, vx: this.rng.range(-0.4, 0.4), vy: this.rng.range(0.8, 1.8), vz: this.rng.range(-0.4, 0.4), life: 0, max: this.rng.range(1.5, 3.2), size: 0.6 * size, grow: 1.2 * size, r: c, g: c, b: c, a: 0.5 });
  }

  dust(x: number, y: number, z: number, color: [number, number, number]): void {
    this.smoke.emit({ x, y, z, vx: this.rng.range(-0.6, 0.6), vy: this.rng.range(0.2, 0.8), vz: this.rng.range(-0.6, 0.6), life: 0, max: this.rng.range(0.8, 1.6), size: 0.4, grow: 1.4, r: color[0], g: color[1], b: color[2], a: 0.4 });
  }

  fire(x: number, y: number, z: number): void {
    this.glow.emit({ x: x + this.rng.range(-0.4, 0.4), y, z: z + this.rng.range(-0.4, 0.4), vx: this.rng.range(-0.3, 0.3), vy: this.rng.range(1.5, 3), vz: this.rng.range(-0.3, 0.3), life: 0, max: this.rng.range(0.4, 0.9), size: 0.9, grow: -0.6, r: 3, g: 1.3, b: 0.3, a: 0.9 });
    if (this.rng.chance(0.35)) this.smokePuff(x, y + 1, z, 0.9, 1.6);
  }

  sparks(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.glow.emit({ x, y, z, vx: this.rng.range(-6, 6), vy: this.rng.range(1, 6), vz: this.rng.range(-6, 6), life: 0, max: this.rng.range(0.2, 0.6), size: 0.12, grow: 0, r: 4, g: 2.6, b: 1.0, a: 1 });
    }
  }

  explosion(x: number, y: number, z: number): void {
    for (let i = 0; i < 60; i++) {
      this.glow.emit({ x, y, z, vx: this.rng.range(-9, 9), vy: this.rng.range(2, 12), vz: this.rng.range(-9, 9), life: 0, max: this.rng.range(0.5, 1.4), size: 2.2, grow: 1.5, r: 4, g: 1.6, b: 0.3, a: 1 });
    }
    for (let i = 0; i < 40; i++) this.smokePuff(x + this.rng.range(-2, 2), y + this.rng.range(0, 3), z + this.rng.range(-2, 2), 0.9, 3);
    this.sparks(x, y, z, 40);
    this.flashes.push({ x, y, z, t: 0 });
  }

  skid(x: number, y: number, z: number, yaw: number): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.03, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    this.skids.setMatrixAt(this.skidI, m);
    this.skidAge[this.skidI] = 0;
    this.skidI = (this.skidI + 1) % 1200;
    this.skids.count = Math.max(this.skids.count, this.skidI);
    if (this.skidAge.length >= 1200) this.skids.count = 1200;
    this.skids.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    this.smoke.update(dt);
    this.glow.update(dt);
    let li = 0;
    for (const f of this.flashes) {
      f.t += dt;
      li = Math.max(li, Math.max(0, 1 - f.t * 1.5));
      this.flashLight.position.set(f.x, f.y + 2, f.z);
    }
    this.flashes = this.flashes.filter((f) => f.t < 1);
    this.flashLight.intensity = li * 400;
  }
}
