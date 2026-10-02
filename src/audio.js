// Procedural audio (WebAudio): engine, tyres, wind, kerbs, pops, shifts, hits.

function makeNoise(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function engineWave(ctx, cylinders) {
  // Harmonic recipe: firing order fundamental plus half-orders for a burbly V8,
  // a smoother, brighter V12 and a raspy four.
  const n = 32;
  const real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    let a = 1 / Math.pow(k, cylinders >= 12 ? 1.25 : cylinders >= 8 ? 1.0 : 0.85);
    if (cylinders === 8 && k % 2 === 0) a *= 1.35;
    if (cylinders === 4 && k % 3 === 0) a *= 1.6;
    imag[k] = a * (k % 2 ? 1 : -0.7);
  }
  return ctx.createPeriodicWave(real, imag);
}

class EngineVoice {
  constructor(ctx, out, noise, cylinders) {
    this.ctx = ctx;
    this.cyl = cylinders;
    const wave = engineWave(ctx, cylinders);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.2;
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    this.shaper.curve = curve;
    this.pre = ctx.createGain();
    this.pre.gain.value = 0.5;
    this.oscs = [];
    const mix = ctx.createGain();
    mix.gain.value = 0.32;
    for (const [mult, gain, detune] of [[1, 0.8, 0], [1, 0.5, 7], [0.5, cylinders === 8 ? 0.7 : 0.35, -4], [2, 0.18, 3]]) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(mix);
      o.start();
      this.oscs.push({ o, mult });
    }
    // Intake / exhaust roar.
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noise;
    this.noise.loop = true;
    this.noiseBand = ctx.createBiquadFilter();
    this.noiseBand.type = 'bandpass';
    this.noiseBand.Q.value = 0.9;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseBand).connect(this.noiseGain).connect(this.pre);
    this.noise.start();
    mix.connect(this.pre);
    this.pre.connect(this.shaper).connect(this.filter).connect(this.out).connect(out);
    this.jitter = 0;
  }

  update(rpm, throttle, volume) {
    const t = this.ctx.currentTime;
    this.jitter += (Math.random() - 0.5) * 0.02;
    this.jitter *= 0.9;
    const f = Math.max(8, (rpm / 60) * (this.cyl / 2)) * (1 + this.jitter * 0.04);
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(f * mult, t, 0.012);
    const load = 0.35 + throttle * 0.65;
    this.filter.frequency.setTargetAtTime(500 + rpm * 0.35 + throttle * 3800, t, 0.03);
    this.pre.gain.setTargetAtTime(0.35 + throttle * 0.55, t, 0.03);
    this.noiseBand.frequency.setTargetAtTime(f * 3.2 + 200, t, 0.03);
    this.noiseGain.gain.setTargetAtTime(0.12 * throttle * Math.min(1, rpm / 4000), t, 0.05);
    this.out.gain.setTargetAtTime(volume * load * 0.55, t, 0.04);
  }

  silence() {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
}

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.enabled = false;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.noiseBuf = makeNoise(ctx);

    const loop = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.squeal = loop('bandpass', 1100, 9);
    this.squeal2 = loop('bandpass', 1650, 12);
    this.wind = loop('lowpass', 700, 0.5);
    this.rumble = loop('lowpass', 140, 1);
    this.gravel = loop('bandpass', 2400, 0.7);
    this.hiss = loop('highpass', 2600, 0.7);
    this.enabled = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setPlayerCar(spec) {
    if (!this.ctx) return;
    if (this.player) this.player.out.disconnect();
    this.player = new EngineVoice(this.ctx, this.master, this.noiseBuf, spec.cylinders);
    if (!this.ai) {
      this.ai = new EngineVoice(this.ctx, this.master, this.noiseBuf, 8);
    }
  }

  // Per-frame update from the game.
  update(s) {
    if (!this.ctx || !this.player) return;
    const t = this.ctx.currentTime;
    if (s.paused) {
      this.player.silence();
      this.ai?.silence();
      for (const n of [this.squeal, this.squeal2, this.wind, this.rumble, this.gravel, this.hiss]) n.g.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    this.player.update(s.rpm, s.engineOn ? s.throttle : 0, s.engineOn ? 1 : 0);
    const sq = Math.min(1, Math.max(0, (s.slip - 1.5) / 8)) * (s.onAsphalt ? 1 : 0.15);
    this.squeal.g.gain.setTargetAtTime(sq * 0.22, t, 0.04);
    this.squeal2.g.gain.setTargetAtTime(sq * 0.1, t, 0.04);
    this.squeal.f.frequency.setTargetAtTime(950 + sq * 300 + Math.random() * 60, t, 0.05);
    const w = Math.min(1, s.speed / 75);
    this.wind.g.gain.setTargetAtTime(w * w * 0.32, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(400 + w * 1400, t, 0.1);
    this.rumble.g.gain.setTargetAtTime((s.kerb ? 0.7 : 0) + (s.grass ? 0.35 : 0) * Math.min(1, s.speed / 10), t, 0.03);
    this.gravel.g.gain.setTargetAtTime(s.grass ? Math.min(0.12, s.speed / 150) : 0, t, 0.05);
    this.hiss.g.gain.setTargetAtTime(s.nitro ? 0.13 : 0, t, s.nitro ? 0.03 : 0.15);
    if (this.ai) {
      if (s.aiDist !== undefined && s.aiDist < 120) {
        const vol = Math.max(0, 1 - s.aiDist / 120) ** 2 * 0.6;
        this.ai.update(s.aiRpm, 0.8, vol);
      } else this.ai.silence();
    }
    // Lift-off pops and crackles.
    if (s.popChance > 0 && Math.random() < s.popChance) this.pop();
  }

  _burst({ dur = 0.08, freq = 1500, q = 1, gain = 0.4, type = 'bandpass', delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  _tone({ freq = 440, dur = 0.15, gain = 0.3, type = 'sine', slide = 0, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  pop() {
    this._burst({ dur: 0.05 + Math.random() * 0.05, freq: 500 + Math.random() * 900, q: 0.8, gain: 0.5 + Math.random() * 0.4 });
    this._tone({ freq: 70 + Math.random() * 40, dur: 0.07, gain: 0.35, type: 'triangle', slide: -30 });
  }

  nitroStart() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.7);
  }

  shift() {
    this._burst({ dur: 0.05, freq: 3000, q: 2, gain: 0.25, type: 'highpass' });
    this._tone({ freq: 160, dur: 0.06, gain: 0.15, type: 'square', slide: -80 });
  }

  grind() {
    for (let i = 0; i < 6; i++) {
      this._burst({ dur: 0.07, freq: 2600 + Math.random() * 1500, q: 4, gain: 0.35, delay: i * 0.06 });
      this._tone({ freq: 900 + Math.random() * 400, dur: 0.06, gain: 0.08, type: 'sawtooth', delay: i * 0.06 });
    }
  }

  hit(strength) {
    const g = Math.min(1, strength);
    this._burst({ dur: 0.25, freq: 220, q: 0.7, gain: 0.5 * g + 0.1, type: 'lowpass' });
    this._tone({ freq: 90, dur: 0.25, gain: 0.5 * g, type: 'sine', slide: -50 });
    if (g > 0.4) this._burst({ dur: 0.18, freq: 3500, q: 1.5, gain: 0.2 * g });
  }

  scrape(strength) {
    this._burst({ dur: 0.12, freq: 2800 + Math.random() * 1000, q: 3, gain: Math.min(0.3, strength * 0.25) });
  }

  beep(high) {
    this._tone({ freq: high ? 1320 : 660, dur: high ? 0.6 : 0.22, gain: 0.3, type: 'square' });
  }

  starter() {
    for (let i = 0; i < 5; i++) this._tone({ freq: 55 + i * 3, dur: 0.1, gain: 0.25, type: 'sawtooth', delay: i * 0.09 });
  }

  cash() {
    this._tone({ freq: 1568, dur: 0.12, gain: 0.18, type: 'triangle' });
    this._tone({ freq: 2093, dur: 0.35, gain: 0.18, type: 'triangle', delay: 0.09 });
    this._burst({ dur: 0.06, freq: 5000, q: 2, gain: 0.15, type: 'highpass', delay: 0.02 });
  }

  click() {
    this._tone({ freq: 1800, dur: 0.03, gain: 0.08, type: 'square' });
  }
}
