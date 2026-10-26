// Game: owns every subsystem and runs the fixed-timestep simulation (60 Hz) with
// interpolated rendering. Handles player/vehicle interaction, missions, police,
// interiors, shops, saving, achievements, weather/time and the HUD.

import * as THREE from 'three';
import { clamp, dist, dist2, formatMoney, lerp, smoothstep, yawOf } from '../core/math';
import { Input } from '../core/input';
import { Rng } from '../core/rng';
import { ACHIEVEMENTS, AREAS, type AchievementCtx } from '../data/achievements';
import { MISSIONS, type MissionDef, type Pt } from '../data/missions';
import { POIS, poiById } from '../data/pois';
import { DEALER_STOCK, FUEL_PRICE, HOSPITAL_FEE, BUSTED_FINE_PER_STAR, ITEMS, OUTFITS, PAINT_COST, PROPERTIES, REPAIR_COST_PER_PCT, SHOP_STOCK, type ItemId } from '../data/shops';
import { vehicleById } from '../data/vehicles';
import { AudioEngine, type EngineParams } from '../audio/audio';
import { applyPose, buildHumanGeometry, createHuman, makeHumanMaterial, randomLook, type HumanLook, type HumanRig, type PoseState } from '../entities/human';
import { Atmosphere } from '../render/sky';
import { Effects, RainFX } from '../render/effects';
import { PostFX } from '../render/post';
import { U } from '../render/shaderlib';
import { defaultSettings, effectiveQuality, type QualitySettings, type UserSettings } from '../render/quality';
import { GameClock, WEATHER_LABEL, WeatherSystem, type WeatherKind } from '../sim/clock';
import { Economy, newEconomy } from '../sim/economy';
import { MissionRunner, type MissionCtx } from '../sim/missions';
import { PedSystem, type Ped } from '../sim/peds';
import { makeSave, migrateSave, readSave, writeSave, newStats, type SaveData, type Stats } from '../sim/save';
import { TrafficSystem } from '../sim/traffic';
import { forwardSpeed } from '../sim/vehiclePhysics';
import { WantedSystem, type CrimeKind } from '../sim/wanted';
import { HUD, type Blip, type MenuItem } from '../ui/hud';
import { renderMap } from '../ui/mapRender';
import { TouchControls } from '../ui/touch';
import { CITY_Y, LAKE, SIGN_POS, AIRPORT_RECT, TOWN_RECT, PORT, coastDistance, inRect } from '../world/layout';
import type { Door } from '../world/worldgen';
import { lanePathForRoute, lanePathThrough, PathDriver, FleeDriver } from './ai';
import { buildWorld, type WorldBundle } from './build';
import { CameraRig } from './camera';
import { InteriorLibrary, type InteractPoint, type Interior } from './interiors';
import { PedManager } from './peds';
import { Player } from './player';
import { PoliceManager } from './police';
import { VehicleManager, type Vehicle } from './vehicles';

const STEP = 1 / 60;

/** localStorage can be missing or throw in private windows and sandboxed frames. */
function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const k = '__vc_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}
const SETTINGS_KEY = 'vistacoast.settings';

export type GameState = 'loading' | 'title' | 'playing' | 'menu' | 'map' | 'dead';

interface Marker3D {
  mesh: THREE.Mesh;
  x: number;
  z: number;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly input: Input;
  readonly touch: TouchControls;
  readonly hud: HUD;
  readonly audio = new AudioEngine();
  settings: UserSettings;
  q: QualitySettings;
  post!: PostFX;
  atmo!: Atmosphere;
  W!: WorldBundle;
  effects!: Effects;
  rain!: RainFX;
  interiors!: InteriorLibrary;
  clock = new GameClock();
  weather = new WeatherSystem(19);
  wanted = new WantedSystem();
  economy = new Economy(newEconomy());
  missions!: MissionRunner;
  traffic!: TrafficSystem;
  vehicles!: VehicleManager;
  pedSys!: PedSystem;
  peds!: PedManager;
  police!: PoliceManager;
  player!: Player;
  playerRig!: HumanRig;
  playerLook: HumanLook;
  private playerPose: PoseState = { mode: 'idle', phase: 0, speed: 0, t: 0, time: 0, lean: 0, talk: 0, steer: 0, seed: 0.5 };
  private humanMat = makeHumanMaterial();
  stats: Stats = newStats();
  achievements = new Set<string>();
  collected = new Set<number>();
  state: GameState = 'loading';
  private acc = 0;
  private lastT = 0;
  private simTime = 0;
  private frameTimes: number[] = [];
  private autoQualityDone = false;
  private dynScale = 1;
  private dynCheckT = 0;
  private interior: Interior | null = null;
  private interiorDoor: Door | null = null;
  waypoint: Pt | null = null;
  private gps: Pt[] | null = null;
  private gpsTimer = 0;
  private gpsTarget: Pt | null = null;
  private markerGroup = new THREE.Group();
  private missionMarkers: Marker3D[] = [];
  private objMarker: THREE.Mesh;
  private cpRing: THREE.Mesh;
  private arrow: THREE.Mesh;
  private postcardMeshes: THREE.Mesh[] = [];
  private raceRivals: Vehicle[] = [];
  private raceCps: Pt[] = [];
  private rng = new Rng(2026);
  private achTimer = 0;
  private areaTimer = 0;
  private deadTimer = 0;
  private deadKind: 'wasted' | 'busted' = 'wasted';
  private lastVehicle: Vehicle | null = null;
  private engineParams: EngineParams[] = [];
  private crashCooldown = 0;
  private interiorGround = { groundAt: (): number => 0, waterAt: (): number => -Infinity };
  private hornCooldown = 0;
  private talkBabble = 0;
  private lightsPL: THREE.PointLight[] = [];
  private tmpV = new THREE.Vector3();
  private sunTmp = new THREE.Vector3();
  private seatTmp = new THREE.Vector3();
  private headTmp = new THREE.Vector3();
  private neonMats: THREE.MeshStandardMaterial[] | null = null;
  private nightTint = new THREE.Vector3(0.92, 0.97, 1.08);
  private dancing = false;
  private serviceSpawned = false;
  private savedDuringSession = false;
  onFirstFrame: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.settings = this.loadSettings();
    this.q = effectiveQuality(this.settings);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.maxDpr) * this.q.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.q.shadowMap > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // stats cover the whole frame (shadow + scene + post passes); reset manually per frame
    this.renderer.info.autoReset = false;
    this.rig = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight));
    this.rig.cam.far = Math.max(2500, this.q.viewDistance * 2.6);
    this.rig.cam.updateProjectionMatrix();
    this.input = new Input(canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    this.touch = new TouchControls(this.input);
    this.hud = new HUD();
    this.playerLook = randomLook(7);
    this.playerLook.female = false;
    this.playerLook.hairStyle = 0;
    this.playerLook.beard = false;
    this.playerLook.skirt = false;
    this.playerLook.height = 1.02;
    const mk = (geo: THREE.BufferGeometry, color: number, opacity: number): THREE.Mesh =>
      new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.objMarker = mk(new THREE.CylinderGeometry(1, 1, 1, 32, 1, true), 0xf2b705, 0.35);
    this.cpRing = mk(new THREE.TorusGeometry(6, 0.45, 8, 40), 0xf2b705, 0.6);
    this.arrow = mk(new THREE.ConeGeometry(0.7, 1.6, 4), 0xf2b705, 0.9);
    this.arrow.rotation.x = Math.PI;
    this.markerGroup.add(this.objMarker, this.cpRing, this.arrow);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.openPause();
        this.audio.suspend();
      } else if (this.state !== 'title') this.audio.resume();
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fatal('グラフィックスの初期化がリセットされました（WebGLコンテキスト消失）。ページを再読み込みしてください。');
    });
  }

  // ------------------------------------------------------------ settings
  private loadSettings(): UserSettings {
    const d = defaultSettings();
    try {
      const raw = safeStorage()?.getItem(SETTINGS_KEY);
      if (raw) return { ...d, ...(JSON.parse(raw) as Partial<UserSettings>) };
    } catch {
      /* ignore */
    }
    return d;
  }

  saveSettings(): void {
    try {
      safeStorage()?.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  fatal(msg: string): void {
    const e = document.getElementById('err');
    if (e) {
      e.style.display = 'block';
      e.textContent = msg;
    }
  }

  // ------------------------------------------------------------ init
  async init(progress: (p: number, msg: string) => void): Promise<void> {
    this.W = await buildWorld(this.q, progress);
    const W = this.W;
    this.scene.add(W.root);
    this.atmo = new Atmosphere(this.renderer, this.scene, W.tex.cloudNoise, this.q.shadowMap);
    this.atmo.setShadowExtent(this.q.shadowExtent);
    this.post = new PostFX(this.renderer, this.scene, this.rig.cam, this.q);
    this.effects = new Effects(W.tex.soft, W.tex.skid);
    this.scene.add(this.effects.group);
    this.rain = new RainFX(this.q.tier === 'low' ? 2500 : this.q.tier === 'medium' ? 5000 : 9000);
    this.scene.add(this.rain.mesh, this.rain.splashes);
    this.interiors = new InteriorLibrary(this.scene, W.tex);
    // simulation systems
    this.traffic = new TrafficSystem(W.graph);
    this.vehicles = new VehicleManager(W.graph, W.ground, W.world, this.traffic, W.wd.parking, W.tex.lightPool, {
      onImpact: (v, impact, other, x, z) => this.onVehicleImpact(v, impact, other, x, z),
      onExplosion: (x, y, z, v) => this.onExplosion(x, y, z, v),
      onBreakLight: (li, x, z) => {
        W.props.breakLight(li, Math.random() * 6.28);
        this.effects.sparks(x, CITY_Y + 1, z, 12);
        this.audio.crash(6, x, CITY_Y + 1, z);
      },
    });
    this.vehicles.lightColliders = W.lightColliderToIndex;
    this.vehicles.density = { traffic: this.q.traffic, parked: this.q.parked };
    this.vehicles.viewDist = Math.min(420, this.q.viewDistance * 0.35);
    this.scene.add(this.vehicles.group);
    const benches = W.wd.props.filter((p) => p.kind === 'bench');
    this.pedSys = new PedSystem(W.ground, W.graph, W.world, W.wd.blocks, W.wd.doors, benches);
    this.peds = new PedManager(this.pedSys, {
      onPedHit: (p, byPlayer, sp) => this.onPedHit(p, byPlayer, sp),
      onSubtitle: (sp, text) => {
        if (this.settings.subtitles && !this.missions.dialog) {
          this.hud.subtitle(sp, text, 3.1);
          this.audio.babble(Math.min(2.5, text.length * 0.07), 140 + this.rng.range(0, 90));
        }
      },
      onReaction: () => undefined,
    });
    this.peds.density = this.q.peds;
    const park = W.wd.blocks.find((b) => b.poi?.kind === 'park');
    if (park) this.peds.parkRect = park.inner;
    this.scene.add(this.peds.group);
    this.pedSys.onReport = (x, z, sev) => {
      const before = this.wanted.level;
      this.wanted.report(sev, x, z, false);
      if (this.wanted.level > before) this.hud.notify('目撃者が通報した！ 手配度 ★' + this.wanted.level);
    };
    this.police = new PoliceManager(W.graph, this.vehicles, this.peds, W.world, this.wanted);
    this.police.onBusted = () => this.die('busted');
    this.player = new Player(W.ground, W.world);
    this.player.onStep = (run) => {
      const kind = this.interior ? 'concrete' : W.ground.surfaceKind(this.player.x, this.player.z, this.player.y);
      this.audio.footstep(kind, run);
    };
    this.playerRig = createHuman(buildHumanGeometry(this.playerLook), this.humanMat, this.playerLook.height);
    this.scene.add(this.playerRig.mesh);
    this.missions = new MissionRunner(this.makeMissionCtx());
    this.scene.add(this.markerGroup);
    // postcards
    const pcMat = new THREE.MeshStandardMaterial({ color: 0xff70a6, emissive: new THREE.Color(1, 0.3, 0.6), emissiveIntensity: 1.5, roughness: 0.3 });
    W.wd.collectibles.forEach((c) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.05), pcMat);
      m.position.set(c.x, c.y, c.z);
      this.scene.add(m);
      this.postcardMeshes.push(m);
    });
    // a few real point lights reused near the player at night
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 26, 1.8);
      this.scene.add(l);
      this.lightsPL.push(l);
    }
    // map
    const map = renderMap(W.hf, W.graph, W.wd);
    this.hud.mapImage = map;
    this.hud.mapView.image = map;
    this.hud.mapView.onWaypoint = (x, z) => {
      this.waypoint = { x, z };
      this.gpsTimer = 0;
      this.hud.notify('目的地を設定しました');
      this.refreshMapBlips();
    };
    this.hud.mapView.onClose = () => this.closeMap();
    this.touch.setEnabled('ontouchstart' in window || navigator.maxTouchPoints > 0);
    this.resize();
    this.applyAudioSettings();
    progress(1, '完了');
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.maxDpr) * this.q.pixelRatio * this.dynScale);
    this.renderer.setSize(w, h, false);
    this.rig.cam.aspect = w / Math.max(1, h);
    this.rig.cam.updateProjectionMatrix();
    this.post?.resize();
    if (this.hud.mapView.open) this.hud.mapView.resize();
  }

  private applyAudioSettings(): void {
    this.audio.setVolume(this.settings.volume, this.settings.music);
    this.clock.minutesPerSecond = this.settings.timeScale;
  }

  // ------------------------------------------------------------ new / load
  hasSave(): boolean {
    const st = safeStorage();
    return st ? readSave(st) !== null : false;
  }

  newGame(): void {
    this.applySave(makeSave(), true);
    this.missions.start('m1');
  }

  continueGame(): boolean {
    const st = safeStorage();
    const s = st ? readSave(st) : null;
    if (!s) return false;
    this.applySave(s, false);
    return true;
  }

  private applySave(s: SaveData, fresh: boolean): void {
    this.economy = new Economy(s.economy);
    this.missions.completed = new Set(s.missions.completed);
    this.missions.completions = { ...s.missions.completions };
    this.missions.stats = { ...s.missions.stats };
    this.collected = new Set(s.collectibles);
    this.achievements = new Set(s.achievements);
    this.stats = s.stats;
    this.clock.hours = s.clock;
    this.weather.set((Object.keys(WEATHER_LABEL).includes(s.weather) ? s.weather : 'clear') as WeatherKind, true);
    this.player.teleport(s.player.x, s.player.z, s.player.yaw);
    this.player.health = s.player.health;
    this.rig.resetBehind(s.player.yaw);
    this.applyOutfit();
    for (let i = 0; i < this.postcardMeshes.length; i++) (this.postcardMeshes[i] as THREE.Mesh).visible = !this.collected.has(i);
    this.W.terrain.update(new THREE.Vector3(s.player.x, 0, s.player.z), true);
    if (s.lastVehicle) {
      const v = this.vehicles.spawnAt(s.lastVehicle.specId, s.lastVehicle.color, s.player.x + 4, s.player.z + 3, s.player.yaw, 'owned');
      v.st.damage = s.lastVehicle.damage;
      this.lastVehicle = v;
    }
    if (!this.serviceSpawned) this.spawnServiceVehicles();
    this.refreshMapBlips();
    void fresh;
  }

  private makeSaveData(): SaveData {
    const lv = this.lastVehicle && this.vehicles.list.includes(this.lastVehicle) && !this.lastVehicle.destroyed ? { specId: this.lastVehicle.spec.id, color: this.lastVehicle.color, damage: this.lastVehicle.st.damage } : null;
    const p = this.player;
    const inside = this.interior && this.interiorDoor ? this.interiorDoor : null;
    return makeSave({
      player: { x: inside ? inside.x : p.x, y: p.y, z: inside ? inside.z : p.z, yaw: p.yaw, health: p.health },
      economy: this.economy.s,
      missions: { completed: [...this.missions.completed], completions: { ...this.missions.completions }, stats: { ...this.missions.stats } },
      collectibles: [...this.collected],
      achievements: [...this.achievements],
      stats: this.stats,
      clock: this.clock.hours,
      weather: this.weather.kind,
      lastVehicle: lv,
    });
  }

  save(silent = false): boolean {
    if (this.missions.active) {
      if (!silent) this.hud.notify('ミッション中はセーブできません');
      return false;
    }
    if (this.wanted.level > 0) {
      if (!silent) this.hud.notify('手配中はセーブできません');
      return false;
    }
    const st = safeStorage();
    const ok = st ? writeSave(st, this.makeSaveData()) : false;
    if (!silent) this.hud.notify(ok ? 'セーブしました' : 'セーブに失敗しました（容量不足）');
    this.savedDuringSession = ok || this.savedDuringSession;
    return ok;
  }

  /** Import a save from text (used by tests / backup). */
  importSave(json: string): boolean {
    try {
      const s = migrateSave(JSON.parse(json) as unknown);
      if (!s) return false;
      this.applySave(s, false);
      return true;
    } catch {
      return false;
    }
  }

  private spawnServiceVehicles(): void {
    this.serviceSpawned = true;
    const place = (poiId: string, spec: string, n: number): void => {
      const d = this.W.wd.doors.find((q) => q.poi.id === poiId);
      if (!d) return;
      for (let k = 0; k < n; k++) {
        const side = Math.cos(d.yaw);
        const ox = d.x + Math.sin(d.yaw) * 9 + Math.cos(d.yaw) * (k - (n - 1) / 2) * 4;
        const oz = d.z + Math.cos(d.yaw) * 9 - Math.sin(d.yaw) * (k - (n - 1) / 2) * 4;
        void side;
        const v = this.vehicles.spawnAt(spec, undefined, ox, oz, d.yaw + Math.PI / 2, 'parked');
        v.persistent = true;
        v.dynamic = false;
      }
    };
    place('police', 'interceptor', 3);
    place('hospital', 'medic', 2);
    place('fire', 'blaze', 1);
  }

  // ------------------------------------------------------------ mission context
  private makeMissionCtx(): MissionCtx {
    return {
      player: () => {
        const p = this.player;
        const v = p.vehicle;
        return { x: v ? v.st.x : p.x, y: v ? v.st.y : p.y, z: v ? v.st.z : p.z, inVehicle: !!v, vehicleTag: v ? v.tag : null, speed: v ? Math.hypot(v.st.vx, v.st.vz) : p.speed };
      },
      poiPos: (id) => {
        const d = this.W.wd.doors.find((q) => q.poi.id === id);
        if (d) return { x: d.x + Math.sin(d.yaw) * 6, z: d.z + Math.cos(d.yaw) * 6 };
        const poi = poiById(id);
        return poi?.at ? { x: poi.at.x, z: poi.at.z } : { x: 0, z: 0 };
      },
      spawnVehicle: (tag, spec, x, z, yaw, color, ai) => {
        const v = this.vehicles.spawnAt(spec, color, x, z, yaw, 'mission');
        v.tag = tag;
        v.persistent = true;
        if (ai === 'flee' || ai === 'boss') {
          v.driver = 'npc';
          v.ai = ai;
          v.flee = new FleeDriver(this.W.graph, tag.length * 31 + (ai === 'boss' ? 7 : 1), ai === 'boss' ? 30 : 24);
        }
      },
      vehicleInfo: (tag) => {
        const v = this.vehicles.byTag(tag);
        if (!v) return null;
        return { x: v.st.x, z: v.st.z, damage: v.st.damage, speed: Math.hypot(v.st.vx, v.st.vz), disabled: v.disabled || v.destroyed };
      },
      clearMissionVehicles: () => {
        for (const v of [...this.vehicles.list]) {
          if (v.kind === 'mission' || v.kind === 'rival') {
            if (v === this.player.vehicle) {
              v.kind = 'player';
              v.tag = null;
              continue;
            }
            v.tag = null;
            v.persistent = false;
            v.kind = 'wreck';
            v.ai = 'none';
            v.driver = 'none';
          }
        }
        this.raceRivals = [];
      },
      setWanted: (l) => {
        const p = this.ctxPlayerPos();
        this.wanted.setLevel(l, p.x, p.z);
      },
      wanted: () => this.wanted.level,
      setHour: (h) => this.clock.setHour(h),
      setWeather: (k) => this.weather.set(k),
      reward: (money, vehicle) => {
        this.economy.earn(money);
        this.audio.ui('cash');
        if (vehicle) {
          const p = this.ctxPlayerPos();
          const v = this.vehicles.spawnAt(vehicle, undefined, p.x + 6, p.z + 6, 0, 'owned');
          this.setLastVehicle(v);
          this.hud.notify(v.spec.name + ' を手に入れた！');
        }
      },
      startRace: (rivals, cps, start, yaw) => this.startRace(rivals, cps, start, yaw),
      prepareStart: (start, yaw) => this.prepareStart(start, yaw),
      rivalsFinished: () => this.raceRivals.filter((r) => r.raceFinished).length,
      endRace: () => {
        for (const r of this.raceRivals) {
          r.kind = 'wreck';
          r.persistent = false;
          r.ai = 'none';
          r.driver = 'none';
        }
        this.raceRivals = [];
      },
      sfx: (n) => this.audio.ui(n === 'start' ? 'start' : n),
      notify: (t) => this.hud.notify(t),
    };
  }

  private ctxPlayerPos(): Pt {
    const v = this.player.vehicle;
    return v ? { x: v.st.x, z: v.st.z } : { x: this.player.x, z: this.player.z };
  }

  private prepareStart(start: Pt, yaw: number): void {
    let v = this.player.vehicle;
    if (!v) {
      v = this.vehicles.spawnAt('thunder', undefined, start.x, start.z, yaw, 'player');
      this.enterVehicleNow(v);
    }
    const st = v.st;
    st.x = start.x;
    st.z = start.z;
    st.y = this.W.ground.groundAt(start.x, start.z, st.y + 5);
    st.yaw = yaw;
    st.vx = st.vz = st.yawRate = 0;
    st.px = st.x;
    st.pz = st.z;
    st.py = st.y;
    st.pyaw = yaw;
    this.rig.resetBehind(yaw);
  }

  private startRace(rivals: string[], cps: Pt[], start: Pt, yaw: number): void {
    this.raceCps = cps;
    const path = lanePathThrough(this.W.graph, cps, start, yaw);
    this.raceRivals = [];
    rivals.forEach((id, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.floor((i + 1) / 2);
      const ox = start.x + Math.cos(yaw) * side * 3.2 - Math.sin(yaw) * row * 7;
      const oz = start.z - Math.sin(yaw) * side * 3.2 - Math.cos(yaw) * row * 7;
      const v = this.vehicles.spawnAt(id, undefined, ox, oz, yaw, 'rival');
      v.tag = 'rival' + i;
      v.driver = 'npc';
      v.ai = 'race';
      v.race = new PathDriver();
      v.race.setPath(path.map((p) => ({ x: p.x, z: p.z })));
      v.race.maxSpeed = 30 + i * 2;
      v.race.aggression = 1.1;
      v.raceProgress = 0;
      v.raceFinished = false;
      this.raceRivals.push(v);
    });
  }

  // ------------------------------------------------------------ main loop
  private loopStarted = false;
  private titleT = 0;

  /** Start rendering the title screen flyover. */
  startTitle(): void {
    this.state = 'title';
    this.hud.setVisible(false);
    this.touch.setEnabled(false);
    this.clock.setHour(17.4);
    this.weather.set('cloudy', true);
    this.lastT = performance.now();
    if (!this.loopStarted) {
      this.loopStarted = true;
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  start(): void {
    this.state = 'playing';
    this.hud.setVisible(true);
    this.touch.setEnabled('ontouchstart' in window || navigator.maxTouchPoints > 0);
    this.touch.setContext(this.player.vehicle ? 'car' : 'foot');
    this.lastT = performance.now();
    if (!this.loopStarted) {
      this.loopStarted = true;
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  private titleFrame(dt: number): void {
    this.renderer.info.reset();
    this.titleT += dt;
    const t = this.titleT * 0.03;
    const W = this.W;
    // slow orbit around downtown with the beach and sunset behind
    const cx = 380 + Math.cos(t) * 520;
    const cz = -260 + Math.sin(t) * 420;
    const cam = this.rig.cam;
    cam.position.set(cx, 120 + Math.sin(t * 1.7) * 25, cz);
    cam.lookAt(220, 60, -420);
    U.uTime.value = this.titleT;
    const night = this.clock.nightFactor();
    U.uNight.value = night;
    U.uWet.value = 0;
    U.uRain.value = 0;
    const sun = this.sunTmp;
    this.clock.sunDir(sun);
    this.atmo.update(dt, { sunDir: sun, night, cloud: 0.4, rain: 0, fog: 0.05, flash: 0 }, cam, this.tmpV.set(cx, 0, cz));
    this.scene.environmentIntensity = this.atmo.envIntensity;
    W.terrain.update(cam.position);
    W.vegetation.update(cam.position, cam.position);
    W.props.update(dt, cam.position, W.graph, this.titleT, this.q.viewDistance);
    W.water.update(dt, cam.position, 0.4, this.titleT);
    W.landmarks.update(dt, night, this.titleT);
    this.playerRig.mesh.visible = false;
    (this.post.uniform('uSpeed') as THREE.IUniform<number>).value = 0;
    (this.post.uniform('uTime') as THREE.IUniform<number>).value = this.titleT;
    this.post.setBloom(0.3, 1.0);
    this.post.render(dt);
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.lastT) / 1000;
    if (this.q.fpsLimit > 0 && dt < 1 / this.q.fpsLimit - 0.002) return;
    this.lastT = now;
    if (!(dt > 0)) dt = STEP;
    dt = Math.min(dt, 0.1);
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    try {
      if (this.state === 'title') {
        this.titleFrame(dt);
        if (this.onFirstFrame) {
          this.onFirstFrame();
          this.onFirstFrame = null;
        }
        return;
      }
      this.input.poll();
      this.handleFrameInput(dt);
      const running = this.state === 'playing' || this.state === 'dead';
      if (running) {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= STEP && steps < 6) {
          this.tick(STEP);
          this.acc -= STEP;
          steps++;
        }
        if (steps >= 6) this.acc = 0;
      }
      const alpha = running ? clamp(this.acc / STEP, 0, 1) : 1;
      this.render(dt, alpha, running);
      this.input.clearEdges();
      this.autoQuality();
      if (this.onFirstFrame) {
        this.onFirstFrame();
        this.onFirstFrame = null;
      }
    } catch (e) {
      console.error(e);
      this.fatal('エラーが発生しました:\n' + (e instanceof Error ? e.stack ?? e.message : String(e)));
      throw e;
    }
  }

  /** Dynamic resolution: keeps the frame rate up on slower devices by scaling the render
   * resolution (0.55..1). If even the lowest scale is too slow, the next launch uses a lower tier. */
  private autoQuality(): void {
    if (!this.settings.autoQuality || this.state !== 'playing' || this.frameTimes.length < 60) return;
    const now = performance.now();
    if (now - this.dynCheckT < 1500) return;
    this.dynCheckT = now;
    const n = this.frameTimes.length;
    let sum = 0;
    for (let k = n - 60; k < n; k++) sum += this.frameTimes[k] as number;
    const avg = sum / 60;
    if (avg > 1 / 28 && this.dynScale > 0.56) {
      this.dynScale = Math.max(0.55, this.dynScale * 0.85);
      this.resize();
      this.frameTimes.length = 0; // measure the new resolution from scratch
    } else if (avg < 1 / 50 && this.dynScale < 1) {
      this.dynScale = Math.min(1, this.dynScale * 1.08);
      this.resize();
      this.frameTimes.length = 0;
    }
    if (this.autoQualityDone || this.simTime < 20 || this.dynScale > 0.56 || avg <= 1 / 28) return;
    this.autoQualityDone = true;
    const order: QualitySettings['tier'][] = ['low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(this.settings.tier);
    if (i > 0) {
      this.settings.tier = order[i - 1] as QualitySettings['tier'];
      this.saveSettings();
      this.hud.notify('動作を軽くするため画質を「' + this.settings.tier + '」に下げます（次回起動時に反映）');
    }
  }

  // ------------------------------------------------------------ input (per frame)
  private handleFrameInput(dt: number): void {
    const inp = this.input;
    if (this.state === 'menu') {
      if (inp.pressed('pause')) this.hud.back();
      return;
    }
    if (this.state === 'map') {
      if (inp.pressed('map') || inp.pressed('pause')) this.closeMap();
      return;
    }
    if (this.state !== 'playing') return;
    if (inp.pressed('pause')) {
      this.openPause();
      return;
    }
    if (inp.pressed('map')) {
      this.openMap();
      return;
    }
    if (inp.pressed('camera')) this.rig.toggleMode();
    if (inp.pressed('skip')) this.missions.skipLine();
    const look = inp.consumeLook();
    this.rig.applyLook(look.x, look.y, inp.consumeZoom());
    const p = this.player;
    if (inp.pressed('enter')) {
      if (p.mode === 'vehicle') this.exitVehicle();
      else if (p.mode === 'foot') this.tryEnterVehicle();
    }
    if (inp.pressed('interact')) this.interact();
    if (inp.pressed('useItem')) this.openInventory();
    if (p.mode === 'foot' && inp.pressed('punch') && p.punchT <= 0 && !this.interior) {
      p.punchT = 0.45;
      this.audio.punch();
      const hit = this.peds.punch(p.x, p.z, p.yaw);
      if (hit) {
        this.reportCrime(hit.cop ? 'copAssault' : 'assault', p.x, p.y, p.z);
        this.pedSys.scare(p.x, p.z, 20, 1);
      }
    }
    const v = p.vehicle;
    if (v) {
      if (inp.pressed('horn') && this.hornCooldown <= 0) {
        this.audio.horn(v.st.x, v.st.y, v.st.z, 0.45);
        this.pedSys.scare(v.st.x, v.st.z, 10, 0.3);
        this.hornCooldown = 0.4;
      }
      if (inp.pressed('lights')) {
        v.lightsOn = !v.lightsOn;
        this.hud.notify(v.lightsOn ? 'ライト ON' : 'ライト OFF');
      }
      if (inp.pressed('blinkL')) v.blinker = v.blinker === -1 ? 0 : -1;
      if (inp.pressed('blinkR')) v.blinker = v.blinker === 1 ? 0 : 1;
      if (inp.pressed('radio')) {
        const on = this.audio.toggleRadio();
        this.hud.radio(on ? '📻 VISTA FM 98.7 — Coast Lo-Fi' : '📻 ラジオ OFF');
      }
      if (v.siren !== undefined && v.spec.siren && inp.pressed('phone')) v.siren = !v.siren;
    }
    this.hornCooldown = Math.max(0, this.hornCooldown - dt);
    if (this.rig.mode === 'third' && !this.input.touchActive && !this.input.pointerLocked && this.input.lastDevice === 'kbm' && this.input.mouseDown) {
      // keep it easy: clicking the canvas locks the pointer on desktop
      this.input.requestPointerLock();
    }
  }

  // ------------------------------------------------------------ simulation tick
  private tick(dt: number): void {
    this.simTime += dt;
    this.stats.timePlayed += dt;
    this.clock.advance(dt);
    this.weather.update(dt);
    for (const t of this.weather.takeThunder()) this.audio.thunder(t.dist);
    const W = this.W;
    W.ground.wetness = this.weather.wetness;
    const p = this.player;
    const night = this.clock.nightFactor();
    if (this.state === 'dead') {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) this.respawn();
    }
    // player
    if (p.mode === 'vehicle' && p.vehicle) {
      const v = p.vehicle;
      const inp = this.input;
      const frozen = this.missions.countdown > 0 || this.state === 'dead' || this.missions.dialog !== null && this.missions.step?.t === 'talk';
      v.input.throttle = frozen ? 0 : inp.throttle();
      v.input.brake = frozen ? 1 : inp.brakeAmount();
      v.input.steer = frozen ? 0 : clamp(inp.moveX, -1, 1);
      v.input.handbrake = !frozen && inp.isDown('handbrake');
      if (this.missions.countdown > 0) v.input.handbrake = true;
      p.x = v.st.x;
      p.y = v.st.y;
      p.z = v.st.z;
      p.yaw = v.st.yaw;
      const sp = Math.hypot(v.st.vx, v.st.vz);
      this.stats.distanceDriven += sp * dt;
      this.stats.maxSpeed = Math.max(this.stats.maxSpeed, sp);
      if (!v.st.onGround) this.stats.maxAir = Math.max(this.stats.maxAir, v.st.airTime);
      // skid marks
      if (v.st.onGround && (v.st.slipRear > 0.22 || v.st.wheelslip > 0.3) && sp > 4 && v.view && !this.interior) {
        for (const wh of v.view.geo.wheels) {
          if (wh.front) continue;
          const wx = v.st.x + Math.sin(v.st.yaw) * wh.z - Math.cos(v.st.yaw) * wh.x;
          const wz = v.st.z + Math.cos(v.st.yaw) * wh.z + Math.sin(v.st.yaw) * wh.x;
          if (this.rng.chance(0.6)) this.effects.skid(wx, v.st.y, wz, Math.atan2(v.st.vx, v.st.vz));
        }
        if (this.rng.chance(0.3)) this.effects.smokePuff(v.st.x - Math.sin(v.st.yaw) * v.spec.length * 0.4, v.st.y + 0.3, v.st.z - Math.cos(v.st.yaw) * v.spec.length * 0.4, 0.1, 0.8);
      }
      // drowning car
      if (v.submerged > 2 && W.ground.waterAt(v.st.x, v.st.z) > v.st.y + 1.2) {
        this.hud.notify('車が水没した！');
        this.exitVehicle(true);
      }
    } else if (!this.interior || p.mode !== 'vehicle') {
      const camYaw = this.rig.yaw;
      const frozen = this.state === 'dead' || this.dancing || (this.missions.dialog !== null && this.missions.step?.t === 'talk' && this.missions.active?.kind === 'main' && this.missions.stepIndex === 0 && false);
      p.frozen = frozen;
      const near = this.interior ? [] : this.vehicles.list.filter((v) => dist2(v.st.x, v.st.z, p.x, p.z) < 100);
      p.updateFoot(dt, this.input, camYaw, near);
      if (p.mode === 'foot') this.stats.distanceWalked = p.distWalked;
      if (p.health <= 0 && this.state !== 'dead') this.die('wasted');
    }
    if (this.interior) {
      this.interiors.update(this.interior, dt, this.simTime);
      this.checkAchievements(dt);
      return;
    }
    // AI vehicles
    for (const v of this.vehicles.list) {
      if (v.destroyed) continue;
      if ((v.ai === 'flee' || v.ai === 'boss') && v.flee && !v.disabled) {
        const pp = this.ctxPlayerPos();
        v.flee.update(v.spec, v.st, dt, v.input, pp.x, pp.z);
      } else if (v.ai === 'race' && v.race && !v.raceFinished) {
        if (this.missions.countdown > 0) {
          v.input.throttle = 0;
          v.input.brake = 1;
          v.input.handbrake = true;
        } else {
          // rubber band: slow down a little when far ahead of the player
          const pp = this.ctxPlayerPos();
          const ahead = v.race.idx - this.playerRaceIndex(v.race.path, pp);
          const cap = ahead > 40 ? 22 : ahead < -40 ? 60 : Infinity;
          v.race.drive(v.spec, v.st, dt, v.input, cap);
          const last = this.raceCps[this.raceCps.length - 1];
          if (last && Math.hypot(v.st.x - last.x, v.st.z - last.z) < 14) {
            v.raceFinished = true;
            this.hud.notify(v.spec.name + ' がゴールした');
          }
        }
      } else if (v.disabled && v.tag) {
        v.input.throttle = 0;
        v.input.brake = 1;
        v.hazard = true;
      }
    }
    // vehicles, peds, police
    const pv = p.vehicle;
    const onFootObs = p.mode === 'foot' || p.mode === 'down' ? { x: p.x, y: p.y, z: p.z, r: 0.45, vx: p.vx, vz: p.vz, emergency: false } : null;
    this.vehicles.playerVehicle = pv;
    this.vehicles.update(dt, p.x, p.z, night, this.peds.obstacles, onFootObs);
    this.peds.update(dt, p.x, p.z, night, this.weather.current.rain, this.vehicles.list, pv);
    const pvx = pv ? pv.st.vx : p.vx;
    const pvz = pv ? pv.st.vz : p.vz;
    this.police.update(dt, p.x, p.y, p.z, pvx, pvz, !pv, pv ? Math.hypot(pv.st.vx, pv.st.vz) : p.speed);
    const escaped = this.wanted.update(dt, this.police.seen, p.x, p.z);
    if (escaped) {
      this.stats.escapes++;
      this.hud.notify('警察を振り切った！');
      this.audio.ui('success');
    }
    // speeding/near police on freeway etc. (police see reckless driving)
    // missions
    const wasActive = this.missions.active;
    this.missions.update(dt);
    if (wasActive && !this.missions.active) this.onMissionEnd();
    if (this.missions.dialog) {
      const d = this.missions.dialog;
      if (this.hud && this.lastDialog !== d.text) {
        this.lastDialog = d.text;
        this.hud.subtitle(d.speaker, d.text, 8);
        this.audio.babble(Math.min(3, d.text.length * 0.06), d.speaker.includes('ローザ') || d.speaker.includes('イネス') || d.speaker.includes('ミア') ? 230 : 130);
      }
    } else if (this.lastDialog) {
      this.lastDialog = '';
      this.hud.clearSubtitle();
    }
    // collectibles
    W.wd.collectibles.forEach((c, i) => {
      if (this.collected.has(i)) return;
      if (Math.abs(c.x - p.x) < 2.2 && Math.abs(c.z - p.z) < 2.2 && Math.abs(c.y - 1.2 - p.y) < 3) {
        this.collected.add(i);
        (this.postcardMeshes[i] as THREE.Mesh).visible = false;
        this.economy.earn(250);
        this.audio.ui('pickup');
        this.hud.notify(`絵はがきを見つけた！ (${this.collected.size}/${W.wd.collectibles.length})  +$250`);
      }
    });
    // fires / smoke for damaged vehicles near the camera
    for (const v of this.vehicles.list) {
      if (!v.view) continue;
      if (v.st.damage > 0.7 && this.rng.chance(0.25)) {
        const hx = v.st.x + Math.sin(v.st.yaw) * v.spec.length * 0.35;
        const hz = v.st.z + Math.cos(v.st.yaw) * v.spec.length * 0.35;
        if (v.fire > 0 && !v.destroyed) this.effects.fire(hx, v.st.y + v.spec.height * 0.7, hz);
        else this.effects.smokePuff(hx, v.st.y + v.spec.height * 0.8, hz, v.destroyed ? 0.9 : 0.5, 1);
      }
    }
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    this.checkAchievements(dt);
    this.updateAreas(dt);
  }

  private lastDialog = '';

  private playerRaceIndex(path: Pt[], pp: Pt): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < path.length; i += 2) {
      const q = path[i] as Pt;
      const d = (q.x - pp.x) * (q.x - pp.x) + (q.z - pp.z) * (q.z - pp.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ events
  private reportCrime(kind: CrimeKind, x: number, y: number, z: number): void {
    // police nearby with line of sight see it directly
    let seen = false;
    for (const c of this.police.cars) {
      if (dist2(c.st.x, c.st.z, x, z) < 70 * 70 && this.W.world.lineOfSight(c.st.x, c.st.y + 1.4, c.st.z, x, y + 1, z)) seen = true;
    }
    for (const v of this.vehicles.list) {
      if (v.spec.category === 'police' && v.driver !== 'none' && dist2(v.st.x, v.st.z, x, z) < 50 * 50) seen = true;
    }
    if (seen) {
      const before = this.wanted.level;
      this.wanted.report(kind, x, z, true);
      if (this.wanted.level > before) this.hud.notify('警察に目撃された！ 手配度 ★' + this.wanted.level);
    } else {
      const sev = { collision: 0.5, carjack: 1, assault: 1, hitPed: 2, copAssault: 3, speeding: 0.3, alarm: 3, trespass: 1 }[kind];
      this.pedSys.crime(x, y, z, sev, 60);
    }
  }

  private onVehicleImpact(v: Vehicle, impact: number, other: Vehicle | null, x: number, z: number): void {
    const p = this.player;
    const involvesPlayer = v === p.vehicle || other === p.vehicle;
    if (impact > 4 && v.view) this.effects.sparks(x, v.st.y + 0.6, z, Math.min(24, Math.floor(impact)));
    if (impact > 3 && dist2(x, z, this.rig.cam.position.x, this.rig.cam.position.z) < 200 * 200 && this.crashCooldown <= 0) {
      this.audio.crash(impact, x, v.st.y + 0.5, z);
      this.crashCooldown = 0.12;
    }
    if (v === p.vehicle) {
      this.rig.addShake(Math.min(1, impact / 15));
      if (impact > 8) this.stats.crashes++;
      if (impact > 22) p.damage((impact - 22) * 2.2);
    }
    if (involvesPlayer && other && v === p.vehicle && impact > 6) {
      if (other.spec.category === 'police' && other.driver !== 'none') this.reportCrime('copAssault', x, v.st.y, z);
      else if (other.driver === 'npc' && !other.tag) this.reportCrime('collision', x, v.st.y, z);
    }
    if (impact > 10) this.pedSys.scare(x, z, 18, 0.5);
  }

  private onExplosion(x: number, y: number, z: number, v: Vehicle): void {
    this.effects.explosion(x, y, z);
    this.audio.explosion(x, y, z);
    this.pedSys.scare(x, z, 40, 1);
    const p = this.player;
    const d = dist(p.x, p.z, x, z);
    if (d < 10) {
      this.rig.addShake(1.2);
      if (p.mode === 'vehicle' && p.vehicle === v) {
        this.exitVehicle(true);
        p.damage(80);
      } else if (p.mode === 'foot') {
        p.damage((10 - d) * 9);
        p.knockDown((p.x - x) * 1.2, (p.z - z) * 1.2);
      }
    } else if (d < 60) this.rig.addShake((60 - d) / 80);
    for (const o of this.vehicles.list) {
      if (o === v) continue;
      const dd = dist(o.st.x, o.st.z, x, z);
      if (dd < 9) {
        this.vehicles.makeDynamic(o);
        o.st.vx += ((o.st.x - x) / (dd + 1)) * 8;
        o.st.vz += ((o.st.z - z) / (dd + 1)) * 8;
        o.st.vy = 4;
        o.st.onGround = false;
        o.st.damage = Math.min(1, o.st.damage + (9 - dd) * 0.08);
      }
    }
    for (const ped of this.pedSys.peds) {
      const dd = dist(ped.x, ped.z, x, z);
      if (dd < 9) this.pedSys.knockDown(ped, ((ped.x - x) / (dd + 1)) * 8, ((ped.z - z) / (dd + 1)) * 8);
    }
    if (v.lastHitByPlayer > this.vehicles.time - 15 || v === this.lastVehicle) this.reportCrime('assault', x, y, z);
  }

  private onPedHit(p: Ped, byPlayer: boolean, speed: number): void {
    this.audio.crash(Math.min(10, speed), p.x, p.y + 1, p.z);
    if (byPlayer) {
      this.stats.pedsKnocked++;
      this.reportCrime(p.cop ? 'copAssault' : 'hitPed', p.x, p.y, p.z);
      this.pedSys.scare(p.x, p.z, 25, 1);
    }
  }

  // ------------------------------------------------------------ vehicles: enter / exit
  private tryEnterVehicle(): void {
    if (this.interior) return;
    const p = this.player;
    let best: Vehicle | null = null;
    let bd = 5.5 * 5.5;
    for (const v of this.vehicles.list) {
      if (v.destroyed || v.kind === 'rival') continue;
      const d2 = dist2(v.st.x, v.st.z, p.x, p.z) - (v.spec.length * 0.5) * (v.spec.length * 0.5) * 0.5;
      if (Math.abs(v.st.y - p.y) > 3) continue;
      if (d2 < bd) {
        bd = d2;
        best = v;
      }
    }
    if (!best) return;
    const v = best;
    if (v.tag && v.ai !== 'none' && !v.disabled) return; // can't get into a fleeing mission car before it stops
    // carjack / steal
    const hadDriver = v.driver === 'npc' || v.driver === 'cop';
    const isPolice = v.driver === 'cop' || this.police.cars.includes(v);
    if (hadDriver) {
      const side = 1;
      const ox = v.st.x + Math.cos(v.st.yaw) * side * (v.spec.width / 2 + 0.8);
      const oz = v.st.z - Math.sin(v.st.yaw) * side * (v.spec.width / 2 + 0.8);
      this.peds.ejectDriver(ox, oz, p.x, p.z, isPolice);
      this.reportCrime(isPolice ? 'copAssault' : 'carjack', p.x, p.y, p.z);
      this.stats.carsStolen++;
      v.stolen = true;
      if (isPolice) {
        const i = this.police.cars.indexOf(v);
        if (i >= 0) this.police.cars.splice(i, 1);
        v.chase = null;
      }
    } else if (v.kind === 'parked' && !v.stolen && v !== this.lastVehicle) {
      v.stolen = true;
      this.stats.carsStolen++;
      if (this.rng.chance(0.35)) {
        this.hud.notify('車の盗難防止アラームが鳴った！');
        this.reportCrime('carjack', p.x, p.y, p.z);
        v.hazard = true;
        this.audio.horn(v.st.x, v.st.y, v.st.z, 1.2);
      }
    }
    this.audio.door(v.st.x, v.st.y, v.st.z);
    this.enterVehicleNow(v);
  }

  /** Test/debug hook (used by the automated photo tour): spawn a car at the player and enter it. */
  debugSpawnAndEnter(spec = 'thunder'): Vehicle {
    const p = this.player;
    const v = this.vehicles.spawnAt(spec, undefined, p.x, p.z, p.yaw, 'player');
    this.enterVehicleNow(v);
    return v;
  }

  private enterVehicleNow(v: Vehicle): void {
    const p = this.player;
    this.vehicles.takeOver(v, v.tag ? 'mission' : 'player');
    if (v.tag && v.kind !== 'mission') v.kind = 'mission';
    v.ai = v.ai === 'race' ? 'none' : v.ai === 'flee' || v.ai === 'boss' ? 'none' : v.ai;
    v.flee = null;
    v.driver = 'player';
    v.disabled = false;
    v.hazard = false;
    v.siren = false;
    p.vehicle = v;
    p.mode = 'vehicle';
    v.st.engineOn = true;
    this.setLastVehicle(v);
    this.rig.resetBehind(v.st.yaw);
    this.touch.setContext('car');
    if (v.spec.category === 'police' || v.spec.category === 'ambulance' || v.spec.category === 'fire') this.hud.notify('T キーでサイレン ON/OFF');
  }

  private setLastVehicle(v: Vehicle): void {
    if (this.lastVehicle && this.lastVehicle !== v && this.vehicles.list.includes(this.lastVehicle)) {
      const lv = this.lastVehicle;
      if (lv.kind === 'owned' || lv.kind === 'player') {
        lv.kind = 'wreck';
        lv.persistent = false;
      }
    }
    this.lastVehicle = v;
    v.persistent = true;
  }

  private exitVehicle(force = false): void {
    const p = this.player;
    const v = p.vehicle;
    if (!v) return;
    const sp = Math.hypot(v.st.vx, v.st.vz);
    if (!force && sp > 14) {
      this.hud.notify('速すぎて降りられない（減速して）');
      return;
    }
    const side = 1;
    let ox = v.st.x + Math.cos(v.st.yaw) * side * (v.spec.width / 2 + 0.7);
    let oz = v.st.z - Math.sin(v.st.yaw) * side * (v.spec.width / 2 + 0.7);
    if (v.spec.shape === 'bike') {
      ox = v.st.x + Math.cos(v.st.yaw) * 0.9;
      oz = v.st.z - Math.sin(v.st.yaw) * 0.9;
    }
    // if the door side is blocked by a building, exit on the other side
    if (this.W.world.raycast(v.st.x, v.st.y + 1, v.st.z, ox, v.st.y + 1, oz, true) < 1) {
      ox = v.st.x - Math.cos(v.st.yaw) * (v.spec.width / 2 + 0.7);
      oz = v.st.z + Math.sin(v.st.yaw) * (v.spec.width / 2 + 0.7);
    }
    p.vehicle = null;
    p.mode = 'foot';
    p.x = ox;
    p.z = oz;
    p.y = this.W.ground.groundAt(ox, oz, v.st.y + 1.5);
    p.vy = 0;
    p.vx = v.st.vx * 0.5;
    p.vz = v.st.vz * 0.5;
    p.px = p.x;
    p.pz = p.z;
    p.py = p.y;
    p.yaw = v.st.yaw;
    v.driver = 'none';
    v.input.throttle = 0;
    v.input.brake = 0.3;
    v.input.handbrake = true;
    if (sp > 8) {
      p.damage(sp * 0.8);
      p.knockDown(v.st.vx * 0.6, v.st.vz * 0.6);
    }
    if (v.kind === 'player') v.kind = 'owned';
    this.audio.door(v.st.x, v.st.y, v.st.z);
    this.audio.setRadio(false);
    this.touch.setContext('foot');
    this.rig.resetBehind(p.yaw);
  }

  // ------------------------------------------------------------ interaction (E)
  private nearestDoor(): Door | null {
    const p = this.player;
    let best: Door | null = null;
    let bd = 3.2 * 3.2;
    for (const d of this.W.wd.doors) {
      const d2 = dist2(d.x, d.z, p.x, p.z);
      if (d2 < bd && Math.abs(d.y - p.y) < 3) {
        bd = d2;
        best = d;
      }
    }
    return best;
  }

  private nearestMission(): MissionDef | null {
    const p = this.ctxPlayerPos();
    for (const m of this.missions.available()) {
      const at = this.missions.resolve(m.at);
      if (Math.hypot(at.x - p.x, at.z - p.z) < (this.player.vehicle ? 7 : 4)) return m;
    }
    return null;
  }

  private nearPump(): boolean {
    const p = this.ctxPlayerPos();
    return this.W.wd.props.some((q) => q.kind === 'pump' && Math.hypot(q.x - p.x, q.z - p.z) < 7);
  }

  private garageDoorNear(): Door | null {
    const p = this.ctxPlayerPos();
    for (const d of this.W.wd.doors) {
      const isGarage = d.interior === 'underground' || ((d.poi.kind === 'property') && this.economy.owns(d.poi.id));
      if (isGarage && Math.hypot(d.x - p.x, d.z - p.z) < 12) return d;
    }
    return null;
  }

  private interactPoint(): InteractPoint | null {
    const it = this.interior;
    if (!it) return null;
    const p = this.player;
    for (const pt of it.points) if (Math.hypot(pt.x - p.x, pt.z - p.z) < pt.r) return pt;
    return null;
  }

  private interact(): void {
    const p = this.player;
    if (this.missions.dialog) {
      this.missions.skipLine();
      return;
    }
    if (this.interior) {
      const pt = this.interactPoint();
      if (pt) this.useInteriorPoint(pt);
      return;
    }
    const m = this.nearestMission();
    if (m) {
      this.confirmMission(m);
      return;
    }
    if (p.vehicle) {
      if (this.nearPump()) {
        this.refuel();
        return;
      }
      const g = this.garageDoorNear();
      if (g) {
        this.storeVehicle(g.interior === 'underground' ? 'underground' : g.poi.id);
        return;
      }
      return;
    }
    const d = this.nearestDoor();
    if (d) this.useDoor(d);
  }

  private confirmMission(m: MissionDef): void {
    this.openMenu(m.title, [
      { label: 'ミッションを開始', sub: m.giver, primary: true, onClick: () => { this.closeMenuToGame(); this.missions.start(m.id); } },
      { label: 'やめる', onClick: () => this.closeMenuToGame() },
    ], `<p style="opacity:.85">${m.summary}</p>`);
  }

  private useDoor(d: Door): void {
    if (this.wanted.level > 0 && d.poi.kind !== 'police') {
      this.hud.notify('手配中は建物に入れない');
      return;
    }
    if (d.poi.kind === 'property' && !this.economy.owns(d.poi.id)) {
      const prop = PROPERTIES.find((q) => q.id === d.poi.id);
      if (!prop) return;
      this.openMenu(prop.name, [
        { label: '購入する', sub: formatMoney(prop.price), primary: true, disabled: this.economy.money < prop.price, onClick: () => {
          if (this.economy.buyProperty(prop.id)) {
            this.audio.ui('cash');
            this.hud.banner('物件を購入！', prop.name, 'ok');
            this.closeMenuToGame();
            this.save(true);
            this.enterInterior(d);
          }
        } },
        { label: 'やめる', onClick: () => this.closeMenuToGame() },
      ], `<p style="opacity:.85">${prop.desc}</p>`);
      return;
    }
    this.enterInterior(d);
  }

  private enterInterior(d: Door): void {
    const it = this.interiors.get(d.interior);
    this.hud.fade(1);
    window.setTimeout(() => {
      this.interior = it;
      this.interiorDoor = d;
      it.group.visible = true;
      this.W.root.visible = false;
      this.vehicles.group.visible = false;
      this.peds.group.visible = false;
      this.atmo.group.visible = false;
      this.effects.group.visible = false;
      this.rain.mesh.visible = false;
      this.markerGroup.visible = false;
      for (const m of this.postcardMeshes) m.visible = false;
      this.scene.fog = null;
      this.atmo.sun.intensity = 0;
      this.atmo.hemi.intensity = it.ambient * 0.3;
      this.interiorGround.groundAt = (): number => it.floorY;
      this.player.ground = this.interiorGround;
      this.player.world = it.world;
      this.player.teleport(it.spawn.x, it.spawn.z, it.spawn.yaw);
      this.player.y = it.floorY;
      this.rig.interior = true;
      this.rig.resetBehind(it.spawn.yaw);
      this.audio.door(0, 0, 0);
      if (d.interior === 'club') this.stats.clubVisits++;
      this.hud.notify(it.name);
      this.hud.fade(0);
    }, 300);
  }

  private exitInterior(): void {
    const d = this.interiorDoor;
    const it = this.interior;
    if (!d || !it) return;
    this.hud.fade(1);
    this.dancing = false;
    window.setTimeout(() => {
      it.group.visible = false;
      this.interior = null;
      this.interiorDoor = null;
      this.W.root.visible = true;
      this.vehicles.group.visible = true;
      this.peds.group.visible = true;
      this.atmo.group.visible = true;
      this.effects.group.visible = true;
      this.markerGroup.visible = true;
      for (let i = 0; i < this.postcardMeshes.length; i++) (this.postcardMeshes[i] as THREE.Mesh).visible = !this.collected.has(i);
      this.scene.fog = this.atmo.fog;
      this.player.ground = this.W.ground;
      this.player.world = this.W.world;
      const ox = d.x + Math.sin(d.yaw) * 1.5;
      const oz = d.z + Math.cos(d.yaw) * 1.5;
      this.player.teleport(ox, oz, d.yaw);
      this.rig.interior = false;
      this.rig.resetBehind(d.yaw);
      this.audio.door(ox, this.player.y, oz);
      this.hud.fade(0);
    }, 300);
  }

  private useInteriorPoint(pt: InteractPoint): void {
    switch (pt.kind) {
      case 'exit':
        this.exitInterior();
        break;
      case 'shop':
        this.openShop(pt.shop ?? 'mart');
        break;
      case 'outfit':
        this.openOutfits(false);
        break;
      case 'wardrobe':
        this.openOutfits(true);
        break;
      case 'dealer':
        this.openDealer();
        break;
      case 'repair':
        this.openRepair();
        break;
      case 'garage':
        this.openGarage(this.interiorDoor?.interior === 'underground' ? 'underground' : this.interiorDoor?.poi.id ?? 'underground');
        break;
      case 'bed':
        this.sleep();
        break;
      case 'heal':
        this.openMenu('総合病院', [
          { label: '治療を受ける（全回復）', sub: formatMoney(100), disabled: this.economy.money < 100 || this.player.health >= 100, onClick: () => {
            if (this.economy.spend(100)) {
              this.player.health = 100;
              this.audio.ui('cash');
              this.hud.notify('体力が全回復した');
            }
            this.closeMenuToGame();
          } },
          { label: '救急キットを買う', sub: formatMoney(ITEMS.medkit.price), onClick: () => { this.buyItem('medkit'); } },
          { label: '閉じる', onClick: () => this.closeMenuToGame() },
        ], '');
        break;
      case 'police': {
        const fee = this.wanted.level * 500;
        this.openMenu('VCPD 窓口', [
          { label: this.wanted.level > 0 ? '罰金を払って手配を解除' : '手配はありません', sub: this.wanted.level > 0 ? formatMoney(fee) : '', disabled: this.wanted.level === 0 || this.economy.money < fee, onClick: () => {
            if (this.economy.spend(fee)) {
              this.wanted.clear();
              this.police.clearAll();
              this.hud.notify('手配が解除された');
            }
            this.closeMenuToGame();
          } },
          { label: '閉じる', onClick: () => this.closeMenuToGame() },
        ], '');
        break;
      }
      case 'dance':
        this.dancing = !this.dancing;
        this.hud.notify(this.dancing ? '踊っている！（もう一度 E でやめる）' : 'ダンスをやめた');
        break;
    }
  }

  // ------------------------------------------------------------ shops & services
  private buyItem(id: ItemId): void {
    const def = ITEMS[id];
    if (!this.economy.buyItem(id)) {
      this.hud.notify('お金が足りない');
      return;
    }
    this.audio.ui('cash');
    if (!def.carry) {
      this.player.health = Math.min(100, this.player.health + def.heal);
      this.hud.notify(def.name + 'を食べた（体力 +' + def.heal + '）');
    } else this.hud.notify(def.name + 'を買った');
  }

  private openShop(shop: string): void {
    const stock = SHOP_STOCK[shop] ?? [];
    const items: MenuItem[] = stock.map((id) => {
      const d = ITEMS[id];
      return { label: d.name, sub: formatMoney(d.price) + '　' + d.desc, disabled: this.economy.money < d.price, onClick: () => { this.buyItem(id); this.openShop(shop); } };
    });
    items.push({ label: '閉じる', onClick: () => this.closeMenuToGame() });
    this.openMenu('ショップ　所持金 ' + formatMoney(this.economy.money), items, '');
  }

  private openInventory(): void {
    const inv = this.economy.s.inventory;
    const items: MenuItem[] = [];
    for (const id of Object.keys(inv) as ItemId[]) {
      const n = inv[id] ?? 0;
      if (n <= 0) continue;
      const d = ITEMS[id];
      items.push({ label: `${d.name} ×${n}`, sub: '使う：' + d.desc, onClick: () => {
        this.useItem(id);
        this.openInventory();
      } });
    }
    if (items.length === 0) items.push({ label: '所持品はありません', disabled: true, onClick: () => undefined });
    items.push({ label: '閉じる', onClick: () => this.closeMenuToGame() });
    this.openMenu('所持品', items, '');
  }

  private useItem(id: ItemId): void {
    const d = ITEMS[id];
    if (!this.economy.useItem(id)) return;
    if (id === 'repairKit') {
      const v = this.player.vehicle ?? this.lastVehicle;
      if (v && dist2(v.st.x, v.st.z, this.player.x, this.player.z) < 100) {
        v.st.damage = Math.max(0, v.st.damage - 0.5);
        if (v.st.damage < 0.3) v.view?.repair();
        v.fire = 0;
        this.hud.notify('車を修理した');
      } else {
        this.economy.s.inventory[id] = (this.economy.s.inventory[id] ?? 0) + 1;
        this.hud.notify('近くに自分の車がない');
      }
      return;
    }
    if (id === 'fuelCan') {
      const v = this.player.vehicle ?? this.lastVehicle;
      if (v) {
        v.st.fuel = Math.min(60, v.st.fuel + 30);
        this.hud.notify('給油した（+30L）');
      }
      return;
    }
    this.player.health = Math.min(100, this.player.health + d.heal);
    this.hud.notify(d.name + 'を使った（体力 +' + d.heal + '）');
  }

  private openOutfits(ownedOnly: boolean): void {
    const items: MenuItem[] = OUTFITS.filter((o) => !ownedOnly || this.economy.s.outfits.includes(o.id)).map((o) => {
      const owned = this.economy.s.outfits.includes(o.id);
      return {
        label: o.name + (this.economy.s.outfit === o.id ? '（着用中）' : ''),
        sub: owned ? '所持' : formatMoney(o.price),
        disabled: !owned && this.economy.money < o.price,
        onClick: () => {
          if (this.economy.buyOutfit(o.id)) {
            if (!owned) this.audio.ui('cash');
            this.applyOutfit();
            this.hud.notify(o.name + ' に着替えた');
          }
          this.openOutfits(ownedOnly);
        },
      };
    });
    items.push({ label: '閉じる', onClick: () => this.closeMenuToGame() });
    this.openMenu(ownedOnly ? 'ワードローブ' : 'MODA VISTA', items, '');
  }

  private applyOutfit(): void {
    const o = OUTFITS.find((q) => q.id === this.economy.s.outfit) ?? OUTFITS[0];
    if (!o) return;
    this.playerLook.shirt = o.shirt;
    this.playerLook.pants = o.pants;
    this.playerLook.shoes = o.shoes;
    this.playerLook.jacket = o.jacket;
    this.playerLook.hat = o.hat;
    this.playerLook.shorts = o.id === 'beach';
    const old = this.playerRig.mesh.geometry;
    this.playerRig.mesh.geometry = buildHumanGeometry(this.playerLook);
    old.dispose();
  }

  private openDealer(): void {
    const items: MenuItem[] = DEALER_STOCK.map((id) => {
      const s = vehicleById(id);
      return {
        label: s.name,
        sub: formatMoney(s.price) + '　最高 ' + Math.round(s.topSpeed * 3.6) + 'km/h',
        disabled: this.economy.money < s.price,
        onClick: () => {
          if (!this.economy.spend(s.price)) return;
          this.audio.ui('cash');
          const d = this.interiorDoor;
          this.closeMenuToGame();
          this.exitInterior();
          window.setTimeout(() => {
            if (!d) return;
            const v = this.vehicles.spawnAt(s.id, undefined, d.x + Math.sin(d.yaw) * 8, d.z + Math.cos(d.yaw) * 8, d.yaw + Math.PI / 2, 'owned');
            this.setLastVehicle(v);
            this.hud.banner('購入完了！', s.name + '（ガレージに保管するとセーブされます）', 'ok');
          }, 450);
        },
      };
    });
    items.push({ label: '閉じる', onClick: () => this.closeMenuToGame() });
    this.openMenu('NEXA MOTORS　所持金 ' + formatMoney(this.economy.money), items, '');
  }

  private openRepair(): void {
    const v = this.lastVehicle;
    const near = v && this.interiorDoor && dist2(v.st.x, v.st.z, this.interiorDoor.x, this.interiorDoor.z) < 60 * 60 && !v.destroyed;
    const cost = v ? Math.ceil(v.st.damage * 100 * REPAIR_COST_PER_PCT) : 0;
    this.openMenu("Marco's Garage", [
      { label: near ? '車を修理する' : '修理する車を店の前に停めてください', sub: near ? formatMoney(cost) : '', disabled: !near || cost === 0 || this.economy.money < cost, onClick: () => {
        if (v && this.economy.spend(cost)) {
          v.st.damage = 0;
          v.fire = 0;
          v.view?.repair();
          this.audio.ui('cash');
          this.hud.notify('修理完了！');
        }
        this.closeMenuToGame();
      } },
      { label: '塗装を変える（ランダム）', sub: formatMoney(PAINT_COST), disabled: !near || this.economy.money < PAINT_COST, onClick: () => {
        if (v && this.economy.spend(PAINT_COST)) {
          const cols = [0xb3121a, 0x1d4fa8, 0xf2b705, 0x111111, 0xf2f2f2, 0x2f7d4f, 0x5b2c83, 0xd95d1e, 0x6c757d];
          v.color = cols[Math.floor(this.rng.next() * cols.length)] as number;
          v.view?.setPaint(v.color);
          this.audio.ui('cash');
          this.hud.notify('新しい塗装になった！');
        }
        this.closeMenuToGame();
      } },
      { label: '閉じる', onClick: () => this.closeMenuToGame() },
    ], '');
  }

  private refuel(): void {
    const v = this.player.vehicle;
    if (!v) return;
    const need = 60 - v.st.fuel;
    if (need < 1) {
      this.hud.notify('燃料は満タン');
      return;
    }
    const cost = Math.ceil(need * FUEL_PRICE);
    if (!this.economy.spend(cost)) {
      this.hud.notify('お金が足りない');
      return;
    }
    v.st.fuel = 60;
    this.audio.ui('cash');
    this.hud.notify('満タンにした ' + formatMoney(cost));
  }

  private storeVehicle(key: string): void {
    const v = this.player.vehicle;
    if (!v) return;
    if (v.tag) {
      this.hud.notify('ミッションの車は保管できない');
      return;
    }
    if (v.spec.category === 'police' || v.spec.category === 'ambulance' || v.spec.category === 'fire') {
      this.hud.notify('緊急車両は保管できない');
      return;
    }
    if (!this.economy.storeVehicle(key, { specId: v.spec.id, color: v.color, damage: v.st.damage })) {
      this.hud.notify('ガレージがいっぱい');
      return;
    }
    this.exitVehicle(true);
    if (this.lastVehicle === v) this.lastVehicle = null;
    this.vehicles.remove(v);
    this.hud.notify(v.spec.name + ' をガレージに保管した');
    this.save(true);
  }

  private openGarage(key: string): void {
    const list = this.economy.s.garages[key] ?? [];
    const cap = this.economy.garageCapacity(key);
    const items: MenuItem[] = list.map((sv, i) => ({
      label: vehicleById(sv.specId).name,
      sub: '損傷 ' + Math.round(sv.damage * 100) + '%　出庫する',
      onClick: () => {
        const taken = this.economy.takeVehicle(key, i);
        const d = this.interiorDoor;
        this.closeMenuToGame();
        if (!taken || !d) return;
        this.exitInterior();
        window.setTimeout(() => {
          const v = this.vehicles.spawnAt(taken.specId, taken.color, d.x + Math.sin(d.yaw) * 7, d.z + Math.cos(d.yaw) * 7, d.yaw + Math.PI / 2, 'owned');
          v.st.damage = taken.damage;
          this.setLastVehicle(v);
          this.hud.notify(v.spec.name + ' を出庫した');
        }, 450);
      },
    }));
    if (items.length === 0) items.push({ label: '保管している車はありません（車で入口に近づき E で保管）', disabled: true, onClick: () => undefined });
    items.push({ label: '閉じる', onClick: () => this.closeMenuToGame() });
    this.openMenu(`ガレージ（${list.length}/${cap}）`, items, '');
  }

  private sleep(): void {
    this.openMenu('ベッド', [
      { label: 'セーブする', primary: true, onClick: () => { this.save(); this.closeMenuToGame(); } },
      { label: '8時間眠る（セーブ）', onClick: () => {
        this.closeMenuToGame();
        this.hud.fade(1);
        window.setTimeout(() => {
          this.clock.hours += 8;
          this.player.health = 100;
          this.save();
          this.hud.fade(0);
        }, 600);
      } },
      { label: '閉じる', onClick: () => this.closeMenuToGame() },
    ], '');
  }

  // ------------------------------------------------------------ death / arrest
  private die(kind: 'wasted' | 'busted'): void {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.deadKind = kind;
    this.deadTimer = 4;
    if (this.player.vehicle) this.exitVehicle(true);
    if (kind === 'wasted') {
      this.player.mode = 'down';
      this.player.downT = 99;
      this.stats.wasted++;
      this.hud.bustedScreen('WASTED', '意識を失った…', '#e63946');
    } else {
      this.player.frozen = true;
      this.stats.busted++;
      this.hud.bustedScreen('BUSTED', '逮捕された', '#4cc9f0');
    }
    this.audio.ui('fail');
    if (this.missions.active) this.missions.fail(kind === 'wasted' ? '倒れてしまった' : '逮捕された');
  }

  private respawn(): void {
    const kind = this.deadKind;
    const poi = kind === 'wasted' ? 'hospital' : 'police';
    const d = this.W.wd.doors.find((q) => q.poi.id === poi);
    let msg: string;
    if (kind === 'wasted') {
      const fee = this.economy.fine(HOSPITAL_FEE);
      msg = '病院の治療費 ' + formatMoney(fee);
    } else {
      const fee = this.economy.fine(BUSTED_FINE_PER_STAR * Math.max(1, this.wanted.level));
      msg = '罰金 ' + formatMoney(fee);
    }
    this.wanted.clear();
    this.police.clearAll();
    this.player.health = 100;
    this.player.mode = 'foot';
    this.player.frozen = false;
    this.player.downT = 0;
    if (d) this.player.teleport(d.x + Math.sin(d.yaw) * 2, d.z + Math.cos(d.yaw) * 2, d.yaw);
    this.rig.resetBehind(this.player.yaw);
    this.hud.hideBusted();
    this.hud.notify(msg);
    this.state = 'playing';
    this.W.terrain.update(new THREE.Vector3(this.player.x, 0, this.player.z), true);
  }

  // ------------------------------------------------------------ missions
  private onMissionEnd(): void {
    const r = this.missions.lastResult;
    if (!r) return;
    if (r.success) {
      this.hud.banner('MISSION PASSED', r.title + (r.money > 0 ? '　報酬 ' + formatMoney(r.money) : ''), 'big', 4.5);
      this.save(true);
    } else this.hud.banner('MISSION FAILED', r.reason, 'fail', 4);
    this.missions.lastResult = null;
    this.refreshMapBlips();
  }

  // ------------------------------------------------------------ achievements & areas
  private checkAchievements(dt: number): void {
    this.achTimer -= dt;
    if (this.achTimer > 0) return;
    this.achTimer = 1.5;
    let owned = 0;
    for (const k of Object.keys(this.economy.s.garages)) owned += (this.economy.s.garages[k] ?? []).length;
    if (this.lastVehicle) owned++;
    const ctx: AchievementCtx = {
      stats: this.stats,
      completed: this.missions.completed,
      collectibles: this.collected.size,
      totalCollectibles: this.W.wd.collectibles.length,
      money: this.economy.money,
      properties: this.economy.s.properties.length,
      vehiclesOwned: owned,
      maxWanted: this.wanted.maxLevelReached,
      racesWon: this.missions.stats.racesWon,
      trialsWon: this.missions.stats.trialsWon,
      deliveries: this.missions.stats.deliveries,
    };
    for (const a of ACHIEVEMENTS) {
      if (this.achievements.has(a.id)) continue;
      if (a.check(ctx)) {
        this.achievements.add(a.id);
        this.hud.notify('🏆 実績解除：' + a.name);
        this.audio.ui('success');
      }
    }
  }

  private areaAt(x: number, z: number, y: number): string | null {
    if (x > -150 && x < 450 && z > -750 && z < -150) return 'downtown';
    if (x > 905 && z < 640 && coastDistance(x, z) < 160) return 'beach';
    if (inRect(AIRPORT_RECT, x, z)) return 'airport';
    if (x > PORT.x0 && z > PORT.z0 && z < PORT.z1) return 'port';
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < 450) return 'lake';
    if (inRect(TOWN_RECT, x, z)) return 'town';
    if (Math.hypot(x - SIGN_POS.x, z - SIGN_POS.z) < 120) return 'sign';
    if (z < -950 && z > -1400 && x > -800 && x < 300) return 'hills';
    if (z > 600 && x > -300 && x < 600 && z < 1100) return 'industrial';
    if (this.W.hf.onDeck(x, z, y)) return 'freeway';
    return null;
  }

  private updateAreas(dt: number): void {
    this.areaTimer -= dt;
    if (this.areaTimer > 0) return;
    this.areaTimer = 1;
    const a = this.areaAt(this.player.x, this.player.z, this.player.y);
    if (a && !this.stats.areas.includes(a)) {
      this.stats.areas.push(a);
      const name = AREAS.find((q) => q.id === a)?.name ?? a;
      this.hud.notify('新しいエリア：' + name);
    }
  }

  // ------------------------------------------------------------ render
  private render(dt: number, alpha: number, running: boolean): void {
    this.renderer.info.reset();
    const W = this.W;
    const p = this.player;
    const time = this.simTime;
    U.uTime.value = time;
    const night = this.clock.nightFactor();
    const wc = this.weather.current;
    U.uNight.value = night;
    U.uWet.value = this.weather.wetness;
    U.uRain.value = wc.rain;
    U.uWind.value = wc.wind;
    U.uFlash.value = this.weather.lightningFlash;
    // player visual
    const rig = this.playerRig;
    const pose = this.playerPose;
    const v = p.vehicle;
    let headPos: THREE.Vector3;
    if (v && v.view) {
      v.view.driverSlot.add(rig.mesh);
      rig.mesh.position.set(0, -0.48 + 0.05, 0);
      rig.mesh.rotation.set(0, 0, 0);
      pose.mode = v.spec.shape === 'bike' ? 'ride' : 'drive';
      pose.steer = v.st.steerAngle / Math.max(0.1, v.spec.steerMax);
      rig.mesh.visible = !(this.rig.mode === 'first');
    } else {
      if (rig.mesh.parent !== this.scene) this.scene.add(rig.mesh);
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      const z = p.pz + (p.z - p.pz) * alpha;
      rig.mesh.position.set(x, y, z);
      rig.mesh.rotation.set(0, p.yaw, 0);
      rig.mesh.visible = this.rig.mode !== 'first' || this.state === 'dead';
      const sp = p.speed;
      let mode: PoseState['mode'] = 'idle';
      if (p.mode === 'down' || (this.state === 'dead' && this.deadKind === 'wasted')) mode = 'down';
      else if (p.mode === 'swim') mode = 'swim';
      else if (this.dancing) mode = 'dance';
      else if (p.punchT > 0) mode = 'punch';
      else if (!p.onGround && p.airT > 0.15) mode = p.vy > 0 ? 'jump' : 'fall';
      else if (sp > 5.5) mode = 'sprint';
      else if (sp > 2.6) mode = 'run';
      else if (sp > 0.25) mode = 'walk';
      if (this.state === 'dead' && this.deadKind === 'busted') mode = 'cower';
      if (mode !== pose.mode) {
        pose.mode = mode;
        pose.t = 0;
      }
      pose.speed = sp;
      pose.phase += sp * dt * (sp > 3 ? 2.0 : 3.4);
      if (mode === 'punch') pose.t = 0.45 - p.punchT;
    }
    pose.t += dt;
    pose.time = time;
    applyPose(rig, pose, dt);
    // camera
    if (v) {
      const sp = Math.hypot(v.st.vx, v.st.vz);
      const vx = v.st.px + (v.st.x - v.st.px) * alpha;
      const vy = v.st.py + (v.st.y - v.st.py) * alpha;
      const vz = v.st.pz + (v.st.z - v.st.pz) * alpha;
      let seat: THREE.Vector3 | null = null;
      if (v.view) {
        v.view.group.updateMatrixWorld();
        seat = this.seatTmp.copy(v.view.geo.seat).applyMatrix4(v.view.body.matrixWorld);
      }
      this.rig.updateVehicle(dt, this.tmpV.set(vx, vy, vz), v.st.yaw, sp, v.spec.length / 4.5, seat, this.input.isDown('lookBack'), W.world, W.ground);
      headPos = this.headTmp.copy(this.tmpV);
    } else {
      const h = this.headTmp.copy(rig.mesh.position);
      h.y += p.mode === 'swim' ? 1.1 : p.mode === 'down' ? 0.5 : 1.62 * this.playerLook.height;
      const world = this.interior ? this.interior.world : W.world;
      const ground = this.interior ? { groundAt: (): number => (this.interior as Interior).floorY } : W.ground;
      this.rig.updateFoot(dt, h, p.yaw, world, ground as unknown as typeof W.ground);
      headPos = h;
    }
    const cam = this.rig.cam;
    // world systems
    if (!this.interior) {
      const sun = this.sunTmp;
      this.clock.sunDir(sun);
      this.atmo.update(dt, { sunDir: sun, night, cloud: wc.cloud, rain: wc.rain, fog: wc.fog, flash: this.weather.lightningFlash }, cam, headPos);
      this.scene.environmentIntensity = this.atmo.envIntensity;
      W.terrain.update(cam.position);
      W.vegetation.update(cam.position, headPos);
      W.vegetation.setGrassVisible(this.q.grass);
      W.props.update(dt, cam.position, W.graph, this.traffic.time, this.q.viewDistance);
      W.water.update(dt, cam.position, wc.wind, time);
      W.landmarks.update(dt, night, time);
      for (const s of W.signs) {
        const m = s.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = (m.userData['neon'] ? 0.4 + night * 2.6 : 0.3 + night * 0.9);
      }
      if (!this.neonMats) {
        const list: THREE.MeshStandardMaterial[] = [];
        W.billboards.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (m && m.userData && m.userData['neon'] && !list.includes(m)) list.push(m);
        });
        this.neonMats = list;
      }
      for (const m of this.neonMats) m.emissiveIntensity = 0.3 + night * 2.2;
      this.vehicles.updateViews(cam.position, alpha, night, this.weather.wetness > 0.2, wc.rain > 0.05);
      this.peds.updateViews(dt, cam.position, alpha);
      this.effects.update(dt);
      this.rain.update(dt, cam.position, (x, z) => W.ground.groundAt(x, z, cam.position.y), wc.rain);
      this.updateNightLights(night);
      this.updateMarkers(dt, time);
      for (const m of this.postcardMeshes) {
        m.rotation.y = time * 1.5;
        m.position.y += Math.sin(time * 2 + m.position.x) * 0.002;
      }
      const under = W.ground.waterAt(cam.position.x, cam.position.z) > cam.position.y ? 1 : 0;
      (this.post.uniform('uUnder') as THREE.IUniform<number>).value = under;
    } else {
      this.scene.environmentIntensity = 0.35;
      (this.post.uniform('uUnder') as THREE.IUniform<number>).value = 0;
    }
    // post uniforms
    const spd = v ? Math.hypot(v.st.vx, v.st.vz) : 0;
    (this.post.uniform('uTime') as THREE.IUniform<number>).value = time;
    (this.post.uniform('uSpeed') as THREE.IUniform<number>).value = this.q.motionBlur ? smoothstep(22, 70, spd) : 0;
    (this.post.uniform('uFlash') as THREE.IUniform<number>).value = this.interior ? 0 : this.weather.lightningFlash;
    (this.post.uniform('uRain') as THREE.IUniform<number>).value = !this.interior && this.rig.mode === 'first' && v ? 0 : this.interior ? 0 : wc.rain * 0.7;
    (this.post.uniform('uDamage') as THREE.IUniform<number>).value = clamp(p.hurtFlash + (p.health < 25 ? 0.35 : 0), 0, 1);
    (this.post.uniform('uDesat') as THREE.IUniform<number>).value = this.state === 'dead' ? 0.85 : this.wanted.level > 0 ? 0.05 : 0;
    this.clock.sunDir(this.sunTmp);
    const golden = 1 - smoothstep(0.05, 0.35, this.sunTmp.y);
    const tint = this.post.uniform('uTint') as THREE.IUniform<THREE.Vector3>;
    tint.value.set(lerp(1, 1.06, golden * (1 - night)), 1, lerp(1, 0.94, golden * (1 - night)));
    tint.value.lerp(this.nightTint, night * 0.6);
    this.post.setBloom(this.interior ? 0.3 : lerp(0.26, 0.42, night) + wc.rain * 0.05, this.interior ? 1.1 : lerp(1.0, 1.35, night));
    this.post.setFocus(this.rig.mode === 'first' ? 20 : this.rig.dist + 0.5);
    this.renderer.toneMappingExposure = this.interior ? 1.0 : lerp(0.95, 1.12, night) * lerp(1, 1.08, wc.cloud);
    this.post.render(dt);
    // audio + HUD
    this.updateAudio(cam);
    if (running || this.state === 'menu' || this.state === 'map') this.updateHUD(dt);
  }

  private updateNightLights(night: number): void {
    const out: { x: number; y: number; z: number; yaw: number }[] = [];
    this.W.props.nearestLights(this.player.x, this.player.z, 4, out as never);
    for (let i = 0; i < this.lightsPL.length; i++) {
      const l = this.lightsPL[i] as THREE.PointLight;
      const s = out[i];
      if (!s || night < 0.15) {
        l.intensity = 0;
        continue;
      }
      l.position.set(s.x + Math.sin(s.yaw) * 2.3, s.y + 7.8, s.z + Math.cos(s.yaw) * 2.3);
      l.intensity = 60 * night;
    }
  }

  private updateMarkers(dt: number, time: number): void {
    // mission start markers
    const avail = this.missions.active ? [] : this.missions.available();
    while (this.missionMarkers.length < avail.length) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      this.markerGroup.add(m);
      this.missionMarkers.push({ mesh: m, x: 0, z: 0 });
    }
    this.missionMarkers.forEach((mm, i) => {
      const m = avail[i];
      mm.mesh.visible = !!m;
      if (!m) return;
      const at = this.missions.resolve(m.at);
      const y = this.W.ground.groundAt(at.x, at.z, 60);
      mm.mesh.position.set(at.x, y + 1.1, at.z);
      (mm.mesh.material as THREE.MeshBasicMaterial).color.setHex(m.kind === 'main' ? 0xf2b705 : 0x4cc9f0);
      mm.mesh.scale.set(1 + Math.sin(time * 3) * 0.05, 1, 1 + Math.sin(time * 3) * 0.05);
    });
    // objective marker
    const mk = this.missions.marker;
    this.objMarker.visible = false;
    this.cpRing.visible = false;
    this.arrow.visible = false;
    if (mk) {
      const y = this.W.ground.groundAt(mk.x, mk.z, 60);
      if (mk.kind === 'checkpoint') {
        this.cpRing.visible = true;
        this.cpRing.position.set(mk.x, y + 6.5, mk.z);
        const nx = mk.next ? mk.next.x - mk.x : 0;
        const nz = mk.next ? mk.next.z - mk.z : 1;
        this.cpRing.rotation.set(0, yawOf(nx, nz), 0);
      } else if (mk.kind === 'vehicle') {
        this.arrow.visible = true;
        const v = this.missions.step && 'tag' in this.missions.step ? this.vehicles.byTag((this.missions.step as { tag: string }).tag) : null;
        const h = v ? v.spec.height : 1.5;
        this.arrow.position.set(mk.x, y + h + 2 + Math.sin(time * 4) * 0.3, mk.z);
        this.arrow.rotation.y = time * 2;
      } else {
        this.objMarker.visible = true;
        const r = mk.kind === 'pickup' ? 1.2 : Math.min(mk.r, 8);
        this.objMarker.position.set(mk.x, y + 1.2, mk.z);
        this.objMarker.scale.set(r, 2.4, r);
        (this.objMarker.material as THREE.MeshBasicMaterial).color.setHex(mk.kind === 'pickup' ? 0x4cc9f0 : 0xf2b705);
      }
    }
    // GPS route
    this.gpsTimer -= dt;
    const target = mk ? { x: mk.x, z: mk.z } : this.waypoint;
    if (this.waypoint && Math.hypot(this.waypoint.x - this.player.x, this.waypoint.z - this.player.z) < 25) {
      this.waypoint = null;
      this.hud.notify('目的地に到着');
    }
    if (target && (this.gpsTimer <= 0 || !this.gpsTarget || Math.hypot(this.gpsTarget.x - target.x, this.gpsTarget.z - target.z) > 20)) {
      this.gpsTimer = 2;
      this.gpsTarget = { x: target.x, z: target.z };
      const p = this.ctxPlayerPos();
      const route = this.W.graph.route(this.W.graph.nearestNode(p.x, p.z), this.W.graph.nearestNode(target.x, target.z));
      const path = lanePathForRoute(this.W.graph, route);
      this.gps = [{ x: p.x, z: p.z }, ...path, { x: target.x, z: target.z }];
    }
    if (!target) this.gps = null;
  }

  private updateAudio(cam: THREE.PerspectiveCamera): void {
    const a = this.audio;
    if (!a.ctx) return;
    const f = new THREE.Vector3();
    cam.getWorldDirection(f);
    a.setListener(cam.position.x, cam.position.y, cam.position.z, f.x, f.y, f.z);
    const p = this.player;
    // engines: player first, then nearest moving
    this.engineParams.length = 0;
    const inside = this.interior ? 1 : 0;
    if (!this.interior) {
      const list = this.vehicles.list
        .filter((v) => v.view && (v.driver !== 'none' || v === p.vehicle))
        .map((v) => ({ v, d: dist2(v.st.x, v.st.z, cam.position.x, cam.position.z) }))
        .sort((x, y) => (x.v === p.vehicle ? -1 : y.v === p.vehicle ? 1 : x.d - y.d))
        .slice(0, 5);
      for (const { v } of list) {
        const mine = v === p.vehicle;
        this.engineParams.push({
          id: v.id,
          x: v.st.x,
          y: v.st.y + 0.6,
          z: v.st.z,
          rpm: v.st.engineOn ? v.st.rpm : 0,
          throttle: mine ? v.input.throttle : v.agent ? clamp(v.agent.speed / 15, 0.1, 0.6) : v.input.throttle,
          slip: v.st.onGround ? Math.max(v.st.slipRear, v.st.slipFront * 0.7, v.st.wheelslip * 0.5) * (Math.hypot(v.st.vx, v.st.vz) > 3 ? 1 : 0) : 0,
          volume: mine ? 1 : 0.6,
          cylinders: v.spec.shape === 'bike' ? 2 : v.spec.mass > 5000 ? 6 : v.spec.category === 'super' || v.spec.category === 'muscle' ? 8 : 4,
        });
      }
      // siren of nearest police
      const sirenCar = this.vehicles.list.find((v) => v.siren && dist2(v.st.x, v.st.z, cam.position.x, cam.position.z) < 300 * 300);
      a.siren(!!sirenCar, sirenCar ? sirenCar.st.x : 0, sirenCar ? sirenCar.st.y : 0, sirenCar ? sirenCar.st.z : 0);
    } else a.siren(false, 0, 0, 0);
    a.updateEngines(this.engineParams);
    // ambience
    const W = this.W;
    const x = p.x;
    const z = p.z;
    const city = clamp(1 - Math.max(0, Math.abs(x - 0) - 900) / 600, 0, 1) * clamp(1 - Math.max(0, Math.abs(z - 0) - 950) / 500, 0, 1);
    const coast = clamp(1 - coastDistance(x, z) / 220, 0, 1);
    const wc = this.weather.current;
    const height = clamp((p.y - 20) / 200, 0, 1);
    const speedWind = p.vehicle ? clamp(Math.hypot(p.vehicle.st.vx, p.vehicle.st.vz) / 40, 0, 1) * 0.5 : 0;
    const birds = (1 - this.clock.nightFactor()) * (1 - wc.rain) * (W.ground.surfaceKind(x, z, p.y) === 'grass' ? 1 : 0.3);
    const crowd = this.interior && this.interior.id === 'club' ? 1 : this.interior && this.interior.id === 'mall' ? 0.6 : 0;
    a.ambience(city * (1 - this.clock.nightFactor() * 0.5), coast, Math.min(1, wc.wind * 0.8 + height + speedWind), wc.rain, birds, crowd, inside);
    a.updateRadio();
    void this.talkBabble;
  }

  private updateHUD(dt: number): void {
    const hud = this.hud;
    const p = this.player;
    hud.update(dt);
    hud.setMoney(this.economy.money, dt);
    hud.setWanted(this.wanted.level, this.wanted.searching);
    const h = this.clock.hourOfDay;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    hud.setClock(`DAY ${this.clock.day}  ${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}  ${WEATHER_LABEL[this.weather.kind]}`);
    hud.setBars(p.health, p.stamina);
    const m = this.missions;
    let obj = m.active ? m.objective : '';
    if (m.countdown > 0) obj = m.countdown > 0.5 ? String(Math.ceil(m.countdown - 0.5)) : 'GO!';
    hud.setObjective(obj, m.timer);
    const v = p.vehicle;
    if (v) {
      const kmh = Math.abs(forwardSpeed(v.st)) * 3.6;
      hud.speed(true, kmh, v.st.gear, v.st.rpm / v.spec.redline, v.st.fuel / 60, v.st.damage, v.spec.name);
    } else hud.speed(false, 0, 0, 0, 0, 0, '');
    hud.arrest(this.police.bustedProgress);
    // prompts
    let prompt: [string, string] | null = null;
    const touch = this.touch.enabled;
    const keyE = touch ? 'E' : 'E';
    const keyF = touch ? '乗る' : 'F';
    if (this.state === 'playing') {
      if (this.interior) {
        const pt = this.interactPoint();
        if (pt) prompt = [keyE, pt.label];
      } else if (m.dialog) {
        prompt = null;
      } else {
        const mi = this.nearestMission();
        if (mi) prompt = [keyE, 'ミッション：' + mi.title];
        else if (v) {
          if (this.nearPump()) prompt = [keyE, '給油する（$' + FUEL_PRICE.toFixed(1) + '/L）'];
          else if (this.garageDoorNear() && !v.tag) prompt = [keyE, 'ガレージに保管'];
        } else {
          const d = this.nearestDoor();
          if (d) {
            const owned = d.poi.kind !== 'property' || this.economy.owns(d.poi.id);
            prompt = [keyE, owned ? d.poi.name + ' に入る' : d.poi.name + '（購入できます）'];
          } else {
            const nv = this.vehicles.nearest(p.x, p.z, 4.5, (q) => !q.destroyed && q.kind !== 'rival');
            if (nv && p.mode === 'foot') prompt = [keyF, (nv.driver === 'npc' ? '車を奪う：' : '乗る：') + nv.spec.name];
          }
        }
      }
    }
    if (prompt) hud.prompt(prompt[0], prompt[1]);
    else hud.prompt(null);
    // minimap
    if (!this.interior) {
      const blips: Blip[] = this.collectBlips(false);
      const heading = this.settings.minimapRotate ? this.rig.yaw : 0;
      hud.drawMinimap(this.ctxPlayerPos().x, this.ctxPlayerPos().z, this.settings.minimapRotate ? heading : p.yaw, this.settings.minimapRotate, blips, this.gps);
    }
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.frameTimes.length);
    hud.fps(`${Math.round(1 / Math.max(avg, 1e-3))} fps  ${this.renderer.info.render.calls} draws  ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k tris`);
  }

  private collectBlips(full: boolean): Blip[] {
    const blips: Blip[] = [];
    if (full || true) {
      for (const d of this.W.wd.doors) blips.push({ x: d.x, z: d.z, kind: 'poi', icon: d.poi.icon, label: d.poi.name });
      for (const poi of POIS) if (poi.at && !poi.interior) blips.push({ x: poi.at.x, z: poi.at.z, kind: 'poi', icon: poi.icon, label: poi.name });
    }
    for (const m of this.missions.available()) {
      const at = this.missions.resolve(m.at);
      blips.push({ x: at.x, z: at.z, kind: 'mission', icon: m.kind === 'main' ? '!' : '?', label: m.title });
    }
    const mk = this.missions.marker;
    if (mk) blips.push({ x: mk.x, z: mk.z, kind: mk.kind === 'vehicle' ? 'target' : mk.kind === 'checkpoint' ? 'checkpoint' : mk.kind === 'drop' ? 'drop' : 'pickup' });
    if (this.waypoint) blips.push({ x: this.waypoint.x, z: this.waypoint.z, kind: 'waypoint', label: '目的地' });
    for (const c of this.police.cars) blips.push({ x: c.st.x, z: c.st.z, kind: 'police' });
    for (const r of this.raceRivals) blips.push({ x: r.st.x, z: r.st.z, kind: 'vehicle' });
    if (this.lastVehicle && this.lastVehicle !== this.player.vehicle && this.vehicles.list.includes(this.lastVehicle)) blips.push({ x: this.lastVehicle.st.x, z: this.lastVehicle.st.z, kind: 'vehicle', label: 'あなたの車' });
    if (full) this.W.wd.collectibles.forEach((c, i) => {
      if (!this.collected.has(i)) blips.push({ x: c.x, z: c.z, kind: 'collectible' });
    });
    return blips;
  }

  private refreshMapBlips(): void {
    this.hud.mapView.blips = this.collectBlips(true);
    this.hud.mapView.draw();
  }

  // ------------------------------------------------------------ menus
  private openMenu(title: string, items: MenuItem[], html: string): void {
    this.state = 'menu';
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.clearAll();
    this.hud.menu(title, items, () => this.closeMenuToGame(), html);
  }

  closeMenuToGame(): void {
    this.hud.closeMenu();
    this.input.clearAll();
    if (this.state === 'menu') this.state = 'playing';
    this.lastT = performance.now();
  }

  private openMap(): void {
    this.state = 'map';
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.clearAll();
    this.refreshMapBlips();
    const pp = this.ctxPlayerPos();
    this.hud.mapView.show(pp.x, pp.z, this.player.vehicle ? this.player.vehicle.st.yaw : this.player.yaw);
  }

  private closeMap(): void {
    this.hud.mapView.hide();
    this.input.clearAll();
    this.state = 'playing';
    this.lastT = performance.now();
  }

  openPause(): void {
    if (this.state !== 'playing') return;
    const m = this.missions;
    const items: MenuItem[] = [
      { label: 'ゲームに戻る', primary: true, onClick: () => this.closeMenuToGame() },
      { label: 'マップ', onClick: () => { this.hud.closeMenu(); this.openMap(); } },
      { label: 'ミッション一覧', onClick: () => this.openMissionList() },
      { label: '所持品', onClick: () => this.openInventory() },
      { label: '実績・統計', onClick: () => this.openAchievements() },
      { label: '設定', onClick: () => this.openSettings() },
      { label: '操作方法', onClick: () => this.openControls() },
      { label: 'セーブ', sub: m.active || this.wanted.level > 0 ? 'ミッション中/手配中は不可' : '', disabled: !!m.active || this.wanted.level > 0, onClick: () => { this.save(); this.closeMenuToGame(); } },
    ];
    if (m.active) items.push({ label: 'ミッションを中止', sub: m.active.title, onClick: () => { m.abort(); this.closeMenuToGame(); } });
    items.push({ label: 'タイトルに戻る', onClick: () => location.reload() });
    this.openMenu('ポーズ', items, `<p style="opacity:.75;margin:0 0 8px">所持金 ${formatMoney(this.economy.money)}　体力 ${Math.round(this.player.health)}　絵はがき ${this.collected.size}/${this.W.wd.collectibles.length}</p>`);
  }

  private openMissionList(): void {
    const items: MenuItem[] = MISSIONS.map((m) => {
      const done = this.missions.completed.has(m.id);
      const avail = this.missions.available().includes(m);
      const at = this.missions.resolve(m.at);
      return {
        label: (m.kind === 'main' ? '【メイン】' : '【サブ】') + m.title + (done ? ' ✓' : ''),
        sub: avail ? '受注可能：地図に設定' : done ? (m.repeatable ? 'クリア済み（再挑戦可）' : 'クリア済み') : 'ロック中',
        disabled: !avail,
        onClick: () => {
          this.waypoint = { x: at.x, z: at.z };
          this.gpsTimer = 0;
          this.hud.notify(m.title + ' の場所を目的地に設定');
          this.closeMenuToGame();
        },
      };
    });
    items.push({ label: '戻る', onClick: () => { this.hud.closeMenu(); this.state = 'playing'; this.openPause(); } });
    this.openMenu('ミッション', items, '');
  }

  private openAchievements(): void {
    const s = this.stats;
    const html =
      `<p style="font-size:13px;opacity:.8;line-height:1.7">プレイ時間 ${Math.floor(s.timePlayed / 60)}分　運転距離 ${(s.distanceDriven / 1000).toFixed(1)}km　徒歩 ${(s.distanceWalked / 1000).toFixed(1)}km<br>最高速度 ${Math.round(s.maxSpeed * 3.6)}km/h　最長ジャンプ ${s.maxAir.toFixed(1)}秒　盗んだ車 ${s.carsStolen}台　逃走成功 ${s.escapes}回<br>` +
      `訪れたエリア ${s.areas.length}/${AREAS.length}　実績 ${this.achievements.size}/${ACHIEVEMENTS.length}</p>`;
    const items: MenuItem[] = ACHIEVEMENTS.map((a) => ({ label: (this.achievements.has(a.id) ? '🏆 ' : '🔒 ') + a.name, sub: a.desc, disabled: !this.achievements.has(a.id), onClick: () => undefined }));
    items.push({ label: '戻る', onClick: () => { this.hud.closeMenu(); this.state = 'playing'; this.openPause(); } });
    this.openMenu('実績・統計', items, html);
  }

  private openControls(): void {
    const html = `<div style="font-size:14px;line-height:1.8">
      <b>徒歩</b>：WASD 移動 / マウス 視点 / Shift ダッシュ / Space ジャンプ / Q・クリック パンチ / F 車に乗る / E 調べる・入る<br>
      <b>車</b>：W アクセル / S ブレーキ・バック / A D ハンドル / Space サイドブレーキ / H ホーン / L ライト / Z X ウインカー / R ラジオ / C 後方確認 / F 降りる<br>
      <b>共通</b>：V 視点切替（三人称/一人称）/ ホイール ズーム / M 地図 / I 所持品 / Esc ポーズ / Enter 会話送り<br>
      <b>ゲームパッド</b>：左スティック 移動・ハンドル / 右スティック 視点 / RT アクセル / LT ブレーキ / A ジャンプ / B 乗降 / X パンチ / Y 調べる<br>
      <b>スマホ</b>：左スティック 移動・ハンドル / 右側ドラッグ 視点 / 画面ボタンで各操作（ホーム画面に追加して全画面プレイ推奨）</div>`;
    this.openMenu('操作方法', [{ label: '戻る', onClick: () => { this.hud.closeMenu(); this.state = 'playing'; this.openPause(); } }], html);
  }

  private openSettings(): void {
    this.state = 'menu';
    const body = this.hud.custom('設定', () => { this.hud.closeMenu(); this.state = 'playing'; this.openPause(); });
    const s = this.settings;
    const row = (label: string, ctrl: HTMLElement): void => {
      const r = document.createElement('div');
      r.className = 'set';
      const l = document.createElement('span');
      l.textContent = label;
      r.append(l, ctrl);
      body.appendChild(r);
    };
    const select = (opts: [string, string][], value: string, on: (v: string) => void): HTMLSelectElement => {
      const e = document.createElement('select');
      for (const [v, t] of opts) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        if (v === value) o.selected = true;
        e.appendChild(o);
      }
      e.addEventListener('change', () => on(e.value));
      return e;
    };
    const range = (min: number, max: number, step: number, value: number, on: (v: number) => void): HTMLInputElement => {
      const e = document.createElement('input');
      e.type = 'range';
      e.min = String(min);
      e.max = String(max);
      e.step = String(step);
      e.value = String(value);
      e.addEventListener('input', () => on(Number(e.value)));
      return e;
    };
    const check = (value: boolean, on: (v: boolean) => void): HTMLSelectElement => select([['1', 'ON'], ['0', 'OFF']], value ? '1' : '0', (v) => on(v === '1'));
    let needReload = false;
    row('画質プリセット（再読み込み）', select([['low', '低（スマホ向け）'], ['medium', '中'], ['high', '高'], ['ultra', '最高（高性能PC）']], s.tier, (v) => { s.tier = v as UserSettings['tier']; s.autoQuality = false; needReload = true; }));
    row('解像度スケール（再読み込み）', select([['0.6', '60%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%']], String(s.resScale), (v) => { s.resScale = Number(v); needReload = true; }));
    row('FPS上限', select([['0', '無制限'], ['60', '60'], ['30', '30']], String(s.fpsLimit), (v) => { s.fpsLimit = Number(v); this.q.fpsLimit = s.fpsLimit; }));
    row('影（再読み込み）', check(s.shadows, (v) => { s.shadows = v; needReload = true; }));
    row('ブルーム（再読み込み）', check(s.bloom, (v) => { s.bloom = v; needReload = true; }));
    row('アンビエントオクルージョン（高/最高・再読み込み）', check(s.ao, (v) => { s.ao = v; needReload = true; }));
    row('被写界深度（高負荷・再読み込み）', check(s.dof, (v) => { s.dof = v; needReload = true; }));
    row('モーションブラー', check(s.motionBlur, (v) => { s.motionBlur = v; this.q.motionBlur = v; }));
    row('交通量', range(0.3, 1.5, 0.1, s.trafficScale, (v) => { s.trafficScale = v; this.vehicles.density.traffic = Math.round(effectiveQuality(s).traffic); }));
    row('歩行者の数', range(0.3, 1.5, 0.1, s.pedScale, (v) => { s.pedScale = v; this.peds.density = Math.round(effectiveQuality(s).peds); }));
    row('時間の速さ（分/秒）', select([['0.5', '0.5'], ['1', '1（標準）'], ['2', '2'], ['4', '4']], String(s.timeScale), (v) => { s.timeScale = Number(v); this.clock.minutesPerSecond = s.timeScale; }));
    row('天気を固定', select([['auto', '自動変化'], ['clear', '快晴'], ['cloudy', '晴れ時々くもり'], ['overcast', 'くもり'], ['fog', '霧'], ['lightRain', '小雨'], ['heavyRain', '豪雨'], ['storm', '雷雨']], this.weather.locked ? this.weather.kind : 'auto', (v) => {
      if (v === 'auto') this.weather.locked = false;
      else {
        this.weather.locked = true;
        this.weather.set(v as WeatherKind);
      }
    }));
    row('音量', range(0, 1, 0.05, s.volume, (v) => { s.volume = v; this.applyAudioSettings(); }));
    row('ラジオ音量', range(0, 1, 0.05, s.music, (v) => { s.music = v; this.applyAudioSettings(); }));
    row('視点感度', range(0.3, 2.5, 0.1, s.sensitivity, (v) => { s.sensitivity = v; this.input.sensitivity = v; }));
    row('上下反転', check(s.invertY, (v) => { s.invertY = v; this.input.invertY = v; }));
    row('ミニマップ回転', check(s.minimapRotate, (v) => { s.minimapRotate = v; }));
    row('会話の字幕', check(s.subtitles, (v) => { s.subtitles = v; }));
    row('FPS表示', check(this.hud.showFps, (v) => { this.hud.showFps = v; }));
    const done = document.createElement('button');
    done.className = 'btn primary';
    done.textContent = '保存して閉じる';
    done.addEventListener('click', () => {
      this.saveSettings();
      if (needReload) {
        this.save(true);
        location.reload();
        return;
      }
      this.hud.closeMenu();
      this.state = 'playing';
      this.openPause();
    });
    body.appendChild(done);
  }
}
