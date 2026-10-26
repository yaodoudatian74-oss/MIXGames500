// Unit tests + headless simulations for the pure game logic. Run with Node.
declare const process: { exit(code: number): never };

import { Rng } from '../src/core/rng';
import { VEHICLES, vehicleById, TRAFFIC_MIX, pickWeighted } from '../src/data/vehicles';
import { MISSIONS } from '../src/data/missions';
import { Economy, newEconomy } from '../src/sim/economy';
import { MissionRunner, type MissionCtx, type PlayerInfo } from '../src/sim/missions';
import { PedSystem } from '../src/sim/peds';
import { RoadGraph } from '../src/sim/roadGraph';
import { makeSave, migrateSave, readSave, writeSave, SAVE_VERSION } from '../src/sim/save';
import { TrafficSystem } from '../src/sim/traffic';
import { makeVehicleState, stepVehicle, collideVehicleStatic, type Ground } from '../src/sim/vehiclePhysics';
import { WantedSystem } from '../src/sim/wanted';
import { GameClock, WeatherSystem } from '../src/sim/clock';
import { CollisionWorld } from '../src/sim/collision';
import { HeightField } from '../src/world/heightmap';
import { GroundModel } from '../src/world/ground';
import { WorldGen } from '../src/world/worldgen';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + ': ' + (e instanceof Error ? e.message : String(e)));
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const flat: Ground = {
  groundAt: () => 0,
  surface: () => ({ mu: 1, roll: 0.013, offroad: false }),
  wetness: 0,
};
const DT = 1 / 60;

console.log('vehicle physics');
test('every vehicle accelerates to a plausible top speed without NaN', () => {
  for (const spec of VEHICLES) {
    const s = makeVehicleState(0, 0, 0, 0);
    for (let i = 0; i < 60 * 40; i++) stepVehicle(spec, s, { throttle: 1, brake: 0, steer: 0, handbrake: false }, flat, DT);
    const v = Math.hypot(s.vx, s.vz);
    assert(Number.isFinite(v), spec.id + ' NaN');
    assert(v > spec.topSpeed * 0.55 && v <= spec.topSpeed * 1.08, spec.id + ' top speed ' + v.toFixed(1) + ' vs ' + spec.topSpeed);
    assert(Math.abs(s.x) < 2, spec.id + ' drifted sideways ' + s.x.toFixed(2));
  }
});
test('0-100 km/h of the sports car is between 3 and 8 s', () => {
  const spec = vehicleById('vortex');
  const s = makeVehicleState(0, 0, 0, 0);
  let t = 0;
  while (Math.hypot(s.vx, s.vz) < 27.8 && t < 20) {
    stepVehicle(spec, s, { throttle: 1, brake: 0, steer: 0, handbrake: false }, flat, DT);
    t += DT;
  }
  assert(t > 3 && t < 8, 't=' + t.toFixed(2));
});
test('braking from 100 km/h stops within 25..70 m', () => {
  const spec = vehicleById('meridian');
  const s = makeVehicleState(0, 0, 0, 0);
  s.vz = 27.8;
  let i = 0;
  while (Math.hypot(s.vx, s.vz) > 0.1 && i++ < 60 * 20) stepVehicle(spec, s, { throttle: 0, brake: 1, steer: 0, handbrake: false }, flat, DT);
  assert(s.z > 25 && s.z < 70, 'stop distance ' + s.z.toFixed(1));
});
test('steering right turns right (yaw decreases) and car turns in a circle', () => {
  const spec = vehicleById('meridian');
  const s = makeVehicleState(0, 0, 0, 0);
  s.vz = 10;
  for (let i = 0; i < 60 * 2; i++) stepVehicle(spec, s, { throttle: 0.3, brake: 0, steer: 1, handbrake: false }, flat, DT);
  assert(s.yaw < -0.5, 'yaw ' + s.yaw.toFixed(2));
  assert(s.x < 0, 'should move toward -x (right) ' + s.x.toFixed(2));
});
test('reverse works', () => {
  const spec = vehicleById('pico');
  const s = makeVehicleState(0, 0, 0, 0);
  for (let i = 0; i < 60 * 3; i++) stepVehicle(spec, s, { throttle: 0, brake: 1, steer: 0, handbrake: false }, flat, DT);
  assert(s.z < -3, 'z ' + s.z.toFixed(2));
});
test('random inputs for 20k ticks never produce NaN or absurd speed', () => {
  const r = new Rng(7);
  for (const id of ['stratos', 'raptor', 'metro', 'dune']) {
    const spec = vehicleById(id);
    const s = makeVehicleState(0, 0, 0, 0);
    let inp = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    for (let i = 0; i < 20000; i++) {
      if (i % 30 === 0) inp = { throttle: r.next(), brake: r.chance(0.2) ? r.next() : 0, steer: r.range(-1, 1), handbrake: r.chance(0.1) };
      stepVehicle(spec, s, inp, flat, DT);
      const v = Math.hypot(s.vx, s.vz);
      assert(Number.isFinite(v) && Number.isFinite(s.yaw), id + ' NaN at ' + i);
      assert(v < spec.topSpeed * 1.3, id + ' speed blowup ' + v.toFixed(1));
    }
  }
});
test('wall collision stops the car and reports an impact', () => {
  const w = new CollisionWorld();
  w.addBox(-10, 20, 10, 30, -1, 20);
  const spec = vehicleById('meridian');
  const s = makeVehicleState(0, 0, 0, 0);
  s.vz = 20;
  let impact = 0;
  for (let i = 0; i < 120; i++) {
    stepVehicle(spec, s, { throttle: 0, brake: 0, steer: 0, handbrake: false }, flat, DT);
    impact = Math.max(impact, collideVehicleStatic(spec, s, w, () => undefined));
  }
  assert(s.z < 20, 'went through the wall z=' + s.z.toFixed(2));
  assert(impact > 10, 'impact ' + impact.toFixed(1));
});

console.log('world');
const hf = new HeightField();
hf.bake();
const graph = new RoadGraph(hf);
const wd = new WorldGen(hf, graph).generate();
const ground = new GroundModel(hf, graph, wd.blocks);
const cw = new CollisionWorld();
for (const b of wd.buildings) cw.addBox(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, b.baseY - 5, b.baseY + b.h, b.id);

test('every lane has a continuation', () => {
  const dead = graph.pieces.filter((p) => p.next.length === 0);
  assert(dead.length === 0, dead.length + ' dead ends');
});
test('lane pieces are continuous with their connectors (gap < 0.6 m)', () => {
  for (const p of graph.pieces) {
    for (const nid of p.next) {
      const q = graph.pieces[nid];
      if (!q) throw new Error('missing piece');
      const e = p.xs.length - 1;
      const gap = Math.hypot((p.xs[e] as number) - (q.xs[0] as number), (p.zs[e] as number) - (q.zs[0] as number));
      assert(gap < 0.6, 'gap ' + gap.toFixed(2) + ' at piece ' + p.id);
    }
  }
});
test('no building overlaps a road', () => {
  let bad = 0;
  for (const b of wd.buildings) {
    for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45], [0, 0]] as const) {
      if (graph.roadAt(b.x + dx * b.w, b.z + dz * b.d)) bad++;
    }
  }
  assert(bad === 0, bad + ' building corners on roads');
});
test('city ground is flat and blocks have curbs', () => {
  assert(Math.abs(hf.heightAt(0, 0) - 1) < 1e-6, 'city height');
  const b = wd.blocks[0];
  if (!b) throw new Error('no blocks');
  const cx = (b.outer.x0 + b.outer.x1) / 2;
  const cz = (b.outer.z0 + b.outer.z1) / 2;
  assert(ground.groundAt(cx, cz, 5) > 1.1, 'curb');
});
test('A* finds a route from downtown to the town and the airport', () => {
  const a = graph.nearestNode(150, -450);
  assert(graph.route(a, graph.nearestNode(-1500, 0)).length > 3, 'town');
  assert(graph.route(a, graph.nearestNode(-1350, 690)).length > 3, 'airport');
  assert(graph.route(a, graph.nearestNode(420, -1620)).length > 3, 'mountain');
});

console.log('traffic');
test('headless traffic: 160 cars for 120 s keep moving and never overlap on a lane', () => {
  const ts = new TrafficSystem(graph);
  const lanes = graph.lanes();
  const r = new Rng(3);
  let tries = 0;
  while (ts.agents.length < 160 && tries++ < 5000) {
    const lane = lanes[Math.floor(r.next() * lanes.length)];
    if (!lane) continue;
    const s = r.range(0, lane.length);
    if (!ts.canSpawn(lane.id, s, 14)) continue;
    ts.spawn(vehicleById(pickWeighted(TRAFFIC_MIX, r.next())), 0xffffff, lane.id, s, 8);
  }
  let moved = 0;
  const startX = ts.agents.map((a) => a.state.x);
  for (let i = 0; i < 60 * 120; i++) {
    ts.update(DT, [], 0);
    if (i % 60 === 0) {
      for (const a of ts.agents) {
        assert(Number.isFinite(a.state.x) && Number.isFinite(a.state.z), 'NaN agent');
        for (const b of ts.agents) {
          if (a === b || a.piece !== b.piece) continue;
          assert(Math.abs(a.s - b.s) > 0.8, 'overlap on piece ' + a.piece + ' ds=' + Math.abs(a.s - b.s).toFixed(2));
        }
      }
    }
  }
  ts.agents.forEach((a, i) => {
    if (Math.abs(a.state.x - (startX[i] as number)) > 5) moved++;
  });
  const avg = ts.agents.reduce((s, a) => s + a.speed, 0) / ts.agents.length;
  assert(moved > ts.agents.length * 0.4, 'only ' + moved + ' moved');
  assert(avg > 1.0, 'avg speed ' + avg.toFixed(2));
});
test('cars stop for an obstacle in their lane', () => {
  const ts = new TrafficSystem(graph);
  const lane = graph.lanes().find((l) => l.length > 120 && l.kind === 'lane');
  if (!lane) throw new Error('no lane');
  const a = ts.spawn(vehicleById('meridian'), 0, lane.id, 5, 10);
  if (!a) throw new Error('spawn');
  const pt = { x: 0, y: 0, z: 0, yaw: 0 };
  graph.sample(lane, 60, pt);
  for (let i = 0; i < 60 * 15; i++) ts.update(DT, [{ x: pt.x, y: pt.y, z: pt.z, r: 0.4, vx: 0, vz: 0, emergency: false }], 0);
  assert(a.piece !== lane.id || a.s < 60, 'drove through obstacle s=' + a.s.toFixed(1));
  assert(a.speed < 0.5, 'still moving ' + a.speed.toFixed(2));
});

console.log('pedestrians');
test('headless peds: 150 peds for 100 s, finite and not stuck waiting forever', () => {
  const benches = wd.props.filter((p) => p.kind === 'bench');
  const ps = new PedSystem(ground, graph, cw, wd.blocks, wd.doors, benches);
  const r = new Rng(5);
  for (let i = 0; i < 150; i++) {
    const bi = Math.floor(r.next() * ps.walkBlocks.length);
    const wb = ps.walkBlocks[bi];
    if (wb) ps.spawnOnBlock(bi, r.range(0, wb.perim), i);
  }
  let crossed = 0;
  for (let i = 0; i < 60 * 100; i++) {
    ps.update(DT, 0, 0);
    for (const p of ps.peds) if (p.mode === 'cross') crossed++;
  }
  for (const p of ps.peds) {
    assert(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.y), 'NaN ped');
    assert(p.y > 0.5 && p.y < 40, 'ped height ' + p.y.toFixed(2));
  }
  assert(crossed > 0, 'nobody crossed a street');
});

console.log('wanted / economy / save');
test('wanted level rises, search starts, and evasion clears it', () => {
  const w = new WantedSystem();
  w.report('hitPed', 0, 0, false);
  assert(w.level === 2, 'level ' + w.level);
  w.report('copAssault', 0, 0, true);
  assert(w.level >= 4, 'level after cop assault ' + w.level);
  for (let i = 0; i < 60; i++) w.update(DT, true, 0, 0);
  assert(!w.searching, 'should not search while seen');
  let cleared = false;
  for (let i = 0; i < 60 * 60 && !cleared; i++) cleared = w.update(DT, false, 2000, 2000);
  assert(cleared && w.level === 0, 'not cleared');
});
test('economy never goes negative', () => {
  const e = new Economy(newEconomy());
  assert(!e.spend(1e9), 'overspend');
  const taken = e.fine(1e9);
  assert(e.money === 0 && taken === 800, 'fine');
  e.earn(30000);
  assert(e.buyProperty('house'), 'buy house');
  assert(!e.buyProperty('house'), 'double buy');
  assert(e.garageCapacity('house') === 4, 'capacity');
  for (let i = 0; i < 4; i++) assert(e.storeVehicle('house', { specId: 'pico', color: 0, damage: 0 }), 'store ' + i);
  assert(!e.storeVehicle('house', { specId: 'pico', color: 0, damage: 0 }), 'over capacity');
  assert(e.takeVehicle('house', 9) === null, 'bad index');
});
test('save roundtrip and migrations', () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const s = makeSave();
  s.economy.money = 1234;
  s.collectibles = [1, 5];
  assert(writeSave(storage, s), 'write');
  const back = readSave(storage);
  assert(back !== null && back.economy.money === 1234 && back.collectibles.length === 2 && back.v === SAVE_VERSION, 'roundtrip');
  const v1 = migrateSave({ version: 1, money: 50, pos: { x: 10, z: 20 }, hour: 18 });
  assert(v1 !== null && v1.economy.money === 50 && v1.player.x === 10 && v1.clock === 18, 'v1');
  const v2 = migrateSave({ v: 2, postcards: [3, 4, 'x'], economy: { money: -5 } });
  assert(v2 !== null && v2.collectibles.length === 2 && v2.economy.money === 0, 'v2');
  assert(migrateSave('garbage') === null && migrateSave({ v: 99 }) === null, 'garbage');
  storage.setItem('vistacoast.save', '{not json');
  assert(readSave(storage) === null, 'corrupt json');
});
test('clock and weather', () => {
  const c = new GameClock();
  c.setHour(22);
  assert(Math.abs(c.hourOfDay - 22) < 1e-6, 'setHour');
  assert(c.nightFactor() === 1, 'night');
  c.setHour(12);
  const d = { x: 0, y: 0, z: 0 };
  c.sunDir(d);
  assert(d.y > 0.8, 'sun high at noon');
  const w = new WeatherSystem(1);
  w.set('storm');
  for (let i = 0; i < 60 * 120; i++) w.update(DT);
  assert(w.wetness > 0.1, 'wet after rain');
});

console.log('missions');
function fakeCtx(state: { p: PlayerInfo; wanted: number; vehicles: Map<string, { x: number; z: number; damage: number; speed: number; disabled: boolean }> }): MissionCtx {
  return {
    player: () => state.p,
    poiPos: (id) => (id === 'diner' ? { x: 880, z: -75 } : { x: 0, z: 0 }),
    spawnVehicle: (tag, _s, x, z) => void state.vehicles.set(tag, { x, z, damage: 0, speed: 0, disabled: false }),
    vehicleInfo: (tag) => state.vehicles.get(tag) ?? null,
    clearMissionVehicles: () => state.vehicles.clear(),
    setWanted: (l) => void (state.wanted = l),
    wanted: () => state.wanted,
    setHour: () => undefined,
    setWeather: () => undefined,
    reward: () => undefined,
    startRace: () => undefined,
    prepareStart: () => undefined,
    rivalsFinished: () => 0,
    endRace: () => undefined,
    sfx: () => undefined,
    notify: () => undefined,
  };
}
test('mission m1 can be completed step by step', () => {
  const state = { p: { x: -1400, y: 1, z: 702, inVehicle: false, vehicleTag: null as string | null, speed: 0 }, wanted: 0, vehicles: new Map() };
  const mr = new MissionRunner(fakeCtx(state));
  assert(mr.available().some((m) => m.id === 'm1'), 'm1 available');
  assert(!mr.available().some((m) => m.id === 'm2'), 'm2 locked');
  mr.start('m1');
  for (let i = 0; i < 60 * 30; i++) mr.update(DT);
  assert(mr.step?.t === 'enterVehicle', 'at enterVehicle, got ' + mr.step?.t);
  state.p.inVehicle = true;
  state.p.vehicleTag = 'rental';
  mr.update(DT);
  assert(mr.step?.t === 'goto', 'goto');
  state.p.x = 880;
  state.p.z = -75;
  mr.update(DT);
  for (let i = 0; i < 60 * 30; i++) mr.update(DT);
  assert(mr.completed.has('m1'), 'completed');
  assert(mr.available().some((m) => m.id === 'm2'), 'm2 unlocked');
});
test('delivery mission fails when time runs out', () => {
  const state = { p: { x: 0, y: 1, z: 0, inVehicle: true, vehicleTag: null as string | null, speed: 0 }, wanted: 0, vehicles: new Map() };
  const mr = new MissionRunner(fakeCtx(state));
  mr.start('s_delivery');
  for (let i = 0; i < 60 * 200; i++) mr.update(DT);
  assert(mr.active === null && mr.lastResult !== null && !mr.lastResult.success, 'should fail');
});
test('all mission data is well formed', () => {
  for (const m of MISSIONS) {
    assert(m.steps.length > 0, m.id + ' empty');
    if (m.requires) assert(MISSIONS.some((q) => q.id === m.requires), m.id + ' requires unknown');
    for (const s of m.steps) {
      if (s.t === 'spawnVehicle') vehicleById(s.spec);
      if (s.t === 'race') for (const r of s.rivals) vehicleById(r);
      if (s.t === 'reward' && s.vehicle) vehicleById(s.vehicle);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
