// Vehicle manager: traffic & parked car streaming around the player, physics for
// dynamic vehicles, vehicle-vehicle / vehicle-world collisions, damage, fire,
// explosions, and the visual views (created only near the camera).

import * as THREE from 'three';
import { clamp, dist2 } from '../core/math';
import { Rng, hash1 } from '../core/rng';
import { PARKED_MIX, TRAFFIC_MIX, VEHICLES, pickWeighted, vehicleById, type VehicleSpec } from '../data/vehicles';
import type { CollisionWorld } from '../sim/collision';
import type { PathPiece, RoadGraph } from '../sim/roadGraph';
import type { Obstacle, TrafficAgent, TrafficSystem } from '../sim/traffic';
import {
  collideVehicleStatic,
  collideVehicles,
  impactDamage,
  makeVehicleState,
  stepVehicle,
  type VehicleInput,
  type VehicleState,
} from '../sim/vehiclePhysics';
import { VehicleView, WheelPool, makeSharedVehicleParts, type ViewParams } from '../entities/vehicleView';
import { makeBodyMaterial } from '../entities/vehicleModel';
import type { GroundModel } from '../world/ground';
import { FREEWAY_X, SEA_LEVEL, WORLD_HALF, freewayHalfWidth } from '../world/layout';
import type { ParkingSlot } from '../world/worldgen';
import { ChaseDriver, FleeDriver, PathDriver } from './ai';

export type VKind = 'traffic' | 'parked' | 'player' | 'police' | 'mission' | 'rival' | 'owned' | 'wreck';

export interface Vehicle {
  id: number;
  spec: VehicleSpec;
  color: number;
  kind: VKind;
  st: VehicleState;
  input: VehicleInput;
  agent: TrafficAgent | null;
  view: VehicleView | null;
  tag: string | null;
  ai: 'none' | 'flee' | 'chase' | 'race' | 'boss';
  flee: FleeDriver | null;
  chase: ChaseDriver | null;
  race: PathDriver | null;
  driver: 'none' | 'npc' | 'player' | 'cop';
  siren: boolean;
  lightsOn: boolean;
  blinker: number;
  hazard: boolean;
  horn: number;
  dynamic: boolean;
  parkedSlot: number;
  disabled: boolean;
  destroyed: boolean;
  fire: number; // seconds burning
  stolen: boolean;
  lastHitByPlayer: number; // time stamp
  persistent: boolean;
  calmT: number;
  submerged: number;
  raceProgress: number;
  raceFinished: boolean;
}

export interface VehicleEvents {
  onImpact(v: Vehicle, impact: number, other: Vehicle | null, x: number, z: number): void;
  onExplosion(x: number, y: number, z: number, v: Vehicle): void;
  onBreakLight(lightIndex: number, x: number, z: number): void;
}

interface Density {
  traffic: number;
  parked: number;
}

const tmpObstacles: Obstacle[] = [];

export class VehicleManager {
  readonly list: Vehicle[] = [];
  readonly group = new THREE.Group();
  readonly wheels: WheelPool;
  private nextId = 1;
  private rng = new Rng(808);
  private baseBody = makeBodyMaterial();
  private glassMat: THREE.MeshPhysicalMaterial;
  private shared;
  private parkedBySlot = new Map<number, Vehicle>();
  private laneMids: { piece: PathPiece; x: number; z: number }[] = [];
  private slotGrid = new Map<number, number[]>();
  density: Density = { traffic: 30, parked: 50 };
  viewDist = 380;
  private vp: ViewParams = { alpha: 1, night: 0, braking: false, reversing: false, blinker: 0, hazard: false, siren: false, lightsOn: false, time: 0, wipers: false, steer: 0, detail: true, near: true, shadow: true };
  time = 0;
  playerVehicle: Vehicle | null = null;
  /** street lights breakable mapping: collider id -> light index */
  lightColliders = new Map<number, number>();
  private spawnTimer = 0;
  private headLights: THREE.SpotLight[] = [];
  private sirenLight: THREE.PointLight;
  extraObstacles: Obstacle[] = [];

  constructor(
    readonly graph: RoadGraph,
    private readonly ground: GroundModel,
    private readonly world: CollisionWorld,
    readonly traffic: TrafficSystem,
    private readonly slots: readonly ParkingSlot[],
    lightPool: THREE.Texture,
    private readonly events: VehicleEvents,
  ) {
    this.wheels = new WheelPool(900);
    this.group.add(this.wheels.tire, this.wheels.rim);
    this.glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0e151c, metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.62, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 });
    this.shared = makeSharedVehicleParts(lightPool);
    for (const p of graph.pieces) {
      if (p.kind !== 'lane' || p.length < 20) continue;
      const k = Math.floor(p.xs.length / 2);
      this.laneMids.push({ piece: p, x: p.xs[k] as number, z: p.zs[k] as number });
    }
    slots.forEach((s, i) => {
      const key = Math.floor(s.x / 64) * 1000 + Math.floor(s.z / 64);
      const arr = this.slotGrid.get(key);
      if (arr) arr.push(i);
      else this.slotGrid.set(key, [i]);
    });
    for (let i = 0; i < 2; i++) {
      const sl = new THREE.SpotLight(0xfff1dd, 0, 70, 0.48, 0.55, 1.4);
      sl.castShadow = false;
      this.headLights.push(sl);
      this.group.add(sl, sl.target);
    }
    this.sirenLight = new THREE.PointLight(0xff2020, 0, 30, 2);
    this.group.add(this.sirenLight);
  }

  // ------------------------------------------------------------ creation
  create(spec: VehicleSpec, color: number, x: number, y: number, z: number, yaw: number, kind: VKind): Vehicle {
    const st = makeVehicleState(x, y, z, yaw);
    const v: Vehicle = {
      id: this.nextId++,
      spec,
      color,
      kind,
      st,
      input: { throttle: 0, brake: 0, steer: 0, handbrake: false },
      agent: null,
      view: null,
      tag: null,
      ai: 'none',
      flee: null,
      chase: null,
      race: null,
      driver: 'none',
      siren: false,
      lightsOn: false,
      blinker: 0,
      hazard: false,
      horn: 0,
      dynamic: kind !== 'parked' && kind !== 'traffic',
      parkedSlot: -1,
      disabled: false,
      destroyed: false,
      fire: 0,
      stolen: false,
      lastHitByPlayer: -100,
      persistent: kind === 'player' || kind === 'mission' || kind === 'owned' || kind === 'rival',
      calmT: 0,
      submerged: 0,
      raceProgress: 0,
      raceFinished: false,
    };
    this.list.push(v);
    return v;
  }

  spawnTrafficAgent(spec: VehicleSpec, color: number, piece: PathPiece, s: number, speed: number): Vehicle | null {
    const agent = this.traffic.spawn(spec, color, piece.id, s, speed);
    if (!agent) return null;
    const v = this.create(spec, color, agent.state.x, agent.state.y, agent.state.z, agent.state.yaw, 'traffic');
    v.st = agent.state;
    v.agent = agent;
    v.driver = 'npc';
    v.dynamic = false;
    if (spec.category === 'police' || spec.category === 'ambulance' || spec.category === 'fire') v.siren = false;
    return v;
  }

  remove(v: Vehicle): void {
    if (v.agent) this.traffic.remove(v.agent);
    if (v.view) {
      v.view.dispose();
      v.view = null;
    }
    if (v.parkedSlot >= 0) this.parkedBySlot.delete(v.parkedSlot);
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    if (this.playerVehicle === v) this.playerVehicle = null;
  }

  byTag(tag: string): Vehicle | null {
    return this.list.find((v) => v.tag === tag) ?? null;
  }

  /** Turn a kinematic traffic/parked car into a physics object (after being hit or stolen). */
  makeDynamic(v: Vehicle): void {
    if (v.dynamic) return;
    if (v.agent) {
      v.agent.mode = 'dynamic';
      v.st = v.agent.state;
    }
    if (v.parkedSlot >= 0) {
      this.parkedBySlot.delete(v.parkedSlot);
      v.parkedSlot = -1;
    }
    v.dynamic = true;
    if (v.kind === 'parked') v.kind = 'wreck';
    v.calmT = 0;
  }

  /** Detach the traffic agent completely (car taken by player/police). */
  takeOver(v: Vehicle, kind: VKind): void {
    this.makeDynamic(v);
    if (v.agent) {
      this.traffic.remove(v.agent);
      v.agent = null;
    }
    v.kind = kind;
    v.persistent = kind === 'player' || kind === 'owned' || kind === 'mission' || kind === 'rival';
  }

  // ------------------------------------------------------------ streaming
  private streamTraffic(px: number, pz: number, night: number): void {
    // despawn far kinematic traffic
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i] as Vehicle;
      if (v.persistent || v.kind === 'police') continue;
      const d2 = dist2(v.st.x, v.st.z, px, pz);
      if ((v.kind === 'traffic' && d2 > 470 * 470) || (v.kind === 'parked' && d2 > 230 * 230) || (v.kind === 'wreck' && d2 > 350 * 350)) this.remove(v);
    }
    // time-of-day density: fewer cars late at night
    const tod = 1 - night * 0.55;
    const target = Math.round(this.density.traffic * tod);
    let count = 0;
    for (const v of this.list) if (v.kind === 'traffic') count++;
    let tries = 0;
    while (count < target && tries++ < 6) {
      const cand = this.laneMids[Math.floor(this.rng.next() * this.laneMids.length)];
      if (!cand) break;
      const d = Math.hypot(cand.x - px, cand.z - pz);
      if (d < 130 || d > 400) continue;
      const s = this.rng.range(5, Math.max(6, cand.piece.length - 5));
      if (!this.traffic.canSpawn(cand.piece.id, s, 16)) continue;
      const spec = vehicleById(pickWeighted(TRAFFIC_MIX, this.rng.next()));
      if (cand.piece.speed > 25 && (spec.category === 'bus' || spec.shape === 'bike')) continue;
      const color = spec.colors[Math.floor(this.rng.next() * spec.colors.length)] ?? 0xffffff;
      if (this.spawnTrafficAgent(spec, color, cand.piece, s, cand.piece.speed * 0.7)) count++;
    }
  }

  private streamParked(px: number, pz: number): void {
    const R = 170;
    const cx0 = Math.floor((px - R) / 64);
    const cx1 = Math.floor((px + R) / 64);
    const cz0 = Math.floor((pz - R) / 64);
    const cz1 = Math.floor((pz + R) / 64);
    let spawned = 0;
    for (let cx = cx0; cx <= cx1 && spawned < 12; cx++) {
      for (let cz = cz0; cz <= cz1 && spawned < 12; cz++) {
        const arr = this.slotGrid.get(cx * 1000 + cz);
        if (!arr) continue;
        for (const si of arr) {
          if (this.parkedBySlot.has(si)) continue;
          const s = this.slots[si] as ParkingSlot;
          const d2 = dist2(s.x, s.z, px, pz);
          if (d2 > R * R || d2 < 30 * 30) continue;
          const occ = hash1(si, 4321);
          if (occ > s.p * (this.density.parked / 50)) continue;
          // avoid overlapping a moved vehicle
          let blocked = false;
          for (const v of this.list) if (dist2(v.st.x, v.st.z, s.x, s.z) < 16) blocked = true;
          if (blocked) continue;
          const spec = vehicleById(pickWeighted(PARKED_MIX, hash1(si, 99)));
          const color = spec.colors[Math.floor(hash1(si, 7) * spec.colors.length)] ?? 0xffffff;
          const y = this.ground.groundAt(s.x, s.z, s.y + 1);
          const v = this.create(spec, color, s.x, y, s.z, s.yaw, 'parked');
          v.parkedSlot = si;
          v.dynamic = false;
          this.parkedBySlot.set(si, v);
          spawned++;
          if (spawned >= 12) break;
        }
      }
    }
  }

  // ------------------------------------------------------------ simulation
  update(dt: number, px: number, pz: number, night: number, peds: readonly Obstacle[], playerOnFoot: Obstacle | null): void {
    this.time += dt;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      this.streamTraffic(px, pz, night);
      this.streamParked(px, pz);
    }
    // obstacles for traffic: player, peds, dynamic vehicles
    tmpObstacles.length = 0;
    if (playerOnFoot) tmpObstacles.push(playerOnFoot);
    for (const p of peds) tmpObstacles.push(p);
    for (const o of this.extraObstacles) tmpObstacles.push(o);
    for (const v of this.list) {
      if (!v.dynamic && v.kind !== 'parked') continue;
      if (v.kind === 'parked') continue; // parked cars are outside lanes
      tmpObstacles.push({ x: v.st.x, y: v.st.y, z: v.st.z, r: v.spec.width * 0.6, vx: v.st.vx, vz: v.st.vz, emergency: v.siren });
    }
    this.traffic.update(dt, tmpObstacles, this.ground.wetness);
    // physics for dynamic vehicles
    for (const v of this.list) {
      if (!v.dynamic) continue;
      const st = v.st;
      st.px = st.x;
      st.py = st.y;
      st.pz = st.z;
      st.pyaw = st.yaw;
      if (v.destroyed || (v.driver === 'none' && v.kind !== 'player')) {
        v.input.throttle = 0;
        v.input.brake = v.destroyed ? 0.6 : 0.15;
        v.input.steer = 0;
        v.input.handbrake = true;
      }
      if (v.destroyed) st.engineOn = false;
      stepVehicle(v.spec, st, v.input, this.ground, dt);
      collideVehicleStatic(v.spec, st, this.world, (cid, sp) => {
        const li = this.lightColliders.get(cid);
        const c = this.world.colliders[cid];
        if (c && c.kind === 'circle' && c.breakable && !c.broken) {
          c.broken = true;
          if (li !== undefined) this.events.onBreakLight(li, c.x, c.z);
          void sp;
        }
      });
      if (st.lastImpact > 2) this.handleImpact(v, st.lastImpact, null, st.lastImpactX, st.lastImpactZ);
      if (st.landingImpact > 9) this.handleImpact(v, st.landingImpact * 0.6, null, st.x, st.z);
      // freeway deck walls
      if (this.ground.hf.onDeck(st.x, st.z, st.y)) {
        const lim = freewayHalfWidth() - 0.5 - v.spec.width / 2;
        const dx = st.x - FREEWAY_X;
        if (Math.abs(dx) > lim) {
          st.x = FREEWAY_X + Math.sign(dx) * lim;
          if (Math.sign(st.vx) === Math.sign(dx)) {
            const imp = Math.abs(st.vx);
            st.vx *= -0.2;
            st.vz *= 0.92;
            if (imp > 3) this.handleImpact(v, imp, null, st.x + Math.sign(dx) * v.spec.width / 2, st.z);
          }
        }
      }
      // world bounds
      const lim = WORLD_HALF - 15;
      if (Math.abs(st.x) > lim) {
        st.x = Math.sign(st.x) * lim;
        st.vx = 0;
      }
      if (Math.abs(st.z) > lim) {
        st.z = Math.sign(st.z) * lim;
        st.vz = 0;
      }
      // water
      const wl = this.ground.waterAt(st.x, st.z);
      if (wl > st.y + 0.6) {
        v.submerged += dt;
        st.vx *= 1 - Math.min(1, dt * 1.8);
        st.vz *= 1 - Math.min(1, dt * 1.8);
        if (v.submerged > 2.5) {
          st.engineOn = false;
          st.damage = Math.max(st.damage, 0.9);
        }
      } else v.submerged = Math.max(0, v.submerged - dt);
      // fire & explosion
      if (st.damage >= 1 && !v.destroyed && v.submerged < 1) {
        v.fire += dt;
        if (v.fire > 7) {
          v.destroyed = true;
          v.disabled = true;
          v.view?.setPaint(0x1a1a1a);
          this.events.onExplosion(st.x, st.y + 0.8, st.z, v);
        }
      }
      // traffic dynamic cars try to resume driving when calm
      if (v.agent && v.agent.mode === 'dynamic' && v.driver === 'npc' && !v.destroyed) {
        const spd = Math.hypot(st.vx, st.vz);
        v.calmT = spd < 1 ? v.calmT + dt : 0;
        if (v.calmT > 3 && st.damage < 0.5) {
          if (this.traffic.tryResume(v.agent)) {
            v.dynamic = false;
            v.st = v.agent.state;
            v.calmT = 0;
          }
        }
      }
    }
    this.collidePairs();
    // mission targets: disabled when heavily damaged or stopped by ramming
    for (const v of this.list) {
      if (v.tag && !v.disabled && v.st.damage >= 0.55) v.disabled = true;
      if (v.horn > 0) v.horn -= dt;
    }
  }

  private collidePairs(): void {
    const cell = 10;
    const grid = new Map<number, Vehicle[]>();
    for (const v of this.list) {
      const k = Math.floor(v.st.x / cell) * 73856093 ^ Math.floor(v.st.z / cell) * 19349663;
      const arr = grid.get(k);
      if (arr) arr.push(v);
      else grid.set(k, [v]);
    }
    const seen = new Set<number>();
    for (const v of this.list) {
      if (!v.dynamic) continue;
      const cx = Math.floor(v.st.x / cell);
      const cz = Math.floor(v.st.z / cell);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const arr = grid.get((cx + dx) * 73856093 ^ (cz + dz) * 19349663);
          if (!arr) continue;
          for (const o of arr) {
            if (o === v) continue;
            const key = Math.min(v.id, o.id) * 100000 + Math.max(v.id, o.id);
            if (seen.has(key)) continue;
            seen.add(key);
            // kinematic partner becomes dynamic only if actually touching
            const wasDyn = o.dynamic;
            const sa = v.st;
            const sb = o.st;
            const reach = (v.spec.length + o.spec.length) * 0.5;
            if (dist2(sa.x, sa.z, sb.x, sb.z) > reach * reach) continue;
            if (!wasDyn) {
              // treat as static-ish heavy object: test overlap with a copy first
              const copy = { ...sb };
              const imp0 = collideVehicles(v.spec, sa, o.spec, copy);
              if (imp0 <= 0) continue;
              this.makeDynamic(o);
              o.st.vx = copy.vx;
              o.st.vz = copy.vz;
              o.st.x = copy.x;
              o.st.z = copy.z;
              o.st.yawRate = copy.yawRate;
              if (imp0 > 2) {
                this.handleImpact(v, imp0, o, sa.lastImpactX, sa.lastImpactZ);
                this.handleImpact(o, imp0, v, sa.lastImpactX, sa.lastImpactZ);
              }
              continue;
            }
            const imp = collideVehicles(v.spec, sa, o.spec, sb);
            if (imp > 2) {
              this.handleImpact(v, imp, o, sa.lastImpactX, sa.lastImpactZ);
              this.handleImpact(o, imp, v, sa.lastImpactX, sa.lastImpactZ);
            }
          }
        }
      }
    }
  }

  private handleImpact(v: Vehicle, impact: number, other: Vehicle | null, x: number, z: number): void {
    const dmg = impactDamage(v.spec, impact) * (v.kind === 'police' ? 0.6 : 1);
    v.st.damage = clamp(v.st.damage + dmg, 0, 1);
    if (other && other.kind === 'player') v.lastHitByPlayer = this.time;
    if (v.view && impact > 5) v.view.deform(x, z, Math.min(1.5, impact / 12));
    if (v.agent && v.driver === 'npc' && impact > 4) {
      v.horn = 1.2;
      v.hazard = true;
    }
    this.events.onImpact(v, impact, other, x, z);
  }

  // ------------------------------------------------------------ views
  updateViews(cam: THREE.Vector3, alpha: number, night: number, wet: boolean, raining: boolean): void {
    this.wheels.begin();
    const vd2 = this.viewDist * this.viewDist;
    for (const v of this.list) {
      const d2 = dist2(v.st.x, v.st.z, cam.x, cam.z);
      if (d2 > vd2 * 1.25) {
        if (v.view) {
          v.view.dispose();
          v.view = null;
        }
        continue;
      }
      if (!v.view && d2 < vd2) {
        v.view = new VehicleView(v.spec, v.color, this.baseBody, this.glassMat, this.shared);
        this.group.add(v.view.group);
        if (v.st.damage > 0.3) v.view.deform(v.st.x + v.spec.width / 2, v.st.z, v.st.damage);
        if (v.destroyed) v.view.setPaint(0x1a1a1a);
      }
      if (!v.view) continue;
      const ag = v.agent;
      // one reused params object (no per-vehicle allocation each frame)
      const p = this.vp;
      p.alpha = v.dynamic ? alpha : 1;
      p.night = night;
      p.braking = ag && ag.mode === 'drive' ? ag.braking : v.input.brake > 0.1 && !v.st.reversing;
      p.reversing = v.st.reversing && v.input.brake > 0.1;
      p.blinker = ag && ag.mode === 'drive' ? ag.blinker : v.blinker;
      p.hazard = v.hazard || (ag ? ag.hazard : false);
      p.siren = v.siren;
      p.lightsOn = v.lightsOn || v.kind === 'police' || v.driver !== 'none';
      p.time = this.time + v.id * 0.37;
      p.wipers = (raining || wet) && v.driver !== 'none';
      p.steer = v.st.steerAngle;
      p.detail = d2 < 150 * 150;
      p.near = d2 < 45 * 45 || v.driver === 'player';
      p.shadow = d2 < 80 * 80;
      if (v.kind === 'parked' || (v.driver === 'none' && v.kind !== 'player')) p.lightsOn = false;
      if (v.kind === 'parked') {
        p.braking = false;
        p.night = 0;
      }
      v.view.update(v.st, p, this.wheels);
    }
    this.wheels.end();
    // real headlights for the player's car at night
    const pv = this.playerVehicle;
    const showHL = !!pv && !!pv.view && night > 0.25 && pv.spec.shape !== 'bike';
    for (let i = 0; i < 2; i++) {
      const sl = this.headLights[i] as THREE.SpotLight;
      if (!showHL || !pv || !pv.view) {
        sl.intensity = 0;
        continue;
      }
      const g = pv.view.group;
      const hp = i === 0 ? pv.view.geo.lights.headL : pv.view.geo.lights.headR;
      sl.position.copy(hp).applyMatrix4(g.matrixWorld);
      sl.target.position.set(hp.x, hp.y - 1.6, hp.z + 18).applyMatrix4(g.matrixWorld);
      sl.target.updateMatrixWorld();
      sl.intensity = 140 * night;
    }
    // flashing light for the nearest police car with siren
    let best: Vehicle | null = null;
    let bd = 80 * 80;
    for (const v of this.list) {
      if (!v.siren || !v.view) continue;
      const d2 = dist2(v.st.x, v.st.z, cam.x, cam.z);
      if (d2 < bd) {
        bd = d2;
        best = v;
      }
    }
    if (best && best.view) {
      const ph = Math.floor(this.time * 7) % 2;
      this.sirenLight.color.setHex(ph ? 0xff2020 : 0x2050ff);
      this.sirenLight.intensity = 60 * (0.4 + night);
      this.sirenLight.position.set(best.st.x, best.st.y + best.spec.height + 0.4, best.st.z);
    } else this.sirenLight.intensity = 0;
  }

  nearest(x: number, z: number, maxD: number, filter: (v: Vehicle) => boolean): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = maxD * maxD;
    for (const v of this.list) {
      if (!filter(v)) continue;
      const d2 = dist2(v.st.x, v.st.z, x, z);
      if (d2 < bd) {
        bd = d2;
        best = v;
      }
    }
    return best;
  }

  /** Spawn (or move) a vehicle by spec id at a position, used by missions/garages. */
  spawnAt(specId: string, color: number | undefined, x: number, z: number, yaw: number, kind: VKind): Vehicle {
    const spec = vehicleById(specId);
    const c = color ?? spec.colors[0] ?? 0xffffff;
    // clear the spot of parked/traffic cars
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i] as Vehicle;
      if (!o.persistent && o.kind !== 'police' && dist2(o.st.x, o.st.z, x, z) < 49) this.remove(o);
    }
    const y = this.ground.groundAt(x, z, 60);
    return this.create(spec, c, x, y, z, yaw, kind);
  }

  allSpecs(): VehicleSpec[] {
    return VEHICLES;
  }

  sinkLevel(): number {
    return SEA_LEVEL;
  }
}
