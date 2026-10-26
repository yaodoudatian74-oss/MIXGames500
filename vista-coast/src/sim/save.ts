// Versioned save data with migration from older formats and validation.

import { newEconomy, type EconomyState, type StoredVehicle } from './economy';

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'vistacoast.save';

export interface Stats {
  timePlayed: number;
  distanceDriven: number;
  distanceWalked: number;
  maxSpeed: number; // m/s
  crashes: number;
  pedsKnocked: number;
  carsStolen: number;
  escapes: number;
  maxAir: number;
  areas: string[];
  clubVisits: number;
  busted: number;
  wasted: number;
}

export function newStats(): Stats {
  return { timePlayed: 0, distanceDriven: 0, distanceWalked: 0, maxSpeed: 0, crashes: 0, pedsKnocked: 0, carsStolen: 0, escapes: 0, maxAir: 0, areas: [], clubVisits: 0, busted: 0, wasted: 0 };
}

export interface SaveData {
  v: number;
  savedAt: number;
  player: { x: number; y: number; z: number; yaw: number; health: number };
  economy: EconomyState;
  missions: { completed: string[]; completions: Record<string, number>; stats: { deliveries: number; racesWon: number; trialsWon: number; chases: number } };
  collectibles: number[];
  achievements: string[];
  stats: Stats;
  clock: number;
  weather: string;
  lastVehicle: StoredVehicle | null;
}

export function makeSave(partial: Partial<SaveData> = {}): SaveData {
  return {
    v: SAVE_VERSION,
    savedAt: Date.now(),
    player: { x: -1392, y: 1.2, z: 684, yaw: 2.5, health: 100 },
    economy: newEconomy(),
    missions: { completed: [], completions: {}, stats: { deliveries: 0, racesWon: 0, trialsWon: 0, chases: 0 } },
    collectibles: [],
    achievements: [],
    stats: newStats(),
    clock: 9.5,
    weather: 'clear',
    lastVehicle: null,
    ...partial,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [];
}

/**
 * Parse and migrate any known save format to the current version.
 * v1: { version: 1, money, pos: {x, z}, hour }
 * v2: { v: 2, ..., postcards: number[] } (renamed to collectibles in v3)
 */
export function migrateSave(raw: unknown): SaveData | null {
  if (!isObj(raw)) return null;
  // v1
  if (raw['version'] === 1) {
    const pos = isObj(raw['pos']) ? raw['pos'] : {};
    const eco = newEconomy();
    eco.money = Math.max(0, Math.floor(num(raw['money'], eco.money)));
    return makeSave({
      player: { x: num(pos['x'], -1400), y: 2, z: num(pos['z'], 702), yaw: 0, health: 100 },
      economy: eco,
      clock: num(raw['hour'], 9.5),
    });
  }
  const v = num(raw['v'], 0);
  if (v < 2 || v > SAVE_VERSION) return null;
  const base = makeSave();
  const pl = isObj(raw['player']) ? raw['player'] : {};
  const ecoRaw = isObj(raw['economy']) ? raw['economy'] : {};
  const eco = newEconomy();
  eco.money = Math.max(0, Math.floor(num(ecoRaw['money'], eco.money)));
  eco.earned = num(ecoRaw['earned'], 0);
  eco.spent = num(ecoRaw['spent'], 0);
  eco.properties = strArr(ecoRaw['properties']);
  eco.outfits = strArr(ecoRaw['outfits']);
  if (!eco.outfits.includes('start')) eco.outfits.unshift('start');
  eco.outfit = typeof ecoRaw['outfit'] === 'string' ? (ecoRaw['outfit'] as string) : 'start';
  if (isObj(ecoRaw['inventory'])) {
    for (const [k, val] of Object.entries(ecoRaw['inventory'])) {
      const n = num(val, 0);
      if (n > 0) (eco.inventory as Record<string, number>)[k] = Math.floor(n);
    }
  }
  if (isObj(ecoRaw['garages'])) {
    for (const [k, list] of Object.entries(ecoRaw['garages'])) {
      if (!Array.isArray(list)) continue;
      eco.garages[k] = list
        .filter(isObj)
        .map((o) => ({ specId: typeof o['specId'] === 'string' ? (o['specId'] as string) : 'meridian', color: num(o['color'], 0xffffff), damage: Math.min(1, Math.max(0, num(o['damage'], 0))) }));
    }
  }
  const ms = isObj(raw['missions']) ? raw['missions'] : {};
  const mstats = isObj(ms['stats']) ? ms['stats'] : {};
  const completions: Record<string, number> = {};
  if (isObj(ms['completions'])) for (const [k, val] of Object.entries(ms['completions'])) completions[k] = num(val, 0);
  const st = isObj(raw['stats']) ? raw['stats'] : {};
  const stats = { ...base.stats };
  for (const key of Object.keys(stats) as (keyof Stats)[]) {
    if (key === 'areas') stats.areas = strArr(st['areas']);
    else (stats as unknown as Record<string, number>)[key] = num(st[key], 0);
  }
  const lv = isObj(raw['lastVehicle']) ? raw['lastVehicle'] : null;
  return {
    v: SAVE_VERSION,
    savedAt: num(raw['savedAt'], Date.now()),
    player: {
      x: num(pl['x'], base.player.x),
      y: num(pl['y'], base.player.y),
      z: num(pl['z'], base.player.z),
      yaw: num(pl['yaw'], 0),
      health: Math.min(100, Math.max(1, num(pl['health'], 100))),
    },
    economy: eco,
    missions: {
      completed: strArr(ms['completed']),
      completions,
      stats: { deliveries: num(mstats['deliveries'], 0), racesWon: num(mstats['racesWon'], 0), trialsWon: num(mstats['trialsWon'], 0), chases: num(mstats['chases'], 0) },
    },
    collectibles: v === 2 ? numArr(raw['postcards']) : numArr(raw['collectibles']),
    achievements: strArr(raw['achievements']),
    stats,
    clock: num(raw['clock'], 9.5),
    weather: typeof raw['weather'] === 'string' ? (raw['weather'] as string) : 'clear',
    lastVehicle: lv ? { specId: typeof lv['specId'] === 'string' ? (lv['specId'] as string) : 'meridian', color: num(lv['color'], 0xffffff), damage: num(lv['damage'], 0) } : null,
  };
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function writeSave(storage: Storage, data: SaveData): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave(storage: Storage): SaveData | null {
  try {
    const txt = storage.getItem(SAVE_KEY);
    if (!txt) return null;
    return migrateSave(JSON.parse(txt) as unknown);
  } catch {
    return null;
  }
}
