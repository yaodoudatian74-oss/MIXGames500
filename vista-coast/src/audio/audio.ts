// Web Audio engine: everything is synthesised at runtime (no audio files).
// Positional engines, tyre squeal, sirens, horns, city/sea/wind/rain ambience,
// thunder, footsteps, doors, crashes, explosions, UI jingles, NPC babble,
// interior reverb/occlusion and a procedural car radio.

interface EngineVoice {
  id: number;
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  noise: AudioBufferSourceNode;
  nf: BiquadFilterNode;
  lp: BiquadFilterNode;
  gain: GainNode;
  squealG: GainNode;
  pan: PannerNode;
  used: boolean;
}

export interface EngineParams {
  id: number;
  x: number;
  y: number;
  z: number;
  rpm: number;
  throttle: number;
  slip: number;
  volume: number;
  cylinders: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private ambLP: BiquadFilterNode | null = null;
  private musicG: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private brownBuf: AudioBuffer | null = null;
  private engines: EngineVoice[] = [];
  private ambNodes: Record<string, { g: GainNode; f: BiquadFilterNode }> = {};
  private sirenVoice: { osc: OscillatorNode; g: GainNode; pan: PannerNode } | null = null;
  volume = 0.8;
  musicVolume = 0.5;
  private radioOn = false;
  private radioNext = 0;
  private radioStep = 0;
  private radioSeed = 1;
  interior = 0;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.ambLP = ctx.createBiquadFilter();
    this.ambLP.type = 'lowpass';
    this.ambLP.frequency.value = 18000;
    this.amb.connect(this.ambLP).connect(this.master);
    this.musicG = ctx.createGain();
    this.musicG.gain.value = this.musicVolume * 0.5;
    this.musicG.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.sfx.connect(this.reverbSend).connect(this.reverb).connect(this.master);
    this.noiseBuf = this.makeNoise(false);
    this.brownBuf = this.makeNoise(true);
    for (const name of ['city', 'waves', 'wind', 'rain', 'birds', 'crowd']) {
      const src = ctx.createBufferSource();
      src.buffer = name === 'city' || name === 'waves' ? this.brownBuf : this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      g.gain.value = 0;
      if (name === 'city') {
        f.type = 'lowpass';
        f.frequency.value = 420;
      } else if (name === 'waves') {
        f.type = 'lowpass';
        f.frequency.value = 900;
      } else if (name === 'wind') {
        f.type = 'bandpass';
        f.frequency.value = 600;
        f.Q.value = 0.6;
      } else if (name === 'rain') {
        f.type = 'highpass';
        f.frequency.value = 2500;
      } else if (name === 'crowd') {
        f.type = 'bandpass';
        f.frequency.value = 900;
        f.Q.value = 1.4;
      } else {
        f.type = 'bandpass';
        f.frequency.value = 4200;
        f.Q.value = 8;
      }
      src.connect(f).connect(g).connect(this.amb);
      src.start(0, Math.random() * 1.5);
      this.ambNodes[name] = { g, f };
    }
  }

  private makeNoise(brown: boolean): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const len = ctx.sampleRate * 2;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return b;
  }

  private impulse(sec: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return b;
  }

  setVolume(v: number, music: number): void {
    this.volume = v;
    this.musicVolume = music;
    if (this.master) this.master.gain.value = v;
    if (this.musicG) this.musicG.gain.value = music * 0.5;
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, t, 0.02);
      l.positionY.setTargetAtTime(y, t, 0.02);
      l.positionZ.setTargetAtTime(z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      (l as unknown as { setPosition(a: number, b: number, c: number): void }).setPosition(x, y, z);
    }
  }

  private panner(x: number, y: number, z: number, ref = 6, max = 300): PannerNode {
    const ctx = this.ctx as AudioContext;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = max;
    p.rolloffFactor = 1.1;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    return p;
  }

  /** Ambience levels (0..1). */
  ambience(city: number, waves: number, wind: number, rain: number, birds: number, crowd: number, interior: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const set = (k: string, v: number): void => {
      const n = this.ambNodes[k];
      if (n) n.g.gain.setTargetAtTime(v, t, 0.4);
    };
    const out = 1 - interior;
    set('city', city * 0.35 * out);
    set('waves', waves * 0.5 * out * (0.7 + 0.3 * Math.sin(t * 0.5)));
    set('wind', wind * 0.25 * out);
    set('rain', rain * 0.3 * (1 - interior * 0.7));
    set('birds', birds * 0.03 * out * (Math.sin(t * 3.1) > 0.6 ? 1 : 0.1));
    set('crowd', crowd * 0.12);
    this.interior = interior;
    if (this.ambLP) this.ambLP.frequency.setTargetAtTime(interior > 0.5 ? 700 : 18000, t, 0.2);
    if (this.reverbSend) this.reverbSend.gain.setTargetAtTime(interior * 0.35, t, 0.2);
    const wn = this.ambNodes['wind'];
    if (wn) wn.f.frequency.setTargetAtTime(400 + wind * 900, t, 0.5);
  }

  // ------------------------------------------------------------ engines
  updateEngines(params: EngineParams[]): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    for (const v of this.engines) v.used = false;
    const t = ctx.currentTime;
    for (const p of params.slice(0, 5)) {
      let v = this.engines.find((e) => e.id === p.id);
      if (!v) v = this.engines.find((e) => !e.used && !params.some((q) => q.id === e.id));
      if (!v) {
        if (this.engines.length >= 5) continue;
        v = this.makeEngine();
        this.engines.push(v);
      }
      v.used = true;
      v.id = p.id;
      const base = (p.rpm / 60) * (p.cylinders / 2);
      v.osc1.frequency.setTargetAtTime(Math.max(20, base), t, 0.03);
      v.osc2.frequency.setTargetAtTime(Math.max(10, base * 0.5), t, 0.03);
      v.lp.frequency.setTargetAtTime(300 + p.throttle * 2200 + p.rpm * 0.15, t, 0.05);
      v.nf.frequency.setTargetAtTime(Math.max(80, base * 2), t, 0.05);
      v.gain.gain.setTargetAtTime(p.volume * (0.15 + p.throttle * 0.22), t, 0.05);
      v.squealG.gain.setTargetAtTime(Math.min(0.5, Math.max(0, p.slip - 0.12) * 1.6) * p.volume, t, 0.05);
      v.pan.positionX.setTargetAtTime(p.x, t, 0.03);
      v.pan.positionY.setTargetAtTime(p.y, t, 0.03);
      v.pan.positionZ.setTargetAtTime(p.z, t, 0.03);
    }
    for (const v of this.engines) {
      if (!v.used) {
        v.gain.gain.setTargetAtTime(0, t, 0.1);
        v.squealG.gain.setTargetAtTime(0, t, 0.1);
      }
    }
  }

  private makeEngine(): EngineVoice {
    const ctx = this.ctx as AudioContext;
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.Q.value = 3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    const mix = ctx.createGain();
    mix.gain.value = 1;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    const gn = ctx.createGain();
    gn.gain.value = 0.35;
    osc1.connect(mix);
    osc2.connect(g2).connect(mix);
    noise.connect(nf).connect(gn).connect(mix);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = this.panner(0, 0, 0, 5, 260);
    mix.connect(lp).connect(gain).connect(pan).connect(this.sfx as GainNode);
    // tyre squeal: noise through a resonant band
    const sq = ctx.createBufferSource();
    sq.buffer = this.noiseBuf;
    sq.loop = true;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 2100;
    sf.Q.value = 12;
    const squealG = ctx.createGain();
    squealG.gain.value = 0;
    sq.connect(sf).connect(squealG).connect(pan);
    osc1.start();
    osc2.start();
    noise.start();
    sq.start();
    return { id: -1, osc1, osc2, noise, nf, lp, gain, squealG, pan, used: false };
  }

  siren(on: boolean, x: number, y: number, z: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    if (!this.sirenVoice) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = this.panner(x, y, z, 8, 400);
      osc.connect(g).connect(pan).connect(this.sfx);
      osc.start();
      this.sirenVoice = { osc, g, pan };
    }
    const t = ctx.currentTime;
    const s = this.sirenVoice;
    const wail = 900 + Math.sin(t * 2.2) * 450;
    s.osc.frequency.setTargetAtTime(wail, t, 0.05);
    s.g.gain.setTargetAtTime(on ? 0.22 : 0, t, 0.1);
    s.pan.positionX.setTargetAtTime(x, t, 0.05);
    s.pan.positionY.setTargetAtTime(y, t, 0.05);
    s.pan.positionZ.setTargetAtTime(z, t, 0.05);
  }

  // ------------------------------------------------------------ one-shots
  private burst(dur: number, filter: BiquadFilterType, freq: number, q: number, gain: number, x?: number, y?: number, z?: number, decay = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * decay);
    src.connect(f).connect(g);
    if (x !== undefined && y !== undefined && z !== undefined) g.connect(this.panner(x, y, z, 4, 250)).connect(this.sfx);
    else g.connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number, dest?: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + when;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  footstep(surface: string, run: boolean): void {
    const f = surface === 'grass' ? 700 : surface === 'sand' ? 500 : surface === 'water' ? 1200 : 1800;
    this.burst(0.07, 'bandpass', f * (0.9 + Math.random() * 0.2), 1.2, run ? 0.16 : 0.09);
  }

  door(x: number, y: number, z: number): void {
    this.burst(0.12, 'lowpass', 500, 1, 0.5, x, y, z);
    this.tone(90, 0.12, 'sine', 0.3);
  }

  crash(impact: number, x: number, y: number, z: number): void {
    const g = Math.min(1, impact / 18);
    this.burst(0.35 + g * 0.4, 'lowpass', 1800 + g * 2500, 0.8, 0.25 + g * 0.6, x, y, z);
    this.burst(0.2, 'highpass', 4500, 1, 0.15 * g, x, y, z);
    this.tone(55 + Math.random() * 20, 0.25, 'sine', 0.35 * g);
  }

  horn(x: number, y: number, z: number, dur = 0.5): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const p = this.panner(x, y, z, 8, 300);
    p.connect(this.sfx);
    this.tone(392, dur, 'square', 0.09, 0, undefined, p);
    this.tone(494, dur, 'square', 0.07, 0, undefined, p);
  }

  thunder(dist: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = Math.max(0.15, 1 - dist / 1600);
    this.burst(4.5, 'lowpass', 220 + (1 - g) * -100, 0.7, 0.9 * g, undefined, undefined, undefined, 1);
    this.burst(0.6, 'lowpass', 900, 0.7, 0.4 * g);
  }

  explosion(x: number, y: number, z: number): void {
    this.burst(2.2, 'lowpass', 600, 0.7, 1.4, x, y, z);
    this.burst(0.5, 'lowpass', 3000, 0.7, 0.8, x, y, z);
    this.tone(45, 0.9, 'sine', 0.7, 0, 25);
  }

  punch(): void {
    this.burst(0.08, 'lowpass', 900, 1, 0.5);
    this.tone(120, 0.08, 'sine', 0.3);
  }

  ui(kind: 'click' | 'checkpoint' | 'success' | 'fail' | 'pickup' | 'cash' | 'start' | 'notify'): void {
    switch (kind) {
      case 'click':
        this.tone(880, 0.06, 'triangle', 0.08);
        break;
      case 'checkpoint':
        this.tone(988, 0.12, 'triangle', 0.15);
        this.tone(1318, 0.18, 'triangle', 0.12, 0.08);
        break;
      case 'success':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.14, i * 0.12));
        this.tone(262, 1.0, 'sine', 0.1, 0.36);
        break;
      case 'fail':
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.07, i * 0.18));
        break;
      case 'pickup':
        this.tone(1046, 0.1, 'sine', 0.15);
        this.tone(1568, 0.25, 'sine', 0.12, 0.07);
        break;
      case 'cash':
        this.tone(1318, 0.08, 'square', 0.06);
        this.tone(1760, 0.2, 'triangle', 0.09, 0.06);
        break;
      case 'start':
        [392, 523, 659].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, i * 0.09));
        break;
      case 'notify':
        this.tone(740, 0.12, 'sine', 0.1);
        break;
    }
  }

  /** NPC babble: formant bursts imitating speech without real words. */
  babble(dur: number, pitch: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const formants = [
      [800, 1200],
      [400, 2000],
      [300, 2300],
      [500, 900],
      [650, 1700],
    ];
    let t = 0;
    while (t < dur) {
      const sy = 0.08 + Math.random() * 0.12;
      const [f1, f2] = formants[Math.floor(Math.random() * formants.length)] as [number, number];
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const start = ctx.currentTime + t;
      o.frequency.setValueAtTime(pitch * (0.9 + Math.random() * 0.25), start);
      const b1 = ctx.createBiquadFilter();
      b1.type = 'bandpass';
      b1.frequency.value = f1;
      b1.Q.value = 6;
      const b2 = ctx.createBiquadFilter();
      b2.type = 'bandpass';
      b2.frequency.value = f2;
      b2.Q.value = 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.05, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + sy);
      o.connect(b1).connect(g);
      o.connect(b2).connect(g);
      g.connect(this.sfx);
      o.start(start);
      o.stop(start + sy + 0.05);
      t += sy + (Math.random() < 0.2 ? 0.15 : 0.02);
    }
  }

  // ------------------------------------------------------------ radio
  toggleRadio(): boolean {
    this.radioOn = !this.radioOn;
    this.radioSeed = (this.radioSeed * 7 + 3) % 97;
    return this.radioOn;
  }

  setRadio(on: boolean): void {
    this.radioOn = on;
  }

  get radio(): boolean {
    return this.radioOn;
  }

  /** Lookahead scheduler for the procedural "VISTA FM" lo-fi loop. */
  updateRadio(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicG || !this.radioOn) return;
    const bpm = 92 + (this.radioSeed % 5) * 6;
    const step = 60 / bpm / 2; // eighth notes
    if (this.radioNext < ctx.currentTime) this.radioNext = ctx.currentTime + 0.05;
    const prog = [
      [57, 60, 64, 67],
      [53, 57, 60, 64],
      [55, 59, 62, 65],
      [52, 55, 59, 62],
    ];
    const key = this.radioSeed % 3;
    while (this.radioNext < ctx.currentTime + 0.25) {
      const s = this.radioStep;
      const bar = Math.floor(s / 8) % 4;
      const chord = (prog[bar] as number[]).map((n) => n + key);
      const t0 = this.radioNext - ctx.currentTime;
      const mtof = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
      if (s % 8 === 0) for (const n of chord) this.tone(mtof(n), step * 7.5, 'triangle', 0.025, t0, undefined, this.musicG);
      if (s % 2 === 0) this.tone(mtof((chord[0] as number) - 24), step * 1.8, 'sine', 0.09, t0, undefined, this.musicG);
      if (s % 4 === 0) this.tone(60, 0.12, 'sine', 0.22, t0, 35, this.musicG); // kick
      if (s % 8 === 4) this.burstAt(t0, 0.12, 'bandpass', 1800, 0.12);
      if (s % 2 === 1) this.burstAt(t0, 0.03, 'highpass', 8000, 0.04);
      if (s % 3 === 0 && s % 16 > 8) this.tone(mtof((chord[(s / 3) % 4 | 0] as number) + 12), step * 0.9, 'sine', 0.03, t0, undefined, this.musicG);
      this.radioStep++;
      this.radioNext += step;
    }
  }

  private burstAt(when: number, dur: number, type: BiquadFilterType, freq: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicG) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.musicG);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}
