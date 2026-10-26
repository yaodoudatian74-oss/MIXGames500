// Chunked terrain with distance LOD and a splat-mapped PBR material
// (grass / dirt / sand / rock / concrete), world-space UVs with anti-tiling.

import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { fbm } from '../core/noise';
import type { TextureLib } from '../render/textures';
import { U } from '../render/shaderlib';
import { HeightField, HM_RES } from './heightmap';
import { AIRPORT_RECT, PORT, WORLD_HALF, coastDistance, inRect } from './layout';
import { canopyAt } from './worldgen';

/** Forest canopy coverage texture (R8): lets distant hills read as forested beyond tree draw distance. */
export function buildCanopy(hf: HeightField, size = 384): THREE.DataTexture {
  const data = new Uint8Array(size * size);
  const step = (WORLD_HALF * 2) / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -WORLD_HALF + (i + 0.5) * step;
      const z = -WORLD_HALF + (j + 0.5) * step;
      data[j * size + i] = Math.round(clamp(canopyAt(hf, x, z) * 1.1, 0, 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export const CHUNK = 256;
export const CHUNKS_PER_SIDE = Math.ceil((WORLD_HALF * 2) / CHUNK);

/** Build the splat weights texture (R sand, G dirt, B rock, A concrete; grass = rest). */
export function buildSplat(hf: HeightField, size = 512): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const step = (WORLD_HALF * 2) / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -WORLD_HALF + (i + 0.5) * step;
      const z = -WORLD_HALF + (j + 0.5) * step;
      const h = hf.heightAt(x, z);
      const slope = hf.slopeAt(x, z);
      const dc = coastDistance(x, z);
      let sand = 0;
      let dirt = 0;
      let rock = 0;
      let conc = 0;
      const n = fbm(x / 160, z / 160, 3);
      if (x >= PORT.x0 - 10 && z >= PORT.z0 - 15 && z <= PORT.z1 + 10 && x <= PORT.x1 + 2) conc = 1;
      else if (inRect(AIRPORT_RECT, x, z)) {
        dirt = clamp(0.35 + n * 0.6, 0, 0.8);
      } else {
        sand = 1 - smoothstep(110, 160, dc);
        if (h > 4) sand *= 1 - smoothstep(4, 9, h);
        // green coastal hills: bare rock only on cliffs and the highest ridges
        rock = smoothstep(0.95, 1.4, slope) + smoothstep(380, 460, h);
        dirt = clamp(smoothstep(60, 220, h) * (0.25 + n * 0.8) + Math.max(0, n - 0.35) * 1.0, 0, 0.75) * (1 - sand);
        if (h < 0.5) sand = 1;
      }
      rock = clamp(rock, 0, 1);
      const o = (j * size + i) * 4;
      data[o] = Math.round(clamp(sand, 0, 1) * 255);
      data[o + 1] = Math.round(clamp(dirt * (1 - rock), 0, 1) * 255);
      data[o + 2] = Math.round(rock * 255);
      data[o + 3] = Math.round(conc * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function makeTerrainMaterial(tex: TextureLib, splat: THREE.DataTexture, canopy: THREE.DataTexture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  // keep a map so USE_MAP/UV paths are compiled; we override sampling anyway
  mat.map = tex.grass.map;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['tSplat'] = { value: splat };
    shader.uniforms['tCanopy'] = { value: canopy };
    shader.uniforms['tGrass'] = { value: tex.grass.map };
    shader.uniforms['tDirt'] = { value: tex.dirt.map };
    shader.uniforms['tSand'] = { value: tex.sand.map };
    shader.uniforms['tRock'] = { value: tex.rock.map };
    shader.uniforms['tConc'] = { value: tex.concrete.map };
    shader.uniforms['nGrass'] = { value: tex.grass.normalMap };
    shader.uniforms['nDirt'] = { value: tex.dirt.normalMap };
    shader.uniforms['nSand'] = { value: tex.sand.normalMap };
    shader.uniforms['nRock'] = { value: tex.rock.normalMap };
    shader.uniforms['uWorldHalf'] = { value: WORLD_HALF };
    shader.uniforms['uWet'] = U.uWet;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTW; varying vec3 vTN;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
  vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vTN = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tSplat; uniform sampler2D tCanopy; uniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tSand; uniform sampler2D tRock; uniform sampler2D tConc;
uniform sampler2D nGrass; uniform sampler2D nDirt; uniform sampler2D nSand; uniform sampler2D nRock;
uniform float uWorldHalf; uniform float uWet;
varying vec3 vTW; varying vec3 vTN;
vec4 tW; float tGrassW; vec3 tBlendN; float tRough;
vec3 sampleAT(sampler2D t, vec2 p) {
  // two scales to break repetition
  vec3 a = texture2D(t, p / 6.0).rgb;
  vec3 b = texture2D(t, p / 31.0 + 0.37).rgb;
  return mix(a, a * b * 1.8, 0.45);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `
  {
    vec2 suv = (vTW.xz + uWorldHalf) / (2.0 * uWorldHalf);
    tW = texture2D(tSplat, suv);
    // break up splat edges with texture detail
    float jitter = texture2D(tDirt, vTW.xz / 13.0).r - 0.4;
    tW = clamp(tW + vec4(jitter * 0.25) * step(0.02, tW), 0.0, 1.0);
    // steep slopes always rock, computed per pixel from the normal
    float slopeRock = smoothstep(0.6, 0.42, vTN.y);
    tW.b = max(tW.b, slopeRock);
    float sumO = tW.r + tW.g + tW.b + tW.a;
    if (sumO > 1.0) tW /= sumO;
    tGrassW = clamp(1.0 - (tW.r + tW.g + tW.b + tW.a), 0.0, 1.0);
    vec2 p = vTW.xz;
    vec3 rockP = mix(sampleAT(tRock, p), sampleAT(tRock, vec2(p.x, vTW.y) * 1.0), smoothstep(0.85, 0.5, vTN.y));
    vec3 col = sampleAT(tGrass, p) * tGrassW + sampleAT(tDirt, p) * tW.g + sampleAT(tSand, p) * tW.r + rockP * tW.b + sampleAT(tConc, p) * tW.a;
    // forest canopy: near the camera real trees stand there (forest floor is darker);
    // far away the terrain itself takes the canopy colour so hills read as forested
    float canopy = texture2D(tCanopy, suv).r * (1.0 - tW.r) * (1.0 - tW.a) * (1.0 - tW.b * 0.7);
    float farF = smoothstep(110.0, 380.0, distance(vTW, cameraPosition));
    float cv = texture2D(tGrass, p / 41.0).g;
    vec3 canopyCol = mix(vec3(0.075, 0.12, 0.045), vec3(0.13, 0.17, 0.07), cv);
    col = mix(col, col * vec3(0.72, 0.7, 0.6), canopy * (1.0 - farF) * 0.7);
    col = mix(col, canopyCol, canopy * farF * 0.92);
    diffuseColor.rgb *= col;
    // normals (tangent space), blended
    vec3 n = (texture2D(nGrass, p / 6.0).xyz * 2.0 - 1.0) * tGrassW + (texture2D(nDirt, p / 6.0).xyz * 2.0 - 1.0) * tW.g
           + (texture2D(nSand, p / 6.0).xyz * 2.0 - 1.0) * tW.r + (texture2D(nRock, p / 6.0).xyz * 2.0 - 1.0) * tW.b + vec3(0.0, 0.0, 1.0) * tW.a;
    tBlendN = normalize(n);
    tRough = 0.95 * tGrassW + 0.92 * tW.g + 0.88 * tW.r + 0.8 * tW.b + 0.86 * tW.a;
    diffuseColor.rgb *= mix(1.0, 0.62, uWet * (1.0 - tW.r * 0.5));
  }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix(tRough, tRough * 0.55, uWet);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  {
    vec3 T = normalize(vec3(1.0, 0.0, 0.0) - vTN * vTN.x);
    vec3 B = normalize(cross(T, vTN));
    vec3 nw = normalize(T * tBlendN.x * 1.2 - B * tBlendN.y * 1.2 + vTN * tBlendN.z);
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v5';
  return mat;
}

/** Terrain chunk geometry with skirts; triangle split matches HeightField.heightAt. */
export function buildTerrainChunk(hf: HeightField, cx: number, cz: number, segs: number): THREE.BufferGeometry {
  const x0 = -WORLD_HALF + cx * CHUNK;
  const z0 = -WORLD_HALF + cz * CHUNK;
  const n = segs + 1;
  const step = CHUNK / segs;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const H = (x: number, z: number): number => hf.heightAt(Math.min(x, WORLD_HALF), Math.min(z, WORLD_HALF));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const y = H(x, z);
      pos.push(x, y, z);
      const e = Math.max(step, HM_RES);
      const dx = H(x + e, z) - H(x - e, z);
      const dz = H(x, z + e) - H(x, z - e);
      const nx = -dx;
      const nz = -dz;
      const ny = 2 * e;
      const l = Math.hypot(nx, ny, nz);
      nor.push(nx / l, ny / l, nz / l);
      uv.push(i / segs, j / segs);
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * n + i; // (i, j)
      const b = (j + 1) * n + i; // (i, j+1)
      const c = (j + 1) * n + i + 1; // (i+1, j+1)
      const d = j * n + i + 1; // (i+1, j)
      idx.push(a, b, d, b, c, d);
    }
  }
  // skirts along the 4 edges to hide LOD cracks
  const addSkirt = (ids: number[]): void => {
    for (let k = 0; k < ids.length - 1; k++) {
      const ia = ids[k] as number;
      const ib = ids[k + 1] as number;
      const base = pos.length / 3;
      for (const id of [ia, ib]) {
        pos.push(pos[id * 3] as number, (pos[id * 3 + 1] as number) - 4, pos[id * 3 + 2] as number);
        nor.push(nor[id * 3] as number, nor[id * 3 + 1] as number, nor[id * 3 + 2] as number);
        uv.push(uv[id * 2] as number, uv[id * 2 + 1] as number);
      }
      idx.push(ia, base, ib, ib, base, base + 1);
      idx.push(ia, ib, base, ib, base + 1, base);
    }
  };
  const top: number[] = [];
  const bottom: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    top.push(i);
    bottom.push((n - 1) * n + i);
    left.push(i * n);
    right.push(i * n + n - 1);
  }
  addSkirt(top);
  addSkirt(bottom);
  addSkirt(left);
  addSkirt(right);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export class TerrainLOD {
  readonly group = new THREE.Group();
  private chunks: { cx: number; cz: number; mesh: THREE.Mesh | null; lod: number; center: THREE.Vector3 }[] = [];
  private cache = new Map<string, THREE.BufferGeometry>();
  private budget = 2; // chunk rebuilds per frame

  constructor(
    private readonly hf: HeightField,
    private readonly mat: THREE.Material,
    private readonly nearSegs: number,
  ) {
    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        const x = -WORLD_HALF + (cx + 0.5) * CHUNK;
        const z = -WORLD_HALF + (cz + 0.5) * CHUNK;
        this.chunks.push({ cx, cz, mesh: null, lod: -1, center: new THREE.Vector3(x, hf.heightAt(x, z), z) });
      }
    }
  }

  private segsFor(d: number): number {
    if (d < 420) return this.nearSegs;
    if (d < 900) return Math.max(16, this.nearSegs / 2);
    if (d < 1700) return 16;
    return 8;
  }

  /** Update LODs around the camera; builds at most `budget` chunks per call unless `all`. */
  update(cam: THREE.Vector3, all = false): void {
    let built = 0;
    const order = this.chunks
      .map((c) => ({ c, d: Math.hypot(c.center.x - cam.x, c.center.z - cam.z) }))
      .sort((a, b) => a.d - b.d);
    for (const { c, d } of order) {
      const segs = this.segsFor(d);
      if (c.lod === segs) continue;
      if (!all && built >= this.budget) break;
      const key = c.cx + ',' + c.cz + ',' + segs;
      let geo = this.cache.get(key);
      if (!geo) {
        geo = buildTerrainChunk(this.hf, c.cx, c.cz, segs);
        this.cache.set(key, geo);
      }
      if (!c.mesh) {
        c.mesh = new THREE.Mesh(geo, this.mat);
        c.mesh.receiveShadow = true;
        c.mesh.castShadow = false;
        c.mesh.matrixAutoUpdate = false;
        c.mesh.updateMatrix();
        this.group.add(c.mesh);
      } else {
        // drop cached geometry of the old LOD if far (keep memory bounded)
        c.mesh.geometry = geo;
      }
      c.lod = segs;
      built++;
    }
    // evict unused cached geometries (keep current ones)
    if (this.cache.size > this.chunks.length * 2) {
      const live = new Set(this.chunks.map((c) => c.cx + ',' + c.cz + ',' + c.lod));
      for (const [k, g] of this.cache) {
        if (!live.has(k)) {
          g.dispose();
          this.cache.delete(k);
        }
      }
    }
  }
}
