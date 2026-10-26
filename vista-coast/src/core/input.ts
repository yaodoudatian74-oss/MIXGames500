// Unified input: keyboard + mouse (pointer lock), gamepad, and touch controls
// (touch UI writes into the same action state).

export type Action =
  | 'jump'
  | 'sprint'
  | 'enter'
  | 'interact'
  | 'camera'
  | 'map'
  | 'pause'
  | 'horn'
  | 'lights'
  | 'handbrake'
  | 'accel'
  | 'brake'
  | 'punch'
  | 'lookBack'
  | 'blinkL'
  | 'blinkR'
  | 'radio'
  | 'skip'
  | 'phone'
  | 'walk'
  | 'useItem';

const KEYMAP: Record<string, Action[]> = {
  Space: ['jump', 'handbrake'],
  ShiftLeft: ['sprint'],
  ShiftRight: ['sprint'],
  KeyF: ['enter'],
  KeyE: ['interact'],
  KeyV: ['camera'],
  KeyM: ['map'],
  Escape: ['pause'],
  KeyP: ['pause'],
  KeyH: ['horn'],
  KeyL: ['lights'],
  KeyW: ['accel'],
  ArrowUp: ['accel'],
  KeyS: ['brake'],
  ArrowDown: ['brake'],
  KeyQ: ['punch'],
  KeyC: ['lookBack'],
  KeyZ: ['blinkL'],
  KeyX: ['blinkR'],
  KeyR: ['radio'],
  Enter: ['skip'],
  KeyT: ['phone'],
  AltLeft: ['walk'],
  KeyI: ['useItem'],
};

export class Input {
  moveX = 0;
  moveY = 0;
  lookX = 0;
  lookY = 0;
  zoom = 0;
  private keys = new Set<string>();
  private held = new Map<Action, number>(); // counts of sources holding the action
  private pressedEdge = new Set<Action>();
  private touchHeld = new Set<Action>();
  touchMoveX = 0;
  touchMoveY = 0;
  touchLookX = 0;
  touchLookY = 0;
  touchActive = false;
  pointerLocked = false;
  mouseDown = false;
  gamepad = false;
  private gpPrev: boolean[] = [];
  enabled = true;
  sensitivity = 1;
  invertY = false;
  lastDevice: 'kbm' | 'touch' | 'pad' = 'kbm';

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.clearAll());
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        if (this.pointerLocked) this.press('punch');
      }
      this.lastDevice = 'kbm';
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.lookX += e.movementX * 0.0022 * this.sensitivity;
        this.lookY += e.movementY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
      } else if (this.mouseDown && !this.touchActive) {
        this.lookX += e.movementX * 0.004 * this.sensitivity;
        this.lookY += e.movementY * 0.004 * this.sensitivity * (this.invertY ? -1 : 1);
      }
    });
    target.addEventListener(
      'wheel',
      (e) => {
        this.zoom += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === target;
    });
    window.addEventListener('gamepadconnected', () => {
      this.gamepad = true;
    });
  }

  requestPointerLock(): void {
    if (this.touchActive) return;
    try {
      const r = this.target.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      /* not supported */
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.enabled) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    this.lastDevice = 'kbm';
    const code = e.code;
    if (down) {
      if (this.keys.has(code)) return;
      this.keys.add(code);
      for (const a of KEYMAP[code] ?? []) this.press(a);
    } else {
      this.keys.delete(code);
      for (const a of KEYMAP[code] ?? []) this.release(a);
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code)) e.preventDefault();
  }

  press(a: Action): void {
    this.held.set(a, (this.held.get(a) ?? 0) + 1);
    this.pressedEdge.add(a);
  }

  release(a: Action): void {
    const n = (this.held.get(a) ?? 0) - 1;
    if (n <= 0) this.held.delete(a);
    else this.held.set(a, n);
  }

  /** Touch UI helpers */
  touchDown(a: Action): void {
    if (this.touchHeld.has(a)) return;
    this.touchHeld.add(a);
    this.press(a);
    this.lastDevice = 'touch';
  }
  touchUp(a: Action): void {
    if (!this.touchHeld.has(a)) return;
    this.touchHeld.delete(a);
    this.release(a);
  }

  isDown(a: Action): boolean {
    return (this.held.get(a) ?? 0) > 0;
  }

  /** True once per press (consumed). */
  pressed(a: Action): boolean {
    if (this.pressedEdge.has(a)) {
      this.pressedEdge.delete(a);
      return true;
    }
    return false;
  }

  /** Called once per frame before reading: merges sources into axes. */
  poll(): void {
    let mx = 0;
    let my = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
    if (Math.abs(this.touchMoveX) > 0.01 || Math.abs(this.touchMoveY) > 0.01) {
      mx = this.touchMoveX;
      my = this.touchMoveY;
    }
    this.lookX += this.touchLookX;
    this.lookY += this.touchLookY;
    this.touchLookX = 0;
    this.touchLookY = 0;
    // gamepad
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (gp) {
      this.gamepad = true;
      const dz = (v: number): number => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const lx = dz(gp.axes[0] ?? 0);
      const ly = dz(gp.axes[1] ?? 0);
      const rx = dz(gp.axes[2] ?? 0);
      const ry = dz(gp.axes[3] ?? 0);
      if (Math.abs(lx) + Math.abs(ly) > 0) {
        mx = lx;
        my = -ly;
        this.lastDevice = 'pad';
      }
      this.lookX += rx * 0.05 * this.sensitivity;
      this.lookY += ry * 0.04 * this.sensitivity * (this.invertY ? -1 : 1);
      const map: [number, Action][] = [
        [0, 'jump'],
        [1, 'enter'],
        [2, 'punch'],
        [3, 'interact'],
        [4, 'horn'],
        [5, 'handbrake'],
        [6, 'brake'],
        [7, 'accel'],
        [8, 'map'],
        [9, 'pause'],
        [10, 'sprint'],
        [11, 'camera'],
        [12, 'lights'],
        [13, 'lookBack'],
        [14, 'blinkL'],
        [15, 'blinkR'],
      ];
      for (const [i, a] of map) {
        const btn = gp.buttons[i];
        const down = !!btn && (btn.pressed || btn.value > 0.4);
        const prev = this.gpPrev[i] ?? false;
        if (down && !prev) {
          this.press(a);
          if (a === 'jump') this.press('skip');
          this.lastDevice = 'pad';
        }
        if (!down && prev) {
          this.release(a);
          if (a === 'jump') this.release('skip');
        }
        this.gpPrev[i] = down;
      }
      const rt = gp.buttons[7];
      const lt = gp.buttons[6];
      this.padAccel = rt ? rt.value : 0;
      this.padBrake = lt ? lt.value : 0;
    }
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    this.moveX = mx;
    this.moveY = my;
  }

  padAccel = 0;
  padBrake = 0;

  /** Analog throttle/brake for driving. */
  throttle(): number {
    if (this.padAccel > 0.02) return this.padAccel;
    return this.isDown('accel') ? 1 : 0;
  }
  brakeAmount(): number {
    if (this.padBrake > 0.02) return this.padBrake;
    return this.isDown('brake') ? 1 : 0;
  }

  consumeLook(): { x: number; y: number } {
    const r = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return r;
  }

  consumeZoom(): number {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }

  clearEdges(): void {
    this.pressedEdge.clear();
  }

  clearAll(): void {
    this.keys.clear();
    this.held.clear();
    this.pressedEdge.clear();
    for (const a of this.touchHeld) this.touchHeld.delete(a);
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.mouseDown = false;
  }
}
