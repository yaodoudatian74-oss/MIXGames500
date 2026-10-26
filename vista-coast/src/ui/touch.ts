// On-screen touch controls: virtual stick, camera drag pad, context buttons
// (on foot / in vehicle), pedals. Writes into the shared Input.

import type { Action, Input } from '../core/input';

interface TBtn {
  el: HTMLElement;
  action: Action;
  ctx: 'foot' | 'car' | 'both';
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private stickCx = 0;
  private stickCy = 0;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private buttons: TBtn[] = [];
  enabled = false;
  private ctxMode: 'foot' | 'car' = 'foot';

  constructor(private readonly input: Input) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    document.body.appendChild(this.root);
    const look = document.createElement('div');
    look.className = 'lookpad';
    this.root.appendChild(look);
    this.stick = document.createElement('div');
    this.stick.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);

    // stick
    this.stick.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      const r = this.stick.getBoundingClientRect();
      this.stickCx = r.left + r.width / 2;
      this.stickCy = r.top + r.height / 2;
      this.moveStick(e.clientX, e.clientY);
      this.input.touchActive = true;
      e.preventDefault();
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.touchMoveX = 0;
      this.input.touchMoveY = 0;
      this.knob.style.transform = '';
    };
    this.stick.addEventListener('pointerup', endStick);
    this.stick.addEventListener('pointercancel', endStick);

    // camera look pad
    look.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      look.setPointerCapture(e.pointerId);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.input.touchActive = true;
      this.input.touchDown('skip');
      this.input.touchUp('skip');
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = e.clientX - this.lookX;
      const dy = e.clientY - this.lookY;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.input.touchLookX += dx * 0.0062 * this.input.sensitivity;
      this.input.touchLookY += dy * 0.0048 * this.input.sensitivity * (this.input.invertY ? -1 : 1);
    });
    const endLook = (e: PointerEvent): void => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    const R = 'max(18px, env(safe-area-inset-right))';
    const B = 'max(22px, env(safe-area-inset-bottom))';
    // on foot buttons
    this.btn('ジャンプ', 'jump', 'foot', { right: R, bottom: B }, 'big');
    this.btn('ダッシュ', 'sprint', 'foot', { right: 'calc(' + R + ' + 96px)', bottom: B });
    this.btn('パンチ', 'punch', 'foot', { right: R, bottom: 'calc(' + B + ' + 96px)' });
    this.btn('乗る', 'enter', 'both', { right: 'calc(' + R + ' + 96px)', bottom: 'calc(' + B + ' + 78px)' });
    this.btn('E', 'interact', 'both', { right: 'calc(' + R + ' + 168px)', bottom: 'calc(' + B + ' + 40px)' }, 'sm');
    // vehicle
    this.pedal('アクセル', 'accel', { right: R, bottom: B });
    this.pedal('ブレーキ', 'brake', { right: 'calc(' + R + ' + 90px)', bottom: B });
    this.btn('サイド', 'handbrake', 'car', { right: 'calc(' + R + ' + 180px)', bottom: B });
    this.btn('ホーン', 'horn', 'car', { right: R, bottom: 'calc(' + B + ' + 142px)' }, 'sm');
    this.btn('ライト', 'lights', 'car', { right: 'calc(' + R + ' + 58px)', bottom: 'calc(' + B + ' + 142px)' }, 'sm');
    this.btn('ラジオ', 'radio', 'car', { right: 'calc(' + R + ' + 116px)', bottom: 'calc(' + B + ' + 142px)' }, 'sm');
    // shared top buttons
    const T = 'max(204px, calc(env(safe-area-inset-top) + 196px))';
    this.btn('視点', 'camera', 'both', { left: 'max(12px, env(safe-area-inset-left))', top: T }, 'sm sys0');
    this.btn('地図', 'map', 'both', { left: 'calc(max(12px, env(safe-area-inset-left)) + 58px)', top: T }, 'sm sys1');
    this.btn('Ⅱ', 'pause', 'both', { left: 'calc(max(12px, env(safe-area-inset-left)) + 116px)', top: T }, 'sm sys2');
    this.setContext('foot');
  }

  private btn(label: string, action: Action, ctx: 'foot' | 'car' | 'both', pos: Record<string, string>, size = ''): void {
    const b = document.createElement('div');
    b.className = 'tbtn ' + size;
    b.textContent = label;
    Object.assign(b.style, pos);
    this.root.appendChild(b);
    this.bindHold(b, action);
    this.buttons.push({ el: b, action, ctx });
  }

  private pedal(label: string, action: Action, pos: Record<string, string>): void {
    const b = document.createElement('div');
    b.className = 'pedal';
    b.textContent = label;
    Object.assign(b.style, pos);
    this.root.appendChild(b);
    this.bindHold(b, action);
    this.buttons.push({ el: b, action, ctx: 'car' });
  }

  private bindHold(b: HTMLElement, action: Action): void {
    const ids = new Set<number>();
    b.addEventListener('pointerdown', (e) => {
      ids.add(e.pointerId);
      b.setPointerCapture(e.pointerId);
      b.classList.add('on');
      this.input.touchActive = true;
      this.input.touchDown(action);
      e.preventDefault();
      e.stopPropagation();
    });
    const up = (e: PointerEvent): void => {
      if (!ids.has(e.pointerId)) return;
      ids.delete(e.pointerId);
      if (ids.size === 0) {
        b.classList.remove('on');
        this.input.touchUp(action);
      }
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }

  private moveStick(x: number, y: number): void {
    const dx = x - this.stickCx;
    const dy = y - this.stickCy;
    const max = 58;
    const l = Math.hypot(dx, dy);
    const k = l > max ? max / l : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    let mx = (dx * k) / max;
    let my = -(dy * k) / max;
    // small dead zone
    if (Math.abs(mx) < 0.08) mx = 0;
    if (Math.abs(my) < 0.08) my = 0;
    this.input.touchMoveX = mx;
    this.input.touchMoveY = my;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.classList.toggle('on', on);
    document.body.classList.toggle('touch', on); // HUD layout adapts to on-screen controls
  }

  setContext(mode: 'foot' | 'car'): void {
    this.ctxMode = mode;
    for (const b of this.buttons) {
      const vis = b.ctx === 'both' || b.ctx === mode;
      b.el.style.display = vis ? '' : 'none';
      if (!vis) this.input.touchUp(b.action);
    }
    const enter = this.buttons.find((b) => b.action === 'enter');
    if (enter) enter.el.textContent = mode === 'car' ? '降りる' : '乗る';
    if (mode === 'car') {
      const e = this.buttons.find((b) => b.action === 'enter');
      if (e) {
        e.el.style.right = 'calc(max(18px, env(safe-area-inset-right)) + 180px)';
        e.el.style.bottom = 'calc(max(22px, env(safe-area-inset-bottom)) + 78px)';
      }
    } else {
      const e = this.buttons.find((b) => b.action === 'enter');
      if (e) {
        e.el.style.right = 'calc(max(18px, env(safe-area-inset-right)) + 96px)';
        e.el.style.bottom = 'calc(max(22px, env(safe-area-inset-bottom)) + 78px)';
      }
    }
  }

  get context(): 'foot' | 'car' {
    return this.ctxMode;
  }
}
