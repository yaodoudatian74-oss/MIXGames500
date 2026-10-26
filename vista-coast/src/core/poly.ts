// Polyline helpers (pure).
import { clamp } from './math';

export interface P2 {
  x: number;
  z: number;
}

export function resamplePolyline(pts: readonly P2[], step: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as P2;
    const b = pts[i + 1] as P2;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const last = pts[pts.length - 1];
  if (last) out.push({ x: last.x, z: last.z });
  return out;
}

/** Catmull-Rom smoothing of a polyline for nicer curves (keeps endpoints). */
export function smoothPolyline(pts: readonly P2[], samplesPerSeg: number): P2[] {
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, z: p.z }));
  const out: P2[] = [];
  const get = (i: number): P2 => pts[clamp(i, 0, pts.length - 1)] as P2;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    for (let k = 0; k < samplesPerSeg; k++) {
      const t = k / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  const last = pts[pts.length - 1] as P2;
  out.push({ x: last.x, z: last.z });
  return out;
}
