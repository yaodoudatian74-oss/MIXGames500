// Procedural textures generated at load time (no external image files).
// Albedo, roughness and normal maps for roads, terrain, bark, foliage, water.

import * as THREE from 'three';

// ---------------------------------------------------------------- noise
// Periodic gradient noise: a 256x256 gradient table wrapped with arbitrary
// integer periods, so every texture tiles seamlessly.
const GX = new Float32Array(65536);
const GY = new Float32Array(65536);
(function initGrad(): void {
  let s = 12345;
  for (let i = 0; i < 65536; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const a = (s / 4294967296) * Math.PI * 2;
    GX[i] = Math.cos(a);
    GY[i] = Math.sin(a);
  }
})();

function pnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const ix0 = ((xi % px) + px) % px;
  const iy0 = ((yi % py) + py) % py;
  const ix1 = (ix0 + 1) % px;
  const iy1 = (iy0 + 1) % py;
  const so = (seed * 97) & 255;
  const dot = (ix: number, iy: number, dx: number, dy: number): number => {
    const k = (((iy + so) & 255) << 8) | ((ix + so * 3) & 255);
    return (GX[k] as number) * dx + (GY[k] as number) * dy;
  };
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const d00 = dot(ix0, iy0, xf, yf);
  const d10 = dot(ix1, iy0, xf - 1, yf);
  const d01 = dot(ix0, iy1, xf, yf - 1);
  const d11 = dot(ix1, iy1, xf - 1, yf - 1);
  const a = d00 + (d10 - d00) * u;
  const b = d01 + (d11 - d01) * u;
  return (a + (b - a) * v) * 1.41;
}

/** Tileable noise sampled at integer frequencies fx, fy over the unit square. */
function pn(u: number, v: number, fx: number, fy: number, seed: number, ox = 0, oy = 0): number {
  return pnoise(u * fx + ox, v * fy + oy, fx, fy, seed);
}

/** Tileable fBm starting at integer base frequency. */
function pf(u: number, v: number, base: number, oct: number, seed: number, ox = 0, oy = 0): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = base;
  for (let i = 0; i < oct; i++) {
    sum += amp * pnoise(u * f + ox * (f / base), v * f + oy * (f / base), f, f, seed + i);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

function hashf(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- helpers
export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture | null;
}

function canvas(size: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Build albedo/roughness/normal from per-pixel height + colour functions. */
function buildPbr(
  size: number,
  heightFn: (u: number, v: number) => number,
  colorFn: (u: number, v: number, h: number, out: number[]) => void,
  roughFn: ((u: number, v: number, h: number) => number) | null,
  normalStrength: number,
): PbrSet {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = heightFn(x / size, y / size);
  const albedo = canvas(size);
  const normal = canvas(size);
  const rough = roughFn ? canvas(size) : null;
  const ia = albedo.ctx.createImageData(size, size);
  const inm = normal.ctx.createImageData(size, size);
  const ir = rough ? rough.ctx.createImageData(size, size) : null;
  const col = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = H[i] as number;
      colorFn(x / size, y / size, h, col);
      const o = i * 4;
      ia.data[o] = Math.max(0, Math.min(255, (col[0] as number) * 255));
      ia.data[o + 1] = Math.max(0, Math.min(255, (col[1] as number) * 255));
      ia.data[o + 2] = Math.max(0, Math.min(255, (col[2] as number) * 255));
      ia.data[o + 3] = 255;
      const hl = H[y * size + ((x - 1 + size) % size)] as number;
      const hr = H[y * size + ((x + 1) % size)] as number;
      const hu = H[((y - 1 + size) % size) * size + x] as number;
      const hd = H[((y + 1) % size) * size + x] as number;
      let nx = (hl - hr) * normalStrength;
      let ny = (hu - hd) * normalStrength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      inm.data[o] = (nx * 0.5 + 0.5) * 255;
      inm.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      inm.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      inm.data[o + 3] = 255;
      if (ir && roughFn) {
        const r = Math.max(0, Math.min(1, roughFn(x / size, y / size, h))) * 255;
        // roughness is read from the green channel by three.js
        ir.data[o] = r;
        ir.data[o + 1] = r;
        ir.data[o + 2] = r;
        ir.data[o + 3] = 255;
      }
    }
  }
  albedo.ctx.putImageData(ia, 0, 0);
  normal.ctx.putImageData(inm, 0, 0);
  if (rough && ir) rough.ctx.putImageData(ir, 0, 0);
  return {
    map: toTexture(albedo.c, true),
    normalMap: toTexture(normal.c, false),
    roughnessMap: rough ? toTexture(rough.c, false) : null,
  };
}

// ---------------------------------------------------------------- library
export interface TextureLib {
  asphalt: PbrSet;
  pavers: PbrSet;
  concrete: PbrSet;
  grass: PbrSet;
  dirt: PbrSet;
  sand: PbrSet;
  rock: PbrSet;
  bark: PbrSet;
  grime: THREE.Texture;
  waterNormal: THREE.Texture;
  cloudNoise: THREE.Texture;
  palmLeaf: THREE.Texture;
  broadLeaf: THREE.Texture;
  pineLeaf: THREE.Texture;
  corrugated: PbrSet;
  lightPool: THREE.Texture;
  soft: THREE.Texture;
  skid: THREE.Texture;
  roofTiles: PbrSet;
  wood: PbrSet;
}

export function buildTextures(size: number): TextureLib {
  const S = size;

  const asphalt = buildPbr(
    S,
    (u, v) => {
      const grain = pn(u, v, 64, 64, 3) * 0.35 + pn(u, v, 32, 32, 2) * 0.2;
      const stone = hashf(Math.floor(u * S * 0.5), Math.floor(v * S * 0.5), 3) > 0.86 ? 0.3 : 0;
      return grain + stone;
    },
    (u, v, h, out) => {
      const patch = pf(u, v, 4, 3, 10) * 0.05 + pf(u, v, 16, 3, 11) * 0.03;
      const speck = hashf(Math.floor(u * S), Math.floor(v * S), 7);
      let c = 0.27 + patch + h * 0.035 + (speck > 0.93 ? 0.12 : speck < 0.05 ? -0.05 : 0);
      // tar seams / cracks
      const crack = Math.abs(pn(u, v, 32, 32, 2, 3.1, -1.7));
      if (crack < 0.018) c -= 0.06;
      out[0] = c * 0.98;
      out[1] = c;
      out[2] = c * 1.03;
    },
    (u, v, h) => 0.82 + pn(u, v, 16, 16, 1) * 0.08 - h * 0.05,
    2.4,
  );

  const pavers = buildPbr(
    S,
    (u, v) => {
      const tiles = 4; // 4x4 slabs per texture tile
      const fu = (u * tiles) % 1;
      const fv = (v * tiles) % 1;
      const gr = Math.min(fu, 1 - fu, fv, 1 - fv);
      const groove = gr < 0.02 ? -1 : 0;
      return groove + pn(u, v, 64, 64, 3) * 0.15;
    },
    (u, v, h, out) => {
      const tiles = 4;
      const tx = Math.floor(u * tiles);
      const ty = Math.floor(v * tiles);
      const tone = 0.62 + (hashf(tx, ty, 5) - 0.5) * 0.06 + pf(u, v, 16, 3, 10) * 0.05;
      const c = h < -0.5 ? tone * 0.55 : tone + h * 0.04;
      out[0] = c * 0.99;
      out[1] = c * 0.97;
      out[2] = c * 0.93;
    },
    (u, v, h) => (h < -0.5 ? 0.95 : 0.8 + pn(u, v, 32, 32, 2) * 0.06),
    3,
  );

  const concrete = buildPbr(
    S,
    (u, v) => pn(u, v, 64, 64, 3) * 0.4 + pn(u, v, 32, 32, 2) * 0.25,
    (u, v, h, out) => {
      const stain = pf(u, v, 16, 4, 10, 5, 0);
      // slab expansion joints every quarter tile
      const ju = Math.abs(((u * 4) % 1) - 0.5) > 0.49 || Math.abs(((v * 4) % 1) - 0.5) > 0.49 ? -0.08 : 0;
      const c = 0.47 + stain * 0.09 + h * 0.03 + ju;
      out[0] = c;
      out[1] = c * 0.985;
      out[2] = c * 0.96;
    },
    (u, v) => 0.86 + pn(u, v, 16, 16, 1) * 0.06,
    1.6,
  );

  const grass = buildPbr(
    S,
    (u, v) => pn(u, v, 64, 64, 3) * 0.6 + hashf(Math.floor(u * S), Math.floor(v * S), 2) * 0.5,
    (u, v, h, out) => {
      const big = pf(u, v, 16, 4, 10);
      const dry = Math.max(0, pn(u, v, 8, 8, 4, 2, 0) * 0.8);
      const r = 0.16 + big * 0.04 + dry * 0.18 + h * 0.03;
      const g = 0.27 + big * 0.06 + dry * 0.1 + h * 0.06;
      const b = 0.08 + dry * 0.05;
      out[0] = r;
      out[1] = g;
      out[2] = b;
    },
    (u, v, h) => 0.92 - h * 0.05,
    2.2,
  );

  const dirt = buildPbr(
    S,
    (u, v) => {
      const peb = hashf(Math.floor(u * S * 0.25), Math.floor(v * S * 0.25), 9) > 0.86 ? 0.8 : 0;
      return pn(u, v, 64, 64, 3) * 0.5 + pf(u, v, 32, 2, 20) * 0.4 + peb;
    },
    (u, v, h, out) => {
      const t = pf(u, v, 16, 4, 10);
      const c = 0.36 + t * 0.06 + h * 0.05;
      out[0] = c * 1.0;
      out[1] = c * 0.8;
      out[2] = c * 0.6;
    },
    (u, v, h) => 0.9 - h * 0.04,
    2.6,
  );

  const sand = buildPbr(
    S,
    (u, v) => {
      const ripple = Math.sin((u * 18 + pn(u, v, 16, 16, 1) * 0.8) * Math.PI * 2) * 0.35;
      return ripple + pn(u, v, 64, 64, 3) * 0.3;
    },
    (u, v, h, out) => {
      const t = pf(u, v, 16, 3, 10);
      const speck = hashf(Math.floor(u * S), Math.floor(v * S), 4);
      const c = 0.78 + t * 0.05 + h * 0.03 + (speck > 0.97 ? -0.15 : 0);
      out[0] = c;
      out[1] = c * 0.9;
      out[2] = c * 0.72;
    },
    (u, v) => 0.93 + pn(u, v, 32, 32, 2) * 0.04,
    1.8,
  );

  const rock = buildPbr(
    S,
    (u, v) => {
      const strata = Math.sin((v * 10 + pf(u, v, 16, 3, 10) * 1.5) * Math.PI * 2) * 0.3;
      return pf(u, v, 32, 4, 20) * 0.8 + strata + Math.abs(pn(u, v, 16, 16, 1)) * 0.5;
    },
    (u, v, h, out) => {
      const t = pf(u, v, 16, 3, 10, 9, 0);
      const c = 0.36 + h * 0.08 + t * 0.06;
      out[0] = c * 1.0;
      out[1] = c * 0.95;
      out[2] = c * 0.88;
    },
    (u, v, h) => 0.8 - h * 0.08,
    3.2,
  );

  const bark = buildPbr(
    256,
    (u, v) => {
      const streak = pn(u, v, 32, 4, 2) * 0.9 + pn(u, v, 64, 16, 3) * 0.3;
      return streak;
    },
    (u, v, h, out) => {
      const c = 0.27 + h * 0.08;
      out[0] = c * 1.05;
      out[1] = c * 0.86;
      out[2] = c * 0.68;
    },
    (u, v, h) => 0.9 - h * 0.04,
    4,
  );

  const corrugated = buildPbr(
    256,
    (u, v) => Math.sin(u * Math.PI * 2 * 24) * 0.8 + pn(u, v, 64, 64, 3) * 0.08,
    (u, v, h, out) => {
      const rust = Math.max(0, pf(u, v, 16, 4, 10) - 0.25) * 1.6;
      const c = 0.78 + h * 0.04;
      out[0] = c * (1 - rust * 0.25) + rust * 0.25;
      out[1] = c * (1 - rust * 0.45);
      out[2] = c * (1 - rust * 0.6);
    },
    (u, v) => 0.55 + Math.max(0, pf(u, v, 16, 4, 10)) * 0.4,
    5,
  );

  const roofTiles = buildPbr(
    256,
    (u, v) => {
      const rows = 12;
      const fv = (v * rows) % 1;
      const shift = Math.floor(v * rows) % 2 === 0 ? 0 : 0.5 / 8;
      const fu = ((u + shift) * 8) % 1;
      return fv * 0.8 + (Math.min(fu, 1 - fu) < 0.04 ? -0.4 : 0);
    },
    (u, v, h, out) => {
      const t = hashf(Math.floor(u * 8), Math.floor(v * 12), 8) * 0.12;
      const c = 0.55 + h * 0.1 + t;
      out[0] = c;
      out[1] = c;
      out[2] = c;
    },
    (u, v, h) => 0.75 - h * 0.1,
    4,
  );

  const wood = buildPbr(
    256,
    (u, v) => pn(u, v, 32, 2, 2) * 0.6 + pn(u, v, 64, 8, 3) * 0.2,
    (u, v, h, out) => {
      const c = 0.42 + h * 0.08;
      out[0] = c * 1.1;
      out[1] = c * 0.78;
      out[2] = c * 0.52;
    },
    (u, v, h) => 0.7 - h * 0.05,
    2,
  );

  // grime (grayscale multiplier for facades)
  const grimeC = canvas(256);
  {
    const img = grimeC.ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const u = x / 256;
        const v = y / 256;
        const n = pf(u, v, 16, 5, 10) * 0.5 + 0.5;
        const streak = Math.max(0, pn(u, v, 32, 4, 2)) * 0.4;
        const g = Math.max(0, Math.min(255, (0.8 + n * 0.25 - streak * 0.3) * 255));
        const o = (y * 256 + x) * 4;
        img.data[o] = g;
        img.data[o + 1] = g;
        img.data[o + 2] = g;
        img.data[o + 3] = 255;
      }
    }
    grimeC.ctx.putImageData(img, 0, 0);
  }
  const grime = toTexture(grimeC.c, false);

  // water normal (tileable, two noise layers)
  const water = buildPbr(
    256,
    (u, v) => pf(u, v, 32, 4, 20) * 0.7 + pn(u, v, 64, 64, 3) * 0.2,
    (_u, _v, _h, out) => {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
    },
    null,
    6,
  );

  // cloud noise (tileable fBm in RGB channels at different scales)
  const cloudC = canvas(256);
  {
    const img = cloudC.ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const u = x / 256;
        const v = y / 256;
        const a = pf(u, v, 8, 5, 50) * 0.5 + 0.5;
        const b = pf(u, v, 16, 4, 60) * 0.5 + 0.5;
        const o = (y * 256 + x) * 4;
        img.data[o] = a * 255;
        img.data[o + 1] = b * 255;
        img.data[o + 2] = (1 - Math.abs(pn(u, v, 16, 16, 6))) * 255;
        img.data[o + 3] = 255;
      }
    }
    cloudC.ctx.putImageData(img, 0, 0);
  }
  const cloudNoise = toTexture(cloudC.c, false);

  return {
    asphalt,
    pavers,
    concrete,
    grass,
    dirt,
    sand,
    rock,
    bark,
    grime,
    waterNormal: water.normalMap,
    cloudNoise,
    palmLeaf: palmLeafTexture(),
    broadLeaf: clusterLeafTexture(false),
    pineLeaf: clusterLeafTexture(true),
    corrugated,
    lightPool: radialTexture(128, [
      [0, 'rgba(255,255,255,1)'],
      [0.35, 'rgba(255,255,255,0.45)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    soft: radialTexture(64, [
      [0, 'rgba(255,255,255,1)'],
      [0.5, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    skid: skidTexture(),
    roofTiles,
    wood,
  };
}

function radialTexture(size: number, stops: [number, string][]): THREE.Texture {
  const { c, ctx } = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = toTexture(c, true, false);
  return t;
}

function skidTexture(): THREE.Texture {
  const { c, ctx } = canvas(64);
  const img = ctx.createImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const edge = Math.min(x, 63 - x) / 32;
      const a = Math.min(1, edge * 2.5) * (0.6 + hashf(x, y, 1) * 0.4);
      const o = (y * 64 + x) * 4;
      img.data[o] = 20;
      img.data[o + 1] = 20;
      img.data[o + 2] = 22;
      img.data[o + 3] = a * 200;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, true);
}

function palmLeafTexture(): THREE.Texture {
  // a single frond: central rib with drooping leaflets, on transparent background.
  const S = 512;
  const { c, ctx } = canvas(S);
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 64; i++) {
      const t = i / 64;
      const y = 20 + t * (S - 40);
      const len = Math.sin(Math.PI * Math.min(1, t * 1.15)) * S * 0.46 + 10;
      const shade = 0.75 + hashf(i, pass, 3) * 0.35;
      const r = Math.floor((48 + 40 * t) * shade);
      const g = Math.floor((92 + 30 * (1 - t)) * shade);
      const b = Math.floor(32 * shade);
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.lineWidth = 7 - t * 3;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(S / 2, y);
        const ex = S / 2 + side * len;
        const ey = y + len * 0.55;
        ctx.quadraticCurveTo(S / 2 + side * len * 0.5, y + len * 0.05, ex, ey);
        ctx.stroke();
      }
    }
  }
  ctx.strokeStyle = 'rgb(110,104,60)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(S / 2, 10);
  ctx.lineTo(S / 2, S - 10);
  ctx.stroke();
  const t = toTexture(c, true, false);
  t.premultiplyAlpha = false;
  return t;
}

function clusterLeafTexture(pine: boolean): THREE.Texture {
  const S = 256;
  const { c, ctx } = canvas(S);
  ctx.clearRect(0, 0, S, S);
  const count = pine ? 900 : 420;
  for (let i = 0; i < count; i++) {
    const a = hashf(i, 1, pine ? 5 : 6) * Math.PI * 2;
    const rr = Math.sqrt(hashf(i, 2, 7)) * S * 0.44;
    const x = S / 2 + Math.cos(a) * rr;
    const y = S / 2 + Math.sin(a) * rr * (pine ? 0.95 : 0.85);
    const shade = 0.6 + hashf(i, 3, 8) * 0.5 + (1 - rr / (S * 0.44)) * 0.15;
    if (pine) {
      ctx.strokeStyle = `rgb(${Math.floor(30 * shade)},${Math.floor(62 * shade)},${Math.floor(36 * shade)})`;
      ctx.lineWidth = 2;
      const ang = a + (hashf(i, 4, 9) - 0.5) * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * 14, y + Math.sin(ang) * 14);
      ctx.stroke();
    } else {
      ctx.fillStyle = `rgb(${Math.floor(52 * shade)},${Math.floor(88 * shade)},${Math.floor(34 * shade)})`;
      ctx.beginPath();
      const ang = hashf(i, 4, 10) * Math.PI;
      ctx.ellipse(x, y, 9, 5, ang, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return toTexture(c, true, false);
}

/** Text sign texture (storefronts, billboards). */
export function signTexture(text: string, opts: { bg: string; fg: string; glow?: string; w?: number; h?: number; font?: string }): THREE.CanvasTexture {
  const w = opts.w ?? 1024;
  const h = opts.h ?? 192;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, w, h);
  let size = Math.floor(h * 0.62);
  ctx.font = `700 ${size}px ${opts.font ?? 'Arial, Helvetica, sans-serif'}`;
  while (ctx.measureText(text).width > w * 0.92 && size > 10) {
    size -= 4;
    ctx.font = `700 ${size}px ${opts.font ?? 'Arial, Helvetica, sans-serif'}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (opts.glow) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = h * 0.18;
  }
  ctx.fillStyle = opts.fg;
  ctx.fillText(text, w / 2, h / 2 + h * 0.03);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
