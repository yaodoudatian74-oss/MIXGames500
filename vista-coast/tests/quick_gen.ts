import { HeightField } from '../src/world/heightmap';
import { RoadGraph } from '../src/sim/roadGraph';
import { WorldGen } from '../src/world/worldgen';
const hf = new HeightField(); hf.bake();
const g = new RoadGraph(hf);
const t0 = Date.now();
const wd = new WorldGen(hf, g).generate();
console.log('gen ms', Date.now()-t0);
const byStyle: Record<string, number> = {};
for (const b of wd.buildings) byStyle[b.style] = (byStyle[b.style]||0)+1;
console.log('buildings', wd.buildings.length, JSON.stringify(byStyle));
const tt: Record<number, number> = {}; for (const t of wd.trees) tt[t.type]=(tt[t.type]||0)+1;
console.log('trees', wd.trees.length, JSON.stringify(tt), 'hill', wd.hillTrees);
console.log('lights', wd.lights.length, 'signals', wd.signals.length, 'props', wd.props.length, 'parking', wd.parking.length, 'lots', wd.lots.length, 'doors', wd.doors.length, wd.doors.map(d=>d.poi.id).join(','));
console.log('pillars', wd.pillars.length, 'maxH', Math.max(...wd.buildings.map(b=>b.h)).toFixed(0));
// buildings on roads?
let onRoad = 0; for (const b of wd.buildings) { if (g.roadAt(b.x, b.z)) onRoad++; } console.log('buildings centered on roads', onRoad);
let treesOnRoad=0; for (const t of wd.trees) if (g.roadAt(t.x,t.z)) treesOnRoad++; console.log('trees on road', treesOnRoad);
