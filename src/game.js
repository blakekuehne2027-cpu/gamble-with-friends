// Race session: player car, AI, laps, collisions, cameras, FFB, audio and HUD.

import * as THREE from 'three';
import { TRACKS, getTrack, GroundCache, SANDBOX_SPOTS, smoothstep } from './track.js';
import { findCar, PAINT_COLORS } from './cars.js';
import { CarPhysics, SURFACES } from './physics.js';
import { World, ROAD_Y } from './world.js';
import { CarModel } from './carModel.js';
import { Particles, SkidMarks, Rain } from './effects.js';
import { AIDriver } from './ai.js';
import { loadJSON, saveJSON } from './settings.js';
import { fmtTime } from './hud.js';
import { buildSpec, raceReward, lapReward, saveCareer, modsActive } from './career.js';
import { DragRace, LANE, settle } from './drag.js';
import { JobRunner } from './jobs.js';
import { unlock, checkRace, checkDrag, checkGarage } from './achievements.js';
import { ReplayRecorder, ReplayPlayer } from './replay.js';
import { CarDamage, Debris } from './damage.js';
import { Chassis, Tumble } from './chassis.js';
import { Props } from './props.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';

const STEP = 1 / 240;
const CAMERAS = ['cockpit', 'hood', 'chase', 'far'];
const CAMERA_NAMES = { cockpit: 'COCKPIT', hood: 'BONNET', chase: 'CHASE', far: 'FAR CHASE' };
export { getTrack };

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
    this.groundCache = track.groundCache || (track.groundCache = new GroundCache((x, z) => {
      // The height of what's drawn: road ribbons near the track, terrain beyond.
      const ti = track.terrainAt(x, z, this._gtmp || (this._gtmp = {}));
      const wd = track.wallDist;
      if (ti.d <= wd + 6) return ti.h + (ti.d <= track.halfWidth ? ROAD_Y : ROAD_Y - 0.04);
      return ti.h - 0.45 * (1 - smoothstep(wd + 2, wd + 8, ti.d));
    }));
    this.sandbox = !!def.sandbox;
    this.world = new World(this.renderer, track, def.theme, S.graphics, { time: cfg.time, rain: cfg.rain });
    this.scene = this.world.scene;
    this.night = this.world.theme.night;
    this.rain = !!cfg.rain;
    this.wet = this.rain ? 0.78 : 1; // tyre grip multiplier in the rain
    this.renderer.toneMappingExposure = this.world.theme.exposure;

    // Player: base car + bought upgrades + active mods.
    const base = (this.base = findCar(cfg.carId));
    const spec = buildSpec(base, this.career.owned[base.id]?.up, this.mods);
    this.spec = spec;
    this.car = new CarPhysics(spec);
    this.paintHex = PAINT_COLORS[cfg.color] ?? base.color;
    this.model = new CarModel(spec, this.paintHex, { number: 1, cockpit: true, helmet: 0xffd200, glow: this._glowColor() });
    this.scene.add(this.model.root);
    this.damage = new CarDamage(this.model, spec, S.damage || 'full');
    this.car.dmg = this.damage.mods;
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
    this.debris = new Debris(this.scene, (x, z) => track.heightAt(x, z), (x, z) => this._debrisBounds(x, z));
    this.misfireT = 0;
    this.slowmoT = 0;
    this.retired = false;
    this.retireAt = 0;
    this.smokeT = 0;
    this.rainFx = this.rain ? new Rain(this.scene, S.graphics === 'low' ? 2500 : 5000, this.night) : null;

    // Grid: player at the back in a race, alone in time trial, right lane on the drag strip.
    this.ais = [];
    const race = cfg.mode === 'race';
    const drag = cfg.mode === 'drag';
    const n = race ? cfg.opponents : 0;
    const slot = (i) => ({ s: -12 - i * 9, d: i % 2 ? -2.6 : 2.6 });
    const rivals = cfg.rivals || [];
    for (let i = 0; i < n; i++) {
      const g = slot(i);
      const ai = new AIDriver(track, i, g.s, g.d, cfg.difficulty, { tier: base.tier, speed: this.mods.aiSpeed * (this.rain ? 0.9 : 1), rival: rivals[i] });
      const model = new CarModel(ai.spec, ai.color, { number: ai.number, helmet: [0xffffff, 0xff3b30, 0x34c759, 0x0a84ff][i % 4] });
      ai.model = model;
      ai.damage = new CarDamage(model, ai.spec, (S.damage || 'full') === 'off' ? 'off' : 'visual');
      this.scene.add(model.root);
      this.ais.push(ai);
    }
    const ps = race ? slot(n) : drag ? { s: -2.4, d: -LANE } : { s: -40, d: 0 };
    const p = track.pointAt(ps.s, ps.d);
    this.car.reset(p.x, p.z, p.heading);
    this.free = cfg.mode === 'free';
    // Without a mapped shifter the H-pattern setting falls back to sequential, so start in 1st.
    this.car.gear = S.transmission === 'h' && this.input.shifterMapped() ? 0 : 1;
    this.prog = ps.s;
    this.lastS = track.wrapS(ps.s);
    this.hint = p.i;
    this.carY = p.h + ROAD_Y;
    this.trackPos = { s: this.lastS, d: ps.d, h: p.h, heading: p.heading, tx: p.tx, tz: p.tz };
    // Suspension, airtime and rollovers.
    this.chassis = new Chassis(spec);
    this.chassis.reset(this.carY);
    this.tumble = new Tumble(spec, this.model.style);
    this.flipHint = 0;
    this.envAir = { mu: 1, drag: 0, slope: 0, contactF: 0, contactR: 0 };
    this._groundFn = (x, z, y) => this.groundAt(x, z, y);
    this._wallFn = (x, z, y) => this._wallAt(x, z, y);
    if (this.free && this.sandbox) this._spawnAt(SANDBOX_SPOTS[cfg.spot ?? 1]);
    this.props = null;
    if (this.sandbox) {
      this.props = new Props(this.scene, this._groundFn, S.damage || 'full');
      this.props.populate();
    }
    this.police?.dispose();
    this.police = null;
    this.wreckedTraffic = 0;
    this.traffic = null;
    if (this.sandbox && this.free && S.traffic !== false) {
      this.traffic = new Traffic(this.scene, track, this._groundFn, S.damage || 'full', 14);
      this.traffic.night = this.night;
    }

    // Session state.
    this.time = 0;
    this.raceStartTime = 0;
    this.state = race ? 'countdown' : drag ? 'drag' : 'running';
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
    this.ghostBest = cfg.mode === 'tt' ? loadJSON(this.ghostKey, null) : null;
    if (this.ghostBest) this.bestLap = this.ghostBest.time;
    this.ghostRec = null;
    this.ghostModel = null;
    if (cfg.mode === 'tt') {
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

    // Drag run: rival, tree and timing live in DragRace.
    this.drag = drag ? new DragRace(this, cfg) : null;
    if (this.drag) {
      this.dragRival = new CarModel(this.drag.rivalSpec, cfg.opp.color, { number: 7, helmet: 0xff3b30, glow: this.drag.rivalSpec.glow ?? null });
      this.scene.add(this.dragRival.root);
      this.world.setScoreboard('them', cfg.opp.name, null, null);
      this.world.setScoreboard('you', 'YOU', null, null);
    }

    // Job: objectives, timers and pay live in JobRunner.
    this.job = cfg.mode === 'job' ? new JobRunner(this, cfg.job) : null;
    this.beacon = null;
    if (this.job && (cfg.job.dist || cfg.job.trapS !== undefined)) {
      const mat = new THREE.MeshBasicMaterial({ color: cfg.job.type === 'radar' ? 0xff3b30 : 0x22d3ee, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 160, 16, 1, true), mat);
      this.beacon.visible = false;
      this.scene.add(this.beacon);
    }
    this.lastImpact = 0;
    this.history = [];
    this.rewinding = false;
    this.recorder = new ReplayRecorder();
    this.replay = null;

    this.hud.setTrack(track);
    this.hud.setMode({ race, laps: cfg.laps, units: S.units, cars: n + 1, drag, job: !!this.job, free: cfg.mode === 'free' });
    this.hud.setTelemetryVisible(S.showTelemetry);
    this.hud.setLights(0, false, race);
    this.hud.setNitro(spec.nitro > 0 ? 1 : -1);
    this.hud.setModsBadge(modsActive(this.mods));
    this.world.setStartLights(0);
    if (cfg.mode === 'tt') this.hud.message('TIME TRIAL', 2.5);
    if (this.free) { this.hud.message('FREE ROAM', 2.5); this.hud.sub(this.sandbox ? 'Pause for teleports, repairs and props' : 'Drive anywhere, no timing', 4); }
    if (cfg.mode === 'job') this.hud.message(cfg.job.name.toUpperCase(), 2.5);

    this.audio.setPlayerCar(spec);
    this.model.setCockpitVisible(CAMERAS[this.camIndex] === 'cockpit');
    this.active = true;
    this.paused = false;
    this.resize();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.audio.siren(0);
    this.police?.dispose();
    this.police = null;
    this.ffb.setForce(0);
    this._stopRumble();
    this.ffb.setLeds(0);
    this.audio.update({ paused: true });
    if (this.world) this.world.dispose();
    this.model?.dispose();
    this.dragRival?.dispose();
    this.dragRival = null;
    this.drag = null;
    this.job = null;
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
      this.audio.siren(0);
      this.ffb.setForce(0);
      this._stopRumble();
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
    if (this.replay) {
      this.replay.update(Math.min(dt, 0.1));
      this.hud.replayUpdate(this.replay);
      return;
    }
    if (this.paused) return;
    dt = Math.min(dt, 1 / 20);
    if (this.mods.slowmo) dt *= 0.5;
    // Crash cam: a moment of slow motion after a big hit (free roam).
    if (this.slowmoT > 0) {
      this.slowmoT -= dt;
      dt *= this.slowmoT > 0.4 ? 0.3 : 0.3 + (0.4 - this.slowmoT) * 1.75;
    }
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

    // Rewind: replay the last few seconds backwards instead of simulating.
    if (inp.rewind && this._canRewind()) {
      this._rewindStep(dt, inp);
      return;
    }
    if (this.rewinding) {
      this.rewinding = false;
      this.hud.setRewind(false);
      this.acc = 0;
      this.skids.last.clear();
    }

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
    // Brake pedal feel: a curve so light pressure brakes gently, and an overall strength.
    const brakePressure = Math.pow(Math.max(0, Math.min(1, physBrake)), S.brakeCurve ?? 1.8) * (S.brakeStrength ?? 0.85);
    if (this.state === 'finished' && this.finishedAt !== undefined && this.time - this.finishedAt > 1.5) {
      throttle = Math.min(throttle, 0.25);
    }
    const autoClutch = S.autoClutch || inp.source !== 'wheel' || !this.input.mapping?.clutch;
    // A damaged engine misfires: the power cuts out in stutters with a bang.
    if (this.damage.misfire > 0 && car.engineOn && throttle > 0.2 && this.misfireT <= 0 && Math.random() < this.damage.misfire * dt * 4) {
      this.misfireT = 0.08 + Math.random() * 0.14;
      this.audio.pop();
    }
    if (this.misfireT > 0) { this.misfireT -= dt; throttle *= 0.12; }

    const ev = car.updateTransmission(dt, {
      mode, hGear: inp.hGear ?? 0, shiftUp: inp.pressed.shiftUp, shiftDown: inp.pressed.shiftDown,
      clutch: inp.clutch, throttle, brake, autoClutch, noAutoReverse: !!this.drag && this.drag.you.left === null,
    });
    for (const e of ev) {
      if (e === 'shift') { this.audio.shift(); this.ffbShift = 0.08; }
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
    const phys = { throttle, brake: physBrake, brakePressure, clutch: inp.clutch, steer, handbrake: inp.handbrake, nitro: this.nitroOn, autoClutch, abs: S.abs, tc: S.tc, stability: S.stability };
    this.acc = (this.acc || 0) + dt;
    let n = 0;
    while (this.acc >= STEP && n < 20) {
      if (this.tumble.active) {
        // Tumbling: the rigid body owns the motion; the car model only runs the engine.
        car.step(STEP, phys, this.envAir);
        this.tumble.step(STEP, this._groundFn, this._wallFn, this.damage.lost);
      } else {
        this.chassis.airControl = throttle - physBrake;
        env.contactF = this.chassis.contactF;
        env.contactR = this.chassis.contactR;
        env.slope = this.chassis.groundSlope;
        car.step(STEP, phys, env);
        this.chassis.step(STEP, car, this._groundFn);
      }
      this.acc -= STEP;
      n++;
    }
    this._updateAirborne(dt);
    this.damage.update(dt, car);
    if (car.stalledEvent && !this.damage.dead) {
      car.stalledEvent = false;
      this.hud.message('STALLED', 1.6, 'warn');
      this.hud.sub('Press the clutch to restart', 2.5);
    }
    this.absActive = S.abs && brake > 0.3 && Math.abs(car.u) > 3 && brakePressure * spec.brakeForce * spec.brakeBias > spec.mu * env.mu * car.Nf * 0.93;
    this.tcActive = S.tc && car.tcCut < 0.9;

    this._collideWalls();
    if (!this.mods.ghost) this._collideCars(dt);
    if (this.props) this._updateProps(dt);
    if (this.police) this._updatePolice(dt);
    this._damageFx(dt);
    this._progress(dt);
    this._scoring(dt);
    if (this.drag) this._updateDrag(dt);
    if (this.job) {
      this.job.update(dt);
      const tp = this.job.target();
      if (this.beacon && tp) {
        this.beacon.visible = true;
        this.beacon.position.set(tp.x, tp.h + 80, tp.z);
      }
    }

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
    if (this.rainFx) {
      const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
      this.rainFx.update(dt, this.camera.position, car.u * sp + car.v * cp, car.u * cp - car.v * sp);
    }

    if (this.state === 'finished' && !this.resultsShown && this.time - this.finishedAt > (this.drag ? 1.5 : 4)) {
      this.resultsShown = true;
      this.onFinish?.(this.drag ? this._dragResults() : this.job ? this._jobResults() : this._results());
    }
    this.prevThrottle = throttle;
    this._snapshot();
    this.recorder.record(dt, this);
  }

  // ---------------------------------------------------------------- replay
  _replayOthers() {
    const out = this.ais.map((a) => ({ x: a.x, y: a.h + ROAD_Y, z: a.z, psi: a.psi, steer: a.steer, spin: a.wheelRot, braking: a.braking }));
    if (this.drag) {
      const r = this.drag.rival;
      out.push({ x: r.x, y: this.dragRival.root.position.y, z: r.z, psi: r.psi, steer: r.delta, spin: r.wheelRot, braking: false });
    }
    return out;
  }

  _replayModels() {
    const out = this.ais.map((a) => a.model);
    if (this.dragRival) out.push(this.dragRival);
    return out;
  }

  startReplay() {
    if (this.recorder.frames.length < 30) return false;
    this.replay = new ReplayPlayer(this, this.recorder.frames);
    this.paused = false;
    this.model.setCockpitVisible(false);
    if (this.ghostModel) this.ghostModel.root.visible = false;
    this.ffb.setForce(0);
    this._stopRumble();
    this.hud.setReplay(true);
    return true;
  }

  stopReplay() {
    this.replay = null;
    this.model.setCockpitVisible(CAMERAS[this.camIndex] === 'cockpit');
    this.hud.setReplay(false);
    this.paused = true;
    this.audio.update({ paused: true });
  }

  // ---------------------------------------------------------------- rewind
  _canRewind() {
    if (this.drag || this.cfg.pink) return false; // nothing on the line gets a do-over
    return (this.state === 'racing' || this.state === 'running') && this.history.length > 1;
  }

  _snapshot() {
    if (!(this.state === 'racing' || this.state === 'running')) return;
    const h = this.history;
    h.push({
      car: Object.assign({}, this.car),
      ais: this.ais.map((a) => Object.assign({}, a)),
      job: this.job ? Object.assign({}, this.job) : null,
      ch: { y: this.chassis.y, vy: this.chassis.vy, pitch: this.chassis.pitch, wp: this.chassis.wp, roll: this.chassis.roll, wr: this.chassis.wr },
      tu: this.tumble.active ? { X: this.tumble.X.clone(), q: this.tumble.q.clone(), V: this.tumble.V.clone(), W: this.tumble.W.clone() } : null,
      g: {
        time: this.time, prog: this.prog, lastS: this.lastS, hint: this.hint, lapsDone: this.lapsDone, lapStart: this.lapStart,
        lastLap: this.lastLap, bestLap: this.bestLap, nitro: this.nitro, drift: { ...this.drift }, overtakes: this.overtakes,
        bestPos: this.bestPos, topSpeed: this.topSpeed, carY: this.carY, trackPos: { ...this.trackPos }, steerCmd: this.steerCmd,
        finishOrder: this.finishOrder.slice(), cachedPos: this._cachedPos, ghost: this.ghostRec ? [this.ghostRec.frames.length, this.ghostRec.marks.length] : null,
      },
    });
    while (h.length > 2 && this.time - h[0].g.time > 10) h.shift();
  }

  _rewindStep(dt, inp) {
    if (!this.rewinding) {
      this.rewinding = true;
      this.hud.setRewind(true);
      this.ffb.setForce(0);
      this._stopRumble();
      unlock('do_over', this.career);
    }
    const h = this.history;
    for (let k = 0; k < 2 && h.length > 1; k++) h.pop();
    const snap = h[h.length - 1];
    Object.assign(this.car, snap.car);
    snap.ais.forEach((a, i) => Object.assign(this.ais[i], a));
    if (snap.job && this.job) Object.assign(this.job, snap.job);
    Object.assign(this.chassis, snap.ch);
    this.chassis.primed = false;
    if (snap.tu) this.tumble.start(snap.tu.X, snap.tu.q, snap.tu.V, snap.tu.W);
    else this.tumble.active = false;
    const g = snap.g;
    this.time = g.time; this.prog = g.prog; this.lastS = g.lastS; this.hint = g.hint; this.lapsDone = g.lapsDone; this.lapStart = g.lapStart;
    this.lastLap = g.lastLap; this.bestLap = g.bestLap; this.nitro = g.nitro; this.drift = { ...g.drift }; this.overtakes = g.overtakes;
    this.bestPos = g.bestPos; this.topSpeed = g.topSpeed; this.carY = g.carY; this.trackPos = { ...g.trackPos }; this.steerCmd = g.steerCmd;
    this.finishOrder = g.finishOrder.slice(); this._cachedPos = g.cachedPos;
    if (g.ghost && this.ghostRec) { this.ghostRec.frames.length = g.ghost[0]; this.ghostRec.marks.length = g.ghost[1]; }
    this.nitroOn = false;
    this.recorder.truncate(this.time);
    for (const ai of this.ais) ai._place();
    // Draw the rewound state.
    this._updateVisuals(dt, inp, this.car.delta / -this.spec.maxSteer);
    this._updateCamera(dt, inp);
    this.world.update(this._v.set(this.car.x, this.carY, this.car.z), this.camera);
    this.audio.update({ rpm: this.car.rpm, throttle: 0.2, engineOn: true, speed: this.car.speed, slip: 0, onAsphalt: true, rain: this.rain });
    this.particles.update(dt);
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

  _updateDrag(dt) {
    const d = this.drag;
    d.update(dt);
    const st = d.hudState();
    this.world.setTree({ staged: d.phase !== 'staging' || d.t > 0.3, ambers: st.ambers, green: st.green, redYou: st.redYou, redThem: st.redThem });
    this.hud.dragUpdate(st);
    // Rival model.
    const r = d.rival, m = this.dragRival;
    const p = this.track.project(r.x, r.z, -1, this._rivalProj || (this._rivalProj = {}));
    m.root.position.set(r.x, p.h + ROAD_Y, r.z);
    m.root.rotation.set(0, r.psi, 0, 'YXZ');
    this._rivalSpin = (this._rivalSpin || 0) + (r.u / r.spec.wheelRadius) * dt;
    m.update(dt, { steerRoad: r.delta, spinFront: this._rivalSpin, spinRear: r.wheelRot, braking: r.u > 1 && d.them.finishT !== null, pitch: -r.ax * 0.003, roll: 0, lights: this.night });
    m.setNitro(false, this.time);
    // Scoreboards light up as each car finishes.
    for (const key of ['you', 'them']) {
      const lane = d[key];
      if (lane.finishT !== null && !lane._shown) {
        lane._shown = true;
        this.world.setScoreboard(key, key === 'you' ? 'YOU' : d.opp.name, lane.splits['1/4 mile'], lane.speeds['1/4 mile']);
      }
    }
    // Rival tyre smoke at the launch.
    if (Math.abs(r.rearSpin) > 2 && Math.random() < 0.6) {
      const sp = Math.sin(r.psi), cp = Math.cos(r.psi);
      this.particles.smoke(r.x - sp * 1.4, p.h + ROAD_Y, r.z - cp * 1.4, r.u * sp, r.u * cp, 0.8, this.night);
    }
  }

  _jobResults() {
    const res = this.job.results(this.career);
    saveCareer(this.career);
    if (res.success) {
      if ((this.career.stats.jobs || 0) >= 10) unlock('jobs10', this.career);
      if (res.job.type === 'taxi' && this.job.complaints === 0) unlock('smooth_op', this.career);
    }
    return res;
  }

  _dragResults() {
    const res = this.drag.results(this.career, this.settings);
    saveCareer(this.career);
    checkDrag(this.career, res);
    checkGarage(this.career);
    if (res.win) {
      const lane = this.drag.you;
      this.world.setScoreboard('you', 'WINNER', lane.splits['1/4 mile'] ?? null, lane.speeds['1/4 mile'] ?? null, true);
    }
    return res;
  }

  // Drift combos, overtakes and top speed (paid out at the end of the race).
  _scoring(dt) {
    const car = this.car, dr = this.drift;
    if (this.state === 'countdown') return;
    this.topSpeed = Math.max(this.topSpeed, car.speed);
    if (car.speed > 69.44) unlock('speed250', this.career);
    if (car.speed > 111.1) unlock('speed400', this.career);
    if (this.drift.total + this.drift.combo >= 5000) unlock('drift5k', this.career);
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
    for (const ai of this.ais) ai.setSpeed(this.mods.aiSpeed * (this.rain ? 0.9 : 1));
  }

  _glowColor() {
    if (this.base?.glow) return this.base.glow;
    return this.mods.underglow ? 0x22d3ee : null;
  }

  resetCar() {
    if (this.sandbox && this.free) {
      // Put the car back on its wheels right where it is.
      const c = this.car;
      this._spawnAt({ x: c.x, z: c.z, heading: c.psi });
      this.resetCooldown = 1.0;
      this.hud.sub('CAR RESET', 1.2);
      return;
    }
    const t = this.track;
    const p = t.project(this.car.x, this.car.z, this.hint, this._proj);
    const q = t.pointAt(p.s, 0);
    const gear = this.car.gear;
    this.car.reset(q.x, q.z, q.heading);
    this.car.gear = this.settings.transmission === 'h' ? gear : 1;
    this.tumble.active = false;
    this.chassis.reset(this.groundAt(q.x, q.z));
    this.flipHint = 0;
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
      let s = t.surfaceAt(p.d, p.i, x, z);
      if (this.sandbox && s === 'dirt' && t.featureTop(x, z, this.carY + 0.5) > -Infinity) s = 'asphalt';
      const sf = SURFACES[s];
      mu += sf.mu / 4;
      drag += sf.drag / 4;
      if (s === 'kerb') kerb = true;
      if (s === 'grass' || s === 'dirt') grass = true;
      this.wheelSurf[k++] = s;
    }
    const c = t.project(car.x, car.z, this.hint, this._proj);
    this.hint = c.i;
    this.trackPos = { s: c.s, d: c.d, h: c.h, heading: c.heading, tx: c.tx, tz: c.tz };
    const slope = c.grade * Math.cos(car.psi - c.heading);
    this.onGrass = grass;
    this.onKerb = kerb;
    return { mu: mu * this.wet, drag, slope, kerb, grass };
  }

  // ---------------------------------------------------------------- ground, air & rollovers
  // Ground height under (x, z); ramps and blocks taller than refY + 0.45
  // aren't ground (you hit their sides instead).
  groundAt(x, z, refY = Infinity) {
    const g = this.groundCache.at(x, z);
    if (!this.sandbox) return g;
    const f = this.track.featureTop(x, z, refY + 0.45);
    return f > g ? f : g;
  }

  // Walls: the track barriers, or in the sandbox the map edge and the sides
  // of ramps and blocks. Returns the way out { x, z, nx, nz } or null.
  _spawnAt(sp) {
    const car = this.car;
    car.reset(sp.x, sp.z, sp.heading);
    car.gear = this.settings.transmission === 'h' && this.input.shifterMapped() ? 0 : 1;
    this.hint = this.track.project(sp.x, sp.z, -1, this._proj || (this._proj = {})).i;
    this.chassis.reset(this.groundAt(sp.x, sp.z));
    this.carY = this.chassis.y;
    this.tumble.active = false;
    this.camInit = false;
    this.camPos?.set(0, 0, 0);
    this.camYaw = sp.heading;
    this.skids?.last.clear();
  }

  _updateProps(dt) {
    const st = this.model.style;
    this._propDims = this._propDims || { len: st.len, width: st.width, zOff: (this.spec.a - this.spec.b) / 2 };
    const body = this.tumble.active ? { ...this.car, velocityAt: () => ({ x: 0, z: 0 }), applyImpulse() {}, spec: this.spec } : this.car;
    const onHit = this._propHit || (this._propHit = (sev, x, z, nx, nz, sound, speed, pc) => {
      if (sev > 1.5) this.damage.impact(x, this.carY + 0.4, z, nx, nz, sev);
      if (sound === 'car' || sound === 'concrete') {
        this.audio.hit(Math.min(1, speed / 14));
        if (speed > 3) this.particles.sparks(x, this.carY + 0.4, z, this.car.u * Math.sin(this.car.psi), this.car.u * Math.cos(this.car.psi), Math.min(25, speed * 2) | 0);
        this.shake = Math.max(this.shake, Math.min(0.9, speed / 12));
        this.ffbJolt = Math.min(0.9, speed / 9) * (Math.random() < 0.5 ? -1 : 1);
        if (pc && pc.damage.events.length) this._damageEvents(pc.damage, 0, 0, false);
        // Wreck enough traffic and somebody calls the cops.
        if (pc && pc.wrecked && !pc.reported) {
          pc.reported = true;
          if (++this.wreckedTraffic >= 2 && !this.police && this.free) { this.startChase(); this.hud.sub("YOU'VE BEEN REPORTED!", 3); }
        }
      } else {
        this.audio.thunk(sound, Math.min(1, speed / 12));
        this.ffbJolt = Math.max(this.ffbJolt, Math.min(0.35, speed / 30));
      }
    });
    this.props.update(dt, body, this.carY, this._propDims, onHit);
    if (this.traffic) this.traffic.update(dt, body, this.carY, { pos: this.trackPos }, onHit);
    for (const e of this.props.events) {
      if (e.type === 'bowl') {
        if (e.down >= 10) { this.hud.message('STRIKE!', 3, 'go'); unlock('strike', this.career); this.audio.cash(); }
        else this.hud.message(`${e.down} PIN${e.down === 1 ? '' : 'S'}`, 2.5);
      }
    }
    this.props.events.length = 0;
  }

  // ---------------------------------------------------------------- police
  startChase() {
    if (this.police) this.police.dispose();
    this.police = new Police(this, 3);
    this.chaseEndT = 0;
    this.hud.message('POLICE CHASE!', 2.5, 'warn');
    this.hud.sub('Lose them: get 350 m away and stay gone. Stop and you are busted.', 5);
  }

  endChase() {
    this.police?.dispose();
    this.police = null;
    this.audio.siren(0);
    this.hud.setChase(null);
  }

  _copHit(sev, x, z, nx, nz, speed) {
    if (sev > 1.5) this.damage.impact(x, this.carY + 0.45, z, nx, nz, sev);
    this.audio.hit(Math.min(1, speed / 14));
    this.shake = Math.max(this.shake, Math.min(0.9, speed / 12));
    this.ffbJolt = Math.min(0.9, speed / 9) * (Math.random() < 0.5 ? -1 : 1);
    if (speed > 3) this.particles.sparks(x, this.carY + 0.4, z, 0, 0, Math.min(20, speed * 2) | 0);
  }

  _updatePolice(dt) {
    const P = this.police;
    P.update(dt);
    for (const k of P.cops) if (k.damage.events.length) this._damageEvents(k.damage, 0, 0, false);
    const near = P.nearest();
    this.audio.siren(P.active ? Math.max(0, 1 - near / 320) : 0);
    this.hud.setChase(P.active ? { near, escape: P.escapeT / 8, bust: P.bustT / 3, left: P.cops.filter((k) => !k.out).length } : null);
    if (!P.active && !this.chaseEndT) {
      this.chaseEndT = this.time;
      if (P.state === 'escaped') {
        this.hud.message(P.reason === 'disabled' ? 'COPS WRECKED!' : 'ESCAPED!', 3, 'go');
        this._pay(2000);
        this.hud.cash('+$2,000');
        unlock('getaway', this.career);
        this.audio.cash();
      } else {
        const fine = Math.min(1500, this.career.money);
        this.career.money -= fine;
        saveCareer(this.career);
        this.hud.message('BUSTED!', 3, 'warn');
        this.hud.sub(`Fined $${fine.toLocaleString('en-US')}`, 3);
      }
      this.audio.siren(0);
    }
    if (this.chaseEndT && this.time - this.chaseEndT > 5) this.endChase();
  }

  resetProps() {
    this.props?.reset();
    this.traffic?.reset();
    this.debris.clear();
    this.hud.sub('PROPS RESET', 1.5);
  }

  teleport(i) {
    if (!this.sandbox) return;
    this._spawnAt(SANDBOX_SPOTS[i]);
    this.hud.sub(SANDBOX_SPOTS[i].name.toUpperCase(), 2);
  }

  _wallAt(x, z, y = this.carY) {
    const t = this.track;
    if (this.sandbox) {
      const f = t.featureHit(x, z, y);
      if (f) return f;
      const b = t.bounds, m = 420;
      const cx = Math.max(b.minX - m, Math.min(b.maxX + m, x)), cz = Math.max(b.minZ - m, Math.min(b.maxZ + m, z));
      if (cx === x && cz === z) return null;
      const dx = cx - x, dz = cz - z, l = Math.hypot(dx, dz) || 1;
      return { x: cx, z: cz, nx: dx / l, nz: dz / l, pen: l };
    }
    const p = t.project(x, z, this.hint, this._wp || (this._wp = {}));
    const lim = t.wallDist - 0.05;
    if (Math.abs(p.d) <= lim) return null;
    const over = p.d - Math.sign(p.d) * lim;
    return { x: x - p.nx * over, z: z - p.nz * over, nx: -Math.sign(p.d) * p.nx, nz: -Math.sign(p.d) * p.nz, pen: Math.abs(over) };
  }

  _updateAirborne(dt) {
    const c = this.chassis, car = this.car, T = this.tumble;
    // Sliding sideways on dirt or grass: the tyres dig in and trip the car.
    if (!T.active && this.onGrass && !c.airborne && Math.abs(car.v) > 8) {
      c.wr -= Math.sign(car.v) * (Math.abs(car.v) - 7) * 1.6 * dt;
    }
    if (T.active) {
      // Follow the rigid body.
      const fwd = T.forward;
      if (Math.abs(fwd.y) < 0.97) car.psi = Math.atan2(fwd.x, fwd.z);
      const up = T.up;
      const cg = this.spec.cgHeight;
      car.x = T.X.x - up.x * cg; car.z = T.X.z - up.z * cg;
      this.tumbleBaseY = T.X.y - up.y * cg;
      const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
      car.u = T.V.x * sp + T.V.z * cp;
      car.v = T.V.x * cp - T.V.z * sp;
      car.r = T.W.y;
      for (const h of T.hits) {
        this.damage.impact(h.x, h.y, h.z, h.nx, h.nz, h.speed, h.ny);
        if (h.speed > 4) {
          this.particles.sparks(h.x, h.y, h.z, T.V.x, T.V.z, Math.min(20, h.speed * 2) | 0);
          this.audio.hit(h.speed / 14);
          this.shake = Math.max(this.shake, Math.min(1, h.speed / 10));
          this.ffbJolt = Math.min(0.9, h.speed / 9) * (Math.random() < 0.5 ? -1 : 1);
        } else if (h.speed > 2.5 && this.frame % 4 === 0) this.audio.scrape(0.5);
      }
      T.hits.length = 0;
      if (T.up.y < -0.3) this.wasUpsideDown = true;
      if (T.canDrive) {
        // Landed back on its wheels: hand back to the normal car model.
        if (this.wasUpsideDown) { this.hud.message('BARREL ROLL!', 2.5, 'go'); unlock('barrel_roll', this.career); }
        const e = new THREE.Euler().setFromQuaternion(T.q, 'YXZ');
        c.reset(this.tumbleBaseY);
        c.pitch = e.x; c.roll = e.z; c.vy = T.V.y;
        car.psi = e.y;
        T.active = false;
      } else if (T.rest > 1.2 && !this.flipHint) {
        this.flipHint = 1;
        this.hud.message(T.upsideDown ? 'ON THE ROOF' : 'ON ITS SIDE', 2.5, 'warn');
        this.hud.sub('Press RESET (R) to flip back over', 6);
      }
      return;
    }
    // Hard landings bottom out the suspension.
    if (c.landing > 6.5) {
      const i = c.bottomWheel, w = c.wheels[i];
      const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
      const x = car.x + sp * w.z + cp * w.x, z = car.z + cp * w.z - sp * w.x;
      this.damage.impact(x, c.y + 0.25, z, 0, 0, c.landing * 0.9, 1);
      this.particles.sparks(x, c.y + 0.05, z, car.u * sp, car.u * cp, Math.min(25, c.landing * 2) | 0);
      this.audio.hit(c.landing / 12);
      this.shake = Math.max(this.shake, Math.min(1, c.landing / 9));
      this.ffbJolt = Math.min(1, c.landing / 8) * (w.x > 0 ? -1 : 1);
    } else if (c.landing > 3.5) {
      this.audio.hit(c.landing / 20);
      this.ffbJolt = Math.min(0.5, c.landing / 12);
    }
    c.landing = 0;
    // Big air bonus (time in the air, shown when you land).
    if (c.airTime > 0) this.airMax = c.airTime;
    else if (this.airMax > 0.6) {
      this.hud.cash(`AIR ${this.airMax.toFixed(1)}s`);
      if (this.airMax > 2.5) unlock('big_air', this.career);
      this.airMax = 0;
    } else this.airMax = 0;
    if (c.tipped) this._startTumble();
  }

  _crashCam() {
    if (!this.free || this.settings.crashCam === false || this.slowmoT > 0) return;
    this.slowmoT = 1.6;
  }

  _startTumble() {
    if (this.car.speed > 12) this._crashCam();
    const c = this.chassis, car = this.car, cg = this.spec.cgHeight;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.pitch, car.psi, c.roll, 'YXZ'));
    const X = new THREE.Vector3(0, cg, 0).applyQuaternion(q).add(new THREE.Vector3(car.x, c.y, car.z));
    const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
    const V = new THREE.Vector3(car.u * sp + car.v * cp, c.vy, car.u * cp - car.v * sp);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.psi);
    const W = new THREE.Vector3(c.wp, 0, c.wr).applyQuaternion(yawQ);
    W.y = car.r;
    this.tumble.start(X, q, V, W);
    this.tumbleBaseY = c.y;
    this.flipHint = 0;
    this.wasUpsideDown = false;
  }

  // ---------------------------------------------------------------- damage
  _debrisBounds(x, z) {
    const t = this.track, p = t.project(x, z, -1, this._dbp || (this._dbp = {}));
    const lim = t.wallDist - 0.3;
    if (Math.abs(p.d) <= lim) return null;
    const over = p.d - Math.sign(p.d) * lim;
    return { hit: true, x: x - p.nx * over, z: z - p.nz * over };
  }

  _damageFx(dt) {
    const car = this.car, dm = this.damage;
    if (dm.lastSev > 34) { unlock('crash_test', this.career); dm.lastSev = 0; }
    const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
    const vx = car.u * sp + car.v * cp, vz = car.u * cp - car.v * sp;
    if (dm.events.length) this._damageEvents(dm, vx, vz, true);
    for (const ai of this.ais) {
      if (ai.damage?.events.length) this._damageEvents(ai.damage, ai.v * Math.sin(ai.psi), ai.v * Math.cos(ai.psi), false);
    }
    if (dm.mechanical) {
      const st = this.model.style, zOff = (this.spec.a - this.spec.b) / 2;
      const hot = dm.temp > 112, eng = dm.engine;
      // Steam or smoke from the engine bay; flames once it's done for.
      if (eng > 0.4 || hot) {
        this.smokeT -= dt;
        if (this.smokeT <= 0) {
          this.smokeT = 0.08 / Math.max(0.3, eng + (hot ? 0.4 : 0));
          const mid = this.spec.style === 'proto' || this.spec.style === 'hyper';
          const lz = (mid ? -st.len / 2 + 1.0 : st.len / 2 - 0.9) + zOff;
          const x = car.x + sp * lz, z = car.z + cp * lz, y = this.carY + st.hoodH + 0.05;
          const c = dm.dead ? 0.16 : eng > 0.75 ? 0.35 : hot && eng < 0.5 ? 0.92 : 0.6;
          const r = (k) => (Math.random() - 0.5) * k;
          this.particles.emit(0, x + r(0.6), y, z + r(0.6), vx * 0.25 + r(1), 0.9 + Math.random(), vz * 0.25 + r(1), 1.1 + Math.random() * 0.8, 0.45 + eng * 0.35, c, c, c);
          if (dm.dead && Math.random() < 0.7) {
            this.particles.emit(0, x + r(0.4), y, z + r(0.4), vx * 0.2 + r(0.6), 1.6 + Math.random(), vz * 0.2 + r(0.6), 0.45, 0.45, 1.0, 0.45 + Math.random() * 0.25, 0.08);
          }
        }
      }
      // Bare rims on the road throw sparks.
      if (car.speed > 4) {
        for (let i = 0; i < 4; i++) {
          if (!(dm.lost[i] || dm.tyre[i] < 0.05) || Math.random() > 0.6) continue;
          const lz = i < 2 ? this.spec.a : -this.spec.b, lx = (i % 2 ? -1 : 1) * this.spec.track / 2;
          this.particles.sparks(car.x + sp * lz + cp * lx, this.carY + 0.08, car.z + cp * lz - sp * lx, vx, vz, 2);
        }
      }
    }
    this.debris.update(dt, car, this.carY);
    if (this.frame % 6 === 0) this.hud.setDamage(dm);
    if (this.retireAt && this.time > this.retireAt && this.cfg.mode === 'race' && !this.playerFinished) this._retire();
  }

  _damageEvents(dm, vx, vz, player) {
    for (const e of dm.events) {
      if (e.type === 'detach') {
        const out = 2 + e.sev * 0.22, r = () => (Math.random() - 0.5) * 2;
        this.debris.add(e.part.obj, e.matrix, vx * 0.75 - e.nx * out + r(), 1.5 + Math.random() * 2 + e.sev * 0.08, vz * 0.75 - e.nz * out + r(), 5 + e.sev * 0.6);
        this.audio.crunch(Math.min(1, 0.3 + e.sev / 18));
        if (player && e.part.kind === 'wheel') this.hud.message('WHEEL OFF!', 2, 'warn');
      } else if (e.type === 'glass') {
        this.particles.glass(e.x, e.y, e.z, vx, vz, e.n);
        this.audio.glass();
      } else if (e.type === 'pop') {
        this.audio.crunch(0.35);
      }
      if (!player) continue;
      if (e.type === 'puncture') { this.hud.sub('PUNCTURE!', 2.5); this.audio.pop(); }
      if (e.type === 'big') this._crashCam();
      if (e.type === 'overheat') this.hud.sub('ENGINE OVERHEATING', 3);
      if (e.type === 'engine') this.hud.sub('ENGINE DAMAGED', 2.5);
      if (e.type === 'dead') {
        unlock('totaled', this.career);
        this.hud.message('ENGINE DESTROYED', 3, 'warn');
        if (this.cfg.mode === 'race' && !this.playerFinished) this.retireAt = this.time + 3;
        else this.hud.sub('Pause → Repair car', 5);
      }
    }
    dm.events.length = 0;
  }

  _retire() {
    this.retireAt = 0;
    this.retired = true;
    this.playerFinished = true;
    this.finishPosition = this.ais.length + 1;
    this.finishTime = this.time - this.raceStartTime;
    this.state = 'finished';
    this.finishedAt = this.time - 2.5;
    this.hud.message('RETIRED', 3, 'warn');
  }

  // Racing in career modes costs money when you bend the car.
  _repairBill(reward) {
    const dm = this.damage;
    if (!dm.mechanical || dm.total < 0.03) return;
    const price = Math.max(3000, this.base.price || 0);
    const bill = Math.max(100, Math.round((dm.total * price * 0.12) / 50) * 50);
    this.career.money = Math.max(0, this.career.money - bill);
    saveCareer(this.career);
    reward.lines.push(['Repairs', -bill]);
    reward.total -= bill;
  }

  canRepair() {
    return this.cfg.mode !== 'race' && this.cfg.mode !== 'drag';
  }

  repairCar() {
    this.damage.repair();
    this.car.engineOn = true;
    this.car.omegaE = this.spec.idle / 9.549;
    this.hud.setDamage(this.damage);
    this.hud.sub('CAR REPAIRED', 1.5);
  }

  _corners() {
    const car = this.car, s = this.model.style;
    const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
    const zOff = (this.spec.a - this.spec.b) / 2;
    const fz = s.len / 2 + zOff - 0.1, rz = -s.len / 2 + zOff + 0.1, hx = s.width / 2;
    // [x, z, height of the bodywork's bottom at that corner]
    const c = this.chassis, y0 = this.carY + 0.12;
    const sP = c ? Math.sin(c.pitch) : 0, sR = c ? Math.sin(c.roll) : 0;
    return [[fz, hx], [fz, -hx], [rz, hx], [rz, -hx], [zOff, hx], [zOff, -hx]].map(([lz, lx]) => [car.x + sp * lz + cp * lx, car.z + cp * lz - sp * lx, y0 - lz * sP + lx * sR]);
  }

  _collideWalls() {
    const t = this.track, car = this.car, m = this.spec.mass, I = this.spec.inertia;
    let worst = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (const [x, z, y] of this._corners()) {
        const wl = this._wallAt(x, z, y);
        if (!wl) continue;
        const nx = wl.nx, nz = wl.nz; // inward normal
        car.x += wl.x - x;
        car.z += wl.z - z;
        this.chassis.primed = false; // a push isn't the ground moving
        const v = car.velocityAt(x, z);
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) {
          const rx = x - car.x, rz = z - car.z;
          const rn = rx * nz - rz * nx;
          const J = (-(1 + 0.25) * vn) / (1 / m + (rn * rn) / I);
          car.applyImpulse(nx * J, nz * J, x, z);
          // The hit is below the centre of gravity, so it also rolls/pitches
          // the body (hard enough and the car flips).
          const c = this.chassis, sp = Math.sin(car.psi), cp = Math.cos(car.psi);
          const arm = Math.max(0, this.spec.cgHeight - 0.35);
          const nLat = nx * cp - nz * sp, nLong = nx * sp + nz * cp;
          c.wr += (J * nLat * arm) / c.Ir * 0.9;
          c.wp += (-J * nLong * arm) / c.Ip * 0.6;
          // Scrape friction.
          const tx = -nz, tz = nx;
          const vt = v.x * tx + v.z * tz;
          const Jt = Math.min(Math.abs(vt) * m * 0.3, J * 0.45) * -Math.sign(vt);
          car.applyImpulse(tx * Jt, tz * Jt, x, z);
          worst = Math.max(worst, -vn);
          if (-vn > 1.5) this.particles.sparks(x, this.carY + 0.4, z, v.x, v.z, Math.min(30, (-vn * 3) | 0));
          this.damage.impact(x, this.carY + 0.35 + Math.random() * 0.25, z, nx, nz, -vn);
        }
      }
    }
    this.lastImpact = worst;
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
      this.chassis.primed = false;
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
      ai.damage?.impact(cx, ai.h + ROAD_Y + 0.45, cz, -nx, -nz, -vn);
      this.damage.impact(cx, this.carY + 0.45, cz, nx, nz, -vn);
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
    if (this.drag || this.free) return; // drag runs are timed by DragRace; free roam isn't timed
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
      if (this.cfg.mode === 'job') {
        this.hud.message(fmtTime(lapTime), 2.5);
      } else if (this.cfg.mode !== 'race') {
        this._finishGhostLap(lapTime, best);
        this.hud.message(fmtTime(lapTime), 3, best ? 'go' : '');
        if (best) this.hud.sub('NEW PERSONAL BEST!', 3);
        if (best && hadBest) unlock('ghostbuster', this.career);
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
      if (r.player && this.retired) return -1e9;
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
    let reward = raceReward({
      position: this.finishPosition, opponents: this.ais.length, laps: this.laps, difficulty: this.cfg.difficulty,
      trackKm: this.track.length / 1000, fastestLap: fastestLap && this.ais.length > 0,
      drift: this.drift.total + Math.round(this.drift.combo), overtakes: this.overtakes,
      topSpeedBonus: Math.min(1500, Math.max(0, Math.round((topKmh - 200) * 8 / 10) * 10)),
    });
    if (this.retired) reward = { lines: [['DNF: engine destroyed', 0]], total: 0 };
    this._pay(reward.total);
    this._repairBill(reward);
    if (this.cfg.pink && this.ais[0]?.rival) {
      // Pink-slip race against the lead rival.
      const rv = this.ais[0].rival;
      const lines = settle(this.career, this.settings, { win: this.finishPosition === 1, pink: true, bet: 0, odds: 1, carId: this.base.id, opp: { name: rv.name, carId: rv.carId, up: rv.up || {}, color: rv.color }, you: {} });
      reward.lines.push(...lines);
    }
    const st = this.career.stats;
    st.races++;
    if (this.finishPosition === 1) st.wins++;
    if (this.finishPosition <= 3) st.podiums++;
    st.bestPayout = Math.max(st.bestPayout, reward.total);
    st.overtakes += this.overtakes;
    st.drift += this.drift.total;
    st.topSpeed = Math.max(st.topSpeed, topKmh);
    saveCareer(this.career);
    const S = this.settings;
    checkRace(this.career, { position: this.finishPosition }, {
      overtakes: this.overtakes, difficulty: this.cfg.difficulty, opponents: this.ais.length, rain: this.rain, night: this.night,
      manual: S.transmission === 'h' && this.input.shifterMapped() && !S.autoClutch && !!this.input.mapping?.clutch,
    });
    checkGarage(this.career);
    return {
      track: TRACKS[this.cfg.track].name,
      position: this.finishPosition,
      dnf: this.retired,
      story: this.cfg.story || null,
      pink: !!this.cfg.pink,
      reward,
      balance: this.career.money,
      topSpeed: this.topSpeed,
      rows: rows.map((r, i) => {
        let time;
        if (r.player) time = this.retired ? 'DNF' : fmtTime(this.finishTime);
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
    const m = this.model, c = this.chassis;
    if (this.tumble.active) {
      this.carY = this.tumbleBaseY;
      m.root.position.set(car.x, this.carY, car.z);
      m.root.quaternion.copy(this.tumble.q);
      m.setSuspension([-0.12, -0.12, -0.12, -0.12]);
    } else {
      // The chassis carries the car over the ground on its suspension.
      this.carY = c.y;
      m.root.position.set(car.x, c.y, car.z);
      m.root.rotation.set(c.pitch, car.psi, c.roll, 'YXZ');
      m.setSuspension(c.comp);
    }
    this.vPitch = 0;
    this.vRoll = 0;
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
      // No rubber marks on a wet road; the tyres throw up spray instead.
      this.skids.add('p' + i, x, this.carY + 0.012, z, lx, lz, this.rain ? 0 : Math.min(1, mark));
      if (!front && !this.rain && mark > 0.25 && Math.random() < 0.3 + mark * 0.7) {
        this.particles.smoke(x, this.carY, z, car.u * sp, car.u * cp, mark, this.night);
      }
      if (!front && this.rain && car.speed > 8 && surf !== 'grass' && Math.random() < Math.min(0.9, car.speed / 40)) {
        this.particles.spray(x - sp * 0.4, this.carY, z - cp * 0.4, car.u * sp, car.u * cp, this.night);
      }
    });
    if (this.rain) {
      // AI cars near the camera spray too.
      for (const ai of this.ais) {
        if (ai.v < 10 || Math.hypot(ai.x - car.x, ai.z - car.z) > 90 || Math.random() > 0.6) continue;
        const asp = Math.sin(ai.psi), acp = Math.cos(ai.psi);
        const bx = ai.x - asp * 1.6, bz = ai.z - acp * 1.6;
        this.particles.spray(bx, ai.h + ROAD_Y, bz, ai.v * asp, ai.v * acp, this.night);
      }
    }
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
      aiDist: nearest, aiRpm: nearRpm, popChance: this.popTimer > 0 ? 0.14 : 0, nitro: this.nitroOn, rain: this.rain,
    });
  }

  _updateFFB(dt, inp, env, maxSteerDeg) {
    const S = this.settings, car = this.car, spec = this.spec;
    const speed = car.speed;
    this.odo = (this.odo || 0) + speed * dt;
    if (this.ffbShift > 0) this.ffbShift -= dt;
    const jolt = this.ffbJolt;
    this.ffbJolt *= Math.exp(-dt * 14);
    this._rumble(dt, inp);
    if (!this.ffb.ready || !S.ffb || !inp.wheel) {
      if (this.ffb.ready) this.ffb.setForce(0);
      this._leds();
      return;
    }
    const raw = inp.steerRaw;
    const wVel = (raw - this.prevSteerRaw) / Math.max(dt, 1e-3);
    this.prevSteerRaw = raw;
    const ph = this.frame % 2 ? 1 : -1; // flips every frame: a buzz the wheel motor can play
    const fxAmt = S.ffbEffects ?? 0.7;

    // Steering weight: self-aligning torque from the front tyres, measured
    // against the car's static front load. The wheel gets heavier as weight
    // moves forward under braking and with downforce, lighter over crests, in
    // the rain and when the front tyres start to slide (your understeer warning).
    const L = spec.a + spec.b;
    const NfStatic = spec.mass * 9.81 * (spec.b / L);
    const ref = spec.mu * spec.frontGrip * NfStatic * 0.03;
    // Real tyres' self-aligning torque grows with load (longer contact patch).
    const load = Math.max(0.5, Math.min(1.8, car.Nf / NfStatic)) ** 0.8;
    const sat = (car.steerTorque / ref) * 0.85 * load;
    let f = Math.tanh(sat * 1.15) / 1.15 * Math.min(1, speed / 5);
    // Gentle centring spring at parking speeds plus damping.
    f += -raw * 0.55 * Math.max(0, 1 - speed / 12);
    f += -wVel * (0.035 + 0.02 * Math.min(1, speed / 20));
    // Soft lock at the car's real steering lock.
    const deg = (raw * S.wheelRange) / 2;
    const lock = maxSteerDeg * S.steerRatio;
    if (Math.abs(deg) > lock) f -= Math.sign(deg) * Math.min(1, (Math.abs(deg) - lock) / 12 + 0.25);

    // --- Effects (scaled by "Road feel & effects") ---
    let e = 0;
    // Road texture: small bumps that grow with speed (less on a wet road).
    if (speed > 1) {
      const p = this.odo;
      const n = 0.5 * Math.sin(p * 2.1) + 0.3 * Math.sin(p * 5.3 + 1.3) + 0.2 * Math.sin(p * 11.7 + 0.4);
      e += n * 0.06 * Math.min(1, speed / 25) * (this.rain ? 0.7 : 1);
    }
    if (this.onKerb && speed > 2) e += ph * 0.18 * Math.min(1, speed / 12);
    if (this.onGrass && speed > 2) e += (Math.random() - 0.5) * 0.26 * Math.min(1, speed / 15);
    if (car.grinding) e += ph * 0.14;
    // ABS chattering, or juddering locked fronts with ABS off.
    if (this.absActive) e += Math.sin(this.time * Math.PI * 2 * 13) * 0.08;
    if (car.frontLock) e += ph * 0.12;
    // Wheelspin, the rev limiter, idle shake, gear changes and nitro.
    if (Math.abs(car.rearSpin) > 1.5) e += (Math.random() - 0.5) * 0.1 * Math.min(1, Math.abs(car.rearSpin) / 6);
    if (car.limiterCut) e += ph * 0.06;
    if (car.engineOn && speed < 1) e += (Math.random() - 0.5) * 0.09 * (0.4 + car.rpm / spec.redline);
    if (this.ffbShift > 0) e += ph * 0.16;
    if (this.nitroOn) e += (Math.random() - 0.5) * 0.06;
    f += e * fxAmt * 1.4;
    // Impacts (walls and cars).
    f += jolt;
    if (!car.engineOn) f *= 0.7;
    this.ffb.setForce(Math.max(-1, Math.min(1, f * S.ffbStrength)), S.ffbInvert);
    this._leds();
  }

  // Rumble for Xbox / PlayStation controllers (Gamepad API vibration).
  _rumble(dt, inp) {
    const S = this.settings, car = this.car;
    const pad = inp.source === 'pad' && S.rumble !== false ? this.input.standardPad() : null;
    const act = pad?.vibrationActuator;
    if (!act) {
      if (this.rumbling) this._stopRumble();
      return;
    }
    this.rumbleT = (this.rumbleT || 0) - dt;
    if (this.rumbleT > 0) return;
    this.rumbleT = 0.06;
    const speed = car.speed;
    const k = S.ffbEffects ?? 0.7;
    let strong = Math.min(1, Math.abs(this.ffbJolt) * 1.4);
    let weak = 0;
    if (this.onGrass && speed > 2) strong += 0.35 * Math.min(1, speed / 15);
    if (this.onKerb && speed > 2) weak += 0.55 * Math.min(1, speed / 12);
    if (this.absActive) weak += Math.sin(this.time * Math.PI * 2 * 6) > 0 ? 0.5 : 0.15;
    if (car.frontLock) weak += 0.5;
    if (Math.abs(car.rearSpin) > 1.5) strong += 0.3;
    if (car.limiterCut) weak += 0.25;
    if (this.ffbShift > 0) weak += 0.45;
    if (this.nitroOn) strong += 0.3;
    if (car.grinding) weak += 0.6;
    weak += 0.04 * Math.min(1, speed / 40);
    strong = Math.min(1, strong * k * 1.3);
    weak = Math.min(1, weak * k * 1.3);
    if (strong < 0.03 && weak < 0.03) {
      if (this.rumbling) this._stopRumble();
      return;
    }
    this.rumbling = true;
    act.playEffect?.('dual-rumble', { duration: 110, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => {});
  }

  _stopRumble() {
    this.rumbling = false;
    const act = this.input.standardPad()?.vibrationActuator;
    try { act?.reset?.()?.catch?.(() => {}); } catch (e) { /* ignore */ }
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
    const staged = this.drag && this.drag.you.left === null;
    if (this.state !== 'countdown' && !staged && car.speed < 1 && inp.throttle > 0.5) this.stuckTimer += dt; else this.stuckTimer = 0;
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
