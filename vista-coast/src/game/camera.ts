// Camera rig: third/first person on foot, chase/in-car cameras for vehicles,
// orbit with mouse/touch/gamepad, zoom, collision with buildings, speed FOV, shake.

import * as THREE from 'three';
import { clamp, damp, lerp, wrapAngle } from '../core/math';
import type { CollisionWorld } from '../sim/collision';
import type { GroundModel } from '../world/ground';

export type CamMode = 'third' | 'first';

export class CameraRig {
  readonly cam: THREE.PerspectiveCamera;
  yaw = 0; // camera forward heading
  pitch = 0.18; // positive looks down
  dist = 4.6;
  vehDist = 1;
  mode: CamMode = 'third';
  private lastLook = 10;
  private shake = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private first = true;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  baseFov = 62;
  interior = false;

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.15, 6500);
  }

  addShake(a: number): void {
    this.shake = Math.min(1.2, this.shake + a);
  }

  toggleMode(): void {
    this.mode = this.mode === 'third' ? 'first' : 'third';
  }

  applyLook(dx: number, dy: number, zoom: number): void {
    if (Math.abs(dx) + Math.abs(dy) > 1e-4) this.lastLook = 0;
    this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, -0.95, 1.2);
    if (zoom !== 0) {
      this.dist = clamp(this.dist * (zoom > 0 ? 1.12 : 0.89), 2.2, 9);
      this.vehDist = clamp(this.vehDist * (zoom > 0 ? 1.1 : 0.91), 0.6, 2.0);
    }
  }

  /** On-foot camera. head = player head position. */
  updateFoot(dt: number, head: THREE.Vector3, playerYaw: number, world: CollisionWorld, ground: GroundModel): void {
    this.lastLook += dt;
    if (this.mode === 'first') {
      this.pos.copy(head).add(this.tmpA.set(Math.sin(playerYaw) * 0.12, 0.02, Math.cos(playerYaw) * 0.12));
      const fx = Math.sin(this.yaw) * Math.cos(this.pitch);
      const fz = Math.cos(this.yaw) * Math.cos(this.pitch);
      const fy = -Math.sin(this.pitch);
      this.look.set(this.pos.x + fx, this.pos.y + fy, this.pos.z + fz);
      this.finish(dt, 70, 0);
      return;
    }
    this.smoothTarget.lerp(head, this.first ? 1 : damp(14, dt));
    this.first = false;
    const t = this.smoothTarget;
    const d = this.interior ? Math.min(this.dist, 3.2) : this.dist;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    // shoulder offset to the right
    const rx = -Math.cos(this.yaw) * 0.45;
    const rz = Math.sin(this.yaw) * 0.45;
    const desired = this.tmpA.set(t.x - Math.sin(this.yaw) * cp * d + rx, t.y + sp * d + 0.25, t.z - Math.cos(this.yaw) * cp * d + rz);
    this.collide(t, desired, world, ground);
    this.pos.copy(desired);
    this.look.set(t.x + rx * 0.9, t.y + 0.1, t.z + rz * 0.9);
    this.finish(dt, this.baseFov, 0);
  }

  /** Vehicle camera. */
  updateVehicle(dt: number, center: THREE.Vector3, vehYaw: number, speed: number, size: number, seat: THREE.Vector3 | null, lookBack: boolean, world: CollisionWorld, ground: GroundModel): void {
    this.lastLook += dt;
    if (this.mode === 'first' && seat) {
      this.pos.copy(seat);
      const yaw = vehYaw + (lookBack ? Math.PI : 0) + clamp(wrapAngle(this.yaw - vehYaw), -1.6, 1.6) * (this.lastLook < 2 ? 1 : 0);
      if (this.lastLook >= 2) this.yaw = lerp(this.yaw, vehYaw, damp(3, dt));
      const pitch = clamp(this.pitch * 0.5, -0.4, 0.5);
      this.look.set(seat.x + Math.sin(yaw) * Math.cos(pitch), seat.y - Math.sin(pitch) - 0.02, seat.z + Math.cos(yaw) * Math.cos(pitch));
      this.finish(dt, 68 + clamp(speed * 0.25, 0, 12), speed);
      return;
    }
    // auto-recentre behind the vehicle after a short delay
    if (this.lastLook > 1.4 && speed > 2) {
      this.yaw += wrapAngle(vehYaw - this.yaw) * damp(2.4, dt);
      this.pitch = lerp(this.pitch, 0.2, damp(1.5, dt));
    }
    const yaw = this.yaw + (lookBack ? Math.PI : 0);
    this.smoothTarget.lerp(center, this.first ? 1 : damp(10, dt));
    this.first = false;
    const t = this.smoothTarget;
    const d = (4.2 + size * 1.25) * this.vehDist + clamp(speed * 0.04, 0, 1.5);
    const h = 1.0 + size * 0.45;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const desired = this.tmpA.set(t.x - Math.sin(yaw) * cp * d, t.y + h + sp * d, t.z - Math.cos(yaw) * cp * d);
    const target = this.tmpB.set(t.x, t.y + h * 0.65, t.z);
    this.collide(target, desired, world, ground);
    this.pos.copy(desired);
    this.look.copy(target);
    this.finish(dt, this.baseFov + clamp((speed - 10) * 0.35, 0, 16), speed);
  }

  private collide(from: THREE.Vector3, to: THREE.Vector3, world: CollisionWorld, ground: GroundModel): void {
    const f = world.raycast(from.x, from.y, from.z, to.x, to.y, to.z, true);
    if (f < 1) {
      const k = Math.max(0.12, f - 0.08);
      to.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k);
    }
    const g = ground.groundAt(to.x, to.z, to.y + 1) + 0.35;
    if (to.y < g) to.y = g;
  }

  private finish(dt: number, fov: number, speed: number): void {
    this.cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.15;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    if (speed > 30) {
      const s = (speed - 30) * 0.0009;
      this.cam.position.y += Math.sin(performance.now() * 0.05) * s;
    }
    this.cam.lookAt(this.look);
    const nf = lerp(this.cam.fov, fov, damp(4, dt));
    if (Math.abs(nf - this.cam.fov) > 0.01) {
      this.cam.fov = nf;
      this.cam.updateProjectionMatrix();
    }
  }

  resetBehind(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0.2;
    this.first = true;
  }
}
