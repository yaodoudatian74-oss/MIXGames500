// Wanted level (手配度) logic: crimes, police sightings, search area and evasion.

import { clamp } from '../core/math';

export type CrimeKind = 'collision' | 'carjack' | 'assault' | 'hitPed' | 'copAssault' | 'speeding' | 'alarm' | 'trespass';

export const CRIME_SEVERITY: Record<CrimeKind, number> = {
  collision: 0.5,
  carjack: 1,
  assault: 1,
  hitPed: 2,
  copAssault: 3,
  speeding: 0.3,
  alarm: 3,
  trespass: 1,
};

export class WantedSystem {
  level = 0;
  heat = 0; // fractional progress toward next star
  lastSeenX = 0;
  lastSeenZ = 0;
  unseenTime = 0;
  evadeTime = 0;
  searching = false;
  totalStarsEarned = 0;
  maxLevelReached = 0;
  escapes = 0;

  searchRadius(): number {
    return 140 + this.level * 70;
  }

  /** A crime that the police know about (seen by police or reported by a witness). */
  report(kind: CrimeKind | number, x: number, z: number, seenByPolice: boolean): void {
    const sev = typeof kind === 'number' ? kind : CRIME_SEVERITY[kind];
    if (sev <= 0) return;
    if (this.level === 0) {
      this.level = Math.max(1, Math.floor(sev));
      this.heat = sev - Math.floor(sev);
      this.totalStarsEarned += this.level;
    } else {
      this.heat += sev * (seenByPolice ? 0.8 : 0.5);
      while (this.heat >= 1 && this.level < 5) {
        this.heat -= 1;
        this.level++;
        this.totalStarsEarned++;
      }
      this.heat = clamp(this.heat, 0, 0.99);
    }
    this.maxLevelReached = Math.max(this.maxLevelReached, this.level);
    if (seenByPolice || this.level > 0) {
      this.lastSeenX = x;
      this.lastSeenZ = z;
    }
    if (seenByPolice) {
      this.unseenTime = 0;
      this.searching = false;
      this.evadeTime = 0;
    }
  }

  /** Force a minimum level (missions). */
  setLevel(level: number, x: number, z: number): void {
    const l = clamp(Math.round(level), 0, 5);
    if (l > this.level) this.totalStarsEarned += l - this.level;
    this.level = l;
    this.heat = 0;
    this.lastSeenX = x;
    this.lastSeenZ = z;
    this.unseenTime = 0;
    this.evadeTime = 0;
    this.searching = false;
    this.maxLevelReached = Math.max(this.maxLevelReached, this.level);
  }

  clear(): void {
    this.level = 0;
    this.heat = 0;
    this.searching = false;
    this.unseenTime = 0;
    this.evadeTime = 0;
  }

  /**
   * Returns true when the player just escaped (wanted cleared).
   * `seen` = any police unit currently has line of sight to the player.
   */
  update(dt: number, seen: boolean, px: number, pz: number): boolean {
    if (this.level === 0) return false;
    if (seen) {
      this.lastSeenX = px;
      this.lastSeenZ = pz;
      this.unseenTime = 0;
      this.evadeTime = 0;
      this.searching = false;
      return false;
    }
    this.unseenTime += dt;
    if (this.unseenTime > 6) this.searching = true;
    if (!this.searching) return false;
    const d = Math.hypot(px - this.lastSeenX, pz - this.lastSeenZ);
    if (d > this.searchRadius()) this.evadeTime += dt;
    else this.evadeTime = Math.max(0, this.evadeTime - dt * 0.25);
    const needed = 6 + this.level * 2.5;
    const hideLong = this.unseenTime > 35 + this.level * 12;
    if (this.evadeTime > needed || hideLong) {
      this.clear();
      this.escapes++;
      return true;
    }
    return false;
  }
}
