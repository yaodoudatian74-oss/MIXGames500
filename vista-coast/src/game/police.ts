// Police AI: patrol response scaled by wanted level, pursuit driving, officers on
// foot, line-of-sight detection, search behaviour and arrests (busted).

import { dist2, yawOf } from '../core/math';
import { Rng } from '../core/rng';
import { vehicleById } from '../data/vehicles';
import type { CollisionWorld } from '../sim/collision';
import type { Ped } from '../sim/peds';
import type { PathPiece, RoadGraph } from '../sim/roadGraph';
import type { WantedSystem } from '../sim/wanted';
import { ChaseDriver } from './ai';
import type { PedManager } from './peds';
import type { Vehicle, VehicleManager } from './vehicles';

const UNITS_BY_LEVEL = [0, 1, 2, 3, 5, 6];

interface Officer {
  ped: Ped;
  car: Vehicle | null;
  arrestT: number;
}

export class PoliceManager {
  readonly cars: Vehicle[] = [];
  readonly officers: Officer[] = [];
  private rng = new Rng(9001);
  private spawnTimer = 0;
  seen = false;
  bustedProgress = 0; // 0..1
  private losTimer = 0;
  onBusted: (() => void) | null = null;

  constructor(
    private readonly graph: RoadGraph,
    private readonly vehicles: VehicleManager,
    private readonly peds: PedManager,
    private readonly world: CollisionWorld,
    private readonly wanted: WantedSystem,
  ) {}

  private spawnCar(px: number, pz: number, pvx: number, pvz: number): void {
    // a lane 150-320 m away, preferably behind the player's direction of travel
    const lanes = this.graph.pieces;
    for (let tries = 0; tries < 30; tries++) {
      const p = lanes[Math.floor(this.rng.next() * lanes.length)] as PathPiece;
      if (p.kind !== 'lane' || p.length < 30) continue;
      const k = Math.floor(p.xs.length / 2);
      const x = p.xs[k] as number;
      const z = p.zs[k] as number;
      const d = Math.hypot(x - px, z - pz);
      if (d < 140 || d > 330) continue;
      const sp = Math.hypot(pvx, pvz);
      if (sp > 5) {
        const ahead = ((x - px) * pvx + (z - pz) * pvz) / (d * sp);
        if (ahead > 0.6 && this.rng.chance(0.6)) continue;
      }
      const yaw = yawOf((p.xs[k + 1] ?? x) - x, (p.zs[k + 1] ?? z) - z);
      const v = this.vehicles.spawnAt('interceptor', undefined, x, z, yaw, 'police');
      v.driver = 'cop';
      v.siren = true;
      v.ai = 'chase';
      v.chase = new ChaseDriver(this.graph);
      v.dynamic = true;
      v.st.vx = Math.sin(yaw) * 12;
      v.st.vz = Math.cos(yaw) * 12;
      this.cars.push(v);
      return;
    }
  }

  update(dt: number, px: number, py: number, pz: number, pvx: number, pvz: number, playerOnFoot: boolean, playerSpeed: number): void {
    const level = this.wanted.level;
    // clean list
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i] as Vehicle;
      if (!this.vehicles.list.includes(c)) this.cars.splice(i, 1);
    }
    // spawn to match the wanted level
    this.spawnTimer -= dt;
    const want = UNITS_BY_LEVEL[level] ?? 0;
    const active = this.cars.filter((c) => c.ai === 'chase' && !c.destroyed).length;
    if (level > 0 && active < want && this.spawnTimer <= 0) {
      this.spawnTimer = 4;
      this.spawnCar(px, pz, pvx, pvz);
    }
    // line of sight check (throttled)
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.3;
      let seen = false;
      for (const c of this.cars) {
        if (c.destroyed || c.ai !== 'chase') continue;
        const d2 = dist2(c.st.x, c.st.z, px, pz);
        if (d2 < 22 * 22) seen = true;
        else if (d2 < 95 * 95 && this.world.lineOfSight(c.st.x, c.st.y + 1.4, c.st.z, px, py + 1.2, pz)) seen = true;
        if (seen) break;
      }
      if (!seen) {
        for (const o of this.officers) {
          if (dist2(o.ped.x, o.ped.z, px, pz) < 45 * 45 && this.world.lineOfSight(o.ped.x, o.ped.y + 1.6, o.ped.z, px, py + 1.2, pz)) {
            seen = true;
            break;
          }
        }
      }
      this.seen = seen && level > 0;
    }
    // drive police cars
    for (const c of this.cars) {
      if (c.destroyed) {
        c.siren = false;
        c.driver = 'none';
        continue;
      }
      if (level === 0) {
        // stand down: switch off siren and leave
        c.siren = false;
        c.ai = 'none';
        c.driver = 'none';
        c.persistent = false;
        c.kind = 'wreck';
        continue;
      }
      if (c.ai !== 'chase' || !c.chase) continue;
      const searching = this.wanted.searching;
      const tx = searching ? this.wanted.lastSeenX : px;
      const tz = searching ? this.wanted.lastSeenZ : pz;
      const los = !searching;
      c.chase.update(c.spec, c.st, dt, c.input, tx, tz, searching ? 0 : pvx, searching ? 0 : pvz, los);
      // officers get out when close to a stopped / on-foot player
      const d2 = dist2(c.st.x, c.st.z, px, pz);
      const carSpeed = Math.hypot(c.st.vx, c.st.vz);
      if (!searching && d2 < 20 * 20 && carSpeed < 2.5 && (playerOnFoot || playerSpeed < 3)) {
        const mine = this.officers.filter((o) => o.car === c).length;
        if (mine === 0) {
          for (let k = 0; k < 2; k++) {
            const side = k === 0 ? 1 : -1;
            const ox = c.st.x + Math.cos(c.st.yaw) * side * 1.6;
            const oz = c.st.z - Math.sin(c.st.yaw) * side * 1.6;
            const ped = this.peds.ejectDriver(ox, oz, px, pz, true);
            ped.mode = 'scripted';
            ped.cop = true;
            ped.variant = this.peds.copVariant();
            this.officers.push({ ped, car: c, arrestT: 0 });
          }
        }
      }
    }
    // officers on foot chase and arrest
    let arresting = false;
    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i] as Officer;
      const p = o.ped;
      if (!this.peds.sys.peds.includes(p)) {
        this.officers.splice(i, 1);
        continue;
      }
      if (level === 0 || dist2(p.x, p.z, px, pz) > 160 * 160) {
        // go back / despawn
        if (dist2(p.x, p.z, px, pz) > 60 * 60 || level === 0) {
          this.peds.sys.remove(p);
          this.officers.splice(i, 1);
        }
        continue;
      }
      if (p.mode === 'down' || p.mode === 'getup') continue;
      p.mode = 'scripted';
      // return to the car if the player drives off
      const d = Math.hypot(px - p.x, pz - p.z);
      if (!playerOnFoot && playerSpeed > 6 && o.car && !o.car.destroyed) {
        const cd = Math.hypot(o.car.st.x - p.x, o.car.st.z - p.z);
        if (cd < 2.5) {
          this.peds.sys.remove(p);
          this.officers.splice(i, 1);
          continue;
        }
        this.seek(p, o.car.st.x, o.car.st.z, 5, dt);
        continue;
      }
      if (d > 1.3) this.seek(p, px, pz, d > 6 ? 5.6 : 3.2, dt);
      else {
        p.vx = 0;
        p.vz = 0;
        p.yaw = yawOf(px - p.x, pz - p.z);
      }
      if (d < 2.0 && (playerOnFoot || playerSpeed < 1)) {
        o.arrestT += dt;
        arresting = true;
      } else o.arrestT = Math.max(0, o.arrestT - dt * 2);
      if (o.arrestT > 2.6) {
        this.onBusted?.();
        o.arrestT = 0;
      }
    }
    this.bustedProgress = arresting ? Math.max(...this.officers.map((o) => o.arrestT / 2.6)) : 0;
  }

  private seek(p: Ped, tx: number, tz: number, speed: number, dt: number): void {
    const dx = tx - p.x;
    const dz = tz - p.z;
    const l = Math.hypot(dx, dz) || 1;
    p.vx = (dx / l) * speed;
    p.vz = (dz / l) * speed;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.yaw = yawOf(dx, dz);
    p.phase += speed * dt * 3.2;
  }

  /** Remove every police unit (after busted/wasted or mission end). */
  clearAll(): void {
    for (const c of this.cars) {
      c.siren = false;
      c.ai = 'none';
      c.driver = 'none';
      c.persistent = false;
      c.kind = 'wreck';
    }
    this.cars.length = 0;
    for (const o of this.officers) this.peds.sys.remove(o.ped);
    this.officers.length = 0;
  }

  isPoliceVehicle(v: Vehicle | null): boolean {
    return !!v && (this.cars.includes(v) || v.spec.id === vehicleById('interceptor').id);
  }
}
