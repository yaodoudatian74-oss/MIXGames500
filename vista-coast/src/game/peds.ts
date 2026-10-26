// Pedestrian manager: streams peds around the player, drives their human models
// (distance-based animation LOD), handles vehicle impacts, punching, dodging,
// overheard conversations and crime witnesses.

import * as THREE from 'three';
import { clamp, dist2 } from '../core/math';
import { Rng } from '../core/rng';
import { CHATTER } from '../data/chatter';
import type { Obstacle } from '../sim/traffic';
import type { Ped, PedMode, PedSystem } from '../sim/peds';
import { vehicleCircles } from '../sim/vehiclePhysics';
import { applyPose, buildHumanGeometry, createHuman, makeHumanMaterial, randomLook, type HumanLook, type HumanRig, type PoseMode, type PoseState } from '../entities/human';
import type { Rect } from '../world/layout';
import type { Vehicle } from './vehicles';

const VARIANTS = 28;

interface PedView {
  rig: HumanRig;
  variant: number;
  pose: PoseState;
  lastPose: number;
}

export interface PedEvents {
  onPedHit(p: Ped, byPlayer: boolean, speed: number): void;
  onSubtitle(speaker: string, text: string): void;
  onReaction(p: Ped, text: string): void;
}

export class PedManager {
  readonly group = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private looks: HumanLook[] = [];
  private copGeo: THREE.BufferGeometry;
  private mat = makeHumanMaterial();
  private views = new Map<number, PedView>();
  private pool: PedView[][] = [];
  private rng = new Rng(616);
  density = 40;
  private spawnTimer = 0;
  private talkShown = new Set<number>();
  private talkQueue: { speaker: string; text: string; t: number }[] = [];
  time = 0;
  readonly obstacles: Obstacle[] = [];
  beachRect: Rect = { x0: 925, z0: -880, x1: 1075, z1: 620 };
  parkRect: Rect | null = null;

  constructor(
    readonly sys: PedSystem,
    private readonly events: PedEvents,
  ) {
    for (let i = 0; i < VARIANTS; i++) {
      const look = randomLook(i + 1);
      // some beach-goers in summer outfits
      if (i % 5 === 0) {
        look.shorts = true;
        look.jacket = false;
      }
      this.looks.push(look);
      this.geos.push(buildHumanGeometry(look));
      this.pool.push([]);
    }
    const cop = randomLook(999);
    cop.uniform = 'police';
    cop.skirt = false;
    cop.shorts = false;
    cop.hat = true;
    this.copGeo = buildHumanGeometry(cop);
    this.looks.push(cop);
    this.geos.push(this.copGeo);
    this.pool.push([]);
  }

  copVariant(): number {
    return VARIANTS;
  }

  private takeView(variant: number): PedView {
    const arr = this.pool[variant] as PedView[];
    const v = arr.pop();
    if (v) {
      this.group.add(v.rig.mesh);
      return v;
    }
    const look = this.looks[variant] as HumanLook;
    const rig = createHuman(this.geos[variant] as THREE.BufferGeometry, this.mat, look.height);
    this.group.add(rig.mesh);
    return { rig, variant, pose: { mode: 'idle', phase: 0, speed: 0, t: 0, time: 0, lean: 0, talk: 0, steer: 0, seed: variant * 1.37 }, lastPose: 0 };
  }

  private releaseView(v: PedView): void {
    v.rig.mesh.removeFromParent();
    (this.pool[v.variant] as PedView[]).push(v);
  }

  private stream(px: number, pz: number, night: number, rain: number): void {
    // despawn far peds
    for (let i = this.sys.peds.length - 1; i >= 0; i--) {
      const p = this.sys.peds[i] as Ped;
      if (p.cop) continue;
      if (dist2(p.x, p.z, px, pz) > 155 * 155) {
        const v = this.views.get(p.id);
        if (v) {
          this.releaseView(v);
          this.views.delete(p.id);
        }
        this.sys.remove(p);
      }
    }
    const target = Math.round(this.density * (1 - night * 0.6) * (1 - rain * 0.5));
    let n = 0;
    for (const p of this.sys.peds) if (!p.cop) n++;
    let tries = 0;
    while (n < target && tries++ < 8) {
      const r = this.rng.next();
      const inBeach = px > this.beachRect.x0 - 200 && px < this.beachRect.x1 + 200 && pz > this.beachRect.z0 - 150 && pz < this.beachRect.z1 + 150;
      if (inBeach && r < 0.35) {
        const rr = this.beachRect;
        const sx = clamp(px + this.rng.range(-140, 140), rr.x0, rr.x1);
        const sz = clamp(pz + this.rng.range(-140, 140), rr.z0, rr.z1);
        if (dist2(sx, sz, px, pz) < 35 * 35) continue;
        const sub: Rect = { x0: Math.max(rr.x0, sx - 25), x1: Math.min(rr.x1, sx + 25), z0: Math.max(rr.z0, sz - 25), z1: Math.min(rr.z1, sz + 25) };
        const p = this.sys.spawnWanderer(sub, Math.floor(this.rng.next() * VARIANTS), this.rng.chance(night > 0.5 ? 0 : 0.3) ? 'lie' : 'wander');
        if (p.mode === 'lie') p.timer = 30;
        n++;
        continue;
      }
      // sidewalk peds on nearby blocks
      // keep the population close to the player (streets feel alive, crimes get witnessed)
      const bi = this.sys.blockIndexAt(px + this.rng.range(-115, 115), pz + this.rng.range(-115, 115));
      if (bi < 0) continue;
      const wb = this.sys.walkBlocks[bi];
      if (!wb) continue;
      const u = this.rng.range(0, wb.perim);
      const pt = { x: 0, z: 0, yaw: 0 };
      this.sys.ringPoint(wb, u, pt);
      const d2 = dist2(pt.x, pt.z, px, pz);
      if (d2 < 30 * 30 || d2 > 120 * 120) continue;
      const p = this.sys.spawnOnBlock(bi, u, Math.floor(this.rng.next() * VARIANTS));
      if (p && rain > 0.4) p.speed *= 1.35;
      n++;
    }
  }

  update(dt: number, px: number, pz: number, night: number, rain: number, vehicles: readonly Vehicle[], playerVehicle: Vehicle | null): void {
    this.time += dt;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.3;
      this.stream(px, pz, night, rain);
    }
    this.sys.update(dt, px, pz);
    // dodge & impacts
    for (const v of vehicles) {
      const st = v.st;
      const sp = Math.hypot(st.vx, st.vz);
      if (sp < 2) continue;
      const fx = Math.sin(st.yaw);
      const fz = Math.cos(st.yaw);
      for (const p of this.sys.peds) {
        if (!p.visible || p.mode === 'down' || p.mode === 'inside') continue;
        const dx = p.x - st.x;
        const dz = p.z - st.z;
        if (dx * dx + dz * dz > 400) continue;
        if (Math.abs(p.y - st.y) > 2.5) continue;
        // dodge cars that come at them fast
        const along = dx * fx + dz * fz;
        const lat = -dx * fz + dz * fx;
        if (along > 0 && along < 14 && Math.abs(lat) < 2.2 && sp > 7 && p.mode !== 'flee' && v === playerVehicle) {
          this.sys.startFlee(p, st.x, st.z);
          if (this.rng.chance(0.3)) this.events.onReaction(p, '危ない！');
        }
        for (const c of vehicleCircles(v.spec)) {
          const cx = st.x + fx * c.off;
          const cz = st.z + fz * c.off;
          const ddx = p.x - cx;
          const ddz = p.z - cz;
          const rr = c.r + 0.28;
          if (ddx * ddx + ddz * ddz < rr * rr) {
            if (sp > 3) {
              this.sys.knockDown(p, st.vx + (ddx / rr) * 2, st.vz + (ddz / rr) * 2);
              this.events.onPedHit(p, v === playerVehicle, sp);
              if (v.agent && v.agent.mode === 'drive') v.agent.speed *= 0.3;
            } else {
              const d = Math.hypot(ddx, ddz) || 1e-3;
              p.x = cx + (ddx / d) * rr;
              p.z = cz + (ddz / d) * rr;
            }
            break;
          }
        }
      }
    }
    // obstacles for traffic
    this.obstacles.length = 0;
    for (const p of this.sys.peds) {
      if (!p.visible || dist2(p.x, p.z, px, pz) > 260 * 260) continue;
      if (p.mode === 'cross' || p.mode === 'waitCross' || p.mode === 'flee' || p.mode === 'down' || p.mode === 'getup') this.obstacles.push({ x: p.x, y: p.y, z: p.z, r: 0.4, vx: p.vx, vz: p.vz, emergency: false });
    }
    // conversations near the player
    for (const p of this.sys.peds) {
      if (p.mode !== 'talk' || this.talkShown.has(p.talkId)) continue;
      if (dist2(p.x, p.z, px, pz) > 7 * 7) continue;
      this.talkShown.add(p.talkId);
      const conv = CHATTER[p.talkId % CHATTER.length];
      if (!conv) continue;
      let t = 0;
      for (const [sp, text] of conv) {
        this.talkQueue.push({ speaker: sp, text, t });
        t += 3.2;
      }
    }
    if (this.talkShown.size > 500) this.talkShown.clear();
    for (const q of this.talkQueue) q.t -= dt;
    while (this.talkQueue.length > 0 && (this.talkQueue[0] as { t: number }).t <= 0) {
      const q = this.talkQueue.shift() as { speaker: string; text: string };
      this.events.onSubtitle(q.speaker, q.text);
    }
  }

  /** Try to punch the ped in front of the player. Returns the ped hit, if any. */
  punch(x: number, z: number, yaw: number): Ped | null {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let best: Ped | null = null;
    let bd = 1.8;
    for (const p of this.sys.peds) {
      if (!p.visible || p.mode === 'down') continue;
      const dx = p.x - x;
      const dz = p.z - z;
      const along = dx * fx + dz * fz;
      const d = Math.hypot(dx, dz);
      if (along > 0.2 && d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) this.sys.knockDown(best, fx * 3, fz * 3);
    return best;
  }

  private modeToPose(m: PedMode, speed: number): PoseMode {
    switch (m) {
      case 'walk':
      case 'cross':
      case 'toDoor':
        return 'walk';
      case 'wander':
        return speed > 0.2 ? 'walk' : 'idle';
      case 'flee':
        return speed > 0.5 ? 'sprint' : 'cower';
      case 'idle':
      case 'waitCross':
        return 'idle';
      case 'talk':
        return 'talk';
      case 'sit':
        return 'sit';
      case 'phone':
        return 'phone';
      case 'down':
        return 'down';
      case 'getup':
        return 'getup';
      case 'lie':
        return 'lie';
      case 'dance':
        return 'dance';
      case 'inside':
        return 'idle';
      case 'scripted':
        return speed > 3 ? 'run' : speed > 0.3 ? 'walk' : 'idle';
    }
  }

  updateViews(dt: number, cam: THREE.Vector3, alpha: number): void {
    const alive = new Set<number>();
    for (const p of this.sys.peds) {
      const d2 = dist2(p.x, p.z, cam.x, cam.z);
      alive.add(p.id);
      let v = this.views.get(p.id);
      if (!p.visible || d2 > 130 * 130) {
        if (v) {
          this.releaseView(v);
          this.views.delete(p.id);
        }
        continue;
      }
      if (!v) {
        v = this.takeView(p.cop ? VARIANTS : p.variant % VARIANTS);
        this.views.set(p.id, v);
      }
      const m = v.rig.mesh;
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      const z = p.pz + (p.z - p.pz) * alpha;
      m.position.set(x, y, z);
      m.rotation.y = p.mode === 'down' ? p.fallYaw + Math.PI : p.yaw;
      m.castShadow = d2 < 60 * 60;
      const sp = Math.hypot(p.vx, p.vz);
      const pose = v.pose;
      const nm = this.modeToPose(p.mode, sp);
      if (nm !== pose.mode) {
        pose.mode = nm;
        pose.t = 0;
      }
      pose.t += dt;
      pose.speed = sp;
      pose.phase = p.phase;
      pose.time = this.time;
      pose.talk = p.mode === 'talk' ? 1 : 0;
      // animation LOD: far peds update less often
      const interval = d2 < 45 * 45 ? 0 : d2 < 90 * 90 ? 0.05 : 0.12;
      v.lastPose -= dt;
      if (v.lastPose <= 0) {
        applyPose(v.rig, pose, dt);
        v.lastPose = interval;
      }
    }
    for (const [id, v] of this.views) {
      if (!alive.has(id)) {
        this.releaseView(v);
        this.views.delete(id);
      }
    }
  }

  /** Make an NPC driver get out of a car (carjack, crash) as a ped. */
  ejectDriver(x: number, z: number, fromX: number, fromZ: number, cop: boolean): Ped {
    const p = this.sys.spawnWanderer({ x0: x - 1, x1: x + 1, z0: z - 1, z1: z + 1 }, Math.floor(this.rng.next() * VARIANTS));
    p.x = x;
    p.z = z;
    p.px = x;
    p.pz = z;
    p.cop = cop;
    p.wanderRect = null;
    this.sys.startFlee(p, fromX, fromZ);
    return p;
  }
}
