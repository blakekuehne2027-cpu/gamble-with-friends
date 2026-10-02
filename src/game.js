// Race session: player car, AI, laps, collisions, cameras, FFB, audio and HUD.

import * as THREE from 'three';
import { Track, TRACKS } from './track.js';
import { findCar, PAINT_COLORS } from './cars.js';
import { CarPhysics, SURFACES } from './physics.js';
import { World, ROAD_Y } from './world.js';
import { CarModel } from './carModel.js';
import { Particles, SkidMarks } from './effects.js';
import { AIDriver } from './ai.js';
import { loadJSON, saveJSON } from './settings.js';
import { fmtTime } from './hud.js';
import { buildSpec, raceReward, lapReward, saveCareer, modsActive } from './career.js';

const STEP = 1 / 240;
const CAMERAS = ['cockpit', 'hood', 'chase', 'far'];
const CAMERA_NAMES = { cockpit: 'COCKPIT', hood: 'BONNET', chase: 'CHASE', far: 'FAR CHASE' };
const trackCache = new Map();

export function getTrack(i) {
  if (!trackCache.has(i)) trackCache.set(i, new Track(TRACKS[i]));
  return trackCache.get(i);
}

const wrapPi = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

export class Game {
  constructor({ renderer, input, audio, ffb, hud, settings, career, mods }) {
    this.career = career;
    this.mods = mods;
    this.renderer = renderer;
    this.input = input;
    this.audio = audio;
    this.ffb = ffb;
    this.hud = hud;
    this.settings = settings;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 9000);
    this.active = false;
    this.paused = false;
    this.onFinish = null;
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    this._proj = {};
  }

  // cfg: { mode: 'race'|'tt', track, carId, color, laps, opponents, difficulty }
  start(cfg) {
    this.stop();
    this.cfg = cfg;
    const S = this.settings;
    const track = (this.track = getTrack(cfg.track));
    const def = TRACKS[cfg.track];
    this.world = new World(this.renderer, track, def.theme, S.graphics);
    this.scene = this.world.scene;
    this.night = def.theme === 'night';
    this.renderer.toneMappingExposure = this.world.theme.exposure;

    // Player: base car + bought upgrades + active mods.
    const base = (this.base = findCar(cfg.carId));
    const spec = buildSpec(base, this.career.owned[base.id]?.up, this.mods);
    this.spec = spec;
    this.car = new CarPhysics(spec);
    this.paintHex = PAINT_COLORS[cfg.color] ?? base.color;
    this.model = new CarModel(spec, this.paintHex, { number: 1, cockpit: true, helmet: 0xffd200, glow: this._glowColor() });
    this.scene.add(this.model.root);
    if (this.model.cabinLight) this.model.cabinLight.intensity = this.night ? 0.5 : 0;
    if (this.night) {
      // Headlights.
      const lamp = new THREE.SpotLight(0xfff1dc, 260, 140, 0.5, 0.45, 1.2);
      lamp.position.set(0, 0.8, 2.0);
      lamp.target.position.set(0, 0, 30);
      this.model.root.add(lamp, lamp.target);
    }

    this.particles = new Particles(this.scene);
    this.skids = new SkidMarks(this.scene);

    // Grid: player at the back in a race, alone in time trial.
    this.ais = [];
    const race = cfg.mode === 'race';
    const n = race ? cfg.opponents : 0;
    const slot = (i) => ({ s: -12 - i * 9, d: i % 2 ? -2.6 : 2.6 });
    for (let i = 0; i < n; i++) {
      const g = slot(i);
      const ai = new AIDriver(track, i, g.s, g.d, cfg.difficulty, { tier: base.tier, speed: this.mods.aiSpeed });
      const model = new CarModel(ai.spec, ai.color, { number: ai.number, helmet: [0xffffff, 0xff3b30, 0x34c759, 0x0a84ff][i % 4] });
      ai.model = model;
      this.scene.add(model.root);
      this.ais.push(ai);
    }
    const ps = race ? slot(n) : { s: -40, d: 0 };
    const p = track.pointAt(ps.s, ps.d);
    this.car.reset(p.x, p.z, p.heading);
    this.car.gear = S.transmission === 'h' ? 0 : 1;
    this.prog = ps.s;
    this.lastS = track.wrapS(ps.s);
    this.hint = p.i;
    this.carY = p.h + ROAD_Y;
    this.trackPos = { s: this.lastS, d: ps.d, h: p.h, heading: p.heading, tx: p.tx, tz: p.tz };

    // Session state.
    this.time = 0;
    this.raceStartTime = 0;
    this.state = race ? 'countdown' : 'running';
    this.countdown = 0;
    this.lightsOutAt = 3.6 + 0.6 * 5 + Math.random() * 1.2; // seconds since start
    this.lapsDone = 0;
    this.lapStart = null; // set at the green light (race) or the first line crossing (time trial)
    this.resultsShown = false;
    this._lit = 0;
    this._introShown = false;
    this._cachedPos = n + 1;
    this.lastLap = 0;
    this.bestLap = Infinity;
    this.laps = race ? cfg.laps : Infinity;
    this.finishOrder = [];
    this.playerFinished = false;
    this.camIndex = Math.max(0, CAMERAS.indexOf(S.camera));
    this.camYaw = p.heading;
    this.camPos = new THREE.Vector3();
    this.camInit = false;
    this.shake = 0;
    this.ffbJolt = 0;
    this.steerCmd = 0;
    this.prevSteerRaw = 0;
    this.wrongWay = 0;
    this.stuckTimer = 0;
    this.resetCooldown = 0;
    this.prevThrottle = 0;
    this.popTimer = 0;
    this.absActive = false;
    this.frame = 0;
    // Nitrous, scoring and bonus tracking.
    this.nitro = spec.nitro || 0;
    this.nitroOn = false;
    this.drift = { combo: 0, time: 0, calm: 0, total: 0 };
    this.overtakes = 0;
    this.bestPos = n + 1;
    this.topSpeed = 0;
    this.fastestLapOwner = null;
    this.earned = 0;

    // Time-trial ghost.
    this.ghostKey = `redline.ghost.${def.id}.${base.id}`;
    this.ghostBest = race ? null : loadJSON(this.ghostKey, null);
    if (this.ghostBest) this.bestLap = this.ghostBest.time;
    this.ghostRec = null;
    this.ghostModel = null;
    if (!race) {
      this.ghostModel = new CarModel(spec, 0x9fd4ff, { number: 0 });
      this.ghostModel.root.traverse((o) => {
        if (o.material) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.28;
          o.material.depthWrite = false;
          o.castShadow = false;
        }
      });
      this.ghostModel.root.visible = false;
      this.scene.add(this.ghostModel.root);
    }

    this.hud.setTrack(track);
    this.hud.setMode({ race, laps: cfg.laps, units: S.units, cars: n + 1 });
    this.hud.setTelemetryVisible(S.showTelemetry);
    this.hud.setLights(0, false, race);
    this.hud.setNitro(spec.nitro > 0 ? 1 : -1);
    this.hud.setModsBadge(modsActive(this.mods));
    this.world.setStartLights(0);
    if (!race) this.hud.message('TIME TRIAL', 2.5);

    this.audio.setPlayerCar(spec);
    this.model.setCockpitVisible(CAMERAS[this.camIndex] === 'cockpit');
    this.active = true;
    this.paused = false;
    this.resize();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.ffb.setForce(0);
    this.ffb.setLeds(0);
    this.audio.update({ paused: true });
    if (this.world) this.world.dispose();
    this.model?.dispose();
    for (const a of this.ais || []) a.model.dispose();
    this.world = null;
    this.scene = null;
  }

  restart() {
    this.start(this.cfg);
  }

  setPaused(p) {
    this.paused = p;
    if (p) {
      this.ffb.setForce(0);
      this.audio.update({ paused: true });
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles?.setScale(h * 0.9);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    const inp = this.input.state;
    if (this.paused) return;
    dt = Math.min(dt, 1 / 20);
    if (this.mods.slowmo) dt *= 0.5;
    this.time += dt;
    this.frame++;
    const S = this.settings;
    const car = this.car, spec = this.spec;

    if (inp.pressed.camera) {
      this.camIndex = (this.camIndex + 1) % CAMERAS.length;
      S.camera = CAMERAS[this.camIndex];
      this.model.setCockpitVisible(S.camera === 'cockpit');
      this.hud.sub(CAMERA_NAMES[S.camera], 1.2);
    }
    this.resetCooldown -= dt;
    if (inp.pressed.reset && this.resetCooldown <= 0) this.resetCar();

    this._updateStart(dt);

    // ---- Controls -> physics input ----
    const mode = S.transmission === 'h' && inp.hGear === null ? 'seq' : S.transmission;
    const maxSteerDeg = (spec.maxSteer * 180) / Math.PI;
    const speed = car.speed;
    let steer;
    if (inp.wheel) {
      steer = (inp.steerRaw * S.wheelRange) / 2 / S.steerRatio / maxSteerDeg;
      steer = Math.max(-1, Math.min(1, steer));
      this.steerCmd = steer;
    } else {
      const lim = 1 / (1 + speed / 24);
      let target = inp.steer * lim;
      if (inp.source === 'keys' && S.stability) target -= Math.max(-0.4, Math.min(0.4, car.alphaR * 1.6));
      const rate = inp.source === 'keys' ? (Math.sign(target) !== Math.sign(this.steerCmd) ? 6 : 3.2) : 10;
      const d = target - this.steerCmd;
      this.steerCmd += Math.max(-rate * dt, Math.min(rate * dt, d));
      steer = this.steerCmd;
    }
    let throttle = inp.throttle, brake = inp.brake;
    if (mode === 'auto' && car.gear === -1) [throttle, brake] = [brake, throttle];
    // The car is held on the brakes until the lights go out (you can still rev it).
    const physBrake = this.state === 'countdown' ? 1 : brake;
    if (this.state === 'finished' && this.finishedAt !== undefined && this.time - this.finishedAt > 1.5) {
      throttle = Math.min(throttle, 0.25);
    }
    const autoClutch = S.autoClutch || inp.source !== 'wheel' || !this.input.mapping?.clutch;

    const ev = car.updateTransmission(dt, {
      mode, hGear: inp.hGear ?? 0, shiftUp: inp.pressed.shiftUp, shiftDown: inp.pressed.shiftDown,
      clutch: inp.clutch, throttle, brake, autoClutch,
    });
    for (const e of ev) {
      if (e === 'shift') this.audio.shift();
      if (e === 'grind') { this.audio.grind(); this.ffbJolt = 0.35; this.hud.sub('GRIND! Use the clutch', 1.4); }
      if (e === 'start') this.audio.starter();
    }

    // Nitrous: hold the button with the throttle down; recharges when not in use.
    const canBoost = this.state !== 'countdown' && spec.nitro > 0 && this.nitro > 0 && throttle > 0.3 && car.gear > 0;
    const wasOn = this.nitroOn;
    this.nitroOn = !!inp.nitro && canBoost;
    if (this.nitroOn) {
      if (!this.mods.infiniteNitro) this.nitro = Math.max(0, this.nitro - dt);
      if (!wasOn) this.audio.nitroStart();
    } else if (spec.nitro > 0) {
      this.nitro = Math.min(spec.nitro, this.nitro + dt * (spec.nitro / 28));
    }

    // Surfaces under the four wheels.
    const env = this._surface();
    const phys = { throttle, brake: physBrake, clutch: inp.clutch, steer, handbrake: inp.handbrake, nitro: this.nitroOn, autoClutch, abs: S.abs, tc: S.tc, stability: S.stability };
    this.acc = (this.acc || 0) + dt;
    let n = 0;
    while (this.acc >= STEP && n < 20) {
      car.step(STEP, phys, env);
      this.acc -= STEP;
      n++;
    }
    if (car.stalledEvent) {
      car.stalledEvent = false;
      this.hud.message('STALLED', 1.6, 'warn');
      this.hud.sub('Press the clutch to restart', 2.5);
    }
    this.absActive = S.abs && brake > 0.3 && Math.abs(car.u) > 3 && brake * spec.brakeForce * spec.brakeBias > spec.mu * env.mu * car.Nf * 0.97;
    this.tcActive = S.tc && car.tcCut < 0.9;

    this._collideWalls();
    if (!this.mods.ghost) this._collideCars(dt);
    this._progress(dt);
    this._scoring(dt);

    // AI.
    const racing = this.state === 'racing' || this.state === 'finished';
    const ctx = { racing, playerProgress: this.prog, cars: this.ais };
    for (const ai of this.ais) {
      ai.update(dt, ctx);
      this._aiLaps(ai);
    }
    this._separateAI();

    this._updateVisuals(dt, inp, steer);
    this._updateCamera(dt, inp);
    this._updateEffects(dt);
    this._updateAudio(dt, env, throttle);
    this._updateFFB(dt, inp, env, maxSteerDeg);
    this._updateHUD(dt, inp, mode, autoClutch);
    if (this.ghostModel) this._updateGhost(dt);
    this.world.update(this._v.set(car.x, this.carY, car.z), this.camera);

    if (this.state === 'finished' && !this.resultsShown && this.time - this.finishedAt > 4) {
      this.resultsShown = true;
      this.onFinish?.(this._results());
    }
    this.prevThrottle = throttle;
  }

  _updateStart(dt) {
    if (this.state !== 'countdown') return;
    this.countdown += dt;
    const t = this.countdown;
    const lit = Math.max(0, Math.min(5, Math.floor((t - 3.0) / 0.6) + 1));
    if (t < 3) {
      if (t > 0.3 && !this._introShown) {
        this._introShown = true;
        this.hud.message(TRACKS[this.cfg.track].name.toUpperCase(), 2.2);
      }
    }
    if (lit !== this._lit && t >= 3.0) {
      this._lit = lit;
      this.world.setStartLights(lit);
      this.hud.setLights(lit);
      if (lit > 0) this.audio.beep(false);
    }
    if (t >= this.lightsOutAt) {
      this.state = 'racing';
      this.raceStartTime = this.time;
      this.lapStart = this.time;
      this.world.setStartLights(0);
      this.hud.setLights(0, true);
      this.audio.beep(true);
      this.hud.message('GO!', 1.2, 'go');
      setTimeout(() => this.active && this.hud.setLights(0, false, false), 1500);
    }
  }

  // Drift combos, overtakes and top speed (paid out at the end of the race).
  _scoring(dt) {
    const car = this.car, dr = this.drift;
    if (this.state === 'countdown') return;
    this.topSpeed = Math.max(this.topSpeed, car.speed);
    // Drifting: rear sliding at speed on the tarmac.
    const angle = Math.abs(Math.atan2(car.v, Math.max(1, Math.abs(car.u))));
    const sliding = angle > 0.17 && car.speed > 12 && !this.onGrass && car.u > 0;
    if (sliding) {
      dr.time += dt;
      dr.calm = 0;
      const mult = Math.min(5, 1 + Math.floor(dr.time / 1.5));
      dr.combo += dt * car.speed * angle * 22 * mult;
      dr.mult = mult;
    } else if (dr.combo > 0) {
      dr.calm += dt;
      if (dr.calm > 0.7) {
        const pts = Math.round(dr.combo);
        if (pts >= 50) {
          dr.total += pts;
          this.hud.cash(`DRIFT +${pts}`);
        }
        dr.combo = 0; dr.time = 0; dr.mult = 1;
      }
    }
    if (this._wallHit && dr.combo > 0) {
      this.hud.cash('DRIFT LOST', true);
      dr.combo = 0; dr.time = 0;
    }
    this._wallHit = false;
    this.hud.setDrift(dr.combo > 30 ? Math.round(dr.combo) : 0, dr.mult || 1);
    // Overtakes: reward each new best race position.
    if (this.cfg.mode === 'race' && this.state === 'racing' && this._cachedPos < this.bestPos) {
      const gained = this.bestPos - this._cachedPos;
      this.bestPos = this._cachedPos;
      this.overtakes += gained;
      this.hud.cash(`OVERTAKE +$${150 * gained}`);
    }
  }

  // Re-apply the mod menu while a race is running.
  applyMods() {
    if (!this.active) return;
    const spec = buildSpec(this.base, this.career.owned[this.base.id]?.up, this.mods);
    this.spec = spec;
    this.car.setSpec(spec);
    if (spec.nitro > 0 && this.nitro <= 0) this.nitro = spec.nitro;
    this.nitro = Math.min(this.nitro, spec.nitro);
    this.hud.setNitro(spec.nitro > 0 ? this.nitro / spec.nitro : -1);
    this.hud.setModsBadge(modsActive(this.mods));
    this.model.setGlow(this._glowColor());
    if (!this.mods.rainbow) this.model.setColor(this.paintHex);
    for (const ai of this.ais) ai.setSpeed(this.mods.aiSpeed);
  }

  _glowColor() {
    if (this.base?.glow) return this.base.glow;
    return this.mods.underglow ? 0x22d3ee : null;
  }

  resetCar() {
    const t = this.track;
    const p = t.project(this.car.x, this.car.z, this.hint, this._proj);
    const q = t.pointAt(p.s, 0);
    const gear = this.car.gear;
    this.car.reset(q.x, q.z, q.heading);
    this.car.gear = this.settings.transmission === 'h' ? gear : 1;
    this.resetCooldown = 1.0;
    this.skids.last.clear();
    this.hud.sub('CAR RESET', 1.2);
  }

  _surface() {
    const car = this.car, t = this.track, spec = this.spec;
    const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
    let mu = 0, drag = 0, kerb = false, grass = false;
    const half = spec.track / 2;
    this.wheelSurf = this.wheelSurf || [];
    let k = 0;
    for (const [lz, lx] of [[spec.a, half], [spec.a, -half], [-spec.b, half], [-spec.b, -half]]) {
      const x = car.x + sp * lz + cp * lx, z = car.z + cp * lz - sp * lx;
      const p = t.project(x, z, this.hint, this._proj);
      const s = t.surfaceAt(p.d, p.i);
      const sf = SURFACES[s];
      mu += sf.mu / 4;
      drag += sf.drag / 4;
      if (s === 'kerb') kerb = true;
      if (s === 'grass') grass = true;
      this.wheelSurf[k++] = s;
    }
    const c = t.project(car.x, car.z, this.hint, this._proj);
    this.hint = c.i;
    this.trackPos = { s: c.s, d: c.d, h: c.h, heading: c.heading, tx: c.tx, tz: c.tz };
    const slope = c.grade * Math.cos(car.psi - c.heading);
    this.onGrass = grass;
    this.onKerb = kerb;
    return { mu, drag, slope, kerb, grass };
  }

  _corners() {
    const car = this.car, s = this.model.style;
    const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
    const zOff = (this.spec.a - this.spec.b) / 2;
    const fz = s.len / 2 + zOff - 0.1, rz = -s.len / 2 + zOff + 0.1, hx = s.width / 2;
    return [[fz, hx], [fz, -hx], [rz, hx], [rz, -hx], [zOff, hx], [zOff, -hx]].map(([lz, lx]) => [car.x + sp * lz + cp * lx, car.z + cp * lz - sp * lx]);
  }

  _collideWalls() {
    const t = this.track, car = this.car, m = this.spec.mass, I = this.spec.inertia;
    const lim = t.wallDist - 0.05;
    let worst = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (const [x, z] of this._corners()) {
        const p = t.project(x, z, this.hint, this._proj);
        const ad = Math.abs(p.d);
        if (ad <= lim) continue;
        const pen = ad - lim;
        const nx = -Math.sign(p.d) * p.nx, nz = -Math.sign(p.d) * p.nz; // inward normal
        car.x += nx * pen;
        car.z += nz * pen;
        const v = car.velocityAt(x, z);
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) {
          const rx = x - car.x, rz = z - car.z;
          const rn = rx * nz - rz * nx;
          const J = (-(1 + 0.25) * vn) / (1 / m + (rn * rn) / I);
          car.applyImpulse(nx * J, nz * J, x, z);
          // Scrape friction.
          const tx = -nz, tz = nx;
          const vt = v.x * tx + v.z * tz;
          const Jt = Math.min(Math.abs(vt) * m * 0.3, J * 0.45) * -Math.sign(vt);
          car.applyImpulse(tx * Jt, tz * Jt, x, z);
          worst = Math.max(worst, -vn);
          if (-vn > 1.5) this.particles.sparks(x, this.carY + 0.4, z, v.x, v.z, Math.min(30, (-vn * 3) | 0));
        }
      }
    }
    if (worst > 2) this._wallHit = true;
    if (worst > 0.8) {
      this.audio.hit(worst / 12);
      this.shake = Math.max(this.shake, Math.min(1, worst / 10));
      this.ffbJolt = Math.min(1, worst / 8) * (Math.random() < 0.5 ? -1 : 1);
    } else if (worst > 0.05 && this.car.speed > 4 && this.frame % 6 === 0) {
      this.audio.scrape(this.car.speed / 30);
    }
  }

  _collideCars() {
    const car = this.car, m = this.spec.mass, I = this.spec.inertia;
    const R = 1.05;
    const pc = (x, z, psi, off) => [x + Math.sin(psi) * off, z + Math.cos(psi) * off];
    for (const ai of this.ais) {
      const dx0 = ai.x - car.x, dz0 = ai.z - car.z;
      if (dx0 * dx0 + dz0 * dz0 > 49) continue;
      let best = null;
      for (const po of [1.15, -1.15]) {
        const [px, pz] = pc(car.x, car.z, car.psi, po);
        for (const ao of [1.15, -1.15]) {
          const [ax, az] = pc(ai.x, ai.z, ai.psi, ao);
          const dx = px - ax, dz = pz - az;
          const dist = Math.hypot(dx, dz);
          const pen = 2 * R - dist;
          if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: dx / (dist || 1), nz: dz / (dist || 1), px, pz };
        }
      }
      if (!best) continue;
      const { pen, nx, nz } = best;
      const cx = best.px - nx * R, cz = best.pz - nz * R; // contact point
      car.x += nx * pen * 0.55;
      car.z += nz * pen * 0.55;
      const mAI = ai.spec.mass;
      const vp = car.velocityAt(cx, cz);
      const ty = this.track.pointAt(ai.s, 0, this._aiPt || (this._aiPt = {}));
      const vax = ai.v * Math.sin(ai.psi) + ai.dVel * ty.nx;
      const vaz = ai.v * Math.cos(ai.psi) + ai.dVel * ty.nz;
      const vn = (vp.x - vax) * nx + (vp.z - vaz) * nz;
      ai.push(-nx, -nz, pen * 6, 0);
      if (vn >= 0) continue;
      const rx = cx - car.x, rz = cz - car.z;
      const rn = rx * nz - rz * nx;
      const J = (-(1 + 0.3) * vn) / (1 / m + 1 / mAI + (rn * rn) / I);
      car.applyImpulse(nx * J, nz * J, cx, cz);
      const dvAI = J / mAI;
      const along = -(nx * Math.sin(ai.psi) + nz * Math.cos(ai.psi)) * dvAI;
      ai.push(-nx, -nz, dvAI, along);
      if (-vn > 1) {
        this.audio.hit(-vn / 14);
        this.shake = Math.max(this.shake, Math.min(0.8, -vn / 12));
        this.ffbJolt = Math.min(0.9, -vn / 8) * Math.sign(rn || 1);
      }
    }
  }

  _separateAI() {
    const L = this.track.length;
    for (let i = 0; i < this.ais.length; i++) {
      for (let j = i + 1; j < this.ais.length; j++) {
        const a = this.ais[i], b = this.ais[j];
        let ds = b.s - a.s;
        ds -= Math.round(ds / L) * L;
        if (Math.abs(ds) > 4.6) continue;
        const dd = b.d - a.d;
        if (Math.abs(dd) > 2.1) continue;
        const push = (2.1 - Math.abs(dd)) * 0.5 * (dd >= 0 ? 1 : -1);
        a.d -= push * 0.5; b.d += push * 0.5;
        // The one behind lifts.
        const back = ds > 0 ? a : b, front = ds > 0 ? b : a;
        back.v = Math.min(back.v, front.v);
      }
    }
  }

  _progress() {
    const t = this.track, L = t.length;
    const s = this.trackPos.s;
    let ds = s - this.lastS;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    if (Math.abs(ds) < 60) this.prog += ds;
    this.lastS = s;

    // Wrong-way detection.
    const car = this.car;
    const dir = Math.sin(car.psi) * this.trackPos.tx + Math.cos(car.psi) * this.trackPos.tz;
    if (dir < -0.3 && car.u > 3) this.wrongWay += 1 / 60; else this.wrongWay = 0;
    if (this.wrongWay > 1.2 && Math.floor(this.time * 2) % 2 === 0) this.hud.message('WRONG WAY', 0.6, 'warn');

    // Time trial: timing starts at the first crossing of the line.
    if (this.cfg.mode !== 'race' && this.lapStart === null && this.prog >= 0) {
      this.lapStart = this.time;
      this._startGhostRecording();
    }
    if (this.lapStart === null) return;
    const lapIdx = Math.floor(this.prog / L);
    if (lapIdx > this.lapsDone && this.prog > 0) {
      this.lapsDone = lapIdx;
      const lapTime = this.time - this.lapStart;
      this.lapStart = this.time;
      this.lastLap = lapTime;
      const hadBest = Number.isFinite(this.bestLap);
      const best = lapTime < this.bestLap;
      if (best) this.bestLap = lapTime;
      this.hud.cash(`SPEED TRAP ${Math.round(this.settings.units === 'mph' ? this.car.speed * 2.23694 : this.car.speed * 3.6)} ${this.settings.units === 'mph' ? 'MPH' : 'KM/H'}`);
      if (this.cfg.mode !== 'race') {
        this._finishGhostLap(lapTime, best);
        this.hud.message(fmtTime(lapTime), 3, best ? 'go' : '');
        if (best) this.hud.sub('NEW PERSONAL BEST!', 3);
        const pay = lapReward({ trackKm: this.track.length / 1000, newBest: best, hadBest });
        this._pay(pay.total);
        this.hud.cash(`+$${pay.total.toLocaleString('en-US')}`);
      } else if (this.lapsDone >= this.laps && !this.playerFinished) {
        this.playerFinished = true;
        this.finishPosition = this._position();
        this.finishTime = this.time - this.raceStartTime;
        this.finishOrder.push('player');
        this.state = 'finished';
        this.finishedAt = this.time;
        this.hud.message(this.finishPosition === 1 ? 'YOU WIN!' : `FINISHED P${this.finishPosition}`, 4, this.finishPosition === 1 ? 'go' : '');
      } else {
        this.hud.message(this.lapsDone === this.laps - 1 ? 'FINAL LAP' : `LAP ${this.lapsDone + 1}`, 2);
        this.hud.sub(`${fmtTime(lapTime)}${best ? '  ·  BEST' : ''}`, 2.5);
      }
    }
  }

  _aiLaps(ai) {
    if (this.state === 'countdown') return;
    const L = this.track.length;
    const lap = Math.floor(ai.s / L);
    if (lap > ai.lap && ai.s > 0) {
      ai.lap = lap;
      const lt = this.time - (ai.lapStart ?? this.raceStartTime);
      ai.lapStart = this.time;
      ai.lastLapTime = lt;
      ai.bestLap = Math.min(ai.bestLap, lt);
      if (ai.lap >= this.laps && !ai.finished) {
        ai.finished = true;
        ai.finishTime = this.time - this.raceStartTime;
        this.finishOrder.push(ai);
      }
    }
  }

  _position() {
    const all = this._standings();
    return all.findIndex((r) => r.player) + 1;
  }

  _standings() {
    const rows = [{ player: true, prog: this.prog, name: 'YOU', color: hexCss(PAINT_COLORS[this.cfg.color] ?? this.spec.color) }];
    for (const ai of this.ais) rows.push({ ai, prog: ai.s, name: ai.name, color: hexCss(ai.color) });
    const order = (r) => {
      const idx = this.finishOrder.indexOf(r.player ? 'player' : r.ai);
      return idx >= 0 ? 1e9 - idx : r.prog;
    };
    rows.sort((a, b) => order(b) - order(a));
    return rows;
  }

  _pay(amount) {
    this.career.money += amount;
    this.career.stats.earned += amount;
    this.earned += amount;
    saveCareer(this.career);
  }

  _results() {
    const rows = this._standings();
    const leaderAvg = this.finishTime / this.laps;
    // Prize money.
    const fastestLap = this.ais.every((a) => !(a.bestLap < this.bestLap));
    const topKmh = this.topSpeed * 3.6;
    const reward = raceReward({
      position: this.finishPosition, opponents: this.ais.length, laps: this.laps, difficulty: this.cfg.difficulty,
      trackKm: this.track.length / 1000, fastestLap: fastestLap && this.ais.length > 0,
      drift: this.drift.total + Math.round(this.drift.combo), overtakes: this.overtakes,
      topSpeedBonus: Math.min(1500, Math.max(0, Math.round((topKmh - 200) * 8 / 10) * 10)),
    });
    this._pay(reward.total);
    const st = this.career.stats;
    st.races++;
    if (this.finishPosition === 1) st.wins++;
    if (this.finishPosition <= 3) st.podiums++;
    st.bestPayout = Math.max(st.bestPayout, reward.total);
    st.overtakes += this.overtakes;
    st.drift += this.drift.total;
    st.topSpeed = Math.max(st.topSpeed, topKmh);
    saveCareer(this.career);
    return {
      track: TRACKS[this.cfg.track].name,
      position: this.finishPosition,
      reward,
      balance: this.career.money,
      topSpeed: this.topSpeed,
      rows: rows.map((r, i) => {
        let time;
        if (r.player) time = fmtTime(this.finishTime);
        else if (r.ai.finished) time = fmtTime(r.ai.finishTime);
        else {
          const remaining = this.laps * this.track.length - r.ai.s;
          time = '+' + Math.max(0.1, (remaining / this.track.length) * leaderAvg).toFixed(1) + 's';
        }
        return {
          pos: i + 1, name: r.player ? 'YOU' : r.ai.name, car: r.player ? this.spec.name : r.ai.spec.name, color: r.color,
          best: fmtTime(r.player ? this.bestLap : r.ai.bestLap), time, player: !!r.player,
        };
      }),
    };
  }

  // ---------------------------------------------------------------- visuals
  _updateVisuals(dt, inp, steer) {
    const car = this.car, spec = this.spec;
    this.carY = this.trackPos.h + ROAD_Y + (this.onGrass ? -0.03 : 0);
    const m = this.model;
    m.root.position.set(car.x, this.carY, car.z);
    // Whole car follows the road grade; the body adds dive/squat and roll.
    const gradePitch = -Math.atan(this.track.grade[this.hint] * Math.cos(car.psi - this.trackPos.heading));
    m.root.rotation.set(gradePitch, car.psi, 0, 'YXZ');
    const tp = -car.ax * 0.0032;
    const tr = car.ay * 0.0042;
    this.vPitch = (this.vPitch || 0) + (tp - (this.vPitch || 0)) * Math.min(1, dt * 8);
    this.vRoll = (this.vRoll || 0) + (tr - (this.vRoll || 0)) * Math.min(1, dt * 8);
    const bump = this.onKerb ? (Math.random() - 0.5) * 0.012 : this.onGrass ? (Math.random() - 0.5) * 0.008 * Math.min(1, car.speed / 10) : 0;
    const wheelDeg = inp.wheel ? (inp.steerRaw * this.settings.wheelRange) / 2 : steer * spec.maxSteer * 180 / Math.PI * this.settings.steerRatio;
    this.wheelDeg = wheelDeg;
    const frontSpin = (this.frontSpin = (this.frontSpin || 0) + (car.u / spec.wheelRadius) * dt * (car.frontLock ? 0 : 1));
    m.update(dt, {
      steerRoad: car.delta, spinFront: frontSpin, spinRear: car.rearLock ? m.wheels[2].spin.rotation.x : car.wheelRot,
      braking: this.input.state.brake > 0.05 || (this.settings.transmission === 'auto' && car.gear === -1 && this.input.state.throttle > 0.05),
      pitch: this.vPitch + bump, roll: this.vRoll + bump * 0.6, wheelDeg, lights: this.night,
    });
    if (this.mods.rainbow) {
      const c = (this._rainbow = this._rainbow || new THREE.Color());
      c.setHSL((this.time * 0.15) % 1, 0.9, 0.5);
      m.paint.color.copy(c);
      m.setGlowColor(c);
    }
    m.setNitro(this.nitroOn, this.time);
    // Cockpit display + rev LEDs.
    const rpmF = Math.max(0, (car.rpm - spec.redline * 0.62) / (spec.redline * 0.36));
    const flash = car.rpm > spec.redline - 120 && (this.time * 14) % 2 < 1;
    m.setLeds(rpmF, flash);
    const sp = this.settings.units === 'mph' ? car.speed * 2.23694 : car.speed * 3.6;
    m.setDisplay(car.gear === 0 ? 'N' : car.gear < 0 ? 'R' : String(car.gear), String(Math.round(sp)), this.cfg.mode === 'race' && this.state !== 'countdown' ? `P${this._cachedPos}` : '');

    for (const ai of this.ais) {
      const am = ai.model;
      am.root.position.set(ai.x, ai.h + ROAD_Y, ai.z);
      am.root.rotation.set(-Math.atan(ai.grade || 0), ai.psi, 0, 'YXZ');
      am.update(dt, { steerRoad: ai.steer, spinFront: ai.wheelRot, spinRear: ai.wheelRot, braking: ai.braking, pitch: ai.braking ? 0.012 : 0, roll: 0, lights: this.night });
    }
  }

  _updateCamera(dt, inp) {
    const cam = this.camera, car = this.car, m = this.model;
    const mode = CAMERAS[this.camIndex];
    const S = this.settings;
    const back = inp.lookBack;
    this.shake *= Math.exp(-dt * 6);
    const sh = this.shake * 0.08 + (this.onKerb ? 0.006 : 0) + (this.onGrass ? 0.004 * Math.min(1, car.speed / 15) : 0);
    m.root.updateMatrixWorld(true);
    if (mode === 'cockpit' || mode === 'hood') {
      const local = mode === 'cockpit' ? m.eye.clone() : m.hoodCam.clone();
      if (mode === 'cockpit') {
        // Head moves with the g-forces.
        local.x += -car.ay * 0.0045;
        local.z += -car.ax * 0.004;
        local.y += -Math.abs(car.ax) * 0.0008;
      }
      m.body.localToWorld(local);
      cam.position.copy(local);
      cam.position.x += (Math.random() - 0.5) * sh;
      cam.position.y += (Math.random() - 0.5) * sh;
      m.body.getWorldQuaternion(this._q);
      cam.quaternion.copy(this._q);
      if (!back) cam.quaternion.multiply(this._qFlip);
      cam.fov = S.fov + (this.nitroOn ? 5 : 0);
      this.camInit = false;
    } else {
      const far = mode === 'far';
      const dist = far ? 10 : 6.4, hgt = far ? 3.4 : 2.2;
      // Camera yaw lags behind the car (follows velocity a little when sliding).
      const velYaw = car.speed > 3 ? Math.atan2(car.u * Math.sin(car.psi) + car.v * Math.cos(car.psi), car.u * Math.cos(car.psi) - car.v * Math.sin(car.psi)) : car.psi;
      const want = car.u < -1 ? car.psi : wrapPi(velYaw - car.psi) * 0.35 + car.psi;
      if (!this.camInit) { this.camYaw = car.psi; this.camInit = true; }
      this.camYaw += wrapPi(want - this.camYaw) * Math.min(1, dt * 5);
      const yaw = this.camYaw + (back ? Math.PI : 0);
      const tx = car.x, ty = this.carY, tz = car.z;
      const want3 = this._v.set(tx - Math.sin(yaw) * dist, ty + hgt, tz - Math.cos(yaw) * dist);
      // Keep the camera above the terrain.
      want3.y = Math.max(want3.y, this.track.heightAt(want3.x, want3.z, this.hint) + 0.8);
      if (this.camPos.lengthSq() === 0 || this._lastMode !== mode) this.camPos.copy(want3);
      this.camPos.lerp(want3, Math.min(1, dt * 12));
      cam.position.copy(this.camPos);
      cam.position.x += (Math.random() - 0.5) * sh * 2;
      cam.position.y += (Math.random() - 0.5) * sh * 2;
      cam.lookAt(tx + Math.sin(yaw) * 3, ty + (far ? 1.0 : 1.1), tz + Math.cos(yaw) * 3);
      this.fovKick = (this.fovKick || 0) + ((this.nitroOn ? 10 : 0) - (this.fovKick || 0)) * Math.min(1, dt * 4);
      cam.fov = 58 + Math.min(16, car.speed * 0.16) + this.fovKick;
    }
    this._lastMode = mode;
    cam.updateProjectionMatrix();
  }

  _updateEffects(dt) {
    const car = this.car, spec = this.spec;
    const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
    const half = spec.track / 2;
    const lx = cp, lz = -sp; // left vector
    const wheels = [[spec.a, half], [spec.a, -half], [-spec.b, half], [-spec.b, -half]];
    wheels.forEach(([wz, wx], i) => {
      const x = car.x + sp * wz + cp * wx, z = car.z + cp * wz - sp * wx;
      const front = i < 2;
      const surf = this.wheelSurf[i];
      let mark = 0;
      if (front) {
        if (car.frontLock) mark = 0.8;
        else mark = Math.max(0, Math.abs(car.alphaF) - 0.13) * 4 * Math.min(1, car.speed / 10);
      } else {
        mark = Math.max(Math.min(1, Math.abs(car.rearSpin) / 6), car.rearLock ? 0.8 : 0, Math.max(0, Math.abs(car.alphaR) - 0.11) * 4 * Math.min(1, car.speed / 10));
      }
      if (surf === 'grass') {
        if (car.speed > 3 && Math.random() < 0.5) this.particles.dirt(x, this.carY, z, car.u * sp, car.u * cp);
        mark = 0;
      }
      this.skids.add('p' + i, x, this.carY + 0.012, z, lx, lz, Math.min(1, mark));
      if (!front && mark > 0.25 && Math.random() < 0.3 + mark * 0.7) {
        this.particles.smoke(x, this.carY, z, car.u * sp, car.u * cp, mark, this.night);
      }
    });
    this.skids.flush();
    this.particles.update(dt);
  }

  _updateAudio(dt, env, throttle) {
    const car = this.car, spec = this.spec;
    if (this.prevThrottle > 0.5 && throttle < 0.15 && car.rpm > spec.redline * 0.55) this.popTimer = 0.7;
    if (car.limiterCut && throttle > 0.9) this.popTimer = Math.max(this.popTimer, 0.08);
    this.popTimer -= dt;
    let nearest = Infinity, nearRpm = 0;
    for (const ai of this.ais) {
      const d = Math.hypot(ai.x - car.x, ai.z - car.z);
      if (d < nearest) { nearest = d; nearRpm = ai.rpm; }
    }
    this.audio.update({
      rpm: car.rpm, throttle: car.throttleEff, engineOn: car.engineOn, speed: car.speed,
      slip: car.slipAmount, onAsphalt: !this.onGrass, kerb: this.onKerb && car.speed > 3, grass: this.onGrass,
      aiDist: nearest, aiRpm: nearRpm, popChance: this.popTimer > 0 ? 0.14 : 0, nitro: this.nitroOn,
    });
  }

  _updateFFB(dt, inp, env, maxSteerDeg) {
    const S = this.settings, car = this.car;
    if (!this.ffb.ready || !S.ffb || !inp.wheel) {
      if (this.ffb.ready) this.ffb.setForce(0);
      this._leds();
      return;
    }
    const speed = car.speed;
    const raw = inp.steerRaw;
    const wVel = (raw - this.prevSteerRaw) / Math.max(dt, 1e-3);
    this.prevSteerRaw = raw;
    // Self-aligning torque from the front tyres (goes light when they slide).
    let f = (car.steerTorque / Math.max(1, car.steerTorqueRef)) * 0.85 * Math.min(1, speed / 5);
    // Gentle centring spring at parking speeds plus damping.
    f += -raw * 0.55 * Math.max(0, 1 - speed / 12);
    f += -wVel * (0.035 + 0.02 * Math.min(1, speed / 20));
    // Soft lock at the car's real steering lock.
    const deg = (raw * S.wheelRange) / 2;
    const lock = maxSteerDeg * S.steerRatio;
    if (Math.abs(deg) > lock) f -= Math.sign(deg) * Math.min(1, (Math.abs(deg) - lock) / 12 + 0.25);
    // Road texture.
    if (this.onKerb && speed > 2) f += (this.frame % 2 ? 0.16 : -0.16) * Math.min(1, speed / 12);
    if (this.onGrass && speed > 2) f += (Math.random() - 0.5) * 0.22 * Math.min(1, speed / 15);
    if (car.grinding) f += this.frame % 2 ? 0.12 : -0.12;
    // Impacts.
    f += this.ffbJolt;
    this.ffbJolt *= Math.exp(-dt * 14);
    if (!car.engineOn) f *= 0.7;
    this.ffb.setForce(Math.max(-1, Math.min(1, f * S.ffbStrength)), S.ffbInvert);
    this._leds();
  }

  _leds() {
    if (!this.ffb.ready || !this.settings.revLeds) return;
    const car = this.car, spec = this.spec;
    const frac = (car.rpm - spec.redline * 0.62) / (spec.redline * 0.36);
    let mask = (1 << Math.max(0, Math.min(5, Math.ceil(frac * 5)))) - 1;
    if (car.rpm > spec.redline - 120) mask = (this.time * 12) % 2 < 1 ? 0x1f : 0;
    this.ffb.setLeds(mask);
  }

  _updateHUD(dt, inp, mode, autoClutch) {
    const car = this.car, S = this.settings, spec = this.spec;
    const lapTime = this.lapStart === null ? 0 : this.time - this.lapStart;
    let delta = NaN;
    if (this.ghostBest && this.ghostRec && this.lapStart !== null) {
      const d = this.prog - this.ghostRec.startProg;
      const marks = this.ghostBest.marks;
      const k = Math.floor(d / 10);
      if (k >= 0 && k < marks.length) delta = lapTime - marks[k];
    }
    let board = null;
    if (this.cfg.mode === 'race' && this.frame % 10 === 0) {
      const rows = this._standings();
      const leader = rows[0].prog;
      board = rows.map((r, i) => ({
        pos: i + 1, name: r.name, color: r.color, player: !!r.player,
        gap: i === 0 ? 'LEADER' : `-${Math.max(0, (leader - r.prog) / Math.max(10, car.speed || 30)).toFixed(1)}s`,
      }));
      this._cachedPos = rows.findIndex((r) => r.player) + 1;
    }
    this.hud.update({
      dt,
      position: this.cfg.mode === 'race' ? (this._cachedPos || this.ais.length + 1) : 1,
      lap: this.cfg.mode === 'race' ? this.lapsDone + 1 : this.lapsDone + 1, laps: this.cfg.mode === 'race' ? this.laps : 0,
      lapTime, lastLap: this.lastLap, bestLap: this.bestLap, delta,
      gear: car.gear, grinding: car.grinding, rpm: car.rpm, maxRpm: spec.limiter + 600, redline: spec.redline,
      speedDisplay: S.units === 'mph' ? car.speed * 2.23694 : car.speed * 3.6,
      abs: S.abs, absActive: this.absActive, tc: S.tc, tcActive: this.tcActive, autoClutch, trans: mode,
      wheelDeg: this.wheelDeg, throttle: inp.throttle, brake: inp.brake, clutch: inp.clutch, hGear: inp.hGear,
      board,
    });
    if (spec.nitro > 0) this.hud.setNitro(this.nitro / spec.nitro, this.nitroOn);
    if (this.frame % 3 === 0) {
      const cars = this.ais.map((a) => ({ x: a.x, z: a.z, color: hexCss(a.color) }));
      if (this.ghostModel?.root.visible) cars.push({ x: this.ghostModel.root.position.x, z: this.ghostModel.root.position.z, color: 'rgba(160,210,255,0.7)' });
      cars.push({ x: car.x, z: car.z, color: hexCss(PAINT_COLORS[this.cfg.color] ?? spec.color), player: true });
      this.hud.drawMap(cars);
    }
    // Stuck hint.
    if (this.state !== 'countdown' && car.speed < 1 && inp.throttle > 0.5) this.stuckTimer += dt; else this.stuckTimer = 0;
    if (this.stuckTimer > 3) { this.stuckTimer = 0; this.hud.sub(car.gear === 0 ? 'You are in NEUTRAL - select a gear' : 'Stuck? Press RESET', 2.5); }
  }

  // ---------------------------------------------------------------- ghost
  _startGhostRecording() {
    this.ghostRec = { frames: [], marks: [], startProg: this.prog, t: 0, acc: 0 };
    this.ghostPlayT = 0;
  }

  _finishGhostLap(lapTime, best) {
    if (best && this.ghostRec) {
      const data = { time: lapTime, dt: 1 / 20, frames: this.ghostRec.frames, marks: this.ghostRec.marks };
      saveJSON(this.ghostKey, data);
      this.ghostBest = data;
    }
    this._startGhostRecording();
  }

  _updateGhost(dt) {
    const rec = this.ghostRec;
    const car = this.car;
    if (rec) {
      rec.acc += dt;
      const lapT = this.time - this.lapStart;
      while (rec.acc >= 1 / 20) {
        rec.acc -= 1 / 20;
        rec.frames.push(+car.x.toFixed(2), +this.carY.toFixed(2), +car.z.toFixed(2), +car.psi.toFixed(3));
      }
      const k = Math.floor((this.prog - rec.startProg) / 10);
      while (rec.marks.length <= k && k >= 0) rec.marks.push(lapT);
    }
    const g = this.ghostBest, gm = this.ghostModel;
    if (!g || !rec || this.lapStart === null) { gm.root.visible = false; return; }
    const t = (this.time - this.lapStart) / g.dt;
    const i = Math.floor(t), f = t - i;
    const n = g.frames.length / 4;
    if (i >= n - 1) { gm.root.visible = false; return; }
    const a = i * 4, b = (i + 1) * 4, F = g.frames;
    gm.root.visible = true;
    gm.root.position.set(F[a] + (F[b] - F[a]) * f, F[a + 1] + (F[b + 1] - F[a + 1]) * f, F[a + 2] + (F[b + 2] - F[a + 2]) * f);
    gm.root.rotation.set(0, F[a + 3] + wrapPi(F[b + 3] - F[a + 3]) * f, 0);
    const spin = (gm._spin = (gm._spin || 0) + dt * 60);
    gm.update(dt, { spinFront: spin, spinRear: spin });
  }

  // ---------------------------------------------------------------- render
  render() {
    if (!this.active) return;
    this.renderer.render(this.scene, this.camera);
  }
}
