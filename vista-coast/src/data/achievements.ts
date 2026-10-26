// Achievements (実績) and how they are evaluated from game stats.

import type { Stats } from '../sim/save';

export interface AchievementCtx {
  stats: Stats;
  completed: Set<string>;
  collectibles: number;
  totalCollectibles: number;
  money: number;
  properties: number;
  vehiclesOwned: number;
  maxWanted: number;
  racesWon: number;
  trialsWon: number;
  deliveries: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  check: (c: AchievementCtx) => boolean;
}

export const AREAS: { id: string; name: string }[] = [
  { id: 'downtown', name: 'ダウンタウン' },
  { id: 'beach', name: 'ビーチ' },
  { id: 'airport', name: '空港' },
  { id: 'port', name: '港湾' },
  { id: 'lake', name: '湖と森' },
  { id: 'town', name: '郊外の町' },
  { id: 'hills', name: 'ヴィスタヒルズ' },
  { id: 'sign', name: 'VISTA COASTサイン' },
  { id: 'industrial', name: '工業地帯' },
  { id: 'freeway', name: '高速道路' },
];

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'arrive', name: 'ようこそ VISTA COAST', desc: '最初のミッションをクリア', check: (c) => c.completed.has('m1') },
  { id: 'story', name: '新しい朝', desc: 'メインストーリーをクリア', check: (c) => c.completed.has('m6') },
  { id: 'speed', name: '音速の手前', desc: '時速200kmを出す', check: (c) => c.stats.maxSpeed * 3.6 >= 200 },
  { id: 'air', name: '空を飛ぶ車', desc: '2秒以上ジャンプする', check: (c) => c.stats.maxAir >= 2 },
  { id: 'wanted5', name: '街の嫌われ者', desc: '手配度★5になる', check: (c) => c.maxWanted >= 5 },
  { id: 'escape', name: '逃げ足', desc: '警察から3回逃げ切る', check: (c) => c.stats.escapes >= 3 },
  { id: 'home', name: 'マイホーム', desc: '物件を購入する', check: (c) => c.properties >= 1 },
  { id: 'tycoon', name: '不動産王', desc: '全ての物件を購入する', check: (c) => c.properties >= 3 },
  { id: 'garage', name: 'コレクター', desc: '車を3台所有する', check: (c) => c.vehiclesOwned >= 3 },
  { id: 'racer', name: 'ストリートキング', desc: 'レースで3回優勝', check: (c) => c.racesWon >= 3 },
  { id: 'trial', name: 'タイムアタッカー', desc: 'タイムトライアルを2回クリア', check: (c) => c.trialsWon >= 2 },
  { id: 'courier', name: '敏腕デリバリー', desc: '配達を10回完了', check: (c) => c.deliveries >= 10 },
  { id: 'postcards', name: '絵はがきコレクター', desc: '絵はがきを全部集める', check: (c) => c.collectibles >= c.totalCollectibles },
  { id: 'postcards5', name: '旅の記録', desc: '絵はがきを5枚集める', check: (c) => c.collectibles >= 5 },
  { id: 'explorer', name: '冒険家', desc: '全エリアを訪れる', check: (c) => c.stats.areas.length >= AREAS.length },
  { id: 'rich', name: 'お金持ち', desc: '所持金 $100,000', check: (c) => c.money >= 100000 },
  { id: 'road', name: 'ロードトリップ', desc: '合計100km運転する', check: (c) => c.stats.distanceDriven >= 100000 },
  { id: 'walker', name: '散歩好き', desc: '合計5km歩く', check: (c) => c.stats.distanceWalked >= 5000 },
  { id: 'club', name: 'ナイトアウル', desc: 'CLUB NEON を訪れる', check: (c) => c.stats.clubVisits >= 1 },
];
