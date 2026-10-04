/**
 * Desert wind / storm / fire ambience.
 *
 * No mp3 files ship with this build (a single-file bundle cannot carry binary audio, and the
 * sandbox cannot write one), so wind-low and wind-storm-heavy are synthesised live from pink
 * noise: a low body, a howling band and a sand hiss. That also lets the storm bar drive the
 * low-pass muffle and the camera drive the stereo direction without decoding a second file.
 */

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class DesertWind {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private body!: GainNode;
  private howl!: GainNode;
  private hiss!: GainNode;
  private fireGain!: GainNode;
  private lowpass!: BiquadFilterNode;
  private howlFilter!: BiquadFilterNode;
  private panner!: StereoPannerNode;
  private gustTimer: number | null = null;
  private crackleTimer: number | null = null;
  private volumeTween: { kill(): void } | null = null;

  private enabled = false;
  private muted = false;
  private storm = 0; // 0 - 1 from the STORM bar
  private proximity = 0; // 0 far outside the storm, 1 right inside it
  private fire = 0; // 0 - 1 how much the inner fire is exposed
  private pan = 0;
  private currentVolume = 0.15;
  started = false;

  /** Build the whole graph once, on the first user gesture. */
  private build() {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    const ctx = new Ctor();
    this.ctx = ctx;

    // 6s of pink noise, seam-crossfaded so the loop is inaudible.
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      const f = Math.floor(ctx.sampleRate * 0.15);
      for (let i = 0; i < f; i++) {
        const a = i / f;
        d[len - f + i] = d[len - f + i] * (1 - a) + d[i] * a;
      }
    }

    const source = (offset: number, rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.loopEnd = 5.85;
      s.playbackRate.value = rate;
      s.start(0, offset);
      return s;
    };

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = "lowpass";
    this.lowpass.frequency.value = 1200;
    this.panner = ctx.createStereoPanner();
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(this.lowpass).connect(this.panner).connect(comp).connect(ctx.destination);

    // low body: soft desert wind
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    this.body = ctx.createGain();
    this.body.gain.value = 0.55;
    source(0).connect(lp).connect(this.body).connect(this.master);

    // howl: the storm front
    this.howlFilter = ctx.createBiquadFilter();
    this.howlFilter.type = "bandpass";
    this.howlFilter.frequency.value = 780;
    this.howlFilter.Q.value = 2.2;
    this.howl = ctx.createGain();
    this.howl.gain.value = 0.18;
    source(2.1, 1.02).connect(this.howlFilter).connect(this.howl).connect(this.master);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(this.howlFilter.frequency);
    lfo.start();

    // hiss: sand striking stone
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3200;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0.05;
    source(4.0, 0.98).connect(hp).connect(this.hiss).connect(this.master);

    // fire crackle, heard through the gaps when the stones disperse
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = "bandpass";
    crackleFilter.frequency.value = 2400;
    crackleFilter.Q.value = 1.4;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    source(1.3, 1.4).connect(crackleFilter).connect(this.fireGain).connect(this.master);

    return true;
  }

  /** Wind gusts never sit still. */
  private scheduleGust = () => {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const g = Math.random();
    this.body.gain.setTargetAtTime(0.35 + g * 0.4 + this.storm * 0.25, t, 1.6);
    this.howl.gain.setTargetAtTime(0.08 + g * g * 0.35 + this.storm * 0.3, t, 1.2);
    this.hiss.gain.setTargetAtTime(0.03 + g * 0.09 + this.storm * 0.14, t, 1.0);
    this.howlFilter.frequency.setTargetAtTime(600 + g * 600 + this.storm * 320, t, 2.0);
    this.gustTimer = window.setTimeout(this.scheduleGust, 1800 + Math.random() * 3200);
  };

  /** Irregular crackle spikes from the exposed inner fire. */
  private scheduleCrackle = () => {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const amount = this.fire * (0.35 + Math.random() * 0.65);
    this.fireGain.gain.cancelScheduledValues(t);
    this.fireGain.gain.setTargetAtTime(amount * 0.5, t, 0.02);
    this.fireGain.gain.setTargetAtTime(0, t + 0.03, 0.09);
    this.crackleTimer = window.setTimeout(this.scheduleCrackle, 70 + Math.random() * 260);
  };

  /**
   * Combine the two volume drivers:
   *   storm   = stormValue / 100            (0.1 quiet -> 1.0 heavy)
   *   proximity = 1 - min(distance / 20, 1) (0 far away, 1 inside the storm)
   *   finalVolume = storm * 0.7 + proximity * 0.3
   * Rising is a 1.5s ease, falling a 2s ease, so entering and leaving never snap.
   */
  private applyMix() {
    if (!this.ctx || !this.enabled) return;
    const target = clamp(Math.max(0.15, this.storm * 0.7 + this.proximity * 0.3), 0, 1);
    const rising = target > this.currentVolume;
    const duration = rising ? 1.5 : 2.0;
    const t = this.ctx.currentTime;
    this.currentVolume = target;
    const gain = this.muted ? 0 : target * 0.85;

    // Manual ramp instead of a tween so the graph stays sample-accurate.
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(gain, t + duration);

    // Heavy storm is muffled and intense; a clear desert night is open and thin.
    this.lowpass.frequency.cancelScheduledValues(t);
    this.lowpass.frequency.setTargetAtTime(1200 - this.storm * 830, t, 0.8);
  }

  async enable() {
    this.enabled = true;
    if (!this.ctx && !this.build()) return;
    const ctx = this.ctx!;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }
    if (!this.enabled) return;
    this.started = true;
    this.applyMix();
    if (this.gustTimer) clearTimeout(this.gustTimer);
    if (this.crackleTimer) clearTimeout(this.crackleTimer);
    this.scheduleGust();
    this.scheduleCrackle();
  }

  disable() {
    this.enabled = false;
    if (this.gustTimer) clearTimeout(this.gustTimer);
    if (this.crackleTimer) clearTimeout(this.crackleTimer);
    this.gustTimer = null;
    this.crackleTimer = null;
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.9);
    window.setTimeout(() => {
      if (!this.enabled && ctx.state === "running") ctx.suspend();
    }, 1200);
  }

  /** STORM bar, 0 - 100. */
  setStormIntensity(value: number) {
    this.storm = clamp(value / 100, 0, 1);
    this.applyMix();
  }

  /** Camera distance to the pyramid: close = inside the storm = loud. */
  setProximity(distance: number) {
    this.proximity = 1 - Math.min(distance / 20, 1);
    this.applyMix();
  }

  /** Camera azimuth turns the wind direction across the stereo field. */
  setPan(pan: number) {
    this.pan = clamp(pan, -1, 1) * 0.55;
    if (!this.ctx) return;
    this.panner.pan.setTargetAtTime(this.pan, this.ctx.currentTime, 0.7);
  }

  /** 0 - 1 how much of the inner fire is showing through the gaps. */
  setFire(amount: number) {
    this.fire = clamp(amount, 0, 1);
    if (!this.ctx || !this.enabled) return;
    if (this.crackleTimer === null) this.scheduleCrackle();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMix();
    if (this.ctx && this.enabled) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : this.currentVolume * 0.85, t + 0.4);
    }
  }

  dispose() {
    this.disable();
    this.volumeTween?.kill();
    if (this.ctx) this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}
