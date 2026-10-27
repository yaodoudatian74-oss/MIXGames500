// Graphics quality tiers and user settings.

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  tier: QualityTier;
  pixelRatio: number; // multiplier of devicePixelRatio (capped)
  maxDpr: number;
  shadowMap: number; // 0 = off
  shadowExtent: number;
  msaa: number;
  fxaa: boolean;
  bloom: boolean;
  ao: boolean;
  dof: boolean;
  motionBlur: boolean;
  viewDistance: number;
  treeDistance: number;
  grass: boolean;
  traffic: number;
  peds: number;
  parked: number;
  textureSize: number;
  fpsLimit: number; // 0 = unlimited
  terrainDetail: number; // segments per chunk near
}

export const TIERS: Record<QualityTier, Omit<QualitySettings, 'fpsLimit'>> = {
  low: { tier: 'low', pixelRatio: 0.75, maxDpr: 1.25, shadowMap: 1024, shadowExtent: 80, msaa: 0, fxaa: true, bloom: true, ao: false, dof: false, motionBlur: false, viewDistance: 750, treeDistance: 320, grass: false, traffic: 18, peds: 22, parked: 30, textureSize: 256, terrainDetail: 32 },
  medium: { tier: 'medium', pixelRatio: 1, maxDpr: 1.5, shadowMap: 2048, shadowExtent: 130, msaa: 0, fxaa: true, bloom: true, ao: true, dof: false, motionBlur: true, viewDistance: 1300, treeDistance: 620, grass: true, traffic: 36, peds: 44, parked: 60, textureSize: 1024, terrainDetail: 56 },
  high: { tier: 'high', pixelRatio: 1, maxDpr: 2, shadowMap: 4096, shadowExtent: 170, msaa: 4, fxaa: false, bloom: true, ao: true, dof: false, motionBlur: true, viewDistance: 1900, treeDistance: 950, grass: true, traffic: 48, peds: 60, parked: 80, textureSize: 1024, terrainDetail: 72 },
  ultra: { tier: 'ultra', pixelRatio: 1, maxDpr: 2.5, shadowMap: 4096, shadowExtent: 220, msaa: 4, fxaa: false, bloom: true, ao: true, dof: true, motionBlur: true, viewDistance: 2600, treeDistance: 1300, grass: true, traffic: 60, peds: 76, parked: 100, textureSize: 2048, terrainDetail: 80 },
};

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

export function defaultTier(): QualityTier {
  return 'high';
}

export function makeQuality(tier: QualityTier, fpsLimit = 0): QualitySettings {
  return { ...TIERS[tier], fpsLimit };
}

export interface UserSettings {
  tier: QualityTier;
  fpsLimit: number;
  resScale: number; // 0.5..1.5
  bloom: boolean;
  motionBlur: boolean;
  dof: boolean;
  ao: boolean;
  shadows: boolean;
  volume: number;
  music: number;
  sensitivity: number;
  invertY: boolean;
  trafficScale: number; // 0.5..1.5
  pedScale: number;
  timeScale: number; // minutes per second
  minimapRotate: boolean;
  subtitles: boolean;
  autoQuality: boolean;
}

export function defaultSettings(): UserSettings {
  const tier = defaultTier();
  const q = TIERS[tier];
  return {
    tier,
    fpsLimit: isMobile() ? 60 : 0,
    resScale: 1,
    bloom: q.bloom,
    motionBlur: q.motionBlur,
    dof: q.dof,
    ao: q.ao,
    shadows: true,
    volume: 0.8,
    music: 0.5,
    sensitivity: 1,
    invertY: false,
    trafficScale: 1,
    pedScale: 1,
    timeScale: 1,
    minimapRotate: true,
    subtitles: true,
    autoQuality: true,
  };
}

/** Combine the tier with user overrides into the effective settings. */
export function effectiveQuality(s: UserSettings): QualitySettings {
  const q = makeQuality(s.tier, s.fpsLimit);
  q.pixelRatio *= s.resScale;
  q.bloom = s.bloom;
  q.motionBlur = s.motionBlur;
  q.dof = s.dof;
  q.ao = q.ao && s.ao;
  if (!s.shadows) q.shadowMap = 0;
  q.traffic = Math.round(q.traffic * s.trafficScale);
  q.peds = Math.round(q.peds * s.pedScale);
  return q;
}
