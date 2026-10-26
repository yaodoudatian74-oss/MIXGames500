// Ocean and lake: Gerstner waves, depth-based colour (turquoise shallows to deep
// blue), shoreline/crest foam, scrolling detail normals, sky reflections via the
// PBR environment, rain ripples and boat wakes. Boats sail around offshore.

import * as THREE from 'three';
import { wrapAngle } from '../core/math';
import { DataUtils } from 'three';
import { U } from '../render/shaderlib';
import type { TextureLib } from '../render/textures';
import { HeightField, HM_N } from './heightmap';
import { LAKE, SEA_LEVEL, WORLD_HALF } from './layout';

export const MAX_WAKES = 4;

function heightTexture(hf: HeightField, size: number): THREE.DataTexture {
  const data = new Uint16Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -WORLD_HALF + ((i + 0.5) / size) * WORLD_HALF * 2;
      const z = -WORLD_HALF + ((j + 0.5) / size) * WORLD_HALF * 2;
      data[j * size + i] = DataUtils.toHalfFloat(hf.heightAt(x, z));
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  void HM_N;
  return t;
}

function radialGrid(rings: number, segs: number, r0: number, r1: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    const r = r0 * (Math.exp(t * Math.log(r1 / r0)) - 1) + t * 1.5;
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let k = 0; k < segs; k++) idx.push(0, 1 + ((k + 1) % segs), 1 + k);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segs;
    const b0 = 1 + (i + 1) * segs;
    for (let k = 0; k < segs; k++) {
      const k1 = (k + 1) % segs;
      idx.push(a0 + k, a0 + k1, b0 + k);
      idx.push(a0 + k1, b0 + k1, b0 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < nor.length; i += 3) nor[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), r1);
  return g;
}

export class WaterSystem {
  readonly group = new THREE.Group();
  readonly ocean: THREE.Mesh;
  readonly lake: THREE.Mesh;
  private oceanMat: THREE.MeshStandardMaterial;
  private lakeMat: THREE.MeshStandardMaterial;
  readonly wakes: THREE.Vector4[] = [];
  readonly waveAmp = { value: 0.6 };
  private boats: { mesh: THREE.Group; path: THREE.Vector2[]; speed: number; s: number; len: number; bob: number }[] = [];

  constructor(hf: HeightField, tex: TextureLib, detail: number) {
    for (let i = 0; i < MAX_WAKES; i++) this.wakes.push(new THREE.Vector4(0, 0, 0, 0));
    const hTex = heightTexture(hf, 512);
    this.oceanMat = this.makeMaterial(tex, hTex, SEA_LEVEL, 1);
    this.lakeMat = this.makeMaterial(tex, hTex, hf.lakeLevel, 0.15);
    this.ocean = new THREE.Mesh(radialGrid(detail, Math.round(detail * 2.2), 2.5, 7000), this.oceanMat);
    this.ocean.frustumCulled = false;
    this.ocean.receiveShadow = true;
    this.ocean.renderOrder = 1;
    this.group.add(this.ocean);
    const lakeGeo = new THREE.CircleGeometry(LAKE.r + 45, 64, 0, Math.PI * 2).rotateX(-Math.PI / 2);
    this.lake = new THREE.Mesh(lakeGeo, this.lakeMat);
    this.lake.position.set(LAKE.x, hf.lakeLevel, LAKE.z);
    this.lake.receiveShadow = true;
    this.lake.renderOrder = 1;
    this.group.add(this.lake);
    this.makeBoats();
  }

  private makeMaterial(tex: TextureLib, hTex: THREE.Texture, level: number, ampScale: number): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.0, transparent: true, depthWrite: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = U.uTime;
      shader.uniforms['uRain'] = U.uRain;
      shader.uniforms['uNight'] = U.uNight;
      shader.uniforms['uSunColor'] = U.uSunColor;
      shader.uniforms['uLake'] = { value: ampScale < 0.5 ? 1 : 0 };
      shader.uniforms['uAmp'] = this.waveAmp;
      shader.uniforms['uAmpScale'] = { value: ampScale };
      shader.uniforms['uLevel'] = { value: level };
      shader.uniforms['tHeight'] = { value: hTex };
      shader.uniforms['tWaterN'] = { value: tex.waterNormal };
      shader.uniforms['uWorldHalf'] = { value: WORLD_HALF };
      shader.uniforms['uWakes'] = { value: this.wakes };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime; uniform float uAmp; uniform float uAmpScale; uniform float uLevel; uniform sampler2D tHeight; uniform float uWorldHalf;
varying vec3 vW; varying float vDepth; varying float vCrest; varying vec3 vGN;
vec3 gerstner(vec2 p, vec2 dir, float wl, float steep, float speed, inout vec3 tangent, inout vec3 binormal) {
  float k = 6.28318 / wl;
  float c = sqrt(9.8 / k) * speed;
  vec2 d = normalize(dir);
  float f = k * (dot(d, p) - c * uTime);
  float a = steep / k;
  tangent += vec3(-d.x * d.x * (steep * sin(f)), d.x * (steep * cos(f)), -d.x * d.y * (steep * sin(f)));
  binormal += vec3(-d.x * d.y * (steep * sin(f)), d.y * (steep * cos(f)), -d.y * d.y * (steep * sin(f)));
  return vec3(d.x * (a * cos(f)), a * sin(f), d.y * (a * cos(f)));
}`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
  vec4 wp0 = modelMatrix * vec4(position, 1.0);
  vec2 huv = (wp0.xz + uWorldHalf) / (2.0 * uWorldHalf);
  float ground = texture2D(tHeight, huv).r;
  float depth = uLevel - ground;
  vDepth = depth;
  float amp = uAmp * uAmpScale * clamp(depth / 6.0, 0.15, 1.0) * (1.0 - smoothstep(1800.0, 4500.0, length(wp0.xz - cameraPosition.xz)));
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);
  disp += gerstner(wp0.xz, vec2(-1.0, 0.25), 60.0, 0.16 * amp, 1.0, tangent, binormal);
  disp += gerstner(wp0.xz, vec2(-0.7, 0.6), 31.0, 0.14 * amp, 1.0, tangent, binormal);
  disp += gerstner(wp0.xz, vec2(-0.9, -0.4), 18.0, 0.12 * amp, 1.0, tangent, binormal);
  disp += gerstner(wp0.xz, vec2(-0.2, 1.0), 9.0, 0.10 * amp, 1.0, tangent, binormal);
  transformed += disp;
  vCrest = disp.y;
  vGN = normalize(cross(binormal, tangent));`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
  vW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime; uniform float uRain; uniform float uNight; uniform vec3 uSunColor; uniform float uLake; uniform sampler2D tWaterN; uniform vec4 uWakes[${MAX_WAKES}]; uniform float uAmp;
varying vec3 vW; varying float vDepth; varying float vCrest; varying vec3 vGN;
float wFoam; vec3 wN;
float wakeFoam(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < ${MAX_WAKES}; i++) {
    vec4 w = uWakes[i];
    if (w.w <= 0.01) continue;
    vec2 dir = vec2(sin(w.z), cos(w.z));
    vec2 rel = p - w.xy;
    float back = -dot(rel, dir);
    if (back < -3.0) continue;
    float side = abs(dot(rel, vec2(dir.y, -dir.x)));
    float v = smoothstep(2.5, 0.0, abs(side - back * 0.36)) * smoothstep(140.0, 0.0, back) * step(-3.0, back);
    float trail = smoothstep(2.2, 0.0, side) * smoothstep(90.0, 0.0, back) * step(0.0, back);
    f = max(f, (v + trail * 0.8) * w.w);
  }
  return f;
}`,
        )
        .replace(
          '#include <map_fragment>',
          `
  vec2 p = vW.xz;
  vec3 n1 = texture2D(tWaterN, p / 23.0 + vec2(uTime * 0.012, uTime * 0.008)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tWaterN, p / 7.3 - vec2(uTime * 0.02, -uTime * 0.017)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(tWaterN, p / 1.7 + vec2(uTime * 0.11, uTime * 0.07)).xyz * 2.0 - 1.0;
  wN = normalize(vec3(n1.xy * 0.55 + n2.xy * 0.35 + n3.xy * (0.12 + uRain * 0.5), 1.0));
  float d = max(vDepth, 0.0);
  vec3 shallow = mix(vec3(0.07, 0.48, 0.47), vec3(0.06, 0.16, 0.12), uLake);
  vec3 mid = mix(vec3(0.02, 0.24, 0.32), vec3(0.02, 0.08, 0.08), uLake);
  vec3 deep = mix(vec3(0.006, 0.05, 0.1), vec3(0.005, 0.03, 0.04), uLake);
  vec3 wcol = mix(shallow, mid, smoothstep(0.5, 6.0, d));
  wcol = mix(wcol, deep, smoothstep(6.0, 30.0, d));
  float shore = (1.0 - smoothstep(0.0, mix(1.4, 0.25, uLake) + 0.6 * (1.0 - uLake) * sin(p.x * 0.05 + p.y * 0.04 + uTime * 0.9), d)) * mix(1.0, 0.35, uLake);
  float crest = smoothstep(0.35, 0.8, vCrest / max(uAmp, 0.05)) * (n2.x * 0.5 + 0.6);
  wFoam = clamp(shore * (0.6 + 0.4 * n1.x) + crest * 0.35 + wakeFoam(p), 0.0, 1.0);
  diffuseColor.rgb = mix(wcol, vec3(0.92, 0.95, 0.96), wFoam);
  diffuseColor.a = mix(0.55, 0.97, smoothstep(0.0, 3.5, d)) + wFoam * 0.3;
  diffuseColor.a = clamp(diffuseColor.a, 0.0, 1.0);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = mix(0.07 + uRain * 0.06, 0.6, wFoam);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
  {
    // detail normals fade with distance so far water reflects the sky smoothly (no dark aliasing)
    float nfade = 1.0 - smoothstep(40.0, 700.0, distance(vW, cameraPosition));
    vec3 nw = normalize(normalize(vGN) + vec3(-wN.x, 0.0, -wN.y) * (0.1 + 0.32 * nfade));
    if (nw.y < 0.2) nw = normalize(vec3(nw.x, 0.2, nw.z));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
  // subsurface-ish scattering in wave crests toward the viewer
  totalEmissiveRadiance += vec3(0.0, 0.08, 0.07) * smoothstep(0.0, 1.0, vCrest) * clamp(dot(uSunColor, vec3(0.33)), 0.0, 1.0) * 0.5;`,
        );
    };
    mat.customProgramCacheKey = () => 'water-v5-' + ampScale.toFixed(2);
    return mat;
  }

  private makeBoats(): void {
    const hull = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35 });
    const deck = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.4 });
    const sail = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.8, side: THREE.DoubleSide });
    const mk = (kind: number): THREE.Group => {
      const g = new THREE.Group();
      if (kind === 0) {
        // speedboat
        const h = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 7.5), hull);
        h.position.y = 0.3;
        g.add(h);
        const c = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 2.2), glass);
        c.position.set(0, 1.1, 0.5);
        g.add(c);
        const bow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.5, 4), hull);
        bow.rotation.x = Math.PI / 2;
        bow.rotation.y = Math.PI / 4;
        bow.position.set(0, 0.3, 5);
        g.add(bow);
      } else if (kind === 1) {
        // sailboat
        const h = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 10), hull);
        h.position.y = 0.3;
        g.add(h);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 13, 6), deck);
        m.position.set(0, 7.2, 0.5);
        g.add(m);
        const s = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 11), sail);
        s.position.set(0, 7, -1.6);
        s.rotation.y = Math.PI / 2;
        g.add(s);
      } else {
        // ferry
        const h = new THREE.Mesh(new THREE.BoxGeometry(9, 2.5, 34), hull);
        h.position.y = 0.6;
        g.add(h);
        const top = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 20), new THREE.MeshStandardMaterial({ color: 0x2a6fb5, roughness: 0.4 }));
        top.position.y = 3.3;
        g.add(top);
        const w = new THREE.Mesh(new THREE.BoxGeometry(8.1, 1.0, 19), glass);
        w.position.y = 3.6;
        g.add(w);
      }
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
        }
      });
      return g;
    };
    const loops: { pts: [number, number][]; kind: number; speed: number }[] = [
      { pts: [[1250, -800], [1500, -200], [1350, 500], [1250, 100]], kind: 0, speed: 16 },
      { pts: [[1450, -1200], [1800, -600], [1700, 200], [1500, -400]], kind: 1, speed: 5 },
      { pts: [[1320, 800], [1600, 1300], [900, 1500], [600, 1350]], kind: 2, speed: 8 },
      { pts: [[1200, 300], [1400, 600], [1250, 900], [1180, 520]], kind: 0, speed: 13 },
    ];
    for (const l of loops) {
      const path = l.pts.map(([x, z]) => new THREE.Vector2(x, z));
      let len = 0;
      for (let i = 0; i < path.length; i++) len += (path[i] as THREE.Vector2).distanceTo(path[(i + 1) % path.length] as THREE.Vector2);
      const mesh = mk(l.kind);
      this.group.add(mesh);
      this.boats.push({ mesh, path, speed: l.speed, s: (this.boats.length * 0.37 % 1) * len, len, bob: this.boats.length * 1.7 });
    }
  }

  update(dt: number, cam: THREE.Vector3, wind: number, time: number): void {
    const snap = 4;
    this.ocean.position.set(Math.round(cam.x / snap) * snap, SEA_LEVEL, Math.round(cam.z / snap) * snap);
    this.waveAmp.value = 0.35 + wind * 1.1;
    for (let i = 0; i < this.boats.length; i++) {
      const b = this.boats[i];
      if (!b) continue;
      b.s = (b.s + b.speed * dt) % b.len;
      let s = b.s;
      let k = 0;
      const n = b.path.length;
      let a = b.path[0] as THREE.Vector2;
      let c = b.path[1 % n] as THREE.Vector2;
      for (k = 0; k < n; k++) {
        a = b.path[k] as THREE.Vector2;
        c = b.path[(k + 1) % n] as THREE.Vector2;
        const L = a.distanceTo(c);
        if (s <= L) break;
        s -= L;
      }
      const L = a.distanceTo(c) || 1;
      const t = s / L;
      const x = a.x + (c.x - a.x) * t;
      const z = a.y + (c.y - a.y) * t;
      const yaw = Math.atan2(c.x - a.x, c.y - a.y);
      const bob = Math.sin(time * 1.3 + b.bob) * 0.25 * (0.5 + wind);
      b.mesh.position.set(x, SEA_LEVEL - 0.25 + bob, z);
      const cur = b.mesh.rotation.y;
      const dy = wrapAngle(yaw - cur);
      b.mesh.rotation.y = cur + dy * Math.min(1, dt * 0.6);
      b.mesh.rotation.z = Math.sin(time * 0.9 + b.bob) * 0.04 * (0.5 + wind);
      b.mesh.rotation.x = Math.sin(time * 1.1 + b.bob * 2) * 0.03 * (0.5 + wind);
      const w = this.wakes[i];
      if (w) w.set(x, z, b.mesh.rotation.y, Math.min(1, b.speed / 12));
    }
  }

  /** Height of the water surface (without waves) at (x,z), or -Infinity if none. */
  static levelAt(hf: HeightField, x: number, z: number): number {
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 40) return hf.lakeLevel;
    return SEA_LEVEL;
  }
}
