// VISTA COAST world layout: coastline, zones, and road network definitions.
// Pure data/logic: no three.js here so it can be unit tested in Node.

import { smoothstep } from '../core/math';
import { smoothPolyline, type P2 } from '../core/poly';

export type { P2 };

export const WORLD_HALF = 2000; // world spans [-2000, 2000] on x and z
export const SEA_LEVEL = 0;
export const CITY_Y = 1.0; // ground height of the flat city
export const ROAD_LIFT = 0.04; // road surface above terrain

// ---------------------------------------------------------------------------
// Coastline. East coast (beach) and south coast, port quay in the south-east.
// ---------------------------------------------------------------------------
export const PORT = { x0: 915, x1: 1180, z0: 650, z1: 1190 };

export function coastX(z: number): number {
  const beach = 1100 + 25 * Math.sin(z / 180) + 12 * Math.sin(z / 63 + 1.3);
  const t = smoothstep(560, 660, z);
  return beach * (1 - t) + PORT.x1 * t;
}

export function coastZ(x: number): number {
  if (x < -620) return 1500;
  const t = smoothstep(-620, -520, x);
  const south = 1200 + 20 * Math.sin(x / 200) + 8 * Math.sin(x / 71);
  return 1500 * (1 - t) + south * t;
}

/** Signed distance-ish to the coastline. Positive on land, negative in the sea. */
export function coastDistance(x: number, z: number): number {
  const dEast = coastX(z) - x;
  const dSouth = coastZ(x) - z;
  return Math.min(dEast, dSouth);
}

export function inPort(x: number, z: number): boolean {
  return x >= PORT.x0 - 5 && z >= PORT.z0 - 20 && z <= PORT.z1 + 15;
}

// ---------------------------------------------------------------------------
// Flat zones (city grid, airport, town...). Outside them terrain becomes hilly.
// ---------------------------------------------------------------------------
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const CITY_RECT: Rect = { x0: -1110, z0: -960, x1: 1200, z1: 1210 };
export const AIRPORT_RECT: Rect = { x0: -1880, z0: 640, x1: -1130, z1: 1420 };
export const TOWN_RECT: Rect = { x0: -1720, z0: -320, x1: -1280, z1: 320 };
export const WESTWAY_RECT: Rect = { x0: -1720, z0: 560, x1: -1050, z1: 640 };
export const TOWNRD_RECT: Rect = { x0: -1530, z0: 250, x1: -1470, z1: 620 };

export const FLAT_ZONES: Rect[] = [CITY_RECT, AIRPORT_RECT, TOWN_RECT, WESTWAY_RECT, TOWNRD_RECT];

export function rectDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.sqrt(dx * dx + dz * dz);
}

export function inRect(r: Rect, x: number, z: number, margin = 0): boolean {
  return x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin;
}

/** 1 inside flat zones, fading to 0 over `blend` meters. */
export function flatMask(x: number, z: number, blend = 90): number {
  let m = 0;
  for (const r of FLAT_ZONES) {
    const d = rectDistance(r, x, z);
    if (d <= 0) return 1;
    m = Math.max(m, 1 - smoothstep(0, blend, d));
  }
  return m;
}

export const LAKE = { x: -1000, z: -1240, r: 170 };
export const SIGN_POS = { x: -180, z: -1560 }; // big VISTA COAST letters on the hillside

// ---------------------------------------------------------------------------
// Road network definitions.
// ---------------------------------------------------------------------------
export type RoadClass = 'avenue' | 'street' | 'freeway' | 'highway' | 'rural';

export interface RoadSpec {
  lanesPerDir: number;
  laneW: number;
  medianW: number;
  parkingW: number;
  sidewalkW: number;
  speed: number; // m/s speed limit
}

export const ROAD_SPECS: Record<RoadClass, RoadSpec> = {
  avenue: { lanesPerDir: 2, laneW: 3.5, medianW: 1.2, parkingW: 0, sidewalkW: 4.5, speed: 16 },
  street: { lanesPerDir: 1, laneW: 3.6, medianW: 0, parkingW: 2.4, sidewalkW: 4, speed: 12.5 },
  freeway: { lanesPerDir: 2, laneW: 3.7, medianW: 1.6, parkingW: 1.6, sidewalkW: 0, speed: 27 },
  highway: { lanesPerDir: 2, laneW: 3.6, medianW: 2, parkingW: 1, sidewalkW: 2, speed: 22 },
  rural: { lanesPerDir: 1, laneW: 3.5, medianW: 0, parkingW: 0.8, sidewalkW: 0, speed: 15 },
};

export function roadHalfWidth(cls: RoadClass): number {
  const s = ROAD_SPECS[cls];
  return s.medianW / 2 + s.lanesPerDir * s.laneW + s.parkingW;
}

export interface RoadDef {
  id: number;
  cls: RoadClass;
  name: string;
  a: number; // start node id
  b: number; // end node id
  pts: P2[]; // polyline from node a to node b (inclusive)
  elevated: boolean; // freeway deck: heights come from deckHeight()
  grid: boolean; // straight city grid road
}

export interface NodeDef {
  id: number;
  x: number;
  z: number;
  lights: boolean; // signalised intersection
}

// City grid lines.
export const X_LINES: number[] = [];
export const Z_LINES: number[] = [];
for (let x = -1050; x <= 900; x += 150) X_LINES.push(x);
for (let z = -900; z <= 1050; z += 150) Z_LINES.push(z);

export function gridLineClass(v: number): RoadClass {
  return Math.round(v) % 300 === 0 ? 'avenue' : 'street';
}

// Town grid
export const TOWN_X = [-1650, -1500, -1350];
export const TOWN_Z = [-250, 0, 250];

// Freeway (elevated, north-south) geometry
export const FREEWAY_X = 675;
export const FREEWAY = {
  x: FREEWAY_X,
  zNorthGround: -1000,
  zNorthDeck: -850,
  zSouthDeck: 850,
  zSouthGround: 1050,
  deckH: 10,
};

/** Height of the freeway deck above CITY_Y as a function of z (0 at ground ends). */
export function deckHeight(z: number): number {
  const f = FREEWAY;
  if (z < f.zNorthGround || z > f.zSouthGround) return 0;
  if (z < f.zNorthDeck) return f.deckH * smoothstep(f.zNorthGround, f.zNorthDeck, z);
  if (z > f.zSouthDeck) return f.deckH * (1 - smoothstep(f.zSouthDeck, f.zSouthGround - 50, z));
  return f.deckH;
}

export function freewayHalfWidth(): number {
  return roadHalfWidth('freeway') + 0.6;
}

const STREET_NAMES_X: Record<number, string> = {
  [-1050]: 'Westgate St',
  [-900]: 'Palm Ave',
  [-750]: 'Cedar St',
  [-600]: 'Mission Ave',
  [-450]: 'Hill St',
  [-300]: 'Grand Ave',
  [-150]: 'Spring St',
  0: 'Central Ave',
  150: 'Olive St',
  300: 'Vista Ave',
  450: 'Harbor St',
  600: 'Pacific Ave',
  750: 'Coral St',
  900: 'Ocean Drive',
};
const STREET_NAMES_Z: Record<number, string> = {
  [-900]: 'Skyline Blvd',
  [-750]: '1st St',
  [-600]: 'Sunset Blvd',
  [-450]: '3rd St',
  [-300]: 'Wilshore Blvd',
  [-150]: '5th St',
  0: 'Main Blvd',
  150: '7th St',
  300: 'Marina Blvd',
  450: '9th St',
  600: 'Westway Blvd',
  750: '11th St',
  900: 'Dockside Ave',
  1050: 'Bay St',
};

export interface RoadNetworkDef {
  nodes: NodeDef[];
  roads: RoadDef[];
}

let cachedNetwork: RoadNetworkDef | null = null;

export function buildRoadNetwork(): RoadNetworkDef {
  if (cachedNetwork) return cachedNetwork;
  const nodes: NodeDef[] = [];
  const roads: RoadDef[] = [];
  const nodeKey = new Map<string, number>();
  const node = (x: number, z: number, lights = false): number => {
    const k = Math.round(x) + ',' + Math.round(z);
    const existing = nodeKey.get(k);
    if (existing !== undefined) {
      const n = nodes[existing];
      if (n && lights) n.lights = true;
      return existing;
    }
    const id = nodes.length;
    nodes.push({ id, x, z, lights });
    nodeKey.set(k, id);
    return id;
  };
  const addRoad = (cls: RoadClass, name: string, pts: P2[], opts?: { elevated?: boolean; grid?: boolean }): void => {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last) return;
    const a = node(first.x, first.z);
    const b = node(last.x, last.z);
    roads.push({
      id: roads.length,
      cls,
      name,
      a,
      b,
      pts: cls === 'rural' ? smoothPolyline(pts, 5) : pts.map((p) => ({ x: p.x, z: p.z })),
      elevated: opts?.elevated ?? false,
      grid: opts?.grid ?? false,
    });
  };

  // Grid intersections: all lines span full extents.
  const zMin = Z_LINES[0] as number;
  const zMax = Z_LINES[Z_LINES.length - 1] as number;
  const xMin = X_LINES[0] as number;
  const xMax = X_LINES[X_LINES.length - 1] as number;
  for (const x of X_LINES) for (const z of Z_LINES) node(x, z, true);
  // Extra split node where the freeway meets Bay St.
  node(FREEWAY_X, zMax, true);

  // Vertical grid roads (constant x) split at every crossing.
  for (const x of X_LINES) {
    const cls = gridLineClass(x);
    for (let j = 0; j < Z_LINES.length - 1; j++) {
      const z0 = Z_LINES[j] as number;
      const z1 = Z_LINES[j + 1] as number;
      addRoad(cls, STREET_NAMES_X[x] ?? 'St', [{ x, z: z0 }, { x, z: z1 }], { grid: true });
    }
  }
  // Horizontal grid roads (constant z).
  for (const z of Z_LINES) {
    const cls = gridLineClass(z);
    const xs = X_LINES.slice();
    if (z === zMax) {
      xs.push(FREEWAY_X);
      xs.sort((p, q) => p - q);
    }
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i] as number;
      const x1 = xs[i + 1] as number;
      addRoad(cls, STREET_NAMES_Z[z] ?? 'St', [{ x: x0, z }, { x: x1, z }], { grid: true });
    }
  }
  void zMin;
  void xMin;
  void xMax;

  // Elevated freeway: from Bay St (south ground) to the north ramp end.
  const fwPts: P2[] = [];
  for (let z = FREEWAY.zSouthGround; z >= FREEWAY.zNorthGround; z -= 50) fwPts.push({ x: FREEWAY_X, z });
  addRoad('freeway', 'Vista Freeway', fwPts, { elevated: true });
  const FN = { x: FREEWAY_X, z: FREEWAY.zNorthGround };

  // Coastal and mountain roads.
  const J1 = { x: 960, z: -1150 };
  const J2 = { x: 420, z: -1620 };
  const J3 = { x: -220, z: -1330 };
  const J4 = { x: -880, z: -1030 };
  const T1 = { x: -1500, z: -250 };
  addRoad('rural', 'Coast Hwy', [{ x: 900, z: -900 }, { x: 935, z: -1010 }, { x: 958, z: -1085 }, J1]);
  addRoad('rural', 'Freeway Link', [FN, { x: 690, z: -1055 }, { x: 760, z: -1105 }, { x: 860, z: -1140 }, J1]);
  addRoad('rural', 'Coast Hwy', [J1, { x: 965, z: -1240 }, { x: 952, z: -1330 }, { x: 915, z: -1430 }, { x: 850, z: -1520 }, { x: 760, z: -1585 }, { x: 640, z: -1630 }, { x: 520, z: -1640 }, J2]);
  addRoad('rural', 'Canyon Rd', [J2, { x: 330, z: -1600 }, { x: 230, z: -1560 }, { x: 120, z: -1510 }, { x: 20, z: -1460 }, { x: -80, z: -1420 }, { x: -160, z: -1380 }, J3]);
  addRoad('rural', 'Vista Hills Dr', [{ x: -300, z: -900 }, { x: -312, z: -980 }, { x: -322, z: -1060 }, { x: -305, z: -1140 }, { x: -270, z: -1220 }, { x: -240, z: -1285 }, J3]);
  addRoad('rural', 'Ridge Rd', [J3, { x: -300, z: -1300 }, { x: -380, z: -1255 }, { x: -470, z: -1215 }, { x: -560, z: -1180 }, { x: -660, z: -1130 }, { x: -760, z: -1080 }, J4]);
  addRoad('rural', 'Lake Rd', [{ x: -1050, z: -900 }, { x: -1000, z: -950 }, { x: -940, z: -1000 }, J4]);
  addRoad('rural', 'Lakeshore Dr', [J4, { x: -960, z: -1030 }, { x: -1050, z: -1035 }, { x: -1140, z: -1045 }, { x: -1230, z: -1040 }, { x: -1320, z: -990 }, { x: -1400, z: -900 }, { x: -1460, z: -790 }, { x: -1500, z: -660 }, { x: -1530, z: -540 }, { x: -1530, z: -420 }, { x: -1515, z: -330 }, T1]);

  // Town grid.
  for (const x of TOWN_X) for (const z of TOWN_Z) node(x, z, x === -1500 && z === 0);
  for (const x of TOWN_X) {
    for (let j = 0; j < TOWN_Z.length - 1; j++) {
      addRoad('street', 'Town St', [{ x, z: TOWN_Z[j] as number }, { x, z: TOWN_Z[j + 1] as number }], { grid: true });
    }
  }
  for (const z of TOWN_Z) {
    for (let i = 0; i < TOWN_X.length - 1; i++) {
      addRoad('street', 'Town Ave', [{ x: TOWN_X[i] as number, z }, { x: TOWN_X[i + 1] as number, z }], { grid: true });
    }
  }
  addRoad('rural', 'Town Rd', [{ x: -1500, z: 250 }, { x: -1500, z: 400 }, { x: -1500, z: 600 }]);
  // Westway highway from the grid to the airport and town.
  addRoad('highway', 'Westway', [{ x: -1050, z: 600 }, { x: -1200, z: 600 }, { x: -1350, z: 600 }], { grid: true });
  addRoad('highway', 'Westway', [{ x: -1350, z: 600 }, { x: -1500, z: 600 }], { grid: true });
  addRoad('highway', 'Westway', [{ x: -1500, z: 600 }, { x: -1650, z: 600 }], { grid: true });
  addRoad('street', 'Airport Rd', [{ x: -1350, z: 600 }, { x: -1350, z: 690 }], { grid: true });
  // Port roads.
  addRoad('street', 'Port Rd', [{ x: 900, z: 900 }, { x: 1000, z: 900 }, { x: 1100, z: 900 }], { grid: true });
  addRoad('street', 'Quay Rd', [{ x: 900, z: 750 }, { x: 1050, z: 750 }], { grid: true });

  cachedNetwork = { nodes, roads };
  return cachedNetwork;
}

/** Length of a polyline. */
export function polylineLength(pts: readonly P2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as P2;
    const b = pts[i] as P2;
    L += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return L;
}
