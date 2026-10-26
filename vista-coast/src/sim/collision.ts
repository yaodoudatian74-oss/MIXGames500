// Static collision world: axis-aligned boxes and vertical cylinders in a spatial hash.

export interface BoxCollider {
  kind: 'box';
  id: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
  tag: number; // building id or -1
}

export interface CircleCollider {
  kind: 'circle';
  id: number;
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  breakable: boolean;
  broken: boolean;
  tag: number; // index into a prop/light list for breakables
  group: 'tree' | 'light' | 'pillar' | 'prop' | 'signal';
}

export type Collider = BoxCollider | CircleCollider;

export interface Contact {
  nx: number;
  nz: number;
  depth: number;
  collider: Collider;
}

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private grid = new Map<number, number[]>();
  constructor(private readonly cell = 32) {}

  private key(cx: number, cz: number): number {
    return (cx + 4000) * 16384 + (cz + 4000);
  }

  addBox(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tag = -1): BoxCollider {
    const c: BoxCollider = { kind: 'box', id: this.colliders.length, x0, z0, x1, z1, y0, y1, tag };
    this.colliders.push(c);
    this.index(c.id, x0, z0, x1, z1);
    return c;
  }

  addCircle(x: number, z: number, r: number, y0: number, y1: number, group: CircleCollider['group'], breakable = false, tag = -1): CircleCollider {
    const c: CircleCollider = { kind: 'circle', id: this.colliders.length, x, z, r, y0, y1, breakable, broken: false, tag, group };
    this.colliders.push(c);
    this.index(c.id, x - r, z - r, x + r, z + r);
    return c;
  }

  private index(id: number, x0: number, z0: number, x1: number, z1: number): void {
    const c = this.cell;
    for (let cz = Math.floor(z0 / c); cz <= Math.floor(z1 / c); cz++) {
      for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
        const k = this.key(cx, cz);
        const arr = this.grid.get(k);
        if (arr) arr.push(id);
        else this.grid.set(k, [id]);
      }
    }
  }

  private stamp = 0;
  private marks: number[] = [];

  /** Calls fn for each collider whose cell overlaps the query box (deduplicated). */
  query(x0: number, z0: number, x1: number, z1: number, fn: (c: Collider) => void): void {
    const c = this.cell;
    this.stamp++;
    for (let cz = Math.floor(z0 / c); cz <= Math.floor(z1 / c); cz++) {
      for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
        const arr = this.grid.get(this.key(cx, cz));
        if (!arr) continue;
        for (const id of arr) {
          if (this.marks[id] === this.stamp) continue;
          this.marks[id] = this.stamp;
          const col = this.colliders[id];
          if (col) fn(col);
        }
      }
    }
  }

  /**
   * Find the deepest contact for a vertical cylinder (x,z,r) spanning [y, y+h].
   * Returns null when free.
   */
  circleContacts(x: number, z: number, r: number, y: number, h: number, out: Contact[]): number {
    out.length = 0;
    this.query(x - r, z - r, x + r, z + r, (c) => {
      if (c.y1 < y + 0.25 || c.y0 > y + h) return;
      if (c.kind === 'box') {
        const cx = Math.max(c.x0, Math.min(x, c.x1));
        const cz = Math.max(c.z0, Math.min(z, c.z1));
        let dx = x - cx;
        let dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) return;
        if (d2 < 1e-8) {
          // centre inside the box: push out along the shallowest axis
          const left = x - c.x0;
          const right = c.x1 - x;
          const top = z - c.z0;
          const bottom = c.z1 - z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) out.push({ nx: -1, nz: 0, depth: left + r, collider: c });
          else if (m === right) out.push({ nx: 1, nz: 0, depth: right + r, collider: c });
          else if (m === top) out.push({ nx: 0, nz: -1, depth: top + r, collider: c });
          else out.push({ nx: 0, nz: 1, depth: bottom + r, collider: c });
          return;
        }
        const d = Math.sqrt(d2);
        dx /= d;
        dz /= d;
        out.push({ nx: dx, nz: dz, depth: r - d, collider: c });
      } else {
        if (c.broken) return;
        const dx = x - c.x;
        const dz = z - c.z;
        const rr = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr) return;
        const d = Math.sqrt(d2) || 1e-4;
        out.push({ nx: dx / d, nz: dz / d, depth: rr - d, collider: c });
      }
    });
    return out.length;
  }

  /** Push a circle out of everything. Returns the total push applied. */
  resolveCircle(p: { x: number; z: number }, r: number, y: number, h: number, scratch: Contact[]): { px: number; pz: number } {
    let px = 0;
    let pz = 0;
    for (let iter = 0; iter < 3; iter++) {
      const n = this.circleContacts(p.x, p.z, r, y, h, scratch);
      if (n === 0) break;
      for (const c of scratch) {
        if (c.collider.kind === 'circle' && c.collider.breakable) continue;
        p.x += c.nx * c.depth;
        p.z += c.nz * c.depth;
        px += c.nx * c.depth;
        pz += c.nz * c.depth;
      }
    }
    return { px, pz };
  }

  /**
   * Ray march (2D with height) returning the fraction [0,1] of the first hit against
   * boxes, or 1 if clear. Used for camera collision and line of sight.
   */
  raycast(ax: number, ay: number, az: number, bx: number, by: number, bz: number, boxesOnly = true): number {
    let best = 1;
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    const z0 = Math.min(az, bz);
    const z1 = Math.max(az, bz);
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    this.query(x0, z0, x1, z1, (c) => {
      if (c.kind === 'box') {
        // slab test in 3D
        let tmin = 0;
        let tmax = best;
        const slab = (o: number, d: number, lo: number, hi: number): boolean => {
          if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
          let t1 = (lo - o) / d;
          let t2 = (hi - o) / d;
          if (t1 > t2) {
            const t = t1;
            t1 = t2;
            t2 = t;
          }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          return tmin <= tmax;
        };
        if (slab(ax, dx, c.x0, c.x1) && slab(az, dz, c.z0, c.z1) && slab(ay, dy, c.y0, c.y1)) {
          if (tmin < best) best = tmin;
        }
      } else if (!boxesOnly && !c.broken) {
        // circle in 2D
        const fx = ax - c.x;
        const fz = az - c.z;
        const a = dx * dx + dz * dz;
        if (a < 1e-9) return;
        const b = 2 * (fx * dx + fz * dz);
        const cc = fx * fx + fz * fz - c.r * c.r;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) return;
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t >= 0 && t < best) {
          const y = ay + dy * t;
          if (y >= c.y0 && y <= c.y1) best = t;
        }
      }
    });
    return best;
  }

  /** True if line of sight between two points is clear of buildings. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    return this.raycast(ax, ay, az, bx, by, bz, true) >= 0.999;
  }

  /** Highest box top under a point (for standing on low boxes like piers/platforms). */
  topAt(x: number, z: number, maxY: number): number {
    let top = -Infinity;
    this.query(x, z, x, z, (c) => {
      if (c.kind !== 'box') return;
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return;
      if (c.y1 <= maxY && c.y1 > top) top = c.y1;
    });
    return top;
  }
}
