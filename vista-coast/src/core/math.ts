// Small pure math helpers shared by simulation and rendering.

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) return 0; // never spin forever on Infinity/NaN
  if (a > Math.PI || a < -Math.PI) a = ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a;
}

export function angleLerp(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Move value toward target by at most maxDelta. */
export function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

/** Exponential smoothing factor independent of frame rate. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(dist2(ax, az, bx, bz));
}

/** Forward vector for a yaw angle. Models face +z when yaw = 0. */
export function fwdX(yaw: number): number {
  return Math.sin(yaw);
}
export function fwdZ(yaw: number): number {
  return Math.cos(yaw);
}
/** Right vector (driver's right hand) for a yaw angle. */
export function rightX(yaw: number): number {
  return -Math.cos(yaw);
}
export function rightZ(yaw: number): number {
  return Math.sin(yaw);
}

/** Yaw that faces along direction (dx, dz). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Distance from point P to segment AB, also returns t in [0,1] via out param. */
export function pointSegDist(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  out?: { t: number },
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  if (out) out.t = t;
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return Math.sqrt(dist2(px, pz, cx, cz));
}

export function formatMoney(n: number): string {
  const s = Math.floor(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-$' : '$') + s;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
