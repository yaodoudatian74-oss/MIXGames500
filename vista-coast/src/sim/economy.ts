// Money, inventory, properties, stored vehicles and outfits. Pure state + rules.

import { ITEMS, OUTFITS, PROPERTIES, type ItemId } from '../data/shops';

export interface StoredVehicle {
  specId: string;
  color: number;
  damage: number;
}

export interface EconomyState {
  money: number;
  inventory: Partial<Record<ItemId, number>>;
  properties: string[];
  garages: Record<string, StoredVehicle[]>;
  outfits: string[];
  outfit: string;
  earned: number;
  spent: number;
}

export function newEconomy(): EconomyState {
  return {
    money: 800,
    inventory: { snack: 1 },
    properties: [],
    garages: {},
    outfits: ['start'],
    outfit: 'start',
    earned: 0,
    spent: 0,
  };
}

export class Economy {
  constructor(public s: EconomyState) {}

  get money(): number {
    return this.s.money;
  }

  earn(amount: number): void {
    if (!(amount > 0)) return;
    this.s.money += Math.floor(amount);
    this.s.earned += Math.floor(amount);
  }

  /** Spend if affordable. */
  spend(amount: number): boolean {
    if (!(amount >= 0)) return false;
    const a = Math.ceil(amount);
    if (this.s.money < a) return false;
    this.s.money -= a;
    this.s.spent += a;
    return true;
  }

  /** Take a fine or fee; never goes below zero. Returns the amount actually taken. */
  fine(amount: number): number {
    const taken = Math.min(this.s.money, Math.max(0, Math.floor(amount)));
    this.s.money -= taken;
    this.s.spent += taken;
    return taken;
  }

  buyItem(id: ItemId): boolean {
    const def = ITEMS[id];
    if (!this.spend(def.price)) return false;
    if (def.carry) this.s.inventory[id] = (this.s.inventory[id] ?? 0) + 1;
    return true;
  }

  count(id: ItemId): number {
    return this.s.inventory[id] ?? 0;
  }

  useItem(id: ItemId): boolean {
    const n = this.count(id);
    if (n <= 0) return false;
    this.s.inventory[id] = n - 1;
    return true;
  }

  owns(propertyId: string): boolean {
    return this.s.properties.includes(propertyId);
  }

  buyProperty(propertyId: string): boolean {
    const p = PROPERTIES.find((q) => q.id === propertyId);
    if (!p || this.owns(propertyId)) return false;
    if (!this.spend(p.price)) return false;
    this.s.properties.push(propertyId);
    this.s.garages[propertyId] = [];
    return true;
  }

  garageCapacity(propertyId: string): number {
    if (propertyId === 'underground') return 3; // public underground parking (always available)
    const p = PROPERTIES.find((q) => q.id === propertyId);
    return p && this.owns(propertyId) ? p.garageSlots : 0;
  }

  storeVehicle(propertyId: string, v: StoredVehicle): boolean {
    const cap = this.garageCapacity(propertyId);
    const list = this.s.garages[propertyId] ?? [];
    if (list.length >= cap) return false;
    list.push({ ...v });
    this.s.garages[propertyId] = list;
    return true;
  }

  takeVehicle(propertyId: string, index: number): StoredVehicle | null {
    const list = this.s.garages[propertyId];
    if (!list || index < 0 || index >= list.length) return null;
    const [v] = list.splice(index, 1);
    return v ?? null;
  }

  buyOutfit(id: string): boolean {
    const o = OUTFITS.find((q) => q.id === id);
    if (!o) return false;
    if (this.s.outfits.includes(id)) {
      this.s.outfit = id;
      return true;
    }
    if (!this.spend(o.price)) return false;
    this.s.outfits.push(id);
    this.s.outfit = id;
    return true;
  }
}
