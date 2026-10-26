// World construction: bake terrain, generate the city, colliders and all static
// meshes. Runs once at startup with progress reporting.

import * as THREE from 'three';
import { RoadGraph } from '../sim/roadGraph';
import { CollisionWorld } from '../sim/collision';
import { buildTextures, type TextureLib } from '../render/textures';
import { U, makeFacadeMaterial } from '../render/shaderlib';
import type { QualitySettings } from '../render/quality';
import { HeightField } from '../world/heightmap';
import { GroundModel } from '../world/ground';
import { WorldGen, type WorldData, type Prop } from '../world/worldgen';
import { TerrainLOD, buildCanopy, buildSplat, makeTerrainMaterial } from '../world/terrainMesh';
import { RoadBuilder, makeRoadMaterials } from '../world/roadMesh';
import { buildBillboards, buildBuildings } from '../world/buildingMesh';
import { Vegetation } from '../world/vegetation';
import { PropsSystem } from '../world/props';
import { WaterSystem } from '../world/water';
import { Landmarks } from '../world/landmarks';
import { CITY_Y, FREEWAY_X } from '../world/layout';

export interface WorldBundle {
  tex: TextureLib;
  hf: HeightField;
  graph: RoadGraph;
  wd: WorldData;
  ground: GroundModel;
  world: CollisionWorld;
  root: THREE.Group;
  terrain: TerrainLOD;
  vegetation: Vegetation;
  props: PropsSystem;
  water: WaterSystem;
  landmarks: Landmarks;
  lightColliderToIndex: Map<number, number>;
  signs: THREE.Mesh[];
  billboards: THREE.Group;
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

export async function buildWorld(q: QualitySettings, progress: (p: number, msg: string) => void): Promise<WorldBundle> {
  progress(0.02, 'テクスチャを生成中…');
  await nextFrame();
  const tex = buildTextures(q.textureSize);
  U.uPuddle.value = tex.cloudNoise;
  progress(0.12, '地形を生成中…');
  await nextFrame();
  const hf = new HeightField();
  hf.bake();
  progress(0.3, '道路網を構築中…');
  await nextFrame();
  const graph = new RoadGraph(hf);
  progress(0.36, '街を生成中…');
  await nextFrame();
  const wd = new WorldGen(hf, graph).generate();
  const ground = new GroundModel(hf, graph, wd.blocks);
  // colliders
  const world = new CollisionWorld(32);
  for (const b of wd.buildings) {
    world.addBox(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, b.baseY - 4, b.baseY + b.h + (b.roof === 'gable' ? 2 : 0), b.id);
  }
  for (const t of wd.trees) {
    const r = t.type === 4 ? 0.0 : t.type === 0 || t.type === 5 ? 0.3 : 0.38;
    if (r > 0) world.addCircle(t.x, t.z, r * t.scale, t.y - 1, t.y + 8, 'tree');
  }
  const lightColliderToIndex = new Map<number, number>();
  wd.lights.forEach((l, i) => {
    if (l.double) return; // freeway median lights: not breakable, covered by deck walls
    const c = world.addCircle(l.x, l.z, 0.17, l.y - 0.5, l.y + 8.5, 'light', true, i);
    lightColliderToIndex.set(c.id, i);
  });
  for (const s of wd.signals) world.addCircle(s.x, s.z, 0.18, s.y - 0.5, s.y + 6, 'signal');
  for (const p of wd.pillars) for (const side of [-1, 1]) world.addCircle(p.x + side * 4.5, p.z, 0.95, CITY_Y - 1, p.h - 1.3, 'pillar');
  for (const p of wd.props) addPropCollider(world, p);
  void FREEWAY_X;
  progress(0.45, '地形メッシュを構築中…');
  await nextFrame();
  const root = new THREE.Group();
  const splat = buildSplat(hf, 512);
  const terrainMat = makeTerrainMaterial(tex, splat, buildCanopy(hf));
  const terrain = new TerrainLOD(hf, terrainMat, q.terrainDetail);
  terrain.update(new THREE.Vector3(-1400, 0, 700), true);
  root.add(terrain.group);
  progress(0.58, '道路を舗装中…');
  await nextFrame();
  const roadMats = makeRoadMaterials(tex);
  const roads = new THREE.Group();
  new RoadBuilder(hf, graph, wd).build(roadMats, roads);
  root.add(roads);
  progress(0.68, '建物を建設中…');
  await nextFrame();
  const facade = makeFacadeMaterial(tex.grime);
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x2fa6c9, roughness: 0.05, metalness: 0.1, emissive: new THREE.Color(0.02, 0.12, 0.16) });
  const bm = buildBuildings(wd.buildings, facade, poolMat);
  root.add(bm.group);
  const billboards = buildBillboards(wd.buildings);
  root.add(billboards);
  progress(0.78, '植物を植えています…');
  await nextFrame();
  const vegetation = new Vegetation(wd.trees, tex, ground, q.grass);
  vegetation.nearDist = q.treeDistance * 0.4;
  vegetation.farDist = q.treeDistance;
  root.add(vegetation.group);
  progress(0.86, '街灯と小物を配置中…');
  await nextFrame();
  const props = new PropsSystem(wd.lights, wd.signals, wd.props, tex);
  root.add(props.group);
  progress(0.92, '海と湖を生成中…');
  await nextFrame();
  const water = new WaterSystem(hf, tex, q.tier === 'low' ? 110 : q.tier === 'medium' ? 150 : 200);
  root.add(water.group);
  const landmarks = new Landmarks(hf, world, ground);
  root.add(landmarks.group);
  // debug: ?hide=terrain,roads,buildings,veg,props,water,landmarks hides groups (for bisecting perf issues)
  try {
    const hide = new URLSearchParams(location.search).get('hide');
    if (hide) {
      const map: Record<string, THREE.Object3D> = { terrain: terrain.group, roads, buildings: bm.group, veg: vegetation.group, props: props.group, water: water.group, landmarks: landmarks.group, billboards };
      for (const k of hide.split(',')) {
        const o = map[k];
        if (o) o.visible = false;
      }
    }
  } catch {
    /* ignore */
  }
  progress(0.97, '仕上げ中…');
  await nextFrame();
  return { tex, hf, graph, wd, ground, world, root, terrain, vegetation, props, water, landmarks, lightColliderToIndex, signs: bm.signs, billboards };
}

function addPropCollider(world: CollisionWorld, p: Prop): void {
  switch (p.kind) {
    case 'hydrant':
      world.addCircle(p.x, p.z, 0.22, p.y - 0.2, p.y + 0.8, 'prop');
      break;
    case 'bin':
      world.addCircle(p.x, p.z, 0.32, p.y - 0.2, p.y + 1, 'prop');
      break;
    case 'busstop':
      world.addCircle(p.x, p.z, 0.9, p.y - 0.2, p.y + 2.6, 'prop');
      break;
    case 'lifeguard':
      world.addCircle(p.x, p.z, 1.6, p.y - 0.5, p.y + 4.2, 'prop');
      break;
    case 'rock':
      world.addCircle(p.x, p.z, p.s * 1.0, p.y - 1, p.y + p.s * 1.4, 'prop');
      break;
    case 'container': {
      const y = p.y + p.s * 2.6;
      world.addBox(p.x - 1.25, p.z - 6.1, p.x + 1.25, p.z + 6.1, y - 0.1, y + 2.6);
      break;
    }
    case 'crane':
      for (const [dx, dz] of [[-9, -6], [9, -6], [-9, 6], [9, 6]] as const) {
        // crane faces +x (yaw pi/2): rotate offsets
        world.addCircle(p.x + dz, p.z - dx, 1.0, p.y - 1, p.y + 36, 'prop');
      }
      break;
    case 'tank':
      world.addCircle(p.x, p.z, 6 * p.s, p.y - 1, p.y + 12 * p.s, 'prop');
      break;
    case 'chimney':
      world.addCircle(p.x, p.z, 2.2 * p.s, p.y - 1, p.y + 38 * p.s, 'prop');
      break;
    case 'fountain':
      world.addCircle(p.x, p.z, 4.1 * p.s, p.y - 0.5, p.y + 0.7 * p.s, 'prop');
      break;
    case 'canopy': {
      const alongX = Math.abs(Math.sin(p.yaw)) < 0.5;
      for (const a of [-9, 9]) for (const b of [-4, 4]) {
        const ox = alongX ? a : b;
        const oz = alongX ? b : a;
        world.addCircle(p.x + ox, p.z + oz, 0.35, p.y - 0.5, p.y + 5, 'prop');
      }
      break;
    }
    case 'pump':
      world.addCircle(p.x, p.z, 0.55, p.y - 0.2, p.y + 1.9, 'prop');
      break;
    case 'planter':
      world.addCircle(p.x, p.z, 0.75, p.y - 0.2, p.y + 0.6, 'prop');
      break;
    case 'barrier':
      break;
    default:
      break;
  }
}
