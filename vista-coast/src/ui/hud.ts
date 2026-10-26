// HUD and menus (DOM overlay): minimap, money, wanted stars, clock/weather,
// speedometer, objectives, timers, toasts, banners, subtitles, prompts,
// pause/shop/settings menus, title and loading screens, and the full map.

import { formatMoney, formatTime } from '../core/math';
import { MAP_SIZE, worldToMap } from './mapRender';
import { CSS } from './style';

export interface Blip {
  x: number;
  z: number;
  kind: 'mission' | 'poi' | 'police' | 'target' | 'waypoint' | 'checkpoint' | 'pickup' | 'drop' | 'vehicle' | 'collectible' | 'property';
  icon?: string;
  label?: string;
}

export interface MenuItem {
  label: string;
  sub?: string;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement | null, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export class HUD {
  readonly root: HTMLDivElement;
  private money: HTMLDivElement;
  private stars: HTMLDivElement;
  private clock: HTMLDivElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private hp: HTMLElement;
  private stam: HTMLElement;
  private objective: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastQ: string[] = [];
  private toastT = 0;
  private bannerEl: HTMLDivElement;
  private bannerT = 0;
  private subEl: HTMLDivElement;
  private subT = 0;
  private promptEl: HTMLDivElement;
  private speedo: HTMLDivElement;
  private radioEl: HTMLDivElement;
  private radioT = 0;
  private bustedEl: HTMLDivElement;
  private arrestEl: HTMLDivElement;
  readonly fadeEl: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private screen: HTMLDivElement;
  private panel: HTMLDivElement;
  menuOpen = false;
  private menuBack: (() => void) | null = null;
  private lastMoney = -1;
  private moneyFlashT = 0;
  mapImage: HTMLCanvasElement | null = null;
  readonly mapView: MapView;
  showFps = false;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = el('div', '', document.body);
    this.root.id = 'ui';
    const tl = el('div', 'hud-tl', this.root);
    const miniWrap = el('div', 'mini', tl);
    this.mini = el('canvas', '', miniWrap);
    this.mini.width = 256;
    this.mini.height = 256;
    this.miniCtx = this.mini.getContext('2d') as CanvasRenderingContext2D;
    const bars = el('div', 'bars', tl);
    this.hp = el('i', '', el('div', 'bar', bars));
    this.stam = el('i', '', el('div', 'bar stam', bars));
    const tr = el('div', 'hud-tr', this.root);
    this.money = el('div', 'money', tr, '$0');
    this.stars = el('div', 'stars', tr, '★★★★★');
    this.clock = el('div', 'clock', tr, '');
    this.objective = el('div', 'objective', this.root);
    this.toastEl = el('div', 'toast', this.root);
    this.bannerEl = el('div', 'banner', this.root, '<h1></h1><p></p>');
    this.subEl = el('div', 'subtitle', this.root);
    this.promptEl = el('div', 'prompt', this.root);
    this.speedo = el('div', 'speedo', this.root);
    this.radioEl = el('div', 'radio', this.root);
    this.bustedEl = el('div', 'busted', this.root, '<h1></h1><p></p>');
    this.arrestEl = el('div', 'arrest', this.root, '<i></i>');
    this.fadeEl = el('div', 'fade', this.root);
    this.fpsEl = el('div', 'fps', this.root);
    this.screen = el('div', 'screen', document.body);
    this.panel = el('div', 'panel', this.screen);
    this.screen.addEventListener('pointerdown', (e) => {
      if (e.target === this.screen && this.menuBack) this.menuBack();
    });
    this.mapView = new MapView();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  // ------------------------------------------------------------ status
  setMoney(m: number, dt: number): void {
    if (m !== this.lastMoney) {
      if (this.lastMoney >= 0) this.moneyFlashT = 0.6;
      this.lastMoney = m;
      this.money.textContent = formatMoney(m);
    }
    this.moneyFlashT = Math.max(0, this.moneyFlashT - dt);
    this.money.classList.toggle('flash', this.moneyFlashT > 0 && Math.floor(this.moneyFlashT * 8) % 2 === 0);
  }

  private lastStars = '';
  setWanted(level: number, searching: boolean): void {
    const key = level + (searching ? 's' : '');
    if (key === this.lastStars) return;
    this.lastStars = key;
    let h = '';
    for (let i = 0; i < 5; i++) h += i < level ? '<b>★</b>' : '★';
    this.stars.innerHTML = h;
    this.stars.style.visibility = level > 0 ? 'visible' : 'hidden';
    this.stars.classList.toggle('flash', searching);
  }

  setClock(text: string): void {
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }

  setBars(health: number, stamina: number): void {
    this.hp.style.width = Math.max(0, health) + '%';
    this.hp.style.background = health < 30 ? '#e63946' : '#5cc45c';
    this.stam.style.width = Math.round(stamina * 100) + '%';
  }

  setObjective(text: string, timer: number | null): void {
    if (!text && timer === null) {
      this.objective.style.display = 'none';
      return;
    }
    this.objective.style.display = 'block';
    const t = timer !== null ? `<span class="t">${formatTime(timer)}</span>` : '';
    const html = escapeHtml(text) + t;
    if (this.objective.innerHTML !== html) this.objective.innerHTML = html;
  }

  notify(text: string): void {
    if (this.toastQ[this.toastQ.length - 1] === text) return;
    this.toastQ.push(text);
  }

  banner(title: string, sub: string, kind: 'ok' | 'fail' | 'big' = 'ok', dur = 3.5): void {
    const h = this.bannerEl.querySelector('h1');
    const p = this.bannerEl.querySelector('p');
    if (h) h.textContent = title;
    if (p) p.textContent = sub;
    this.bannerEl.className = 'banner show' + (kind === 'fail' ? ' fail' : kind === 'big' ? ' big' : '');
    this.bannerT = dur;
  }

  subtitle(speaker: string, text: string, dur?: number): void {
    this.subEl.innerHTML = (speaker ? `<b>${escapeHtml(speaker)}</b>` : '') + escapeHtml(text);
    this.subEl.style.display = 'block';
    this.subT = dur ?? Math.min(7, 2 + text.length * 0.08);
  }

  clearSubtitle(): void {
    this.subT = 0;
    this.subEl.style.display = 'none';
  }

  prompt(key: string | null, text?: string): void {
    if (!key) {
      if (this.promptEl.style.display !== 'none') this.promptEl.style.display = 'none';
      return;
    }
    const html = `<kbd>${escapeHtml(key)}</kbd>${escapeHtml(text ?? '')}`;
    if (this.promptEl.innerHTML !== html) this.promptEl.innerHTML = html;
    this.promptEl.style.display = 'block';
  }

  speed(show: boolean, kmh: number, gear: number, rpm: number, fuel: number, damage: number, name: string): void {
    if (!show) {
      this.speedo.style.display = 'none';
      return;
    }
    this.speedo.style.display = 'block';
    const g = kmh < 1 && rpm < 1000 ? 'N' : String(gear);
    this.speedo.innerHTML =
      `<div class="name">${escapeHtml(name)}</div><div><span class="v">${Math.round(kmh)}</span><span class="u">km/h</span></div><div class="g">GEAR ${g}</div>` +
      `<div class="row">RPM<div class="mbar"><i style="width:${Math.min(100, rpm * 100)}%"></i></div></div>` +
      `<div class="row">燃料<div class="mbar"><i style="width:${Math.round(fuel * 100)}%;background:#4cc9f0"></i></div></div>` +
      `<div class="row">損傷<div class="mbar"><i style="width:${Math.round(damage * 100)}%;background:#e63946"></i></div></div>`;
  }

  radio(text: string): void {
    this.radioEl.textContent = text;
    this.radioEl.classList.add('show');
    this.radioT = 2.5;
  }

  bustedScreen(title: string, sub: string, color: string): void {
    const h = this.bustedEl.querySelector('h1') as HTMLElement;
    const p = this.bustedEl.querySelector('p') as HTMLElement;
    h.textContent = title;
    h.style.color = color;
    p.textContent = sub;
    this.bustedEl.style.display = 'flex';
  }

  hideBusted(): void {
    this.bustedEl.style.display = 'none';
  }

  arrest(p: number): void {
    this.arrestEl.style.display = p > 0.01 ? 'block' : 'none';
    (this.arrestEl.firstChild as HTMLElement).style.width = Math.round(p * 100) + '%';
  }

  fade(v: number): void {
    this.fadeEl.style.opacity = String(v);
  }

  fps(text: string): void {
    this.fpsEl.style.display = this.showFps ? 'block' : 'none';
    if (this.showFps) this.fpsEl.textContent = text;
  }

  update(dt: number): void {
    this.toastT -= dt;
    if (this.toastT <= 0) {
      if (this.toastQ.length > 0) {
        this.toastEl.textContent = this.toastQ.shift() as string;
        this.toastEl.classList.add('show');
        this.toastT = 2.8;
      } else this.toastEl.classList.remove('show');
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.bannerEl.classList.remove('show');
    }
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.subEl.style.display = 'none';
    }
    if (this.radioT > 0) {
      this.radioT -= dt;
      if (this.radioT <= 0) this.radioEl.classList.remove('show');
    }
  }

  // ------------------------------------------------------------ minimap
  drawMinimap(px: number, pz: number, heading: number, rotate: boolean, blips: Blip[], route: { x: number; z: number }[] | null): void {
    const ctx = this.miniCtx;
    const S = 256;
    ctx.save();
    ctx.fillStyle = '#244255';
    ctx.fillRect(0, 0, S, S);
    const img = this.mapImage;
    const zoom = 1.6; // map px per screen px
    ctx.translate(S / 2, S / 2);
    if (rotate) ctx.rotate(heading + Math.PI);
    const [mx, mz] = worldToMap(px, pz);
    if (img) ctx.drawImage(img, mx - (S / 2) * zoom * 1.5, mz - (S / 2) * zoom * 1.5, S * zoom * 1.5, S * zoom * 1.5, (-S / 2) * 1.5, (-S / 2) * 1.5, S * 1.5, S * 1.5);
    const scale = 1 / zoom;
    // GPS route
    if (route && route.length > 1) {
      ctx.strokeStyle = '#c77dff';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      route.forEach((p, i) => {
        const [x, z] = worldToMap(p.x, p.z);
        const sx = (x - mx) * scale;
        const sz = (z - mz) * scale;
        if (i === 0) ctx.moveTo(sx, sz);
        else ctx.lineTo(sx, sz);
      });
      ctx.stroke();
    }
    ctx.restore();
    // blips (kept upright)
    ctx.save();
    ctx.translate(S / 2, S / 2);
    for (const b of blips) {
      const [bx, bz] = worldToMap(b.x, b.z);
      let sx = (bx - mx) * scale;
      let sz = (bz - mz) * scale;
      if (rotate) {
        const a = heading + Math.PI;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const rx = sx * c - sz * s;
        const rz = sx * s + sz * c;
        sx = rx;
        sz = rz;
      }
      const d = Math.hypot(sx, sz);
      const lim = S / 2 - 12;
      const important = b.kind === 'mission' || b.kind === 'target' || b.kind === 'waypoint' || b.kind === 'checkpoint' || b.kind === 'drop' || b.kind === 'pickup' || b.kind === 'vehicle';
      if (d > lim) {
        if (!important) continue;
        sx = (sx / d) * lim;
        sz = (sz / d) * lim;
      }
      drawBlip(ctx, sx, sz, b, 1);
    }
    // player arrow
    ctx.rotate(rotate ? 0 : -heading + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    void MAP_SIZE;
  }

  // ------------------------------------------------------------ menus
  menu(title: string, items: MenuItem[], onBack: (() => void) | null, html?: string): void {
    this.panel.innerHTML = '';
    el('h2', '', this.panel, escapeHtml(title));
    if (html) el('div', '', this.panel, html);
    for (const it of items) {
      const b = el('button', 'btn' + (it.primary ? ' primary' : ''), this.panel);
      b.innerHTML = `<span>${escapeHtml(it.label)}</span>${it.sub ? `<span class="sub">${escapeHtml(it.sub)}</span>` : ''}`;
      if (it.disabled) b.disabled = true;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!it.disabled) it.onClick();
      });
    }
    this.menuBack = onBack;
    this.screen.classList.add('show');
    this.menuOpen = true;
    const first = this.panel.querySelector('button:not([disabled])') as HTMLButtonElement | null;
    first?.focus({ preventScroll: true });
  }

  /** A custom panel (settings etc). Returns the content element. */
  custom(title: string, onBack: (() => void) | null): HTMLDivElement {
    this.panel.innerHTML = '';
    el('h2', '', this.panel, escapeHtml(title));
    const body = el('div', '', this.panel);
    this.menuBack = onBack;
    this.screen.classList.add('show');
    this.menuOpen = true;
    return body;
  }

  closeMenu(): void {
    this.screen.classList.remove('show');
    this.menuOpen = false;
    this.menuBack = null;
  }

  back(): void {
    if (this.menuBack) this.menuBack();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function drawBlip(ctx: CanvasRenderingContext2D, x: number, y: number, b: Blip, k: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  switch (b.kind) {
    case 'police':
      ctx.fillStyle = Math.floor(performance.now() / 250) % 2 ? '#e63946' : '#3a86ff';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'target':
    case 'vehicle':
      ctx.fillStyle = b.kind === 'target' ? '#e63946' : '#4cc9f0';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'waypoint':
      ctx.fillStyle = '#c77dff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(7, 0);
      ctx.lineTo(0, 10);
      ctx.lineTo(-7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'checkpoint':
    case 'drop':
    case 'pickup':
      ctx.fillStyle = '#f2b705';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'mission':
      ctx.fillStyle = '#f2b705';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.icon ?? '!', 0, 1);
      break;
    case 'collectible':
      ctx.fillStyle = '#ff70a6';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = 'rgba(20,22,28,.85)';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(b.icon ?? '•', 0, 1);
  }
  ctx.restore();
}

/** Full-screen map with pan/zoom and waypoint placement. */
export class MapView {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cx = 0;
  private cz = 0;
  private zoom = 0.5; // screen px per map px
  open = false;
  blips: Blip[] = [];
  player = { x: 0, z: 0, yaw: 0 };
  onWaypoint: ((x: number, z: number) => void) | null = null;
  onClose: (() => void) | null = null;
  image: HTMLCanvasElement | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch0 = 0;
  private zoom0 = 1;

  constructor() {
    this.root = el('div', 'mapview', document.body);
    this.canvas = el('canvas', '', this.root);
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const close = el('button', 'btn close', this.root, '閉じる ✕');
    close.addEventListener('click', () => this.onClose?.());
    el('div', 'hint', this.root, 'ドラッグで移動・ホイール/ピンチで拡大・タップで目的地');
    el('div', 'legend', this.root, '🟡 ミッション　◆ 目的地　🏪 店　⛽ スタンド　🍔 飲食　🏠 物件<br>🚗 ディーラー　🔧 修理　★ 警察　✚ 病院　● 絵はがき');
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom0 = this.zoom;
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch0 > 0) this.zoom = Math.min(4, Math.max(0.15, (this.zoom0 * d) / this.pinch0));
        this.moved += 10;
      } else {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        this.moved += Math.abs(dx) + Math.abs(dy);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        this.cx -= (dx * dpr) / this.zoom;
        this.cz -= (dy * dpr) / this.zoom;
      }
      this.draw();
    });
    const up = (e: PointerEvent): void => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (p && this.moved < 8 && this.pointers.size === 0) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const r = this.canvas.getBoundingClientRect();
        const sx = (e.clientX - r.left) * dpr;
        const sy = (e.clientY - r.top) * dpr;
        const mx = this.cx + (sx - this.canvas.width / 2) / this.zoom;
        const mz = this.cz + (sy - this.canvas.height / 2) / this.zoom;
        const wx = (mx / MAP_SIZE) * 4000 - 2000;
        const wz = (mz / MAP_SIZE) * 4000 - 2000;
        this.onWaypoint?.(wx, wz);
        this.draw();
      }
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        this.zoom = Math.min(4, Math.max(0.15, this.zoom * (e.deltaY > 0 ? 0.88 : 1.14)));
        this.draw();
        e.preventDefault();
      },
      { passive: false },
    );
  }

  show(px: number, pz: number, yaw: number): void {
    this.open = true;
    this.root.classList.add('show');
    const [mx, mz] = worldToMap(px, pz);
    this.cx = mx;
    this.cz = mz;
    this.player = { x: px, z: pz, yaw };
    this.resize();
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('show');
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.draw();
  }

  draw(): void {
    if (!this.open) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.fillStyle = '#1f4257';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cx, -this.cz);
    if (this.image) ctx.drawImage(this.image, 0, 0);
    ctx.restore();
    const k = Math.min(2, window.devicePixelRatio || 1);
    for (const b of this.blips) {
      const [mx, mz] = worldToMap(b.x, b.z);
      const sx = W / 2 + (mx - this.cx) * this.zoom;
      const sy = H / 2 + (mz - this.cz) * this.zoom;
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      drawBlip(ctx, sx, sy, b, k);
      if (b.label && this.zoom > 0.9) {
        ctx.font = `${12 * k}px sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.strokeText(b.label, sx + 12 * k, sy + 4 * k);
        ctx.fillText(b.label, sx + 12 * k, sy + 4 * k);
      }
    }
    const [pmx, pmz] = worldToMap(this.player.x, this.player.z);
    ctx.save();
    ctx.translate(W / 2 + (pmx - this.cx) * this.zoom, H / 2 + (pmz - this.cz) * this.zoom);
    ctx.rotate(-this.player.yaw + Math.PI);
    ctx.scale(k * 1.3, k * 1.3);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
