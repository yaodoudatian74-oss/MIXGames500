// Vehicle dynamics: bicycle model with load transfer, saturating tyre forces,
// drivetrain/traction limits, surfaces, slopes, jumps and collision response.

import { approach, clamp, lerp } from '../core/math';
import type { VehicleSpec } from '../data/vehicles';
import type { CollisionWorld, Contact } from './collision';

export interface Ground {
  groundAt(x: number, z: number, refY: number): number;
  /** Friction coefficient of the surface (1 = dry asphalt) and rolling resistance. */
  surface(x: number, z: number, y: number): { mu: number; roll: number; offroad: boolean };
  wetness: number; // 0..1
}

export interface VehicleInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1, + = right
  handbrake: boolean;
}

export interface VehicleState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  yawRate: number; // d(yaw)/dt
  steerAngle: number; // current front wheel angle, + = right
  onGround: boolean;
  airTime: number;
  pitch: number;
  roll: number;
  pitchVel: number;
  rollVel: number;
  suspension: number; // vertical body offset (visual)
  suspVel: number;
  wheelSpin: number;
  rpm: number;
  gear: number;
  slipFront: number;
  slipRear: number;
  wheelslip: number; // longitudinal spin (burnout)
  axPrev: number;
  ayPrev: number;
  damage: number; // 0..1
  engineOn: boolean;
  fuel: number; // litres-ish 0..60
  lastImpact: number; // m/s of last collision this tick
  lastImpactX: number;
  lastImpactZ: number;
  landingImpact: number;
  reversing: boolean;
  // interpolation
  px: number;
  py: number;
  pz: number;
  pyaw: number;
}

export function makeVehicleState(x: number, y: number, z: number, yaw: number): VehicleState {
  return {
    x,
    y,
    z,
    yaw,
    vx: 0,
    vy: 0,
    vz: 0,
    yawRate: 0,
    steerAngle: 0,
    onGround: true,
    airTime: 0,
    pitch: 0,
    roll: 0,
    pitchVel: 0,
    rollVel: 0,
    suspension: 0,
    suspVel: 0,
    wheelSpin: 0,
    rpm: 900,
    gear: 1,
    slipFront: 0,
    slipRear: 0,
    wheelslip: 0,
    axPrev: 0,
    ayPrev: 0,
    damage: 0,
    engineOn: true,
    fuel: 60,
    lastImpact: 0,
    lastImpactX: 0,
    lastImpactZ: 0,
    landingImpact: 0,
    reversing: false,
    px: x,
    py: y,
    pz: z,
    pyaw: yaw,
  };
}

const G = 9.81;
const GEAR_TOPS = [0, 0.18, 0.32, 0.48, 0.64, 0.82, 1.0];

export function speedOf(s: VehicleState): number {
  return Math.hypot(s.vx, s.vz);
}

export function forwardSpeed(s: VehicleState): number {
  return s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
}

/**
 * Advance one vehicle by dt (call at a fixed rate; internally sub-steps).
 */
export function stepVehicle(spec: VehicleSpec, s: VehicleState, inp: VehicleInput, ground: Ground, dt: number): void {
  const sub = 2;
  const h = dt / sub;
  s.lastImpact = 0;
  s.landingImpact = 0;
  for (let i = 0; i < sub; i++) subStep(spec, s, inp, ground, h);
  if (!Number.isFinite(s.x) || !Number.isFinite(s.z) || !Number.isFinite(s.vx) || !Number.isFinite(s.yaw)) {
    // never let NaNs escape: reset to a safe resting state
    s.x = s.px;
    s.y = s.py;
    s.z = s.pz;
    s.yaw = s.pyaw;
    s.vx = s.vy = s.vz = s.yawRate = 0;
  }
}

function subStep(spec: VehicleSpec, s: VehicleState, inp: VehicleInput, ground: Ground, dt: number): void {
  const m = spec.mass;
  const L = spec.wheelbase;
  const a = L * 0.48; // cg -> front axle
  const b = L - a; // cg -> rear axle
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const rx = -fz;
  const rz = fx;
  let vF = s.vx * fx + s.vz * fz;
  let vR = s.vx * rx + s.vz * rz;
  const speed = Math.hypot(vF, vR);
  const omega = -s.yawRate; // right-turn rate

  // --- steering (less lock at speed, smoothed)
  const steerLimit = spec.steerMax / (1 + (speed * speed) / 900);
  const targetSteer = clamp(inp.steer, -1, 1) * steerLimit;
  s.steerAngle = approach(s.steerAngle, targetSteer, 2.6 * dt);
  const delta = s.steerAngle;

  // --- ground probing
  const gC = ground.groundAt(s.x, s.z, s.y + 0.6);
  const gF = ground.groundAt(s.x + fx * a, s.z + fz * a, s.y + 0.6);
  const gB = ground.groundAt(s.x - fx * b, s.z - fz * b, s.y + 0.6);
  const surf = ground.surface(s.x, s.z, s.y);
  const wetMu = 1 - 0.22 * ground.wetness;
  let mu = spec.grip * wetMu * (surf.offroad ? lerp(surf.mu, 1, spec.offroad * 0.75) : surf.mu);
  mu *= 1 - s.damage * 0.25;
  const rollRes = surf.offroad ? lerp(surf.roll, 0.015, spec.offroad) : surf.roll;

  // --- vertical: follow ground, detect jumps
  const groundY = Math.max(gC, (gF + gB) / 2);
  if (s.onGround) {
    const projected = s.y + s.vy * dt;
    if (groundY < projected - 0.35 && speed > 8) {
      s.onGround = false;
      s.airTime = 0;
    } else {
      const newVy = (groundY - s.y) / dt;
      s.vy = clamp(newVy, -15, 15);
      s.y = groundY;
    }
  }
  if (!s.onGround) {
    s.airTime += dt;
    s.vy -= G * dt;
    s.y += s.vy * dt;
    if (s.y <= groundY) {
      s.landingImpact = Math.max(s.landingImpact, -s.vy);
      s.suspVel -= Math.min(6, -s.vy) * 0.6;
      s.y = groundY;
      s.vy = 0;
      s.onGround = true;
    }
  }

  // --- forces
  let Flong = 0;
  let Flat = 0;
  let Mz = 0;
  let slipF = 0;
  let slipR = 0;
  s.wheelslip = 0;
  if (s.onGround) {
    const hcg = spec.cgH;
    let Fzf = (m * G * b) / L - (m * s.axPrev * hcg) / L;
    let Fzr = (m * G * a) / L + (m * s.axPrev * hcg) / L;
    Fzf = Math.max(Fzf, 0.15 * m * G);
    Fzr = Math.max(Fzr, 0.15 * m * G);

    // drive / brake longitudinal force
    let Fdrive = 0;
    let Fbrake = 0;
    const engineOk = s.engineOn && s.fuel > 0 && s.damage < 1;
    const power = spec.powerKW * 1000 * (1 - s.damage * 0.45);
    s.reversing = false;
    if (inp.throttle > 0.01 && engineOk) {
      if (vF > -1.0) {
        const cap = Math.min(spec.maxForce, power / Math.max(Math.abs(vF), 1.5));
        Fdrive = vF < spec.topSpeed ? inp.throttle * cap : 0;
      } else {
        // throttle while rolling backwards = brake
        Fbrake = inp.throttle * m * spec.brakeDecel;
      }
    }
    if (inp.brake > 0.01) {
      if (vF > 0.8) Fbrake = Math.max(Fbrake, inp.brake * m * spec.brakeDecel);
      else if (engineOk && inp.throttle < 0.05) {
        // reverse gear
        s.reversing = true;
        if (vF > -9) Fdrive = -inp.brake * spec.maxForce * 0.55;
      }
    }
    // traction limit on driven wheels
    const muDrive = spec.drive === 'rwd' ? mu * Fzr : spec.drive === 'fwd' ? mu * Fzf : mu * (Fzf + Fzr);
    if (Math.abs(Fdrive) > muDrive) {
      s.wheelslip = (Math.abs(Fdrive) - muDrive) / Math.max(muDrive, 1);
      Fdrive = Math.sign(Fdrive) * muDrive;
    }
    // brake force direction opposes velocity; split 65/35 front/rear
    const brakeSign = vF >= 0 ? -1 : 1;
    const FbF = Math.min(Fbrake * 0.65, mu * Fzf) * brakeSign;
    let FbR = Math.min(Fbrake * 0.35, mu * Fzr) * brakeSign;
    let muRearLat = mu;
    if (inp.handbrake) {
      muRearLat = mu * 0.38;
      FbR = (Math.abs(vF) > 0.5 ? brakeSign : 0) * mu * Fzr * 0.55;
    }

    // front tyre (wheel frame)
    const cd = Math.cos(delta);
    const sd = Math.sin(delta);
    const vfx = vF;
    const vfr = vR + omega * a;
    const wLong = vfx * cd + vfr * sd;
    const wLat = -vfx * sd + vfr * cd;
    const denomF = Math.max(Math.abs(wLong), 2.0);
    const alphaF = Math.atan2(wLat, denomF);
    const C = 7.5;
    let Fyf = -mu * Fzf * Math.tanh((C / Math.max(mu, 0.2)) * alphaF);
    // rear
    const vrr = vR - omega * b;
    const alphaR = Math.atan2(vrr, Math.max(Math.abs(vF), 2.0));
    const FxR = (spec.drive === 'rwd' ? Fdrive : spec.drive === 'awd' ? Fdrive * 0.55 : 0) + FbR;
    const FxF = (spec.drive === 'fwd' ? Fdrive : spec.drive === 'awd' ? Fdrive * 0.45 : 0) + FbF;
    // friction circle: longitudinal use reduces lateral capacity
    const capR = Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.min(1, Math.abs(FxR) / (muRearLat * Fzr + 1)), 2)));
    const capF = Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.min(1, Math.abs(FxF) / (mu * Fzf + 1)), 2)));
    let Fyr = -muRearLat * Fzr * capR * Math.tanh((C / Math.max(muRearLat, 0.2)) * alphaR);
    Fyf *= capF;
    if (spec.shape === 'bike') {
      Fyf *= 1.05;
      Fyr *= 1.05;
    }
    slipF = Math.abs(alphaF);
    slipR = Math.abs(alphaR);

    // body-frame forces (front tyre forces rotated by steer)
    const FfLong = FxF * cd - Fyf * sd;
    const FfLat = FxF * sd + Fyf * cd;
    Flong = FfLong + FxR;
    Flat = FfLat + Fyr;
    Mz = a * FfLat - b * Fyr;

    // resistances
    Flong -= 0.5 * 1.2 * spec.cdA * vF * Math.abs(vF);
    Flong -= rollRes * m * G * clamp(vF * 2, -1, 1);
    Flat -= 0.5 * 1.2 * spec.cdA * 1.5 * vR * Math.abs(vR);
    // slope
    const sinPitch = clamp((gF - gB) / L, -0.6, 0.6);
    Flong -= m * G * sinPitch;
  } else {
    // air: tiny drag only
    Flong -= 0.5 * 1.2 * spec.cdA * vF * Math.abs(vF);
  }

  const ax = Flong / m;
  const ay = Flat / m;
  s.axPrev = lerp(s.axPrev, ax, 0.3);
  s.ayPrev = lerp(s.ayPrev, ay, 0.3);
  // integrate in world frame
  s.vx += (ax * fx + ay * rx) * dt;
  s.vz += (ax * fz + ay * rz) * dt;
  const Iz = (m * (spec.length * spec.length + spec.width * spec.width)) / 12 * 1.15;
  let newOmega = omega + (Mz / Iz) * dt;
  if (!s.onGround) newOmega *= 1 - 0.5 * dt;

  // low-speed kinematic blend for stability
  vF = s.vx * fx + s.vz * fz;
  vR = s.vx * rx + s.vz * rz;
  if (s.onGround && Math.abs(vF) < 5) {
    const t = 1 - Math.abs(vF) / 5;
    const kin = (vF * Math.tan(delta)) / L;
    newOmega = lerp(newOmega, kin, t * 0.85);
    const vRd = vR * (1 - t * 0.6);
    s.vx += (vRd - vR) * rx;
    s.vz += (vRd - vR) * rz;
  }
  newOmega = clamp(newOmega, -4, 4);
  s.yawRate = -newOmega;
  s.yaw -= newOmega * dt;
  if (s.yaw > Math.PI) s.yaw -= Math.PI * 2;
  else if (s.yaw < -Math.PI) s.yaw += Math.PI * 2;

  // static hold: stop creeping when braking at very low speed
  const spd = Math.hypot(s.vx, s.vz);
  if (s.onGround && spd < 0.25 && inp.throttle < 0.02 && (inp.brake < 0.02 || inp.handbrake)) {
    s.vx *= 0.5;
    s.vz *= 0.5;
    if (spd < 0.05) {
      s.vx = 0;
      s.vz = 0;
      s.yawRate *= 0.5;
    }
  }

  s.x += s.vx * dt;
  s.z += s.vz * dt;

  // --- visual body motion (spring-damper)
  const targetPitch = s.onGround ? Math.atan2(gF - gB, L) * -1 + clamp(-s.axPrev * 0.011, -0.07, 0.07) : s.pitch;
  // cars roll toward the outside of a turn, bikes lean in
  const targetRoll = s.onGround ? clamp(s.ayPrev * 0.012, -0.08, 0.08) * (spec.shape === 'bike' ? 6 : -1) : s.roll;
  const k = 90;
  const c = 12;
  s.pitchVel += ((targetPitch - s.pitch) * k - s.pitchVel * c) * dt;
  s.rollVel += ((targetRoll - s.roll) * k - s.rollVel * c) * dt;
  s.pitch += s.pitchVel * dt;
  s.roll += s.rollVel * dt;
  if (spec.shape === 'bike') s.roll = clamp(s.roll, -0.75, 0.75);
  s.suspVel += (-s.suspension * 120 - s.suspVel * 14) * dt;
  s.suspension += s.suspVel * dt;
  s.suspension = clamp(s.suspension, -0.15, 0.1);

  // --- wheels, rpm, gears
  const vFw = s.vx * fx + s.vz * fz;
  s.wheelSpin += ((vFw + s.wheelslip * 6 * Math.sign(inp.throttle - inp.brake)) / spec.wheelR) * dt;
  if (s.wheelSpin > 1000) s.wheelSpin -= Math.PI * 200;
  if (s.wheelSpin < -1000) s.wheelSpin += Math.PI * 200;
  const ratio = Math.abs(vFw) / Math.max(1, spec.topSpeed);
  const gearTop = GEAR_TOPS[s.gear] ?? 1;
  const gearBottom = GEAR_TOPS[s.gear - 1] ?? 0;
  if (ratio > gearTop * 0.97 && s.gear < 6) s.gear++;
  else if (s.gear > 1 && ratio < gearBottom * 0.72) s.gear--;
  const inGear = clamp((ratio - gearBottom * 0.55) / Math.max(0.05, gearTop - gearBottom * 0.55), 0, 1.05);
  const idle = 850;
  const target = s.engineOn ? idle + inGear * (spec.redline - idle) + (inp.throttle > 0.1 && Math.abs(vFw) < 2 ? 1800 * inp.throttle : 0) + s.wheelslip * 1500 : 0;
  s.rpm = lerp(s.rpm, target, clamp(dt * 10, 0, 1));
  s.slipFront = slipF;
  s.slipRear = slipR;

  // fuel
  if (s.engineOn) s.fuel = Math.max(0, s.fuel - (0.0004 + inp.throttle * spec.powerKW * 0.0000035) * dt * 60);
}

/** Collision circles along the vehicle's length (local forward offsets). */
export function vehicleCircles(spec: VehicleSpec): { off: number; r: number }[] {
  const r = spec.width * 0.5;
  const half = spec.length * 0.5 - r;
  if (half <= 0.05) return [{ off: 0, r: spec.length * 0.5 }];
  const n = Math.max(2, Math.ceil((spec.length - spec.width) / spec.width) + 1);
  const out: { off: number; r: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ off: -half + (2 * half * i) / (n - 1), r: r * 0.98 });
  return out;
}

const scratch: Contact[] = [];

/**
 * Resolve a vehicle against the static world. Returns impact speed (m/s).
 * Breakable colliders are reported via onBreak instead of blocking.
 */
export function collideVehicleStatic(
  spec: VehicleSpec,
  s: VehicleState,
  world: CollisionWorld,
  onBreak: (colliderId: number, speed: number) => void,
): number {
  const circles = vehicleCircles(spec);
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  let maxImpact = 0;
  const h = spec.height;
  for (let iter = 0; iter < 2; iter++) {
    for (const c of circles) {
      const cx = s.x + fx * c.off;
      const cz = s.z + fz * c.off;
      const n = world.circleContacts(cx, cz, c.r, s.y + spec.clearance, h, scratch);
      if (n === 0) continue;
      for (const ct of scratch) {
        const col = ct.collider;
        const vn = s.vx * ct.nx + s.vz * ct.nz;
        if (col.kind === 'circle' && col.breakable) {
          if (vn < -2.5 || Math.hypot(s.vx, s.vz) > 6) {
            onBreak(col.id, Math.abs(vn));
            s.vx *= 0.92;
            s.vz *= 0.92;
            continue;
          }
        }
        s.x += ct.nx * ct.depth;
        s.z += ct.nz * ct.depth;
        if (vn < 0) {
          const e = 0.18;
          s.vx -= (1 + e) * vn * ct.nx;
          s.vz -= (1 + e) * vn * ct.nz;
          // tangential scrub
          const tx = -ct.nz;
          const tz = ct.nx;
          const vt = s.vx * tx + s.vz * tz;
          const scrub = Math.min(Math.abs(vt), -vn * 0.35) * Math.sign(vt);
          s.vx -= tx * scrub;
          s.vz -= tz * scrub;
          // spin from off-centre hits
          const lever = c.off;
          const cross = fx * ct.nz - fz * ct.nx;
          s.yawRate += clamp(-vn * lever * cross * 0.18, -2, 2);
          if (-vn > maxImpact) {
            maxImpact = -vn;
            s.lastImpactX = cx - ct.nx * c.r;
            s.lastImpactZ = cz - ct.nz * c.r;
          }
        }
      }
    }
  }
  if (maxImpact > s.lastImpact) s.lastImpact = maxImpact;
  return maxImpact;
}

/** Vehicle-vehicle collision using circle sets and mass-weighted impulses. */
export function collideVehicles(
  sa: VehicleSpec,
  a: VehicleState,
  sb: VehicleSpec,
  b: VehicleState,
): number {
  const ca = vehicleCircles(sa);
  const cb = vehicleCircles(sb);
  const dx0 = a.x - b.x;
  const dz0 = a.z - b.z;
  const reach = (sa.length + sb.length) * 0.5 + 0.5;
  if (dx0 * dx0 + dz0 * dz0 > reach * reach) return 0;
  if (Math.abs(a.y - b.y) > Math.max(sa.height, sb.height) + 0.5) return 0;
  const afx = Math.sin(a.yaw);
  const afz = Math.cos(a.yaw);
  const bfx = Math.sin(b.yaw);
  const bfz = Math.cos(b.yaw);
  let best = 0;
  let nx = 0;
  let nz = 0;
  let depth = 0;
  let px = 0;
  let pz = 0;
  for (const p of ca) {
    const ax = a.x + afx * p.off;
    const az = a.z + afz * p.off;
    for (const q of cb) {
      const bx = b.x + bfx * q.off;
      const bz = b.z + bfz * q.off;
      const dx = ax - bx;
      const dz = az - bz;
      const rr = p.r + q.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-3;
        const pen = rr - d;
        if (pen > depth) {
          depth = pen;
          nx = dx / d;
          nz = dz / d;
          px = (ax + bx) / 2;
          pz = (az + bz) / 2;
        }
      }
    }
  }
  if (depth <= 0) return 0;
  const ma = sa.mass;
  const mb = sb.mass;
  const inv = 1 / (ma + mb);
  a.x += nx * depth * mb * inv;
  a.z += nz * depth * mb * inv;
  b.x -= nx * depth * ma * inv;
  b.z -= nz * depth * ma * inv;
  const rvx = a.vx - b.vx;
  const rvz = a.vz - b.vz;
  const vn = rvx * nx + rvz * nz;
  if (vn < 0) {
    const e = 0.2;
    const j = (-(1 + e) * vn) / (1 / ma + 1 / mb);
    a.vx += (j / ma) * nx;
    a.vz += (j / ma) * nz;
    b.vx -= (j / mb) * nx;
    b.vz -= (j / mb) * nz;
    best = -vn;
    const jitter = ((Math.abs(px * 13.7 + pz * 7.3) % 1) - 0.5) * best * 0.05;
    a.yawRate += clamp(jitter, -1, 1);
    b.yawRate -= clamp(jitter, -1, 1);
    a.lastImpact = Math.max(a.lastImpact, best);
    b.lastImpact = Math.max(b.lastImpact, best);
    a.lastImpactX = px;
    a.lastImpactZ = pz;
    b.lastImpactX = px;
    b.lastImpactZ = pz;
  }
  return best;
}

/** Damage from an impact speed (m/s). Heavier vehicles take less. */
export function impactDamage(spec: VehicleSpec, impact: number): number {
  if (impact < 3) return 0;
  const k = 0.012 * Math.sqrt(1500 / spec.mass);
  return clamp((impact - 3) * k, 0, 0.6);
}
