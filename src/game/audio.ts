class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private lastPlayed: Record<string, number> = {};

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.createNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private createNoiseBuffer() {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * 1.5;
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  private canPlay(key: string, minIntervalMs: number): boolean {
    const now = performance.now();
    const prev = this.lastPlayed[key] || 0;
    if (now - prev < minIntervalMs) return false;
    this.lastPlayed[key] = now;
    return true;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public playClick(pitch = 620) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.55, now + 0.035);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.045);
  }

  public playGunshot(type: 'pistol' | 'shotgun' | 'rifle' | 'sniper') {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    const config = {
      pistol: { dur: 0.14, freq: 1400, punch: 180, vol: 0.28 },
      rifle: { dur: 0.16, freq: 1800, punch: 150, vol: 0.3 },
      shotgun: { dur: 0.32, freq: 850, punch: 95, vol: 0.44 },
      sniper: { dur: 0.42, freq: 1100, punch: 80, vol: 0.48 },
    }[type];

    // Noise burst
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(config.freq * (0.9 + Math.random() * 0.2), now);
    filter.Q.setValueAtTime(0.7, now);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(config.vol, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + config.dur);

    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    src.start(now);
    src.stop(now + config.dur + 0.02);

    // Low mechanical punch
    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(config.punch, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + config.dur * 0.65);
    oGain.gain.setValueAtTime(config.vol * 0.85, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + config.dur * 0.7);
    osc.connect(oGain);
    oGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + config.dur * 0.72);
  }

  public playExplosion(intensity = 1) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.canPlay('explosion', 40)) return;
    const now = ctx.currentTime;
    const dur = 0.75 + intensity * 0.35;

    // Sub rumble
    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + dur * 0.85);
    oGain.gain.setValueAtTime(Math.min(0.6, 0.45 * intensity), now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(oGain);
    oGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);

    // Roaring filtered noise
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + dur);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(Math.min(0.55, 0.42 * intensity), now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    src.start(now);
    src.stop(now + dur);
  }

  public playFleshImpact(strength = 0.5) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.canPlay('flesh', 45)) return;
    const now = ctx.currentTime;
    const vol = Math.min(0.32, 0.08 + strength * 0.22);

    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135 + Math.random() * 45, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.08);
    oGain.gain.setValueAtTime(vol, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(oGain);
    oGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vol * 0.55, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.08);
  }

  public playSlice(heavy = false) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.canPlay('slice', 50)) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(heavy ? 1200 : 2100, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.12);
    filter.Q.setValueAtTime(2.5, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.34 : 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.15);
  }

  public playDismember() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.canPlay('dismember', 70)) return;
    const now = ctx.currentTime;

    // Wet tear + bone snap
    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(290, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.11);
    oGain.gain.setValueAtTime(0.24, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(oGain);
    oGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(980, now);
    filter.Q.setValueAtTime(1.6, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.28, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.19);
  }

  public playMetalClang(strength = 0.5) {
    const ctx = this.ensureContext();
    if (!ctx || !this.canPlay('metal', 55)) return;
    const now = ctx.currentTime;
    const vol = Math.min(0.2, 0.04 + strength * 0.16);
    const base = 620 + Math.random() * 280;

    [1, 1.47, 2.13].forEach((mult, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(base * mult, now);
      gain.gain.setValueAtTime(vol / (idx + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.18 + idx * 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    });
  }

  public playGlassShatter() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.canPlay('glass', 60)) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(3200, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.26);

    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const t = now + i * 0.025;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2800 + Math.random() * 2600, t);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  public playWoodBreak() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.canPlay('wood', 60)) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(540, now);
    filter.Q.setValueAtTime(1.2, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.15);
  }

  public playZap() {
    const ctx = this.ensureContext();
    if (!ctx || !this.canPlay('zap', 70)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.linearRampToValueAtTime(840, now + 0.04);
    osc.frequency.linearRampToValueAtTime(130, now + 0.12);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playSyringe() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.canPlay('syringe', 120)) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2400, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.19);
  }

  public playChainsawTick() {
    const ctx = this.ensureContext();
    if (!ctx || !this.canPlay('chainsaw', 65)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(88 + Math.random() * 18, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playBandage() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.canPlay('bandage', 100)) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + 0.14);
    filter.Q.setValueAtTime(1.8, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.16);
  }

  public playThrusterTick() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.canPlay('thruster', 90)) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(380, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.11);
  }
}

export const soundEngine = new SoundEngine();
