// Race replays: records every car at 30 Hz during a session and plays it
// back with TV-style trackside cameras, chase, helicopter and bumper cams.

import * as THREE from 'three';

const RATE = 1 / 30;
const P = 13; // floats per player frame
const A = 7; // floats per other car
export const REPLAY_CAMS = ['tv', 'chase', 'heli', 'bumper'];
const CAM_NAMES = { tv: 'TV CAMERAS', chase: 'CHASE', heli: 'HELICOPTER', bumper: 'BUMPER' };

const wrapPi = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class ReplayRecorder {
  constructor() {
    this.frames = [];
    this.acc = 0;
  }

  // Others: array of { x, y, z, psi, steer, spin, braking }.
  record(dt, game) {
    this.acc += dt;
    if (this.acc < RATE) return;
    this.acc %= RATE;
    const c = game.car, m = game.model;
    const others = game._replayOthers();
    const f = new Float32Array(1 + P + others.length * A);
    f[0] = game.time;
    f.set([c.x, game.carY, c.z, c.psi, m.root.rotation.x, m.body.rotation.x, m.body.rotation.z, c.delta,
      m.wheels[0].spin.rotation.x, m.wheels[2].spin.rotation.x, (game.input.state.brake > 0.05 ? 1 : 0) | (game.nitroOn ? 2 : 0), c.rpm, c.throttleEff], 1);
    others.forEach((o, i) => f.set([o.x, o.y, o.z, o.psi, o.steer, o.spin, o.braking ? 1 : 0], 1 + P + i * A));
    this.frames.push(f);
  }

  // Rewind support: forget frames after time t.
  truncate(t) {
    while (this.frames.length && this.frames[this.frames.length - 1][0] > t) this.frames.pop();
  }
}

export class ReplayPlayer {
  constructor(game, frames) {
    this.game = game;
    this.frames = frames;
    this.t0 = frames[0][0];
    this.duration = frames[frames.length - 1][0] - this.t0;
    this.t = 0;
    this.playing = true;
    this.camMode = 0;
    this.autoCam = true;
    this.camTimer = 0;
    this.spot = null;
    this.idx = 0;
    this.snap = true;
    // Trackside TV camera positions on the outside of corners.
    const tr = game.track;
    this.spots = [];
    for (let s = 0; s < tr.length; s += 110) {
      const curv = tr.sampleArray(tr.curv, s + 40);
      const side = curv > 0 ? -1 : 1; // outside of the next bend
      const q = tr.pointAt(s, side * (tr.wallDist + 6));
      this.spots.push({ s, x: q.x, y: q.h + 4 + (s % 330 < 110 ? 4 : 0), z: q.z });
    }
    this.camPos = new THREE.Vector3();
    this.look = new THREE.Vector3();
  }

  get camName() {
    return (this.autoCam ? 'AUTO · ' : '') + CAM_NAMES[REPLAY_CAMS[this.camMode]];
  }

  seek(dt) {
    this.t = Math.max(0, Math.min(this.duration, this.t + dt));
    this.spot = null;
    this.snap = true;
  }

  cycleCam() {
    if (this.autoCam) { this.autoCam = false; this.camMode = 0; } else if (this.camMode === REPLAY_CAMS.length - 1) { this.autoCam = true; } else this.camMode++;
    this.spot = null;
    this.snap = true;
  }

  // Interpolated frame at replay time t.
  _frame() {
    const F = this.frames, T = this.t0 + this.t;
    let i = Math.min(this.idx, F.length - 2);
    while (i > 0 && F[i][0] > T) i--;
    while (i < F.length - 2 && F[i + 1][0] < T) i++;
    this.idx = i;
    const a = F[i], b = F[i + 1];
    const k = Math.max(0, Math.min(1, (T - a[0]) / Math.max(1e-6, b[0] - a[0])));
    return { a, b, k };
  }

  update(dt) {
    const g = this.game;
    if (this.playing) {
      this.t += dt;
      if (this.t >= this.duration) { this.t = this.duration; this.playing = false; }
    }
    if (this.autoCam) {
      this.camTimer += dt;
      if (this.camTimer > 9) {
        this.camTimer = 0;
        this.camMode = [0, 1, 0, 2, 0, 3][(Math.floor(this.t / 9) + 1) % 6];
        this.spot = null;
        this.snap = true;
      }
    }
    const { a, b, k } = this._frame();
    const L = (j) => a[j] + (b[j] - a[j]) * k;
    const Lang = (j) => a[j] + wrapPi(b[j] - a[j]) * k;
    // Player car.
    const m = g.model;
    const px = L(1), py = L(2), pz = L(3), psi = Lang(4);
    m.root.position.set(px, py, pz);
    m.root.rotation.set(L(5), psi, 0, 'YXZ');
    const flags = a[11];
    m.update(dt, { steerRoad: L(8), spinFront: L(9), spinRear: L(10), braking: !!(flags & 1), pitch: L(6), roll: L(7), wheelDeg: 0, lights: g.night });
    m.setNitro(!!(flags & 2), g.time);
    // Other cars.
    const models = g._replayModels();
    models.forEach((om, i) => {
      const o = 1 + P + i * A;
      if (o + A > a.length) { om.root.visible = false; return; }
      om.root.visible = true;
      om.root.position.set(L(o), L(o + 1), L(o + 2));
      om.root.rotation.set(0, Lang(o + 3), 0, 'YXZ');
      om.update(dt, { steerRoad: L(o + 4), spinFront: L(o + 5), spinRear: L(o + 5), braking: a[o + 6] > 0.5, pitch: 0, roll: 0, lights: g.night });
    });
    this._camera(dt, px, py, pz, psi);
    g.world.update(g._v.set(px, py, pz), g.camera);
    const speed = Math.hypot(b[1] - a[1], b[3] - a[3]) / Math.max(1e-3, b[0] - a[0]);
    if (this.playing) g.audio.update({ rpm: L(12), throttle: L(13), engineOn: true, speed, slip: 0, onAsphalt: true, rain: g.rain, nitro: !!(flags & 2) });
    else g.audio.update({ paused: true });
    g.particles.update(dt);
    g.rainFx?.update(dt, g.camera.position, 0, 0);
  }

  _camera(dt, x, y, z, psi) {
    const cam = this.game.camera, tr = this.game.track;
    const mode = REPLAY_CAMS[this.camMode];
    const fwdX = Math.sin(psi), fwdZ = Math.cos(psi);
    if (mode === 'tv') {
      const s = tr.project(x, z, -1).s;
      const ahead = (sp) => { let d = sp.s - s; if (d < -tr.length / 2) d += tr.length; if (d > tr.length / 2) d -= tr.length; return d; };
      if (!this.spot || ahead(this.spot) < -45) {
        let best = null;
        for (const sp of this.spots) {
          const d = ahead(sp);
          if (d > -20 && d < 160 && (!best || d < ahead(best))) best = sp;
        }
        this.spot = best || this.spots[0];
      }
      cam.position.set(this.spot.x, this.spot.y, this.spot.z);
      cam.lookAt(x, y + 0.8, z);
      const dist = Math.hypot(x - this.spot.x, z - this.spot.z);
      cam.fov = Math.max(6, Math.min(55, 2 * Math.atan(7 / Math.max(1, dist)) * 57.3));
    } else if (mode === 'chase') {
      this.camPos.set(x - fwdX * 7, y + 2.4, z - fwdZ * 7);
      if (this.snap) cam.position.copy(this.camPos);
      else cam.position.lerp(this.camPos, Math.min(1, dt * 6));
      cam.lookAt(x + fwdX * 3, y + 1, z + fwdZ * 3);
      cam.fov = 62;
    } else if (mode === 'heli') {
      const a = this.t * 0.15;
      cam.position.set(x + Math.cos(a) * 30, y + 22, z + Math.sin(a) * 30);
      cam.lookAt(x, y, z);
      cam.fov = 50;
    } else {
      cam.position.set(x + fwdX * 2.6, y + 0.45, z + fwdZ * 2.6);
      cam.lookAt(x + fwdX * 30, y + 0.4, z + fwdZ * 30);
      cam.fov = 70;
    }
    cam.updateProjectionMatrix();
    this.snap = false;
  }
}
