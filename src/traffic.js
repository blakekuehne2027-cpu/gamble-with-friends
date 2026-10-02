// Road traffic for free roam: everyday cars cruising the ring road in both
// directions, keeping their lane and slowing for whatever is ahead. Hit one
// hard enough and it stops being traffic and becomes a wreck you shove about.

import { ParkedCar, collideParked } from './props.js';
import { PAINT_COLORS } from './cars.js';

const LANE = 3.4;
const MODELS = ['rookie', 'rookie', 'vortex', 'hauler', 'titan', 'raptor', 'hauler', 'rookie'];
const DULL = [0xd9d9d9, 0x2b2d31, 0x8d939b, 0x7a1f1f, 0x1e3a5f, 0xece6d6, 0x3f4f2f, 0x9a3412, 0x5b5b5b];

class TrafficCar extends ParkedCar {
  constructor(scene, track, ground, carId, color, s, dir, damageMode) {
    const p = track.pointAt(s, -dir * LANE);
    super(scene, carId, color, p.x, p.z, p.heading + (dir < 0 ? Math.PI : 0), damageMode);
    this.track = track;
    this.s = s;
    this.dir = dir;
    this.d = -dir * LANE;
    this.cruise = 13 + Math.random() * 9;
    this.v = this.cruise;
    this.wrecked = false;
    this._pt = {};
  }

  // A hard knock ends its journey.
  hit(speed) {
    if (speed > 2.5) this.wrecked = true;
  }

  drive(dt, ahead) {
    // Slow down for the car in front, speed back up when the lane is clear.
    let target = this.cruise;
    if (ahead < 40) target = Math.min(target, Math.max(0, (ahead - 8) * 0.6));
    this.v = Math.max(0, this.v + Math.max(-6 * dt, Math.min(2.2 * dt, target - this.v)));
    this.s = this.track.wrapS(this.s + this.dir * this.v * dt);
    const p = this.track.pointAt(this.s, this.d, this._pt);
    this.x = p.x; this.z = p.z;
    this.psi = p.heading + (this.dir < 0 ? Math.PI : 0);
    // Keep velocity fields current so collisions see a moving car.
    this.vx = Math.sin(this.psi) * this.v;
    this.vz = Math.cos(this.psi) * this.v;
    this.r = 0;
  }
}

export class Traffic {
  constructor(scene, track, ground, damageMode = 'full', count = 14) {
    this.scene = scene;
    this.track = track;
    this.ground = ground;
    this.cars = [];
    for (let i = 0; i < count; i++) {
      const dir = i % 2 ? 1 : -1;
      const s = (i / count) * track.length + Math.random() * 40;
      const id = MODELS[i % MODELS.length];
      const col = DULL[(i * 5) % DULL.length] ?? PAINT_COLORS[0];
      this.cars.push(new TrafficCar(scene, track, ground, id, col, s, dir, damageMode));
    }
  }

  // Distance along the road to the nearest thing ahead of traffic car c in its lane.
  _ahead(c, player) {
    const L = this.track.length;
    let best = Infinity;
    const gap = (s) => {
      let d = (s - c.s) * c.dir;
      if (d < 0) d += L;
      return d;
    };
    for (const o of this.cars) {
      if (o === c || o.wrecked || o.dir !== c.dir) continue;
      const g = gap(o.s);
      if (g > 0.5 && g < best) best = g;
    }
    // Wrecks block whichever lane they're sitting in.
    for (const w of this._wrecks) {
      if (Math.abs(w.d - c.d) > 2.6) continue;
      const g = gap(w.s);
      if (g > 0.5 && g < best) best = g;
    }
    if (player) {
      const pp = player.pos;
      if (Math.abs(pp.d - c.d) < 2.6) {
        const g = gap(pp.s);
        if (g > 0.5 && g < best) best = g;
      }
    }
    return best;
  }

  // car: CarPhysics; player: { pos: { s, d } } on the road (or null)
  update(dt, car, carY, player, onHit) {
    this._wrecks = [];
    for (const o of this.cars) {
      if (!o.wrecked) continue;
      const p = this.track.project(o.x, o.z, o.hint ?? -1, o._proj || (o._proj = {}));
      o.hint = p.i;
      this._wrecks.push({ s: p.s, d: p.d });
    }
    for (const c of this.cars) {
      if (c.wrecked) continue;
      c.drive(dt, this._ahead(c, player));
    }
    collideParked(car, carY, this.cars, onHit);
    for (const c of this.cars) {
      // Don't draw cars far from the player.
      const far = (c.x - car.x) ** 2 + (c.z - car.z) ** 2 > 350 * 350;
      c.model.root.visible = !far;
      if (c.wrecked) c.update(dt, this.ground);
      else if (!far) {
        const m = c.model;
        m.root.position.set(c.x, this.ground(c.x, c.z, Infinity), c.z);
        m.root.rotation.set(0, c.psi, 0);
        c.spin = (c.spin || 0) + (c.v / c.spec.wheelRadius) * dt;
        m.update(dt, { steerRoad: 0, spinFront: c.spin, spinRear: c.spin, braking: c.v < c.cruise - 2, lights: this.night });
      }
    }
  }

  reset() {
    for (const c of this.cars) {
      c.damage.repair();
      c.wrecked = false;
      c.v = c.cruise;
    }
  }

  dispose() {
    for (const c of this.cars) { this.scene.remove(c.model.root); c.model.dispose(); }
    this.cars = [];
  }
}
