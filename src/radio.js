// Procedural radio: three stations of generated synthwave, darksynth and
// chillwave, sequenced live with Web Audio. Every song is brand new: key,
// tempo, chords, arpeggio, drum groove and lead melody all come from a seed.

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

export const STATIONS = [
  {
    id: 'redline', name: 'REDLINE FM', genre: 'Synthwave', bpm: [98, 112], scale: MINOR, swing: 0, gain: 0.95,
    progs: [[0, 5, 2, 6], [0, 6, 5, 6], [5, 6, 0, 0], [0, 3, 5, 4], [0, 5, 3, 6]],
    drums: 'synthwave', bass: 'octave', arp: 'sawtooth', lead: 'saw', keys: false,
  },
  {
    id: 'nitro', name: 'NITRO 140', genre: 'Darksynth', bpm: [136, 148], scale: MINOR, swing: 0, gain: 0.8,
    progs: [[0, 0, 5, 6], [0, 5, 0, 6], [0, 3, 0, 4], [0, 6, 5, 4]],
    drums: 'dark', bass: 'roll', arp: 'square', lead: 'square', keys: false,
  },
  {
    id: 'chill', name: 'NIGHT DRIVE 88', genre: 'Chillwave', bpm: [78, 88], scale: DORIAN, swing: 0.16, gain: 1.05,
    progs: [[0, 3, 6, 2], [0, 4, 3, 0], [5, 4, 0, 0], [0, 6, 5, 4]],
    drums: 'chill', bass: 'soft', arp: 'triangle', lead: 'soft', keys: true,
  },
];

const WORDS_A = ['Neon', 'Midnight', 'Chrome', 'Electric', 'Turbo', 'Crimson', 'Pacific', 'Velvet', 'Digital', 'Sunset', 'Laser', 'Afterburn', 'Static', 'Ocean', 'Night', 'Pink Slip', 'Redline', 'Outrun', 'Starlight', 'Cobalt'];
const WORDS_B = ['Highway', 'Apex', 'Horizon', 'Dreams', 'Drive', 'Overdrive', 'Skyline', 'Heat', 'Run', 'Boulevard', 'Mirage', 'Pursuit', 'Echoes', 'Lights', 'Interstate', 'Getaway', 'Rain', 'Underdog', 'Paradise', 'Crossing'];
const ARTISTS = ['Vector Kid', 'Palm Static', 'Chrome Dolphin', 'Night Shifter', 'Turbo Saturn', 'Grid Runner', 'VHS Heart', 'Midnight Mechanic', 'Polygon Sun', 'Cassette Cop', 'Arcade Ghost', 'Lowrider 64'];

// Arpeggio patterns: indexes into [root, third, fifth, octave, tenth].
const ARPS = [
  [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 1, 0, 1],
  [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3],
  [0, 1, 2, 4, 3, 2, 1, 2, 0, 1, 2, 4, 3, 2, 3, 1],
  [3, 2, 1, 0, 3, 2, 1, 0, 4, 3, 2, 1, 4, 3, 2, 1],
  [0, 0, 3, 0, 2, 0, 3, 0, 0, 0, 3, 0, 4, 0, 3, 2],
];

const RHYTHMS = [
  [[0, 3], [3, 3], [6, 2], [8, 4], [12, 2], [14, 2]],
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
  [[0, 6], [6, 2], [8, 6], [14, 2]],
  [[0, 4], [4, 2], [6, 2], [8, 8]],
  [[2, 2], [4, 2], [6, 4], [10, 2], [12, 4]],
  [[0, 3], [3, 3], [6, 4], [10, 3], [13, 3]],
];
const ENDINGS = [[[0, 4], [4, 4], [8, 8]], [[0, 2], [2, 2], [4, 12]], [[0, 6], [6, 10]]];

function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// A 4-bar lead phrase: notes are scale-degree offsets from the current chord
// root, so the melody always fits whatever chord is playing.
function makeMotif(r) {
  const r1 = pick(r, RHYTHMS), r2 = pick(r, RHYTHMS);
  const bars = [r1, r2, r1, pick(r, ENDINGS)];
  const notes = [];
  let deg = pick(r, [0, 2, 4, 7]);
  bars.forEach((rh, b) => {
    rh.forEach(([pos, len], i) => {
      deg += pick(r, [-2, -1, -1, 0, 1, 1, 2, 3]);
      deg = Math.max(-2, Math.min(9, deg));
      if (pos % 8 === 0 && deg % 2) deg += deg > 4 ? -1 : 1; // chord tones on strong beats
      if (b === 3 && i === rh.length - 1) deg = deg > 3 ? 7 : 0; // resolve home
      notes.push({ pos: b * 16 + pos, len, off: deg });
    });
  });
  return notes;
}

function makeSong(st, seed) {
  const r = rng(seed);
  const bpm = Math.round(st.bpm[0] + r() * (st.bpm[1] - st.bpm[0]));
  const form = [['intro', 4], ['verse', 8], ['chorus', 8], ['break', 4], ['chorus', 8], ['outro', 4]];
  const secAt = [];
  for (const [name, bars] of form) for (let i = 0; i < bars; i++) secAt.push({ name, i, bars });
  return {
    name: `${pick(r, WORDS_A)} ${pick(r, WORDS_B)}`,
    artist: pick(r, ARTISTS),
    bpm,
    root: 33 + Math.floor(r() * 8), // A1..E2
    prog: pick(r, st.progs),
    arp: pick(r, ARPS),
    motif: makeMotif(r),
    kickVar: r() < 0.5,
    hatOpen: r() < 0.6,
    secAt,
    bars: secAt.length,
    r,
  };
}

export class Radio {
  constructor(audio, station = 0, volume = 0.5) {
    this.audio = audio;
    this.station = station; // -1 = off
    this.volume = volume;
    this.ctx = null;
    this.song = null;
    this.onSong = null;
    this.seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  }

  get nowPlaying() {
    if (this.station < 0 || !this.song) return null;
    const st = STATIONS[this.station];
    return { station: st.name, genre: st.genre, artist: this.song.artist, title: this.song.name };
  }

  // Called every frame; builds the audio graph once the browser allows sound.
  tick() {
    if (this.ctx || !this.audio.ctx) return;
    this._build(this.audio.ctx);
    if (this.station >= 0) this._newSong();
    this.timer = setInterval(() => this._schedule(), 25);
  }

  setVolume(v) {
    this.volume = v;
    if (this.out) this.out.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, 0.05);
  }

  setStation(i) {
    this.station = i;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.mix.gain.cancelScheduledValues(t);
    this.mix.gain.setTargetAtTime(0, t, 0.04);
    this._static(t);
    if (i < 0) {
      this.song = null;
      this.onSong?.(null);
      return;
    }
    this._newSong(t + 0.35);
  }

  // Cycle stations: REDLINE FM -> NITRO 140 -> NIGHT DRIVE 88 -> off.
  next() {
    const n = this.station + 1;
    this.setStation(n >= STATIONS.length ? -1 : n);
    return this.station;
  }

  skip() {
    if (this.station >= 0 && this.ctx) this._newSong(this.ctx.currentTime + 0.1);
  }

  // ------------------------------------------------------------- graph
  _build(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume * 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.out.connect(comp).connect(ctx.destination);
    this.mix = ctx.createGain();
    this.mix.gain.value = 0;
    this.mix.connect(this.out);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.85;
    this.drums.connect(this.mix);
    this.duck = ctx.createGain(); // pumped by the kick, synthwave style
    this.duck.connect(this.mix);
    this.lead = ctx.createGain();
    this.lead.connect(this.mix);

    // Reverb.
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.verbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.32;
    this.verbIn.connect(conv).connect(verbOut).connect(this.mix);

    // Dotted-eighth delay.
    this.delayIn = ctx.createGain();
    this.delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2400;
    const dOut = ctx.createGain();
    dOut.gain.value = 0.28;
    this.delayIn.connect(this.delay);
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delay.connect(dOut).connect(this.mix);

    const nlen = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
  }

  _newSong(at) {
    const st = STATIONS[this.station];
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    this.song = makeSong(st, this.seed);
    this.step = 0;
    const t = at ?? this.ctx.currentTime + 0.05;
    this.nextT = t;
    this.delay.delayTime.setValueAtTime((60 / this.song.bpm) * 0.75, t);
    this.mix.gain.cancelScheduledValues(t);
    this.mix.gain.setValueAtTime(0, t);
    this.mix.gain.linearRampToValueAtTime(st.gain, t + 1.2);
    this.onSong?.(this.nowPlaying);
  }

  _schedule() {
    const ctx = this.ctx;
    if (!this.song || ctx.state !== 'running') return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (this.nextT < ctx.currentTime - 0.25) this.nextT = ctx.currentTime + 0.05; // fell behind: resync
    while (this.nextT < ctx.currentTime + 0.15) {
      if (this.step >= this.song.bars * 16) this._newSong(this.nextT);
      const d16 = 60 / this.song.bpm / 4;
      const swing = this.step % 2 ? STATIONS[this.station].swing * d16 : 0;
      this._play(this.step, this.nextT + swing, d16);
      this.nextT += d16;
      this.step++;
    }
  }

  // ------------------------------------------------------------- sequencer
  _play(step, t, d16) {
    const st = STATIONS[this.station], s = this.song, r = s.r;
    const bar = Math.floor(step / 16), q = step % 16;
    const sec = s.secAt[bar];
    const chord = s.prog[bar % s.prog.length];
    const name = sec.name;
    const drums = name === 'verse' || name === 'chorus';
    const lastBar = sec.i === sec.bars - 1;
    const open = name === 'intro' ? 0.25 + (sec.i + q / 16) / sec.bars * 0.75 : name === 'outro' ? 1 - (sec.i + q / 16) / sec.bars * 0.7 : 1;

    if (name === 'outro' && q === 0 && sec.i === sec.bars - 1) {
      this.mix.gain.setValueAtTime(st.gain, t);
      this.mix.gain.linearRampToValueAtTime(0.0001, t + d16 * 16);
    }

    // Drums.
    if (drums) {
      if (st.drums === 'synthwave') {
        if (q === 0 || q === 8 || (s.kickVar && q === 10)) this._kick(t, 1);
        if (q === 4 || q === 12) this._snare(t, 0.9, 0.7);
        if (q % 2 === 0) this._hat(t, q % 4 === 2 ? 0.9 : 0.55, false);
        if (s.hatOpen && q === 14) this._hat(t, 0.6, true);
      } else if (st.drums === 'dark') {
        if (q % 4 === 0 || (s.kickVar && q === 14)) this._kick(t, 1.1);
        if (q === 4 || q === 12) this._snare(t, 1, 0.45);
        this._hat(t, q % 4 === 2 ? 1 : 0.4, false);
      } else {
        if (q === 0 || q === 10 || (s.kickVar && q === 7)) this._kick(t, 0.75);
        if (q === 4 || q === 12) this._snare(t, 0.5, 0.35);
        if (q % 2 === 0) this._hat(t, 0.35 + (q % 4 === 2 ? 0.2 : 0), false);
      }
      // Fill into the next section.
      if (lastBar && q >= 12 && st.drums !== 'chill') this._snare(t, 0.35 + (q - 12) * 0.15, 0.6);
    } else if (name === 'break' && lastBar && st.drums !== 'chill') {
      this._snare(t, 0.15 + q * 0.04, 0.7); // snare roll build-up
    }
    if (st.keys && r() < 0.25) this._crackle(t);

    // Bass.
    const root = s.root + this._semi(st, chord);
    if ((name !== 'intro' && name !== 'break') || (name === 'intro' && sec.i >= 2)) {
      if (st.bass === 'octave' && q % 2 === 0) this._bass(t, root + (q % 4 === 2 ? 12 : 0), d16 * 1.8, 900);
      else if (st.bass === 'roll') this._bass(t, root + (q % 8 === 6 ? 12 : 0), d16 * 0.9, 600 + (q % 4 === 0 ? 900 : 300));
      else if (st.bass === 'soft' && (q === 0 || q === 6 || q === 10)) this._bass(t, root + (q === 6 ? 7 : 0), d16 * (q === 0 ? 5 : 3), 500);
    }

    // Chord tones (root, third, fifth, octave, tenth) around C4.
    const tones = [0, 2, 4, 7, 9].map((d) => s.root + 24 + this._semi(st, chord + d));

    // Arp or chill keys.
    if (name !== 'break') {
      if (st.keys) {
        if (q === 0 || q === 6 || q === 10) this._keys(t, [tones[0], tones[1], tones[2], s.root + 24 + this._semi(st, chord + 6)], d16 * 5, open);
      } else {
        this._arp(t, tones[s.arp[q]] + 12, d16 * 0.9, open, st.arp);
      }
    }

    // Pad on every bar.
    if (q === 0) this._pad(t, tones.slice(0, 3).map((m) => m - 12), d16 * 16, st.keys ? 0.6 : 1);

    // Lead melody in the chorus and the break.
    if (name === 'chorus' || name === 'break') {
      const pos = (bar % 4) * 16 + q;
      for (const n of s.motif) {
        if (n.pos === pos) this._lead(t, s.root + 36 + this._semi(st, chord + n.off), n.len * d16, st.lead);
      }
    }
  }

  _semi(st, deg) {
    const sc = st.scale;
    const o = Math.floor(deg / 7);
    return sc[((deg % 7) + 7) % 7] + o * 12;
  }

  // ------------------------------------------------------------- instruments
  _env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return t + attack + hold + release + 0.05;
  }

  _kick(t, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    g.gain.setValueAtTime(vel * 0.95, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.42);
    // Sidechain pump.
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(0.35, t);
    d.linearRampToValueAtTime(1, t + 0.24);
  }

  _noise(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
    return src;
  }

  _snare(t, vel, verb) {
    const ctx = this.ctx;
    const n = this._noise(t, 0.3);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(f).connect(g);
    g.connect(this.drums);
    const vs = ctx.createGain();
    vs.gain.value = verb;
    g.connect(vs).connect(this.verbIn);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    og.gain.setValueAtTime(vel * 0.35, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(this.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  _hat(t, vel, open) {
    const ctx = this.ctx;
    const dur = open ? 0.28 : 0.045;
    const n = this._noise(t, dur + 0.02);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.13, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.drums);
  }

  _crackle(t) {
    const ctx = this.ctx;
    const n = this._noise(t, 0.004);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0.02 + Math.random() * 0.05;
    n.connect(f).connect(g).connect(this.mix);
  }

  _bass(t, midi, dur, cutoff) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    o.type = 'sawtooth';
    o2.type = 'square';
    o.frequency.value = o2.frequency.value = mtof(midi);
    o2.detune.value = -8;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(cutoff * 1.6, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.3), t + dur);
    const g = ctx.createGain();
    const end = this._env(g, t, 0.26, 0.004, dur * 0.6, dur * 0.5);
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g).connect(this.duck);
    o.start(t); o2.start(t);
    o.stop(end); o2.stop(end);
  }

  _arp(t, midi, dur, open, type) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500 + 3200 * open;
    f.Q.value = 3;
    const g = ctx.createGain();
    const end = this._env(g, t, type === 'triangle' ? 0.09 : 0.055, 0.003, 0, dur * 1.4);
    o.connect(f).connect(g);
    g.connect(this.duck);
    g.connect(this.delayIn);
    o.start(t);
    o.stop(end);
  }

  _pad(t, midis, dur, level) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1300;
    const g = ctx.createGain();
    const end = this._env(g, t, 0.05 * level, dur * 0.25, dur * 0.6, dur * 0.35);
    f.connect(g);
    g.connect(this.duck);
    g.connect(this.verbIn);
    for (const m of midis) {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(end);
      }
    }
  }

  _keys(t, midis, dur, open) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900 + 1600 * open;
    const g = ctx.createGain();
    const end = this._env(g, t, 0.06, 0.006, 0, dur * 1.6);
    f.connect(g);
    g.connect(this.duck);
    const vs = ctx.createGain();
    vs.gain.value = 0.5;
    g.connect(vs).connect(this.verbIn);
    for (const m of midis) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator();
      o.type = 'triangle';
      o2.type = 'sine';
      o.frequency.value = mtof(m);
      o2.frequency.value = mtof(m) * 2.005;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.5, t);
      g2.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
      o.connect(f);
      o2.connect(g2).connect(f);
      o.start(t); o2.start(t);
      o.stop(end); o2.stop(end);
    }
  }

  _lead(t, midi, dur, style) {
    const ctx = this.ctx;
    const types = style === 'square' ? ['square', 'square'] : style === 'soft' ? ['triangle', 'sine'] : ['sawtooth', 'sawtooth'];
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = style === 'soft' ? 1900 : 2800;
    f.Q.value = 1.5;
    const g = ctx.createGain();
    const end = this._env(g, t, style === 'soft' ? 0.1 : 0.07, 0.015, Math.max(0, dur - 0.06), 0.18);
    f.connect(g);
    g.connect(this.lead);
    g.connect(this.delayIn);
    const vs = ctx.createGain();
    vs.gain.value = 0.6;
    g.connect(vs).connect(this.verbIn);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5.6;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(dur > 0.3 ? 14 : 0, t + Math.min(dur, 0.45));
    lfo.connect(lg);
    lfo.start(t);
    lfo.stop(end);
    types.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(midi + (i && style === 'soft' ? 12 : 0));
      o.detune.value = i ? 7 : -7;
      lg.connect(o.detune);
      o.connect(f);
      o.start(t);
      o.stop(end);
    });
  }

  // Tuning static when changing stations.
  _static(t) {
    const ctx = this.ctx;
    const n = this._noise(t, 0.4);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(800, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    n.connect(f).connect(g).connect(this.out);
  }
}
