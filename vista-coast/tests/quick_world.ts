import { HeightField } from '../src/world/heightmap';
import { RoadGraph } from '../src/sim/roadGraph';
const t0 = Date.now();
const hf = new HeightField();
hf.bake();
const t1 = Date.now();
const g = new RoadGraph(hf);
const t2 = Date.now();
const lanes = g.pieces.filter(p=>p.kind==='lane');
const conns = g.pieces.filter(p=>p.kind==='conn');
const dead = lanes.filter(l=>l.next.length===0);
console.log('bake ms', t1-t0, 'graph ms', t2-t1, 'lanes', lanes.length, 'conns', conns.length, 'deadends', dead.length, 'lake', hf.lakeLevel.toFixed(1));
let mn=1e9,mx=-1e9; for (const v of hf.data){ if(v<mn)mn=v; if(v>mx)mx=v;} console.log('h range', mn.toFixed(1), mx.toFixed(1));
for (const [x,z] of [[0,0],[1000,0],[1150,0],[-1000,-1240],[-180,-1560],[960,-1300],[-1500,0],[675,0]]) console.log(x,z,hf.heightAt(x,z).toFixed(2), 'deck', hf.groundAt(x,z,15).toFixed(2));
console.log('route', g.route(g.nearestNode(0,0), g.nearestNode(-1500,0)).length);
let maxGrade=0; for(const p of hf.profiles){ for(let i=1;i<p.hs.length;i++){const gr=Math.abs(p.hs[i]-p.hs[i-1])/(p.ss[i]-p.ss[i-1]); if(gr>maxGrade)maxGrade=gr;} } console.log('max grade', maxGrade.toFixed(3));
for (const l of dead) { const r = g.net.roads[l.roadId]; console.log('dead', r.name, r.cls, 'dir', l.dir, 'lane', l.laneIndex, 'to', g.net.nodes[l.toNode], 'deg', g.nodeDegree[l.toNode], 'outs', (g.lanesByNodeOut.get(l.toNode)||[]).length); }
