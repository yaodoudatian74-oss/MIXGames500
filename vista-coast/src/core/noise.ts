// Deterministic 2D gradient noise + fBm. Pure functions, used to bake terrain.

const PERM = new Uint8Array(512);
const GRAD_X = new Float32Array(256);
const GRAD_Y = new Float32Array(256);

(function init(): void {
  let s = 1337;
  const rand = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return ((s >>> 8) & 0xffff) / 65536;
  };
  const p: number[] = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i] as number;
    p[i] = p[j] as number;
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255] as number;
  for (let i = 0; i < 256; i++) {
    const a = rand() * Math.PI * 2;
    GRAD_X[i] = Math.cos(a);
    GRAD_Y[i] = Math.sin(a);
  }
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Perlin-style gradient noise, range roughly [-1, 1]. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X = xi & 255;
  const Y = yi & 255;
  const g = (ix: number, iy: number, dx: number, dy: number): number => {
    const h = PERM[(PERM[ix & 255] as number) + (iy & 255)] as number;
    return (GRAD_X[h] as number) * dx + (GRAD_Y[h] as number) * dy;
  };
  const n00 = g(X, Y, xf, yf);
  const n10 = g(X + 1, Y, xf - 1, yf);
  const n01 = g(X, Y + 1, xf, yf - 1);
  const n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
  const u = fade(xf);
  const v = fade(yf);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.414;
}

export function fbm(x: number, y: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal for mountain ridges, range [0,1]. */
export function ridged(x: number, y: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x * freq, y * freq));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    amp *= 0.5;
    freq *= 2.03;
  }
  return Math.min(1, sum);
}
