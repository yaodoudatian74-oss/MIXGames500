// UI stylesheet (injected at startup).

export const CSS = `
:root { --accent: #f2b705; --accent2: #4cc9f0; --panel: rgba(12,14,18,0.82); --text: #f4f4f4; }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; height: 100%; overflow: hidden; background: #000; color: var(--text);
  font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Segoe UI", system-ui, sans-serif; touch-action: none; user-select: none; -webkit-user-select: none; }
canvas#game { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
#ui { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
.hud-tr { position: absolute; top: max(12px, env(safe-area-inset-top)); right: max(14px, env(safe-area-inset-right)); text-align: right; }
.money { font: 800 italic 30px/1 "Arial Black", Arial, sans-serif; color: #7ee081; text-shadow: 0 2px 0 #000, 0 0 8px rgba(0,0,0,.7); letter-spacing: .5px; }
.money.flash { color: #fff; }
.stars { font-size: 26px; letter-spacing: 2px; margin-top: 6px; color: rgba(255,255,255,.18); text-shadow: 0 2px 2px #000; }
.stars b { color: #fff; font-weight: 400; }
.stars.flash b { animation: starflash .5s steps(2) infinite; }
@keyframes starflash { 50% { color: #4cc9f0; } }
.clock { font: 700 15px/1.2 system-ui, sans-serif; margin-top: 4px; text-shadow: 0 1px 3px #000; opacity: .92; }
.hud-tl { position: absolute; top: max(10px, env(safe-area-inset-top)); left: max(10px, env(safe-area-inset-left)); }
.mini { width: 176px; height: 176px; border-radius: 50%; border: 3px solid rgba(0,0,0,.7); box-shadow: 0 4px 18px rgba(0,0,0,.6); overflow: hidden; background: #2a3a48; position: relative; }
.mini canvas { width: 100%; height: 100%; display: block; }
.bars { width: 176px; margin-top: 6px; display: flex; gap: 4px; }
.bar { height: 7px; flex: 1; background: rgba(0,0,0,.6); border-radius: 3px; overflow: hidden; }
.bar i { display: block; height: 100%; width: 100%; background: #5cc45c; transition: width .2s; }
.bar.stam i { background: #4cc9f0; }
.objective { position: absolute; top: max(14px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); max-width: 62vw; text-align: center;
  font-weight: 700; font-size: 16px; padding: 7px 14px; background: rgba(0,0,0,.55); border-radius: 6px; text-shadow: 0 1px 2px #000; display: none; }
.objective .t { color: var(--accent); font: 800 20px/1 "Arial Black", Arial, sans-serif; margin-left: 10px; }
.toast { position: absolute; top: 74px; left: 50%; transform: translateX(-50%); background: var(--panel); padding: 9px 16px; border-radius: 8px; font-size: 15px;
  border-left: 4px solid var(--accent); opacity: 0; transition: opacity .3s, transform .3s; white-space: nowrap; max-width: 90vw; overflow: hidden; text-overflow: ellipsis; }
.toast.show { opacity: 1; transform: translateX(-50%) translateY(6px); }
.banner { position: absolute; top: 34%; left: 0; right: 0; text-align: center; opacity: 0; transition: opacity .5s; }
.banner.show { opacity: 1; }
.banner h1 { margin: 0; font: 900 italic 52px/1 "Arial Black", Arial, sans-serif; color: var(--accent); text-shadow: 0 4px 0 #000, 0 0 24px rgba(0,0,0,.6); letter-spacing: 1px; }
.banner p { margin: 10px 0 0; font-size: 18px; font-weight: 700; text-shadow: 0 2px 3px #000; }
.banner.fail h1 { color: #e63946; }
.banner.big h1 { font-size: 72px; }
.subtitle { position: absolute; bottom: 18%; left: 50%; transform: translateX(-50%); text-align: center; max-width: min(760px, 88vw); font-size: 19px; font-weight: 600;
  text-shadow: 0 2px 3px #000, 0 0 8px #000; line-height: 1.45; display: none; }
.subtitle b { color: var(--accent); margin-right: 8px; }
.prompt { position: absolute; bottom: 30%; left: 50%; transform: translateX(-50%); background: var(--panel); padding: 8px 14px; border-radius: 8px; font-size: 15px; display: none; white-space: nowrap; }
.prompt kbd { display: inline-block; min-width: 22px; padding: 1px 6px; margin-right: 8px; background: #fff; color: #000; border-radius: 4px; font: 800 13px/20px system-ui; text-align: center; }
.speedo { position: absolute; right: max(18px, env(safe-area-inset-right)); bottom: max(18px, env(safe-area-inset-bottom)); text-align: right; display: none; }
.speedo .v { font: 900 italic 54px/1 "Arial Black", Arial, sans-serif; text-shadow: 0 3px 0 #000; }
.speedo .u { font: 700 14px system-ui; opacity: .8; margin-left: 4px; }
.speedo .g { font: 800 16px system-ui; color: var(--accent); margin-top: 2px; }
.speedo .row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; align-items: center; font-size: 12px; }
.speedo .mbar { width: 110px; height: 6px; background: rgba(0,0,0,.6); border-radius: 3px; overflow: hidden; }
.speedo .mbar i { display: block; height: 100%; background: #f2b705; }
.speedo .name { font-size: 13px; opacity: .85; margin-bottom: 2px; }
.radio { position: absolute; left: 50%; bottom: max(14px, env(safe-area-inset-bottom)); transform: translateX(-50%); font: 700 13px system-ui; opacity: 0; transition: opacity .4s; background: rgba(0,0,0,.5); padding: 4px 10px; border-radius: 12px; }
.radio.show { opacity: 1; }
.busted { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; background: radial-gradient(transparent 30%, rgba(0,0,0,.7)); }
.busted h1 { font: 900 italic 80px/1 "Arial Black", Arial, sans-serif; margin: 0; text-shadow: 0 5px 0 #000; }
.busted p { font-size: 18px; font-weight: 700; text-shadow: 0 2px 3px #000; }
.arrest { position: absolute; left: 50%; bottom: 40%; transform: translateX(-50%); width: 220px; height: 10px; background: rgba(0,0,0,.6); border-radius: 5px; overflow: hidden; display: none; }
.arrest i { display: block; height: 100%; background: #4cc9f0; }
.fade { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity .45s; pointer-events: none; }
.dmgvig { position: absolute; inset: 0; pointer-events: none; }
.fps { position: absolute; left: 50%; bottom: 2px; transform: translateX(-50%); font: 11px monospace; opacity: .45; display: none; }
/* panels / menus */
.screen { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center; background: rgba(4,6,10,.72); backdrop-filter: blur(6px); pointer-events: auto; }
.screen.show { display: flex; }
.panel { background: var(--panel); border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 18px 20px; width: min(560px, 94vw); max-height: 88vh; overflow: auto; box-shadow: 0 20px 60px rgba(0,0,0,.6); }
.panel h2 { margin: 0 0 12px; font: 900 italic 28px/1.1 "Arial Black", Arial, sans-serif; color: var(--accent); letter-spacing: .5px; }
.panel h3 { margin: 14px 0 6px; font-size: 15px; opacity: .85; }
.btn { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; margin: 6px 0; padding: 12px 14px; border: 0; border-radius: 10px; background: rgba(255,255,255,.08);
  color: var(--text); font: 700 16px system-ui, sans-serif; text-align: left; cursor: pointer; }
.btn:hover, .btn:focus-visible { background: rgba(242,183,5,.22); outline: none; }
.btn.primary { background: var(--accent); color: #111; }
.btn .sub { font-weight: 500; font-size: 13px; opacity: .75; }
.btn[disabled] { opacity: .4; cursor: default; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.set { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.06); font-size: 14px; }
.set select, .set input[type=range] { width: 52%; }
.set select { background: #1c2026; color: #fff; border: 1px solid #333; border-radius: 6px; padding: 6px; font-size: 14px; }
.title { position: fixed; inset: 0; z-index: 30; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding-bottom: 9vh;
  background: linear-gradient(180deg, rgba(0,0,0,.15) 0%, rgba(0,0,0,.1) 45%, rgba(0,0,0,.85) 100%); pointer-events: auto; }
.logo { font: 900 italic clamp(54px, 11vw, 128px)/0.9 "Arial Black", Arial, sans-serif; letter-spacing: -1px; text-align: center;
  background: linear-gradient(180deg, #ffe08a 0%, #f29f4c 48%, #e2507a 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 6px 0 rgba(0,0,0,.65)) drop-shadow(0 0 30px rgba(242,159,76,.35)); }
.tagline { margin: 10px 0 26px; font-weight: 700; letter-spacing: 6px; font-size: 13px; opacity: .85; text-transform: uppercase; }
.title .btn { width: min(340px, 80vw); justify-content: center; font-size: 18px; }
.loading { position: fixed; inset: 0; z-index: 40; background: #07090c; display: flex; align-items: center; justify-content: center; flex-direction: column; pointer-events: auto; }
.loading .bar2 { width: min(420px, 80vw); height: 6px; border-radius: 3px; background: #1d2128; overflow: hidden; margin-top: 18px; }
.loading .bar2 i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #f29f4c, #e2507a); transition: width .2s; }
.loading .msg { margin-top: 10px; font-size: 13px; opacity: .7; }
.err { position: fixed; inset: 0; z-index: 99; background: #180a0a; color: #fff; display: none; padding: 24px; font: 14px/1.5 monospace; white-space: pre-wrap; overflow: auto; pointer-events: auto; }
.mapview { position: fixed; inset: 0; z-index: 25; display: none; background: #0c1a24; pointer-events: auto; }
.mapview.show { display: block; }
.mapview canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.mapview .legend { position: absolute; left: 12px; bottom: max(12px, env(safe-area-inset-bottom)); background: var(--panel); padding: 10px 12px; border-radius: 10px; font-size: 12px; line-height: 1.6; max-width: 46vw; }
.mapview .close { position: absolute; right: 12px; top: max(12px, env(safe-area-inset-top)); width: auto; padding: 10px 16px; }
.mapview .hint { position: absolute; left: 50%; top: max(14px, env(safe-area-inset-top)); transform: translateX(-50%); background: var(--panel); padding: 6px 12px; border-radius: 8px; font-size: 13px; }
/* touch controls */
#touch { position: fixed; inset: 0; z-index: 10; pointer-events: none; display: none; }
#touch.on { display: block; }
.stick { position: absolute; left: max(22px, env(safe-area-inset-left)); bottom: max(26px, env(safe-area-inset-bottom)); width: 150px; height: 150px; border-radius: 50%;
  background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.18); pointer-events: auto; touch-action: none; }
.stick .knob { position: absolute; left: 50%; top: 50%; width: 62px; height: 62px; margin: -31px 0 0 -31px; border-radius: 50%; background: rgba(255,255,255,.35); box-shadow: 0 4px 12px rgba(0,0,0,.4); }
.tbtn { position: absolute; width: 64px; height: 64px; border-radius: 50%; background: rgba(20,22,28,.55); border: 2px solid rgba(255,255,255,.25); color: #fff;
  font: 800 13px/60px system-ui; text-align: center; pointer-events: auto; touch-action: none; user-select: none; }
.tbtn.big { width: 84px; height: 84px; line-height: 80px; font-size: 15px; }
.tbtn.on { background: rgba(242,183,5,.6); }
.tbtn.sm { width: 50px; height: 50px; line-height: 46px; font-size: 12px; }
.pedal { position: absolute; width: 78px; height: 128px; border-radius: 16px; background: rgba(20,22,28,.55); border: 2px solid rgba(255,255,255,.25); color: #fff; font: 800 14px system-ui;
  display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none; }
.pedal.on { background: rgba(242,183,5,.6); }
.lookpad { position: absolute; right: 0; top: 0; width: 55%; height: 100%; pointer-events: auto; touch-action: none; }
/* touch layout: speedometer moves under the clock so it never sits under the pedals */
body.touch .speedo { top: calc(max(12px, env(safe-area-inset-top)) + 84px); bottom: auto; }
body.touch .speedo .v { font-size: 34px; }
body.touch .speedo .row, body.touch .speedo .name { display: none; }
body.touch .radio { bottom: auto; top: calc(max(10px, env(safe-area-inset-top)) + 40px); }
body.touch .subtitle { bottom: max(8px, env(safe-area-inset-bottom)); max-width: 36vw; font-size: 13px; }
/* very short landscape screens: system buttons sit to the right of the stick instead of above it */
@media (max-height: 420px) {
  .tbtn.sys0, .tbtn.sys1, .tbtn.sys2 { top: auto !important; bottom: calc(max(22px, env(safe-area-inset-bottom)) + 108px) !important; }
  .tbtn.sys0 { left: calc(max(22px, env(safe-area-inset-left)) + 160px) !important; }
  .tbtn.sys1 { left: calc(max(22px, env(safe-area-inset-left)) + 216px) !important; }
  .tbtn.sys2 { left: calc(max(22px, env(safe-area-inset-left)) + 272px) !important; }
}
@media (max-height: 500px) {
  .mini { width: 118px; height: 118px; } .bars { width: 118px; }
  .money { font-size: 22px; } .stars { font-size: 17px; margin-top: 3px; } .clock { font-size: 12px; }
  .banner h1 { font-size: 34px; } .banner.big h1 { font-size: 46px; } .banner p { font-size: 14px; }
  .subtitle { font-size: 14px; max-width: 50vw; bottom: 24%; line-height: 1.35; }
  .objective { font-size: 12px; max-width: 46vw; padding: 5px 10px; }
  .toast { top: 44px; font-size: 13px; }
  .prompt { bottom: 46%; font-size: 13px; }
  body.touch .speedo { top: calc(max(8px, env(safe-area-inset-top)) + 62px); }
}
@media (max-width: 720px) {
  .mini { width: 128px; height: 128px; } .bars { width: 128px; }
  .money { font-size: 22px; } .stars { font-size: 19px; }
  .banner h1 { font-size: 36px; } .banner.big h1 { font-size: 48px; }
  .speedo .v { font-size: 40px; }
  .subtitle { font-size: 15px; bottom: 30%; }
  .objective { font-size: 13px; max-width: 54vw; top: max(10px, env(safe-area-inset-top)); }
  .prompt { bottom: 42%; }
}
`;
