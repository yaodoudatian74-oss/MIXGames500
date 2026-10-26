// Points of interest: special buildings, shops and services in VISTA COAST.

export type PoiKind =
  | 'shop'
  | 'restaurant'
  | 'gas'
  | 'police'
  | 'hospital'
  | 'fire'
  | 'mall'
  | 'park'
  | 'club'
  | 'clothes'
  | 'dealer'
  | 'mechanic'
  | 'property'
  | 'parking'
  | 'cityhall'
  | 'airport'
  | 'port';

export type Face = 'n' | 's' | 'e' | 'w';

export interface PoiDef {
  id: string;
  name: string;
  kind: PoiKind;
  /** Lower-left grid line coordinates of the block (x line, z line). */
  block?: [number, number];
  /** Explicit centre for POIs outside the grid. */
  at?: { x: number; z: number };
  interior?: string;
  sign?: string;
  bw: number;
  bd: number;
  bh: number;
  color: number;
  face: Face;
  icon: string;
  /** Keep the rest of the block as a parking lot. */
  lot?: boolean;
}

export const POIS: PoiDef[] = [
  { id: 'mall', name: 'Vista Grand Mall', kind: 'mall', block: [150, 150], interior: 'mall', sign: 'VISTA GRAND MALL', bw: 116, bd: 96, bh: 26, color: 0xe8e2d6, face: 'n', icon: '🛍' },
  { id: 'mallLot', name: 'モール駐車場', kind: 'parking', block: [300, 150], bw: 0, bd: 0, bh: 0, color: 0, face: 'w', icon: 'P', lot: true },
  { id: 'park', name: 'Vista Park', kind: 'park', block: [-150, 300], bw: 0, bd: 0, bh: 0, color: 0, face: 'n', icon: '🌳' },
  { id: 'hospital', name: 'Vista Coast General Hospital', kind: 'hospital', block: [-450, -150], interior: 'hospital', sign: 'GENERAL HOSPITAL', bw: 80, bd: 46, bh: 34, color: 0xf2f2ef, face: 'e', icon: '✚' },
  { id: 'police', name: 'VCPD 中央警察署', kind: 'police', block: [-150, 0], interior: 'police', sign: 'VCPD', bw: 64, bd: 40, bh: 18, color: 0xcfd3d8, face: 'n', icon: '★', lot: true },
  { id: 'fire', name: 'Station 7 消防署', kind: 'fire', block: [450, 300], interior: 'fire', sign: 'FIRE STATION 7', bw: 48, bd: 30, bh: 12, color: 0xb23a2a, face: 'w', icon: '🔥', lot: true },
  { id: 'diner', name: 'Sunset Diner', kind: 'restaurant', block: [750, -150], interior: 'diner', sign: 'SUNSET DINER', bw: 28, bd: 18, bh: 7, color: 0xf6d7b0, face: 'e', icon: '🍔', lot: true },
  { id: 'pizza', name: 'Pizza Vista', kind: 'restaurant', block: [-300, -300], interior: 'pizza', sign: 'PIZZA VISTA', bw: 24, bd: 18, bh: 8, color: 0xd9c6a5, face: 's', icon: '🍕' },
  { id: 'mart1', name: 'VISTA MART 西店', kind: 'shop', block: [-600, 150], interior: 'mart', sign: 'VISTA MART', bw: 26, bd: 20, bh: 6, color: 0xeeeeee, face: 'n', icon: '🏪', lot: true },
  { id: 'mart2', name: 'VISTA MART 北店', kind: 'shop', block: [300, -900], interior: 'mart', sign: 'VISTA MART', bw: 26, bd: 20, bh: 6, color: 0xeeeeee, face: 's', icon: '🏪' },
  { id: 'mart3', name: 'VISTA MART 海岸店', kind: 'shop', block: [750, 450], interior: 'mart', sign: 'VISTA MART', bw: 26, bd: 20, bh: 6, color: 0xeeeeee, face: 'e', icon: '🏪', lot: true },
  { id: 'gas1', name: 'COASTLINE ガソリンスタンド', kind: 'gas', block: [-1050, 300], interior: 'mart', sign: 'COASTLINE', bw: 18, bd: 14, bh: 5, color: 0xf3f0ea, face: 'e', icon: '⛽', lot: true },
  { id: 'gas2', name: 'COASTLINE 工業地区', kind: 'gas', block: [450, 750], interior: 'mart', sign: 'COASTLINE', bw: 18, bd: 14, bh: 5, color: 0xf3f0ea, face: 'n', icon: '⛽', lot: true },
  { id: 'clothes', name: 'MODA VISTA', kind: 'clothes', block: [0, -150], interior: 'clothes', sign: 'MODA VISTA', bw: 34, bd: 24, bh: 10, color: 0x2b2b30, face: 's', icon: '👕' },
  { id: 'dealer', name: 'NEXA MOTORS', kind: 'dealer', block: [-750, 600], interior: 'dealer', sign: 'NEXA MOTORS', bw: 52, bd: 30, bh: 9, color: 0xd5dde4, face: 'n', icon: '🚗', lot: true },
  { id: 'mechanic', name: "Marco's Garage", kind: 'mechanic', block: [-300, 450], interior: 'mechanic', sign: "MARCO'S GARAGE", bw: 40, bd: 28, bh: 9, color: 0x8c7b66, face: 'n', icon: '🔧', lot: true },
  { id: 'club', name: 'CLUB NEON', kind: 'club', block: [450, -450], interior: 'club', sign: 'CLUB NEON', bw: 44, bd: 34, bh: 14, color: 0x1c1c24, face: 'w', icon: '🎵' },
  { id: 'garageDT', name: 'ダウンタウン地下駐車場', kind: 'parking', block: [0, -450], interior: 'underground', sign: 'P  PARKING', bw: 44, bd: 40, bh: 22, color: 0x9aa0a6, face: 'e', icon: 'P' },
  { id: 'cityhall', name: 'Vista City Hall', kind: 'cityhall', block: [-150, -300], sign: 'CITY HALL', bw: 70, bd: 46, bh: 30, color: 0xe6dfcf, face: 's', icon: '🏛' },
  { id: 'apt', name: 'Bayview アパート', kind: 'property', block: [750, 150], interior: 'apt', sign: 'BAYVIEW', bw: 34, bd: 26, bh: 24, color: 0xf0c9a8, face: 'e', icon: '🏠' },
  { id: 'house', name: 'Maple 一戸建て', kind: 'property', block: [-900, 750], interior: 'house', bw: 16, bd: 14, bh: 7, color: 0xdcd3c0, face: 'n', icon: '🏠' },
  { id: 'villa', name: 'Vista Hills ヴィラ', kind: 'property', at: { x: -232, z: -1178 }, interior: 'villa', bw: 30, bd: 20, bh: 8, color: 0xf2f2f0, face: 'w', icon: '🏠' },
  { id: 'townDiner', name: 'Route 9 Diner', kind: 'restaurant', block: [-1650, 0], interior: 'diner', sign: 'ROUTE 9 DINER', bw: 24, bd: 16, bh: 6, color: 0xe9e1cf, face: 'e', icon: '🍔', lot: true },
  { id: 'townGas', name: 'COASTLINE 郊外店', kind: 'gas', block: [-1500, -250], interior: 'mart', sign: 'COASTLINE', bw: 18, bd: 14, bh: 5, color: 0xf3f0ea, face: 'w', icon: '⛽', lot: true },
  { id: 'airport', name: 'Vista Coast 国際空港', kind: 'airport', at: { x: -1400, z: 740 }, sign: 'VISTA COAST INTERNATIONAL', bw: 300, bd: 70, bh: 22, color: 0xdfe6ea, face: 'n', icon: '✈' },
  { id: 'port', name: 'Vista Coast 港', kind: 'port', at: { x: 1040, z: 980 }, bw: 0, bd: 0, bh: 0, color: 0, face: 'w', icon: '⚓' },
];

export function poiById(id: string): PoiDef | undefined {
  return POIS.find((p) => p.id === id);
}
