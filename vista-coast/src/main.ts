// Entry point: loading screen, title screen, error handling, PWA registration.

import { Game } from './game/game';

declare const __BUILD_TIME__: string;

function $(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error('missing #' + id);
  return e;
}

function showError(msg: string): void {
  const e = document.getElementById('err');
  if (!e) return;
  e.style.display = 'block';
  e.textContent = 'VISTA COAST でエラーが発生しました。\n\n' + msg + '\n\nページを再読み込みしてください。問題が続く場合は設定の画質を下げてください。';
}

window.addEventListener('error', (e) => showError(String(e.error?.stack ?? e.message)));
// stray promise rejections (audio resume, fullscreen, pointer lock…) are not fatal: log only.
// Startup failures are reported through main().catch below.
window.addEventListener('unhandledrejection', (e) => console.warn('unhandled rejection', e.reason));

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const canvas = $('game') as HTMLCanvasElement;
  const bar = $('loadbar');
  const msg = $('loadmsg');
  if (!webglOk()) {
    showError('この端末/ブラウザは WebGL2 に対応していないため起動できません。最新の Chrome / Safari / Edge をお使いください。');
    return;
  }
  const game = new Game(canvas);
  (window as unknown as { __game: Game }).__game = game;
  await game.init((p, m) => {
    bar.style.width = Math.round(p * 100) + '%';
    msg.textContent = m;
  });
  (window as unknown as { __ready: boolean }).__ready = true;
  if (/[?&]noloop/.test(location.search)) return; // debug: probe tools drive rendering themselves
  // title
  const title = $('title');
  const btnContinue = $('btnContinue') as HTMLButtonElement;
  const btnNew = $('btnNew') as HTMLButtonElement;
  const hasSave = game.hasSave();
  btnContinue.style.display = hasSave ? '' : 'none';
  if (!hasSave) btnNew.classList.add('primary');
  game.onFirstFrame = () => {
    $('loading').style.display = 'none';
    title.style.display = 'flex';
  };
  game.startTitle();
  const begin = (cont: boolean): void => {
    game.audio.start();
    title.style.display = 'none';
    if (cont && game.continueGame()) game.hud.notify('おかえりなさい、VISTA COAST へ');
    else game.newGame();
    game.start();
    if (!('ontouchstart' in window)) game.input.requestPointerLock();
    try {
      const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
      if ('ontouchstart' in window && el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
    } catch {
      /* ignore */
    }
  };
  btnContinue.addEventListener('click', () => begin(true));
  const confirmBox = $('newConfirm');
  btnNew.addEventListener('click', () => {
    if (hasSave) {
      confirmBox.style.display = 'flex';
      return;
    }
    begin(false);
  });
  $('btnNewYes').addEventListener('click', () => {
    confirmBox.style.display = 'none';
    begin(false);
  });
  $('btnNewNo').addEventListener('click', () => {
    confirmBox.style.display = 'none';
  });
  canvas.addEventListener('click', () => {
    if (game.state === 'playing' && !('ontouchstart' in window)) game.input.requestPointerLock();
  });
}

// PWA: register the service worker when served over http(s)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => undefined);
  });
}

void main().catch((e: unknown) => showError(String((e as Error)?.stack ?? e)));
void (typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '');
