// Mission runner: executes data-driven steps, tracks objectives, timers, failure.

import { Rng } from '../core/rng';
import { MISSIONS, type Loc, type MissionDef, type Pt, type Step } from '../data/missions';

export interface PlayerInfo {
  x: number;
  y: number;
  z: number;
  inVehicle: boolean;
  vehicleTag: string | null;
  speed: number;
}

export interface MissionCtx {
  player(): PlayerInfo;
  poiPos(id: string): Pt;
  spawnVehicle(tag: string, spec: string, x: number, z: number, yaw: number, color: number | undefined, ai: 'none' | 'flee' | 'boss'): void;
  vehicleInfo(tag: string): { x: number; z: number; damage: number; speed: number; disabled: boolean } | null;
  clearMissionVehicles(): void;
  setWanted(level: number): void;
  wanted(): number;
  setHour(h: number): void;
  setWeather(kind: 'clear' | 'storm' | 'lightRain' | 'fog'): void;
  reward(money: number, vehicle?: string): void;
  startRace(rivals: string[], checkpoints: Pt[], start: Pt, yaw: number): void;
  prepareStart(start: Pt, yaw: number): void;
  rivalsFinished(): number;
  endRace(): void;
  sfx(name: 'checkpoint' | 'success' | 'fail' | 'pickup' | 'start'): void;
  notify(text: string): void;
}

export interface Marker {
  x: number;
  z: number;
  r: number;
  kind: 'goal' | 'drop' | 'checkpoint' | 'pickup' | 'vehicle' | 'start';
  next?: Pt | undefined;
}

export interface DialogLine {
  speaker: string;
  text: string;
}

export class MissionRunner {
  active: MissionDef | null = null;
  stepIndex = 0;
  completed = new Set<string>();
  completions: Record<string, number> = {};
  objective = '';
  marker: Marker | null = null;
  timer: number | null = null;
  dialog: DialogLine | null = null;
  countdown = 0;
  lastResult: { title: string; success: boolean; reason: string; money: number } | null = null;
  private talkQueue: DialogLine[] = [];
  private talkTimer = 0;
  private stepTime = 0;
  private dropList: Pt[] = [];
  private dropIndex = 0;
  private cpIndex = 0;
  private escapeTimer = 0;
  private rng = new Rng(5150);
  private started = false;
  stats = { deliveries: 0, racesWon: 0, trialsWon: 0, chases: 0 };

  constructor(private readonly ctx: MissionCtx) {}

  /** Missions that can be started now (markers shown in the world). */
  available(): MissionDef[] {
    if (this.active) return [];
    return MISSIONS.filter((m) => {
      if (m.requires && !this.completed.has(m.requires)) return false;
      if (this.completed.has(m.id) && !m.repeatable) return false;
      // main story strictly in order: only the next unfinished main mission
      if (m.kind === 'main') {
        const mains = MISSIONS.filter((q) => q.kind === 'main');
        const next = mains.find((q) => !this.completed.has(q.id));
        return next?.id === m.id;
      }
      return true;
    });
  }

  resolve(loc: Loc): Pt {
    if ('poi' in loc) return this.ctx.poiPos(loc.poi);
    return loc;
  }

  start(id: string): boolean {
    if (this.active) return false;
    const m = MISSIONS.find((q) => q.id === id);
    if (!m) return false;
    this.active = m;
    this.stepIndex = 0;
    this.started = false;
    this.lastResult = null;
    this.ctx.sfx('start');
    this.ctx.notify('ミッション開始：' + m.title);
    this.enterStep();
    return true;
  }

  get step(): Step | null {
    if (!this.active) return null;
    return this.active.steps[this.stepIndex] ?? null;
  }

  private enterStep(): void {
    const st = this.step;
    this.stepTime = 0;
    this.marker = null;
    this.timer = null;
    this.escapeTimer = 0;
    if (!st) {
      this.complete();
      return;
    }
    this.started = true;
    switch (st.t) {
      case 'talk':
        this.talkQueue = st.lines.map(([speaker, text]) => ({ speaker, text }));
        this.nextLine();
        this.objective = '';
        break;
      case 'spawnVehicle':
        this.ctx.spawnVehicle(st.tag, st.spec, st.at.x, st.at.z, st.yaw, st.color, st.ai ?? 'none');
        this.advance();
        break;
      case 'setWanted':
        this.ctx.setWanted(st.level);
        this.ctx.notify(st.note);
        this.advance();
        break;
      case 'setTime':
        this.ctx.setHour(st.hour);
        this.advance();
        break;
      case 'weather':
        this.ctx.setWeather(st.kind);
        this.advance();
        break;
      case 'reward':
        this.ctx.reward(st.money, st.vehicle);
        this.lastMoney += st.money;
        this.advance();
        break;
      case 'deliver': {
        if (st.randomCount) {
          const pool = st.drops.slice();
          this.dropList = [];
          for (let i = 0; i < st.randomCount && pool.length > 0; i++) {
            const k = Math.floor(this.rng.next() * pool.length);
            this.dropList.push(pool.splice(k, 1)[0] as Pt);
          }
        } else this.dropList = st.drops.slice();
        this.dropIndex = 0;
        this.timer = st.timeLimit;
        this.updateDeliverMarker(st.label);
        break;
      }
      case 'race':
        this.cpIndex = 0;
        this.ctx.prepareStart(st.start, st.startYaw);
        this.ctx.startRace(st.rivals, st.checkpoints, st.start, st.startYaw);
        this.countdown = 3.5;
        this.objective = st.label;
        this.updateCpMarker(st.checkpoints);
        break;
      case 'timeTrial':
        this.cpIndex = 0;
        this.ctx.prepareStart(st.start, st.startYaw);
        this.countdown = 3.5;
        this.timer = st.timeLimit;
        this.objective = st.label;
        this.updateCpMarker(st.checkpoints);
        break;
      case 'goto': {
        const p = this.resolve(st.at);
        this.marker = { x: p.x, z: p.z, r: st.r, kind: 'goal' };
        this.objective = st.label;
        if (st.timeLimit) this.timer = st.timeLimit;
        break;
      }
      case 'pickup':
        this.marker = { x: st.at.x, z: st.at.z, r: 2.2, kind: 'pickup' };
        this.objective = st.label;
        break;
      case 'enterVehicle':
      case 'chase':
      case 'gotoVehicle':
        this.objective = st.label;
        break;
      case 'loseWanted':
        this.objective = st.label;
        break;
    }
  }

  private lastMoney = 0;

  private updateDeliverMarker(label: string): void {
    const d = this.dropList[this.dropIndex];
    if (!d) return;
    this.marker = { x: d.x, z: d.z, r: 7, kind: 'drop', next: this.dropList[this.dropIndex + 1] };
    this.objective = label + '（' + (this.dropIndex + 1) + '/' + this.dropList.length + '）';
  }

  private updateCpMarker(cps: Pt[]): void {
    const c = cps[this.cpIndex];
    if (!c) return;
    this.marker = { x: c.x, z: c.z, r: 11, kind: 'checkpoint', next: cps[this.cpIndex + 1] };
  }

  private nextLine(): void {
    const line = this.talkQueue.shift();
    this.dialog = line ?? null;
    this.talkTimer = line ? Math.min(7, 2.2 + line.text.length * 0.075) : 0;
    if (!line) this.advance();
  }

  /** Player tapped to skip the current line. */
  skipLine(): void {
    if (this.dialog) this.nextLine();
  }

  private advance(): void {
    if (!this.active) return;
    this.stepIndex++;
    this.enterStep();
  }

  private complete(): void {
    const m = this.active;
    if (!m) return;
    this.completed.add(m.id);
    this.completions[m.id] = (this.completions[m.id] ?? 0) + 1;
    this.lastResult = { title: m.title, success: true, reason: '', money: this.lastMoney };
    this.lastMoney = 0;
    this.ctx.sfx('success');
    this.cleanup();
  }

  fail(reason: string): void {
    const m = this.active;
    if (!m) return;
    this.lastResult = { title: m.title, success: false, reason, money: 0 };
    this.lastMoney = 0;
    this.ctx.sfx('fail');
    this.cleanup();
  }

  private cleanup(): void {
    const st = this.step;
    if (st && st.t === 'race') this.ctx.endRace();
    this.active = null;
    this.marker = null;
    this.timer = null;
    this.objective = '';
    this.dialog = null;
    this.talkQueue = [];
    this.countdown = 0;
    this.ctx.clearMissionVehicles();
  }

  abort(): void {
    if (this.active) this.fail('ミッションを中止した');
  }

  update(dt: number): void {
    const st = this.step;
    if (!this.active || !st || !this.started) return;
    this.stepTime += dt;
    const pl = this.ctx.player();
    if (this.countdown > 0) {
      this.countdown = Math.max(0, this.countdown - dt);
      return;
    }
    if (this.timer !== null) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0;
        this.fail('時間切れ');
        return;
      }
    }
    const near = (x: number, z: number, r: number): boolean => Math.hypot(pl.x - x, pl.z - z) <= r;
    switch (st.t) {
      case 'talk':
        this.talkTimer -= dt;
        if (this.talkTimer <= 0) this.nextLine();
        break;
      case 'goto': {
        const p = this.resolve(st.at);
        if (st.vehicleTag) {
          const info = this.ctx.vehicleInfo(st.vehicleTag);
          if (!info || info.damage >= 1) {
            this.fail('車が壊れた');
            return;
          }
          if (pl.vehicleTag !== st.vehicleTag) {
            this.objective = 'バンに戻る';
            this.marker = { x: info.x, z: info.z, r: 3, kind: 'vehicle' };
            return;
          }
          this.objective = st.label;
          this.marker = { x: p.x, z: p.z, r: st.r, kind: 'goal' };
        }
        if (st.anyVehicle && !pl.inVehicle) {
          this.objective = '車に乗る';
          return;
        }
        if (st.onFoot && pl.inVehicle) {
          this.objective = '車を降りる';
          return;
        }
        this.objective = st.label;
        if (near(p.x, p.z, st.r)) this.advance();
        break;
      }
      case 'enterVehicle': {
        const info = this.ctx.vehicleInfo(st.tag);
        if (!info || info.damage >= 1) {
          this.fail('車が壊れた');
          return;
        }
        this.marker = { x: info.x, z: info.z, r: 3, kind: 'vehicle' };
        if (pl.vehicleTag === st.tag) this.advance();
        break;
      }
      case 'deliver': {
        const d = this.dropList[this.dropIndex];
        if (!d) {
          this.advance();
          return;
        }
        if (near(d.x, d.z, 7) && pl.speed < 3) {
          this.dropIndex++;
          this.stats.deliveries++;
          this.ctx.sfx('checkpoint');
          if (this.dropIndex >= this.dropList.length) {
            this.advance();
            return;
          }
          this.ctx.notify('配達完了！ 次の場所へ');
          this.updateDeliverMarker(st.label);
        }
        break;
      }
      case 'race':
      case 'timeTrial': {
        const cps = st.checkpoints;
        const c = cps[this.cpIndex];
        if (!pl.inVehicle) {
          this.objective = '車に戻る';
        } else this.objective = st.label + '（' + this.cpIndex + '/' + cps.length + '）';
        if (c && pl.inVehicle && near(c.x, c.z, 12)) {
          this.cpIndex++;
          this.ctx.sfx('checkpoint');
          if (this.cpIndex >= cps.length) {
            if (st.t === 'race') {
              const ahead = this.ctx.rivalsFinished();
              if (ahead > 0) {
                this.fail((ahead + 1) + '位でゴール。1位になれなかった');
                return;
              }
              this.stats.racesWon++;
              this.ctx.endRace();
            } else this.stats.trialsWon++;
            this.advance();
            return;
          }
          this.updateCpMarker(cps);
        }
        if (st.t === 'race' && this.ctx.rivalsFinished() >= st.rivals.length) {
          this.fail('全員に先にゴールされた');
          return;
        }
        break;
      }
      case 'chase': {
        const info = this.ctx.vehicleInfo(st.tag);
        if (!info) {
          this.fail('ターゲットを見失った');
          return;
        }
        this.marker = { x: info.x, z: info.z, r: 4, kind: 'vehicle' };
        const d = Math.hypot(pl.x - info.x, pl.z - info.z);
        if (d > st.escapeDist) {
          this.escapeTimer += dt;
          this.objective = '逃げられそうだ！ 追いつけ！';
          if (this.escapeTimer > 8) {
            this.fail('ターゲットに逃げられた');
            return;
          }
        } else {
          this.escapeTimer = 0;
          this.objective = st.label;
        }
        if (info.disabled) {
          this.stats.chases++;
          this.ctx.notify('ターゲットを止めた！');
          this.advance();
        }
        break;
      }
      case 'gotoVehicle': {
        const info = this.ctx.vehicleInfo(st.tag);
        if (!info) {
          this.fail('ターゲットが消えた');
          return;
        }
        this.marker = { x: info.x, z: info.z, r: 4, kind: 'pickup' };
        if (!pl.inVehicle && near(info.x, info.z, 4.5)) {
          this.ctx.sfx('pickup');
          this.ctx.notify('証拠のファイルを手に入れた');
          this.advance();
        } else if (pl.inVehicle) this.objective = '車を降りて近づく';
        else this.objective = st.label;
        break;
      }
      case 'pickup':
        if (pl.inVehicle) {
          this.objective = '車を降りて徒歩で探す';
          break;
        }
        this.objective = st.label;
        if (near(st.at.x, st.at.z, 2.4)) {
          this.ctx.sfx('pickup');
          this.ctx.notify(st.item + 'を手に入れた');
          this.advance();
        }
        break;
      case 'loseWanted':
        if (this.ctx.wanted() === 0 && this.stepTime > 1) this.advance();
        break;
      default:
        break;
    }
  }
}
