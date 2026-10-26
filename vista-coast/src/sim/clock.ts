// Game clock and weather state machine (pure, seeded).

import { clamp, lerp } from '../core/math';
import { Rng } from '../core/rng';

export type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'lightRain' | 'heavyRain' | 'storm';

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: '快晴',
  cloudy: '晴れ時々くもり',
  overcast: 'くもり',
  fog: '霧',
  lightRain: '小雨',
  heavyRain: '豪雨',
  storm: '雷雨',
};

export interface WeatherParams {
  cloud: number; // 0..1 coverage
  rain: number; // 0..1 intensity
  fog: number; // 0..1 extra fog
  wind: number; // 0..1
  lightning: number; // 0..1 chance factor
}

const PRESETS: Record<WeatherKind, WeatherParams> = {
  clear: { cloud: 0.08, rain: 0, fog: 0.0, wind: 0.15, lightning: 0 },
  cloudy: { cloud: 0.45, rain: 0, fog: 0.05, wind: 0.3, lightning: 0 },
  overcast: { cloud: 0.85, rain: 0, fog: 0.15, wind: 0.4, lightning: 0 },
  fog: { cloud: 0.6, rain: 0, fog: 0.85, wind: 0.05, lightning: 0 },
  lightRain: { cloud: 0.85, rain: 0.35, fog: 0.25, wind: 0.45, lightning: 0 },
  heavyRain: { cloud: 0.97, rain: 0.85, fog: 0.4, wind: 0.7, lightning: 0.15 },
  storm: { cloud: 1.0, rain: 1.0, fog: 0.45, wind: 0.95, lightning: 1 },
};

const NEXT: Record<WeatherKind, [WeatherKind, number][]> = {
  clear: [['clear', 4], ['cloudy', 3], ['fog', 0.6]],
  cloudy: [['clear', 3], ['overcast', 2.5], ['cloudy', 1]],
  overcast: [['cloudy', 2], ['lightRain', 2.5], ['fog', 0.8]],
  fog: [['cloudy', 2], ['clear', 2]],
  lightRain: [['overcast', 2], ['heavyRain', 1.6], ['cloudy', 1]],
  heavyRain: [['storm', 1.5], ['lightRain', 2]],
  storm: [['heavyRain', 2], ['lightRain', 1]],
};

export class GameClock {
  /** Hours since day 0, fractional. */
  hours = 9.5;
  /** In-game minutes per real second. */
  minutesPerSecond = 1;
  paused = false;

  get hourOfDay(): number {
    return ((this.hours % 24) + 24) % 24;
  }
  get day(): number {
    return Math.floor(this.hours / 24) + 1;
  }

  advance(dt: number): void {
    if (this.paused) return;
    this.hours += (dt * this.minutesPerSecond) / 60;
  }

  setHour(h: number): void {
    const base = Math.floor(this.hours / 24) * 24;
    let nh = base + h;
    if (nh < this.hours) nh += 24;
    this.hours = nh;
  }

  /** Sun direction (unit vector, y up) for the current time. Simple 34°N model. */
  sunDir(out: { x: number; y: number; z: number }): void {
    const t = ((this.hourOfDay - 6) / 24) * Math.PI * 2; // 0 at 6:00
    const elev = Math.sin(t) * 1.05; // radians-ish
    const az = t; // east -> south -> west
    const ce = Math.cos(Math.asin(clamp(elev, -1, 1)));
    out.x = Math.cos(az) * ce; // east = +x at sunrise
    out.y = clamp(elev, -1, 1);
    out.z = Math.sin(az) * ce * 0.6 + 0.35; // tilted toward south (+z)
    const l = Math.hypot(out.x, out.y, out.z) || 1;
    out.x /= l;
    out.y /= l;
    out.z /= l;
  }

  /** 0 at noon .. 1 at deep night (smooth). */
  nightFactor(): number {
    const h = this.hourOfDay;
    // daylight between 6:00 and 19:30 with twilight ramps
    if (h >= 7 && h <= 18.5) return 0;
    if (h > 18.5 && h < 20.5) return (h - 18.5) / 2;
    if (h >= 20.5 || h <= 4.8) return 1;
    return 1 - (h - 4.8) / 2.2;
  }
}

export class WeatherSystem {
  kind: WeatherKind = 'clear';
  target: WeatherKind = 'clear';
  blend = 1; // 0..1 from previous to target
  private from: WeatherParams = { ...PRESETS.clear };
  current: WeatherParams = { ...PRESETS.clear };
  wetness = 0;
  timer = 300;
  locked = false;
  lightningFlash = 0;
  /** set when a lightning bolt happens: distance for thunder delay */
  pendingThunder: { delay: number; dist: number }[] = [];
  private rng: Rng;

  constructor(seed = 31) {
    this.rng = new Rng(seed);
  }

  set(kind: WeatherKind, instant = false): void {
    if (!PRESETS[kind]) return; // ignore unknown kinds (e.g. corrupted save data)
    this.from = { ...this.current };
    this.target = kind;
    this.blend = instant ? 1 : 0;
    if (instant) this.current = { ...PRESETS[kind] };
    this.kind = kind;
    this.timer = this.rng.range(160, 420);
  }

  update(dt: number): void {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 45);
      const a = this.from;
      const b = PRESETS[this.target];
      const t = this.blend * this.blend * (3 - 2 * this.blend);
      this.current = {
        cloud: lerp(a.cloud, b.cloud, t),
        rain: lerp(a.rain, b.rain, t),
        fog: lerp(a.fog, b.fog, t),
        wind: lerp(a.wind, b.wind, t),
        lightning: lerp(a.lightning, b.lightning, t),
      };
    }
    if (!this.locked) {
      this.timer -= dt;
      if (this.timer <= 0) {
        const opts = NEXT[this.kind];
        let total = 0;
        for (const [, w] of opts) total += w;
        let r = this.rng.next() * total;
        let pick: WeatherKind = this.kind;
        for (const [k, w] of opts) {
          r -= w;
          if (r <= 0) {
            pick = k;
            break;
          }
        }
        this.set(pick);
      }
    }
    // roads get wet while raining and dry slowly afterwards
    const rain = this.current.rain;
    if (rain > 0.05) this.wetness = Math.min(1, this.wetness + dt * rain * 0.05);
    else this.wetness = Math.max(0, this.wetness - dt * 0.004);
    // lightning
    this.lightningFlash = Math.max(0, this.lightningFlash - dt * 4);
    if (this.current.lightning > 0.05 && this.rng.chance(dt * 0.08 * this.current.lightning)) {
      this.lightningFlash = 1;
      this.pendingThunder.push({ delay: this.rng.range(0.3, 4), dist: this.rng.range(200, 1500) });
    }
    for (const t of this.pendingThunder) t.delay -= dt;
  }

  /** Pop thunder events whose sound should start now. */
  takeThunder(): { dist: number }[] {
    const ready = this.pendingThunder.filter((t) => t.delay <= 0);
    this.pendingThunder = this.pendingThunder.filter((t) => t.delay > 0);
    return ready;
  }
}
