// Player on foot: camera-relative movement, walk/run/sprint/jump, swimming,
// collisions with world and vehicles, falling damage, punching, entering cars.

import { approach, clamp, dist2, wrapAngle, yawOf } from '../core/math';
import type { Input } from '../core/input';
import type { CollisionWorld, Contact } from '../sim/collision';
import { vehicleCircles } from '../sim/vehiclePhysics';
export interface PlayerGround {
  groundAt(x: number, z: number, refY: number): number;
  waterAt(x: number, z: number): number;
}
import { WORLD_HALF } from '../world/layout';
import type { Vehicle } from './vehicles';

export type PlayerMode = 'foot' | 'entering' | 'vehicle' | 'exiting' | 'swim' | 'down' | 'dead';

export class Player {
  x = -1400;
  y = 1.2;
  z = 702;
  yaw = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  px = this.x;
  py = this.y;
  pz = this.z;
  pyaw = 0;
  onGround = true;
  health = 100;
  stamina = 1;
  mode: PlayerMode = 'foot';
  vehicle: Vehicle | null = null;
  transT = 0;
  punchT = 0;
  airT = 0;
  speed = 0;
  sprinting = false;
  downT = 0;
  hurtFlash = 0;
  distWalked = 0;
  lastDamageT = 100;
  private scratch: Contact[] = [];
  /** Set by the game to block movement during dialogs/menus. */
  frozen = false;
  justLanded = 0;
  stepAcc = 0;
  onStep: ((surfaceRun: boolean) => void) | null = null;

  constructor(
    public ground: PlayerGround,
    public world: CollisionWorld,
  ) {}

  teleport(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.y = this.ground.groundAt(x, z, 400);
    this.yaw = yaw;
    this.vx = this.vy = this.vz = 0;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.pyaw = yaw;
  }

  damage(amount: number): void {
    if (this.mode === 'dead') return;
    this.health = Math.max(0, this.health - amount);
    this.hurtFlash = Math.min(1, this.hurtFlash + amount / 40);
    this.lastDamageT = 0;
  }

  knockDown(vx: number, vz: number): void {
    if (this.mode !== 'foot' && this.mode !== 'swim') return;
    this.mode = 'down';
    this.downT = 2.2;
    this.vx = vx * 0.5;
    this.vz = vz * 0.5;
    this.vy = 3;
  }

  /** Foot movement. camYaw = camera heading (forward = (sin, cos)). */
  updateFoot(dt: number, input: Input, camYaw: number, vehicles: readonly Vehicle[]): void {
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.pyaw = this.yaw;
    this.punchT = Math.max(0, this.punchT - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 0.8);
    this.lastDamageT += dt;
    if (this.lastDamageT > 8 && this.health < 100 && this.health > 0) this.health = Math.min(100, this.health + dt * 0.6);
    if (this.mode === 'down') {
      this.downT -= dt;
      this.vx *= 1 - Math.min(1, dt * 3);
      this.vz *= 1 - Math.min(1, dt * 3);
      this.integrate(dt);
      if (this.downT <= 0) this.mode = 'foot';
      return;
    }
    if (this.mode !== 'foot' && this.mode !== 'swim') return;
    const water = this.ground.waterAt(this.x, this.z);
    const g = this.ground.groundAt(this.x, this.z, this.y + 0.5);
    const deep = water - g;
    if (this.mode === 'foot' && deep > 1.35 && this.y < water - 0.9) this.mode = 'swim';
    if (this.mode === 'swim' && deep < 1.15) this.mode = 'foot';

    let mx = this.frozen ? 0 : input.moveX;
    let my = this.frozen ? 0 : input.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    const walkKey = input.isDown('walk');
    this.sprinting = input.isDown('sprint') && mag > 0.3 && this.stamina > 0.05 && this.mode === 'foot';
    let target = 0;
    if (mag > 0.05) {
      if (this.mode === 'swim') target = this.sprinting ? 2.6 : 1.7;
      else if (walkKey || mag < 0.5) target = 1.6 * Math.max(mag, 0.6);
      else target = this.sprinting ? 7.2 : 4.4;
    }
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 0.12);
    else this.stamina = Math.min(1, this.stamina + dt * 0.18);
    // camera relative direction
    let dx = 0;
    let dz = 0;
    if (mag > 0.05) {
      mx /= mag;
      my /= mag;
      const fx = Math.sin(camYaw);
      const fz = Math.cos(camYaw);
      const rx = -Math.cos(camYaw);
      const rz = Math.sin(camYaw);
      dx = fx * my + rx * mx;
      dz = fz * my + rz * mx;
      const want = yawOf(dx, dz);
      this.yaw += wrapAngle(want - this.yaw) * clamp(dt * (this.onGround ? 12 : 4), 0, 1);
    }
    const accel = this.onGround || this.mode === 'swim' ? 14 : 3;
    const tvx = dx * target;
    const tvz = dz * target;
    this.vx = approach(this.vx, tvx, accel * dt);
    this.vz = approach(this.vz, tvz, accel * dt);
    if (this.mode === 'foot' && this.onGround && !this.frozen && input.pressed('jump')) {
      this.vy = 4.9;
      this.onGround = false;
    }
    if (this.mode === 'swim') {
      this.vy = 0;
      this.y = water - 1.25;
    }
    this.integrate(dt);
    // collisions with vehicles (push out; fast cars knock the player down)
    for (const v of vehicles) {
      const st = v.st;
      if (dist2(st.x, st.z, this.x, this.z) > 100) continue;
      if (Math.abs(st.y - this.y) > 2.5) continue;
      const fx = Math.sin(st.yaw);
      const fz = Math.cos(st.yaw);
      for (const c of vehicleCircles(v.spec)) {
        const cx = st.x + fx * c.off;
        const cz = st.z + fz * c.off;
        const ddx = this.x - cx;
        const ddz = this.z - cz;
        const rr = c.r + 0.3;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const nx = ddx / d;
        const nz = ddz / d;
        this.x += nx * (rr - d);
        this.z += nz * (rr - d);
        const rel = (st.vx - this.vx) * nx + (st.vz - this.vz) * nz;
        if (rel > 4.5) {
          this.damage(clamp((rel - 4) * 6, 5, 60));
          this.knockDown(st.vx + nx * 3, st.vz + nz * 3);
        }
      }
    }
    // step sounds
    const sp = Math.hypot(this.vx, this.vz);
    this.speed = sp;
    if (this.onGround && this.mode === 'foot' && sp > 0.5) {
      this.distWalked += sp * dt;
      this.stepAcc += sp * dt;
      const stride = sp > 5 ? 1.6 : sp > 3 ? 1.3 : 0.75;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.onStep?.(sp > 3);
      }
    }
  }

  private integrate(dt: number): void {
    if (this.mode !== 'swim') this.vy -= 19 * dt;
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    // step limit: don't walk up into walls of terrain steeper than ~0.55 m per step
    const gNow = this.ground.groundAt(this.x, this.z, this.y + 0.5);
    const gNext = this.ground.groundAt(nx, nz, this.y + 0.5);
    if (gNext > gNow + 0.55 && gNext > this.y + 0.45) {
      nx = this.x;
      nz = this.z;
      this.vx *= 0.2;
      this.vz *= 0.2;
    }
    this.x = nx;
    this.z = nz;
    this.y += this.vy * dt;
    const p = { x: this.x, z: this.z };
    this.world.resolveCircle(p, 0.32, this.y, 1.75, this.scratch);
    this.x = p.x;
    this.z = p.z;
    const lim = WORLD_HALF - 5;
    this.x = clamp(this.x, -lim, lim);
    this.z = clamp(this.z, -lim, lim);
    const g = this.ground.groundAt(this.x, this.z, this.y + 0.5);
    if (this.mode === 'swim') {
      this.onGround = false;
      return;
    }
    if (this.y <= g) {
      if (!this.onGround) {
        const fall = -this.vy;
        if (fall > 13) this.damage((fall - 13) * 9);
        this.justLanded = 0.25;
      }
      this.y = g;
      this.vy = 0;
      this.onGround = true;
      this.airT = 0;
    } else if (this.y - g < 0.25 && this.vy <= 0) {
      // stick to slopes / stairs going down
      this.y = g;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
      this.airT += dt;
    }
    this.justLanded = Math.max(0, this.justLanded - dt);
  }
}
