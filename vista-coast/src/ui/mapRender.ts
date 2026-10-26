// Renders the VISTA COAST map (terrain shading, water, blocks, roads) once into an
// offscreen canvas used by the minimap and the full-screen map.

import { HeightField } from '../world/heightmap';
import { LAKE, ROAD_SPECS, WORLD_HALF, coastDistance, roadHalfWidth, type P2 } from '../world/layout';
import type { RoadGraph } from '../sim/roadGraph';
import type { WorldData } from '../world/worldgen';

export const MAP_SIZE = 2048;

export function worldToMap(x: number, z: number): [number, number] {
  return [((x + WORLD_HALF) / (WORLD_HALF * 2)) * MAP_SIZE, ((z + WORLD_HALF) / (WORLD_HALF * 2)) * MAP_SIZE];
}

export function renderMap(hf: HeightField, graph: RoadGraph, wd: WorldData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = MAP_SIZE;
  c.height = MAP_SIZE;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  // terrain base at quarter resolution then scaled up
  const lo = 512;
  const img = ctx.createImageData(lo, lo);
  for (let j = 0; j < lo; j++) {
    for (let i = 0; i < lo; i++) {
      const x = -WORLD_HALF + ((i + 0.5) / lo) * WORLD_HALF * 2;
      const z = -WORLD_HALF + ((j + 0.5) / lo) * WORLD_HALF * 2;
      const h = hf.heightAt(x, z);
      const dc = coastDistance(x, z);
      const inLake = Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 5 && h < hf.lakeLevel;
      let r: number;
      let g: number;
      let b: number;
      if ((h < 0.05 && dc < 30) || inLake) {
        const d = Math.min(1, Math.max(0, -h / 25));
        r = 40 - d * 25;
        g = 120 - d * 60;
        b = 160 - d * 40;
      } else if (dc < 140 && h < 3.5) {
        r = 226;
        g = 210;
        b = 170;
      } else {
        const t = Math.min(1, h / 260);
        const shade = hf.slopeAt(x, z);
        r = 116 + t * 60 - shade * 30;
        g = 138 + t * 30 - shade * 30;
        b = 92 + t * 40 - shade * 20;
        if (h <= 1.05) {
          r = 196;
          g = 196;
          b = 188;
        }
      }
      const o = (j * lo + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = lo;
  tmp.height = lo;
  tmp.getContext('2d')?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, MAP_SIZE, MAP_SIZE);
  const s = MAP_SIZE / (WORLD_HALF * 2);
  // blocks
  for (const b of wd.blocks) {
    const [x0, z0] = worldToMap(b.outer.x0, b.outer.z0);
    const [x1, z1] = worldToMap(b.outer.x1, b.outer.z1);
    ctx.fillStyle = b.ground === 'grass' ? '#a9c08f' : '#d7d3cb';
    if (b.poi?.kind === 'park') ctx.fillStyle = '#86b46a';
    ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
  }
  // buildings
  ctx.fillStyle = 'rgba(120,118,112,0.75)';
  for (const b of wd.buildings) {
    const [x, z] = worldToMap(b.x - b.w / 2, b.z - b.d / 2);
    ctx.fillRect(x, z, Math.max(1, b.w * s), Math.max(1, b.d * s));
  }
  // airport pavement
  ctx.fillStyle = '#5c5f62';
  {
    const [x0, z0] = worldToMap(-1840, 1150);
    ctx.fillRect(x0, z0, 680 * s, 60 * s);
  }
  // roads (casing then fill)
  const drawRoads = (casing: boolean): void => {
    for (const r of graph.net.roads) {
      const hw = roadHalfWidth(r.cls);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.5, (hw * 2 + (ROAD_SPECS[r.cls].sidewalkW > 0 ? 1 : 0)) * s) + (casing ? 2 : 0);
      ctx.strokeStyle = casing ? 'rgba(90,90,90,0.8)' : r.cls === 'freeway' ? '#f2c14e' : r.cls === 'highway' ? '#f7e08a' : r.cls === 'avenue' ? '#ffffff' : '#f4f4f0';
      ctx.beginPath();
      r.pts.forEach((p: P2, i: number) => {
        const [x, z] = worldToMap(p.x, p.z);
        if (i === 0) ctx.moveTo(x, z);
        else ctx.lineTo(x, z);
      });
      ctx.stroke();
    }
  };
  drawRoads(true);
  drawRoads(false);
  return c;
}
