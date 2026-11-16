/** Procedural Web Audio synthesizer — zero audio files. */

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

export class SoundSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, vol: number, filterFrom: number, filterTo: number, delay = 0): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(filterFrom, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  /** Pop with ascending pitch: `step` = cascade level (0, 1, 2, ...). */
  pop(step: number): void {
    const semis = PENTATONIC[Math.min(step, PENTATONIC.length - 1)];
    const f = 392 * Math.pow(2, semis / 12);
    this.tone(f, 0.16, 'sine', 0.35);
    this.tone(f * 2, 0.1, 'triangle', 0.12, 0.02);
  }

  swap(): void {
    this.tone(300, 0.08, 'sine', 0.18, 0, 520);
  }

  invalid(): void {
    this.tone(180, 0.14, 'square', 0.12, 0, 110);
  }

  chime(): void {
    [0, 4, 7, 12].forEach((s, i) => this.tone(660 * Math.pow(2, s / 12), 0.22, 'triangle', 0.18, i * 0.06));
  }

  laser(): void {
    this.tone(2200, 0.35, 'sawtooth', 0.16, 0, 160);
    this.tone(1100, 0.35, 'square', 0.08, 0, 90);
    this.noise(0.3, 0.2, 5000, 400);
  }

  boom(): void {
    this.tone(140, 0.45, 'sine', 0.5, 0, 38);
    this.noise(0.4, 0.35, 1800, 120);
  }

  win(): void {
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.3, 'triangle', 0.2, i * 0.09));
  }

  fail(): void {
    [0, -3, -7, -12].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 0.3, 'sawtooth', 0.1, i * 0.16));
  }

  click(): void {
    this.tone(700, 0.05, 'square', 0.08);
  }
}

export const sound = new SoundSynth();
