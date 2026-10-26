// Original vehicle line-up for VISTA COAST. All names and designs are fictional.

export type VehicleCategory =
  | 'sports'
  | 'super'
  | 'sedan'
  | 'compact'
  | 'suv'
  | 'pickup'
  | 'truck'
  | 'bus'
  | 'bike'
  | 'offroad'
  | 'ambulance'
  | 'fire'
  | 'police'
  | 'taxi'
  | 'van'
  | 'luxury'
  | 'muscle';

export type BodyShape = 'coupe' | 'wedge' | 'sedan' | 'hatch' | 'suv' | 'pickup' | 'box' | 'bus' | 'bike' | 'jeep' | 'van';

export interface VehicleSpec {
  id: string;
  name: string;
  category: VehicleCategory;
  shape: BodyShape;
  price: number;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  wheelR: number;
  wheelW: number;
  clearance: number;
  mass: number; // kg
  powerKW: number;
  maxForce: number; // N, low speed traction-limited drive force cap
  topSpeed: number; // m/s
  grip: number; // tyre friction multiplier
  cdA: number; // drag area
  brakeDecel: number; // m/s^2
  steerMax: number; // rad
  cgH: number; // centre of gravity height
  drive: 'rwd' | 'fwd' | 'awd';
  offroad: number; // 0..1, how well it handles grass/sand/dirt
  colors: number[];
  siren: boolean;
  seats: number;
  redline: number;
}

const PAINT_SPORT = [0xb3121a, 0x0c0c0e, 0xf2f2f2, 0x1d4fa8, 0xf2b705, 0x2a2a2e, 0x6c757d, 0xd95d1e];
const PAINT_CIVIL = [0xe8e8e8, 0x1a1a1c, 0x8a9096, 0x2e3a4a, 0x6b1f22, 0x3c4b3a, 0xc7c1b4, 0x24508c, 0x9aa3a8];

export const VEHICLES: VehicleSpec[] = [
  { id: 'vortex', name: 'Vortex GT', category: 'sports', shape: 'coupe', price: 95000, length: 4.5, width: 1.92, height: 1.28, wheelbase: 2.62, wheelR: 0.34, wheelW: 0.27, clearance: 0.12, mass: 1450, powerKW: 360, maxForce: 12500, topSpeed: 82, grip: 1.12, cdA: 0.62, brakeDecel: 11, steerMax: 0.6, cgH: 0.45, drive: 'rwd', offroad: 0.1, colors: PAINT_SPORT, siren: false, seats: 2, redline: 7600 },
  { id: 'stratos', name: 'Stratos R9', category: 'super', shape: 'wedge', price: 320000, length: 4.6, width: 2.02, height: 1.14, wheelbase: 2.7, wheelR: 0.35, wheelW: 0.3, clearance: 0.1, mass: 1380, powerKW: 560, maxForce: 15500, topSpeed: 96, grip: 1.22, cdA: 0.6, brakeDecel: 12, steerMax: 0.58, cgH: 0.4, drive: 'awd', offroad: 0.05, colors: [0xf2b705, 0x9bdb1e, 0xb3121a, 0x111111, 0xf5f5f5, 0x5b2c83], siren: false, seats: 2, redline: 8800 },
  { id: 'meridian', name: 'Meridian S', category: 'sedan', shape: 'sedan', price: 28000, length: 4.8, width: 1.85, height: 1.45, wheelbase: 2.8, wheelR: 0.33, wheelW: 0.23, clearance: 0.15, mass: 1550, powerKW: 150, maxForce: 8200, topSpeed: 60, grip: 0.98, cdA: 0.7, brakeDecel: 9.5, steerMax: 0.62, cgH: 0.55, drive: 'fwd', offroad: 0.2, colors: PAINT_CIVIL, siren: false, seats: 4, redline: 6500 },
  { id: 'pico', name: 'Pico City', category: 'compact', shape: 'hatch', price: 14000, length: 3.9, width: 1.74, height: 1.5, wheelbase: 2.5, wheelR: 0.3, wheelW: 0.2, clearance: 0.15, mass: 1080, powerKW: 75, maxForce: 6000, topSpeed: 47, grip: 0.95, cdA: 0.66, brakeDecel: 9, steerMax: 0.66, cgH: 0.55, drive: 'fwd', offroad: 0.15, colors: [0xd94f2b, 0x4fa3d9, 0xf2f2f2, 0xf2c94c, 0x7bc47f, 0x333333], siren: false, seats: 4, redline: 6200 },
  { id: 'atlas', name: 'Atlas XT', category: 'suv', shape: 'suv', price: 48000, length: 4.9, width: 1.98, height: 1.78, wheelbase: 2.9, wheelR: 0.38, wheelW: 0.26, clearance: 0.22, mass: 2150, powerKW: 220, maxForce: 11000, topSpeed: 62, grip: 0.96, cdA: 0.95, brakeDecel: 9, steerMax: 0.6, cgH: 0.75, drive: 'awd', offroad: 0.55, colors: PAINT_CIVIL, siren: false, seats: 5, redline: 6200 },
  { id: 'ridgeback', name: 'Ridgeback 2500', category: 'pickup', shape: 'pickup', price: 42000, length: 5.6, width: 2.05, height: 1.9, wheelbase: 3.5, wheelR: 0.42, wheelW: 0.28, clearance: 0.26, mass: 2450, powerKW: 260, maxForce: 12500, topSpeed: 58, grip: 0.94, cdA: 1.1, brakeDecel: 8.5, steerMax: 0.56, cgH: 0.8, drive: 'awd', offroad: 0.65, colors: [0x2b2b2b, 0xf2f2f2, 0x7a1f1f, 0x3b5f8a, 0x8a8f7a, 0xc4a35a], siren: false, seats: 4, redline: 5600 },
  { id: 'hauler', name: 'Hauler 9 トラック', category: 'truck', shape: 'box', price: 65000, length: 7.6, width: 2.4, height: 3.2, wheelbase: 4.6, wheelR: 0.5, wheelW: 0.3, clearance: 0.3, mass: 7800, powerKW: 240, maxForce: 26000, topSpeed: 36, grip: 0.88, cdA: 5.5, brakeDecel: 6.5, steerMax: 0.55, cgH: 1.3, drive: 'rwd', offroad: 0.35, colors: [0xf2f2f2, 0x2856a3, 0xd9d9d9, 0xb5332a], siren: false, seats: 2, redline: 3200 },
  { id: 'metro', name: 'Metro Liner バス', category: 'bus', shape: 'bus', price: 180000, length: 11.8, width: 2.55, height: 3.1, wheelbase: 6.6, wheelR: 0.52, wheelW: 0.3, clearance: 0.28, mass: 12500, powerKW: 220, maxForce: 32000, topSpeed: 28, grip: 0.86, cdA: 7, brakeDecel: 6, steerMax: 0.6, cgH: 1.3, drive: 'rwd', offroad: 0.15, colors: [0x2f6fb5, 0xe9e9e9, 0xd23b2f], siren: false, seats: 30, redline: 2600 },
  { id: 'raptor', name: 'Raptor 900 バイク', category: 'bike', shape: 'bike', price: 22000, length: 2.15, width: 0.8, height: 1.15, wheelbase: 1.45, wheelR: 0.31, wheelW: 0.18, clearance: 0.14, mass: 260, powerKW: 105, maxForce: 4200, topSpeed: 74, grip: 1.1, cdA: 0.42, brakeDecel: 10, steerMax: 0.5, cgH: 0.6, drive: 'rwd', offroad: 0.25, colors: [0xd01f1f, 0x111111, 0x1f5fd0, 0xf2f2f2, 0x31c48d], siren: false, seats: 1, redline: 11500 },
  { id: 'dune', name: 'Dune Ranger 4x4', category: 'offroad', shape: 'jeep', price: 52000, length: 4.3, width: 1.95, height: 1.9, wheelbase: 2.6, wheelR: 0.44, wheelW: 0.32, clearance: 0.32, mass: 1950, powerKW: 210, maxForce: 12500, topSpeed: 52, grip: 1.0, cdA: 1.05, brakeDecel: 8.5, steerMax: 0.62, cgH: 0.8, drive: 'awd', offroad: 0.95, colors: [0x4b5d3a, 0xc4a35a, 0x2b2b2b, 0xd04a2a, 0xe8e2d0], siren: false, seats: 4, redline: 5800 },
  { id: 'medic', name: 'Medic One 救急車', category: 'ambulance', shape: 'van', price: 0, length: 6.2, width: 2.2, height: 2.75, wheelbase: 3.9, wheelR: 0.42, wheelW: 0.26, clearance: 0.22, mass: 4100, powerKW: 220, maxForce: 16000, topSpeed: 45, grip: 0.92, cdA: 3.2, brakeDecel: 8, steerMax: 0.58, cgH: 1.05, drive: 'rwd', offroad: 0.25, colors: [0xf4f4f4], siren: true, seats: 2, redline: 4500 },
  { id: 'blaze', name: 'Blaze Commander 消防車', category: 'fire', shape: 'box', price: 0, length: 9.4, width: 2.5, height: 3.3, wheelbase: 5.2, wheelR: 0.52, wheelW: 0.32, clearance: 0.3, mass: 15000, powerKW: 330, maxForce: 38000, topSpeed: 36, grip: 0.88, cdA: 6.5, brakeDecel: 6.5, steerMax: 0.55, cgH: 1.4, drive: 'rwd', offroad: 0.3, colors: [0xc0151a], siren: true, seats: 4, redline: 3000 },
  { id: 'interceptor', name: 'Interceptor VCPD パトカー', category: 'police', shape: 'sedan', price: 0, length: 5.0, width: 1.95, height: 1.5, wheelbase: 2.95, wheelR: 0.35, wheelW: 0.25, clearance: 0.15, mass: 1850, powerKW: 300, maxForce: 12000, topSpeed: 72, grip: 1.05, cdA: 0.8, brakeDecel: 10.5, steerMax: 0.6, cgH: 0.55, drive: 'rwd', offroad: 0.3, colors: [0x111214], siren: true, seats: 4, redline: 6500 },
  { id: 'taxi', name: 'Meridian Taxi', category: 'taxi', shape: 'sedan', price: 26000, length: 4.8, width: 1.85, height: 1.45, wheelbase: 2.8, wheelR: 0.33, wheelW: 0.23, clearance: 0.15, mass: 1550, powerKW: 150, maxForce: 8200, topSpeed: 58, grip: 0.98, cdA: 0.7, brakeDecel: 9.5, steerMax: 0.62, cgH: 0.55, drive: 'fwd', offroad: 0.2, colors: [0xf2c200], siren: false, seats: 4, redline: 6500 },
  { id: 'courier', name: 'Courier バン', category: 'van', shape: 'van', price: 32000, length: 5.4, width: 2.0, height: 2.35, wheelbase: 3.4, wheelR: 0.36, wheelW: 0.23, clearance: 0.18, mass: 2400, powerKW: 130, maxForce: 10500, topSpeed: 44, grip: 0.92, cdA: 2.2, brakeDecel: 8.5, steerMax: 0.6, cgH: 0.95, drive: 'fwd', offroad: 0.2, colors: [0xf2f2f2, 0x2f6fb5, 0xd9a21b, 0x3d3d3d], siren: false, seats: 2, redline: 5200 },
  { id: 'regent', name: 'Regent LX', category: 'luxury', shape: 'sedan', price: 120000, length: 5.2, width: 1.95, height: 1.48, wheelbase: 3.1, wheelR: 0.36, wheelW: 0.26, clearance: 0.14, mass: 2100, powerKW: 390, maxForce: 12000, topSpeed: 76, grip: 1.05, cdA: 0.72, brakeDecel: 10.5, steerMax: 0.58, cgH: 0.55, drive: 'awd', offroad: 0.15, colors: [0x0d0d10, 0xf0f0f0, 0x1c2a3a, 0x5a5a60, 0x3a1416], siren: false, seats: 4, redline: 6800 },
  { id: 'thunder', name: 'Thunder 68', category: 'muscle', shape: 'coupe', price: 58000, length: 4.9, width: 1.95, height: 1.35, wheelbase: 2.85, wheelR: 0.35, wheelW: 0.28, clearance: 0.13, mass: 1700, powerKW: 340, maxForce: 12500, topSpeed: 74, grip: 0.98, cdA: 0.8, brakeDecel: 9.5, steerMax: 0.58, cgH: 0.5, drive: 'rwd', offroad: 0.15, colors: [0x1d4fa8, 0xb3121a, 0x111111, 0xf2b705, 0x2f7d4f, 0xe8e8e8], siren: false, seats: 2, redline: 6400 },
];

export function vehicleById(id: string): VehicleSpec {
  const v = VEHICLES.find((s) => s.id === id);
  if (!v) throw new Error('unknown vehicle ' + id);
  return v;
}

/** Weighted traffic mix by zone character. */
export const TRAFFIC_MIX: { id: string; w: number }[] = [
  { id: 'meridian', w: 22 },
  { id: 'pico', w: 16 },
  { id: 'atlas', w: 14 },
  { id: 'ridgeback', w: 8 },
  { id: 'taxi', w: 7 },
  { id: 'courier', w: 6 },
  { id: 'regent', w: 4 },
  { id: 'thunder', w: 3 },
  { id: 'vortex', w: 2.5 },
  { id: 'stratos', w: 0.8 },
  { id: 'dune', w: 3 },
  { id: 'hauler', w: 3 },
  { id: 'metro', w: 2 },
  { id: 'raptor', w: 3 },
  { id: 'medic', w: 0.6 },
  { id: 'blaze', w: 0.3 },
  { id: 'interceptor', w: 1.2 },
];

export const PARKED_MIX: { id: string; w: number }[] = [
  { id: 'meridian', w: 24 },
  { id: 'pico', w: 18 },
  { id: 'atlas', w: 16 },
  { id: 'ridgeback', w: 9 },
  { id: 'courier', w: 5 },
  { id: 'regent', w: 5 },
  { id: 'thunder', w: 4 },
  { id: 'vortex', w: 3 },
  { id: 'dune', w: 4 },
  { id: 'raptor', w: 3 },
  { id: 'stratos', w: 0.7 },
  { id: 'taxi', w: 2 },
];

export function pickWeighted(mix: readonly { id: string; w: number }[], r: number): string {
  let total = 0;
  for (const m of mix) total += m.w;
  let x = r * total;
  for (const m of mix) {
    x -= m.w;
    if (x <= 0) return m.id;
  }
  const last = mix[mix.length - 1];
  return last ? last.id : 'meridian';
}
