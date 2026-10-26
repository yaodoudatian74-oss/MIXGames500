# VISTA COAST

ブラウザで動く 3D オープンワールド・クライムアクション（three.js + TypeScript）。
架空の海沿いの街「VISTA COAST」を歩き・走り・運転し、ミッション、警察の追跡、買い物や物件購入、天気と昼夜の変化を楽しめます。

## 遊び方
- `dist/index.html`（または `dist/standalone.html`）をブラウザで開く。PWA（manifest + service worker）対応。
- PC: WASD 移動 / マウス視点 / F 乗り降り / E 調べる / Space ジャンプ・サイドブレーキ / Shift ダッシュ / M 地図 / Esc ポーズ / V 視点切替
- スマホ: 画面のスティックとボタンで操作。ホーム画面に追加すると全画面で遊べます。
- Android: `tools/apk.sh` で WebView ラッパーの署名済み APK を作れます（Gradle 不要: aapt2 → javac → d8 → zipalign → apksigner）。

## 開発
```
npm install
npm run typecheck   # TypeScript strict
npm test            # 22 本のロジック/ヘッドレステスト
npm run build       # dist/ に単一 HTML を出力
python3 tools/play.py   # ブラウザでのプレイ自動テスト（20 チェック）
python3 tools/shots.py OUT  # 各エリアのスクリーンショット
```

## 構成
- `src/core` 数学・乱数・入力 / `src/world` 地形・道路・建物・植生・水 / `src/sim` 車両物理・交通AI・歩行者・手配度・経済・ミッション・セーブ
- `src/render` テクスチャ・シェーダー・空・ポストエフェクト / `src/entities` 人物と車のモデル / `src/game` ゲーム本体 / `src/ui` HUD・地図・タッチ操作
