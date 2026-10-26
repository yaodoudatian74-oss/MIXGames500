// Story and side missions for VISTA COAST (original characters and plot).

export interface Pt {
  x: number;
  z: number;
}

export type Loc = Pt | { poi: string };

export type Step =
  | { t: 'talk'; lines: [string, string][] }
  | { t: 'goto'; at: Loc; r: number; label: string; onFoot?: boolean; vehicleTag?: string; anyVehicle?: boolean; timeLimit?: number }
  | { t: 'spawnVehicle'; tag: string; spec: string; at: Pt; yaw: number; color?: number; ai?: 'none' | 'flee' | 'boss' }
  | { t: 'enterVehicle'; tag: string; label: string }
  | { t: 'deliver'; drops: Pt[]; timeLimit: number; label: string; randomCount?: number }
  | { t: 'chase'; tag: string; label: string; escapeDist: number }
  | { t: 'race'; checkpoints: Pt[]; rivals: string[]; label: string; timeLimit?: number; start: Pt; startYaw: number }
  | { t: 'timeTrial'; checkpoints: Pt[]; timeLimit: number; label: string; start: Pt; startYaw: number }
  | { t: 'setWanted'; level: number; note: string }
  | { t: 'loseWanted'; label: string }
  | { t: 'pickup'; at: Pt; label: string; item: string }
  | { t: 'gotoVehicle'; tag: string; label: string }
  | { t: 'setTime'; hour: number }
  | { t: 'weather'; kind: 'clear' | 'storm' | 'lightRain' | 'fog' }
  | { t: 'reward'; money: number; vehicle?: string };

export interface MissionDef {
  id: string;
  title: string;
  kind: 'main' | 'side';
  giver: string;
  at: Loc; // where the mission starts (marker)
  requires?: string; // mission id that must be completed first
  repeatable?: boolean;
  summary: string;
  steps: Step[];
}

const DELIVERY_SPOTS: Pt[] = [
  { x: -675, z: 218 }, { x: 150, z: -598 }, { x: 523, z: 432 }, { x: -380, z: 760 }, { x: 812, z: -470 },
  { x: -820, z: -310 }, { x: 70, z: 905 }, { x: -1070, z: 520 }, { x: 330, z: -760 }, { x: -225, z: 140 },
  { x: 610, z: -620 }, { x: -515, z: -760 },
];

const HILL_RACE: Pt[] = [
  { x: -313, z: -985 }, { x: -322, z: -1062 }, { x: -304, z: -1142 }, { x: -262, z: -1235 }, { x: -222, z: -1325 },
  { x: -378, z: -1256 }, { x: -560, z: -1180 }, { x: -760, z: -1080 }, { x: -882, z: -1030 }, { x: -942, z: -1000 },
  { x: -1003, z: -948 }, { x: -1050, z: -900 },
];

const DOWNTOWN_LOOP: Pt[] = [
  { x: 300, z: -150 }, { x: 300, z: -450 }, { x: 300, z: -750 }, { x: 0, z: -750 }, { x: -150, z: -600 },
  { x: -150, z: -300 }, { x: 0, z: -150 }, { x: 450, z: -150 },
];

const COAST_RUN: Pt[] = [
  { x: 935, z: -1010 }, { x: 960, z: -1150 }, { x: 952, z: -1330 }, { x: 850, z: -1520 }, { x: 640, z: -1630 }, { x: 420, z: -1620 },
];

const WESTWAY_RACE: Pt[] = [
  { x: -1200, z: 600 }, { x: -1350, z: 600 }, { x: -1500, z: 600 }, { x: -1500, z: 400 }, { x: -1500, z: 250 }, { x: -1500, z: 0 },
];

export const MISSIONS: MissionDef[] = [
  {
    id: 'm1',
    title: 'VISTA COASTへようこそ',
    kind: 'main',
    giver: 'ローザ',
    at: { x: -1400, z: 702 },
    summary: '空港でレンタカーを受け取り、ローザのダイナーへ向かう。',
    steps: [
      { t: 'talk', lines: [['ナレーション', 'レオ・ハヤセ。過去を振り切るため、海辺の街 VISTA COAST に降り立った。'], ['ローザ（電話）', 'レオ？ ローザよ。空港の駐車場に車を用意しておいたわ。'], ['ローザ（電話）', '海沿いのサンセット・ダイナーで待ってる。地図のマーカーを目指して。']] },
      { t: 'spawnVehicle', tag: 'rental', spec: 'meridian', at: { x: -1381, z: 668 }, yaw: 0, color: 0x24508c },
      { t: 'enterVehicle', tag: 'rental', label: '駐車場のレンタカー（青いセダン）に乗る' },
      { t: 'goto', at: { poi: 'diner' }, r: 14, label: 'サンセット・ダイナーへ向かう' },
      { t: 'talk', lines: [['ローザ', 'よく来たわね、レオ。この街は眩しいけど、影も深い。'], ['ローザ', '仕事ならいくらでもある。まずは店の手伝いからね。']] },
      { t: 'reward', money: 500 },
    ],
  },
  {
    id: 'm2',
    title: '熱々の配達',
    kind: 'main',
    giver: 'ローザ',
    at: { poi: 'diner' },
    requires: 'm1',
    summary: '制限時間内に3か所へ料理を届ける。',
    steps: [
      { t: 'talk', lines: [['ローザ', '注文が3件。冷める前に届けて！ 車を止めれば受け渡し完了よ。']] },
      { t: 'deliver', drops: [{ x: 812, z: -470 }, { x: 150, z: -598 }, { x: 523, z: 432 }], timeLimit: 260, label: '料理を届ける' },
      { t: 'talk', lines: [['ローザ', '完璧！ お客さん、みんな喜んでたわ。']] },
      { t: 'reward', money: 900 },
    ],
  },
  {
    id: 'm3',
    title: '盗まれたバン',
    kind: 'main',
    giver: 'ローザ',
    at: { poi: 'diner' },
    requires: 'm2',
    summary: '店のバンを盗んだ犯人を追い、車を取り返す。',
    steps: [
      { t: 'talk', lines: [['ローザ', '大変！ 店のバンが盗まれた！ 今ならまだ追いつける！'], ['ローザ', '体当たりして止めて。バンは壊しすぎないでね！']] },
      { t: 'spawnVehicle', tag: 'thief', spec: 'courier', at: { x: 900, z: -60 }, yaw: Math.PI, color: 0xd9a21b, ai: 'flee' },
      { t: 'chase', tag: 'thief', label: '逃げるバンに体当たりして止める', escapeDist: 420 },
      { t: 'enterVehicle', tag: 'thief', label: 'バンに乗る' },
      { t: 'goto', at: { poi: 'diner' }, r: 14, label: 'バンをダイナーへ戻す', vehicleTag: 'thief' },
      { t: 'talk', lines: [['ローザ', '戻ってきた！ …あのバン、港の倉庫の荷物が積んであったわ。'], ['ローザ', '何か嫌な予感がする。']] },
      { t: 'reward', money: 1500 },
    ],
  },
  {
    id: 'm4',
    title: '丘のストリートレース',
    kind: 'main',
    giver: 'デックス',
    at: { x: -300, z: -918 },
    requires: 'm3',
    summary: 'ヴィスタヒルズの峠道で地元の走り屋と勝負する。',
    steps: [
      { t: 'talk', lines: [['デックス', 'お前が噂の新入りか。この峠で俺に勝てたら港の情報をやるよ。'], ['デックス', 'チェックポイントを全部通ってゴールだ。行くぞ！']] },
      { t: 'race', checkpoints: HILL_RACE, rivals: ['vortex', 'thunder', 'regent'], label: '1位でゴールする', start: { x: -305, z: -925 }, startYaw: Math.PI },
      { t: 'talk', lines: [['デックス', 'マジかよ…やるな。約束だ。港の第9埠頭、夜になると怪しい連中が動いてる。'], ['デックス', 'ほら、勝者の車だ。Vortex GT、大事にしろよ。']] },
      { t: 'reward', money: 3000, vehicle: 'vortex' },
    ],
  },
  {
    id: 'm5',
    title: '港の影',
    kind: 'main',
    giver: 'イネス',
    at: { x: 930, z: 905 },
    requires: 'm4',
    summary: '夜の港で密輸の証拠を手に入れ、警察から逃げ切る。',
    steps: [
      { t: 'setTime', hour: 22.5 },
      { t: 'talk', lines: [['イネス', '港の管理をしてるイネスよ。密輸グループ「ブラックタイド」が埠頭を使ってる。'], ['イネス', 'コンテナ置き場の赤いコンテナに帳簿があるはず。警報には気をつけて。']] },
      { t: 'pickup', at: { x: 1023, z: 1010 }, label: 'コンテナ置き場で帳簿を探す（徒歩）', item: '密輸の帳簿' },
      { t: 'setWanted', level: 3, note: '警報が鳴った！ 警察が来る！' },
      { t: 'loseWanted', label: '警察から逃げ切る' },
      { t: 'goto', at: { poi: 'diner' }, r: 14, label: 'ダイナーでローザと落ち合う' },
      { t: 'talk', lines: [['ローザ', 'この帳簿…ブラックタイドのボス、ヴィクター・クレインの名前がある。'], ['ローザ', '彼はこの街を裏から操ってる。でも、これで終わりにできるかもしれない。']] },
      { t: 'reward', money: 5000 },
    ],
  },
  {
    id: 'm6',
    title: 'ブラックタイドの最後',
    kind: 'main',
    giver: 'ローザ',
    at: { poi: 'diner' },
    requires: 'm5',
    summary: 'ボスの車を止めて証拠のファイルを奪い、警察署へ届ける。',
    steps: [
      { t: 'talk', lines: [['ローザ', 'クレインが街から逃げようとしてる！ 黒いSUVよ！'], ['ローザ', '止めて、残りの証拠を警察に渡して。この街のために。']] },
      { t: 'weather', kind: 'lightRain' },
      { t: 'spawnVehicle', tag: 'boss', spec: 'atlas', at: { x: 300, z: 80 }, yaw: Math.PI, color: 0x0d0d10, ai: 'boss' },
      { t: 'chase', tag: 'boss', label: '黒いSUVに体当たりして止める', escapeDist: 480 },
      { t: 'gotoVehicle', tag: 'boss', label: 'SUVから証拠のファイルを回収する（徒歩で近づく）' },
      { t: 'goto', at: { poi: 'police' }, r: 14, label: '証拠を VCPD 中央警察署へ届ける' },
      { t: 'talk', lines: [['刑事グラント', 'これは…クレインの全取引の記録か。よくやった。'], ['ナレーション', 'ブラックタイドは崩壊し、VISTA COAST に新しい朝が来た。'], ['ナレーション', 'メインストーリー クリア！ 街での自由な生活は続く。']] },
      { t: 'reward', money: 15000 },
    ],
  },
  // ----------------------------------------------------------------- side
  {
    id: 's_delivery',
    title: 'デリバリージョブ',
    kind: 'side',
    giver: 'VISTA MART 店長',
    at: { poi: 'mart1' },
    repeatable: true,
    summary: '2か所に商品を届ける（繰り返し可能）。',
    steps: [
      { t: 'deliver', drops: DELIVERY_SPOTS, randomCount: 2, timeLimit: 170, label: '商品を届ける' },
      { t: 'reward', money: 450 },
    ],
  },
  {
    id: 's_tt_downtown',
    title: 'タイムトライアル：ダウンタウン',
    kind: 'side',
    giver: 'トライアル',
    at: { x: 450, z: -138 },
    repeatable: true,
    summary: '制限時間内にダウンタウンを一周する。',
    steps: [{ t: 'timeTrial', checkpoints: DOWNTOWN_LOOP, timeLimit: 110, label: '時間内に全チェックポイントを通過', start: { x: 438, z: -150 }, startYaw: Math.PI / 2 }, { t: 'reward', money: 800 }],
  },
  {
    id: 's_tt_coast',
    title: 'タイムトライアル：海岸線',
    kind: 'side',
    giver: 'トライアル',
    at: { x: 910, z: -915 },
    repeatable: true,
    summary: '断崖の海岸道路を駆け抜ける。',
    steps: [{ t: 'timeTrial', checkpoints: COAST_RUN, timeLimit: 95, label: '時間内に全チェックポイントを通過', start: { x: 906, z: -905 }, startYaw: Math.PI }, { t: 'reward', money: 1000 }],
  },
  {
    id: 's_race_westway',
    title: 'ストリートレース：ウエストウェイ',
    kind: 'side',
    giver: 'デックス',
    at: { x: -1060, z: 590 },
    requires: 'm4',
    repeatable: true,
    summary: 'ハイウェイから郊外の町まで3台とレース。',
    steps: [{ t: 'race', checkpoints: WESTWAY_RACE, rivals: ['thunder', 'vortex', 'atlas'], label: '1位でゴールする', start: { x: -1066, z: 595 }, startYaw: -Math.PI / 2 }, { t: 'reward', money: 2500 }],
  },
  {
    id: 's_suitcase',
    title: '忘れ物のスーツケース',
    kind: 'side',
    giver: '旅行者のミア',
    at: { x: 1000, z: 10 },
    summary: 'ビーチの旅行者が空港行きに間に合わない。スーツケースを届けて。',
    steps: [
      { t: 'talk', lines: [['ミア', 'ホテルにスーツケースを忘れて…飛行機まであと少しなの！'], ['ミア', 'ホテルの前にあるはず。空港まで届けてくれない？']] },
      { t: 'pickup', at: { x: 830, z: 220 }, label: 'ホテル前のスーツケースを拾う（徒歩）', item: 'スーツケース' },
      { t: 'goto', at: { x: -1400, z: 702 }, r: 15, label: '空港ターミナルへ届ける', anyVehicle: false, timeLimit: 300 },
      { t: 'talk', lines: [['ミア', '間に合った！ 本当にありがとう！']] },
      { t: 'reward', money: 700 },
    ],
  },
  {
    id: 's_hospital',
    title: '急患を病院へ',
    kind: 'side',
    giver: 'ライフガード',
    at: { x: 1010, z: -420 },
    summary: 'ビーチで具合が悪くなった人を病院へ運ぶ。',
    steps: [
      { t: 'talk', lines: [['ライフガード', '熱中症の人がいる！ 救急車が渋滞で来られない、病院まで運んで！']] },
      { t: 'goto', at: { poi: 'hospital' }, r: 15, label: '急いで総合病院へ', anyVehicle: true, timeLimit: 150 },
      { t: 'talk', lines: [['医師', '処置が早くて助かりました。ありがとう。']] },
      { t: 'reward', money: 600 },
    ],
  },
  {
    id: 's_heat',
    title: '腕試し：追跡を振り切れ',
    kind: 'side',
    giver: 'デックス',
    at: { x: -1500, z: 12 },
    requires: 'm4',
    repeatable: true,
    summary: '手配度★2から逃げ切る腕試し。',
    steps: [
      { t: 'talk', lines: [['デックス', '本物のドライバーはパトカーなんか怖くない。★2から逃げ切ってみな。']] },
      { t: 'setWanted', level: 2, note: '手配度★2！' },
      { t: 'loseWanted', label: '警察から逃げ切る' },
      { t: 'reward', money: 1200 },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}
