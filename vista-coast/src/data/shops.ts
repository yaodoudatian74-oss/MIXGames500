// Shop catalogues, properties and outfits.

export type ItemId = 'snack' | 'soda' | 'burger' | 'coffee' | 'medkit' | 'repairKit' | 'fuelCan' | 'pizza' | 'meal';

export interface ItemDef {
  id: ItemId;
  name: string;
  price: number;
  heal: number; // health restored when used
  desc: string;
  carry: boolean; // goes to inventory (false = consumed immediately)
}

export const ITEMS: Record<ItemId, ItemDef> = {
  snack: { id: 'snack', name: 'ポテトチップス', price: 3, heal: 10, desc: '体力 +10', carry: true },
  soda: { id: 'soda', name: 'コーラ', price: 2, heal: 6, desc: '体力 +6', carry: true },
  coffee: { id: 'coffee', name: 'アイスコーヒー', price: 4, heal: 8, desc: '体力 +8', carry: true },
  burger: { id: 'burger', name: 'サンセットバーガー', price: 9, heal: 35, desc: '体力 +35', carry: false },
  pizza: { id: 'pizza', name: 'マルゲリータ', price: 14, heal: 50, desc: '体力 +50', carry: false },
  meal: { id: 'meal', name: 'ディナーセット', price: 25, heal: 100, desc: '体力 全回復', carry: false },
  medkit: { id: 'medkit', name: '救急キット', price: 60, heal: 60, desc: '体力 +60（持ち歩き）', carry: true },
  repairKit: { id: 'repairKit', name: '修理キット', price: 150, heal: 0, desc: '乗っている車を50%修理', carry: true },
  fuelCan: { id: 'fuelCan', name: '携行缶ガソリン', price: 40, heal: 0, desc: '燃料 +30L', carry: true },
};

export const SHOP_STOCK: Record<string, ItemId[]> = {
  mart: ['snack', 'soda', 'coffee', 'medkit', 'repairKit', 'fuelCan'],
  diner: ['burger', 'coffee', 'meal', 'soda'],
  pizza: ['pizza', 'soda', 'meal'],
  club: ['soda', 'coffee'],
  hospital: ['medkit'],
};

export interface OutfitDef {
  id: string;
  name: string;
  price: number;
  shirt: number;
  pants: number;
  shoes: number;
  jacket: boolean;
  hat: boolean;
}

export const OUTFITS: OutfitDef[] = [
  { id: 'start', name: 'カジュアル（初期）', price: 0, shirt: 0xe8e4da, pants: 0x3a4a63, shoes: 0x2a2a2a, jacket: false, hat: false },
  { id: 'beach', name: 'ビーチスタイル', price: 120, shirt: 0x3fb6c8, pants: 0xd9c9a8, shoes: 0xf2f2f2, jacket: false, hat: true },
  { id: 'street', name: 'ストリート', price: 260, shirt: 0x1d1d1f, pants: 0x2b2f36, shoes: 0xc92a2a, jacket: true, hat: true },
  { id: 'suit', name: 'ビジネススーツ', price: 900, shirt: 0x24262d, pants: 0x24262d, shoes: 0x14100d, jacket: true, hat: false },
  { id: 'racer', name: 'レーサージャケット', price: 650, shirt: 0xb3121a, pants: 0x18191c, shoes: 0x18191c, jacket: true, hat: false },
  { id: 'sunset', name: 'サンセットシャツ', price: 180, shirt: 0xf29f4c, pants: 0x494038, shoes: 0x6b4a2f, jacket: false, hat: false },
  { id: 'night', name: 'ナイトクラブ', price: 480, shirt: 0x5b2c83, pants: 0x111111, shoes: 0x111111, jacket: true, hat: false },
];

export interface PropertyDef {
  id: string; // matches POI id
  name: string;
  price: number;
  garageSlots: number;
  desc: string;
}

export const PROPERTIES: PropertyDef[] = [
  { id: 'apt', name: 'Bayview アパート', price: 6000, garageSlots: 2, desc: '海が見えるワンルーム。セーブ・着替え・ガレージ2台' },
  { id: 'house', name: 'Maple 一戸建て', price: 28000, garageSlots: 4, desc: '静かな住宅街の一軒家。ガレージ4台' },
  { id: 'villa', name: 'Vista Hills ヴィラ', price: 125000, garageSlots: 8, desc: '丘の上の豪邸。街と海を一望。ガレージ8台' },
];

export const DEALER_STOCK: string[] = ['pico', 'meridian', 'courier', 'atlas', 'ridgeback', 'dune', 'thunder', 'raptor', 'vortex', 'regent', 'stratos', 'hauler'];

export const REPAIR_COST_PER_PCT = 6; // $ per 1% damage
export const PAINT_COST = 300;
export const FUEL_PRICE = 1.6; // per litre
export const HOSPITAL_FEE = 200;
export const BUSTED_FINE_PER_STAR = 250;
