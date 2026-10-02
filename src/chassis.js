// Vertical car dynamics on top of the planar tyre model in physics.js:
//
//  * Chassis: heave, pitch and roll on four suspension springs that follow
//    the ground under each wheel. Wheels lose grip as they unload, so the car
//    can get airborne off crests and ramps and land again (hard landings
//    bottom out the suspension and can damage it).
//  * Tumble: when the car tips past ~55 degrees it becomes a free 3D rigid
//    body that bounces and rolls on the ground until it settles, upright or
//    not.
//
// Car local space (same as CarModel): +z forward, +x left, +y up.

import * as THREE from 'three';

const G = 9.81;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Chassis {
  constructor(spec) {
    this.spec = spec;
    const m = spec.mass;
    const tw = spec.track / 2;
    this.L = spec.a + spec.b;
    this.wheels = [
      { x: tw, z: spec.a }, { x: -tw, z: spec.a },
      { x: tw, z: -spec.b }, { x: -tw, z: -spec.b },
    ];
    const fF = (m * G * spec.b) / this.L / 2, fR = (m * G * spec.a) / this.L / 2;
    this.F0 = [fF, fF, fR, fR];
    const w = 2 * Math.PI * 1.6; // ride frequency
    this.k = (m * w * w) / 4;
    this.c = 2 * 0.42 * Math.sqrt((this.k * m) / 4);
    this.bump = 0.11; // suspension travel before the bump stops
    this.kb = this.k * 9;
    this.antiRoll = this.k * 1.1;
    const len = 4.5, wid = spec.track + 0.3, hgt = 1.2;
    this.Ip = (m * (len * len + hgt * hgt)) / 12 * 0.75;
    this.Ir = (m * (wid * wid + hgt * hgt)) / 12 * 0.75;
    this.prevG = [0, 0, 0, 0];
    this.reset(0);
  }

  reset(y) {
    this.y = y; this.vy = 0;
    this.pitch = 0; this.wp = 0; // nose-down positive
    this.roll = 0; this.wr = 0; // left side up positive
    this.contact = [1, 1, 1, 1];
    this.axle = [1, 1]; // front/rear: how loaded the axle is (an inside wheel lifting in a corner doesn't matter)
    this.comp = [0, 0, 0, 0]; // wheel offset from its rest position (+ = pushed up)
    this.airTime = 0;
    this.landing = 0; // closing speed of the last bump-stop hit
    this.bottomWheel = -1;
    this.groundSlope = 0;
    this.primed = false;
    this.airControl = 0; // throttle - brake, used in the air
    this.badLanding = false;
  }

  get airborne() {
    return this.axle[0] + this.axle[1] < 0.03;
  }

  get contactF() { return this.axle[0]; }
  get contactR() { return this.axle[1]; }

  // ground(x, z) -> height. car: CarPhysics (x, z, psi, ax, ay).
  step(h, car, ground) {
    const m = this.spec.mass, cg = this.spec.cgHeight;
    const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
    const sT = Math.sin(this.pitch), cT = Math.cos(this.pitch), sR = Math.sin(this.roll), cR = Math.cos(this.roll);
    let Fy = 0, Mp = 0, Mr = 0, gF = 0, gR = 0, sumF = 0, sumR = 0;
    const ext = [0, 0, 0, 0];
    const wasAir = this.airborne;
    let deep = 0, deepRel = 0;
    // Pass 1: where each corner sits relative to the ground.
    const rels = this._rels || (this._rels = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const wx = car.x + sp * w.z + cp * w.x, wz = car.z + cp * w.z - sp * w.x;
      const g = ground(wx, wz, this.y);
      if (!this.primed) this.prevG[i] = g;
      // Ground speed under the wheel (capped: a ramp edge is a step, not a speed).
      const gv = clamp((g - this.prevG[i]) / h, -25, 25);
      this.prevG[i] = g;
      if (i < 2) gF += g / 2; else gR += g / 2;
      const yi = this.y + w.x * sR * cT - w.z * sT;
      ext[i] = yi - g; // how far the chassis corner sits above its rest height
      const vi = this.vy + w.x * this.wr * cR - w.z * this.wp * cT;
      rels[i] = vi - gv;
    }
    // Pass 2: spring + damper + anti-roll bar per wheel. The bar moves load
    // from the extended side to the compressed side, but a wheel that has
    // left the ground can't be pulled down, so a car can still tip over.
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const e = ext[i], rel = rels[i];
      const other = ext[i ^ 1];
      const spring = this.F0[i] - this.k * e - this.antiRoll * (e - other) / 2;
      let F = spring > 0 ? spring - this.c * rel : 0;
      if (e < -this.bump) {
        // Bump stop: very stiff and well damped, and it hurts if you hit it
        // fast. Capped so a deep landing can't act like a catapult.
        F += Math.min(this.kb * (-this.bump - e) - this.c * 3 * rel, m * G * 1.5);
        if (-rel > this.landing) { this.landing = -rel; this.bottomWheel = i; }
        // Way past the bump stop (the ground came up through the wheel in one
        // step): treat it as a solid, inelastic contact.
        const d = -this.bump - 0.05 - e;
        if (d > deep) { deep = d; deepRel = rel; }
      }
      if (F < 0) F = 0;
      this.contact[i] = clamp(F / (0.25 * this.F0[i]), 0, 1);
      if (i < 2) sumF += F; else sumR += F;
      this.comp[i] = clamp(-e, -0.16, this.bump + 0.04);
      Fy += F;
      Mp += -F * w.z;
      Mr += F * w.x;
    }
    this.primed = true;
    this.axle[0] = clamp(sumF / (0.7 * this.F0[0]), 0, 1);
    this.axle[1] = clamp(sumR / (0.7 * this.F0[2]), 0, 1);
    // Weight transfer from braking/accelerating and cornering pitches and rolls the body.
    const grip = (this.axle[0] + this.axle[1]) / 2;
    Mp += -m * car.ax * cg * grip;
    Mr += m * car.ay * cg * grip;
    this.vy += (Fy / m - G) * h;
    this.y += this.vy * h;
    if (deep > 0) {
      this.y += deep * 0.6;
      if (deepRel < 0) this.vy -= deepRel * 0.8; // soak up the closing speed
    }
    this.wp += (Mp / this.Ip) * h;
    this.wr += (Mr / this.Ir) * h;
    if (grip < 0.05) {
      // In the air: a bit of damping, and throttle/brake spin the wheels,
      // which rotates the body the other way (nose up / nose down).
      this.wp *= 1 - h * 1.0; this.wr *= 1 - h * 1.0;
      this.wp -= this.airControl * 0.7 * h;
      this.airTime += h;
    } else this.airTime = 0;
    // Landing badly (nose first, on its side): let the rigid body take over.
    if (wasAir && grip > 0.05 && (Math.abs(this.pitch) > 0.6 || Math.abs(this.roll) > 0.6)) this.badLanding = true;
    this.pitch += this.wp * h;
    this.roll += this.wr * h;
    this.groundSlope = grip > 0.05 ? (gF - gR) / this.L : 0;
  }

  // Tipped over far enough that wheels can't hold it any more.
  get tipped() {
    return this.badLanding || Math.abs(this.roll) > 0.95 || Math.abs(this.pitch) > 0.95;
  }
}

const _r = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _m3 = new THREE.Matrix3();
const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _J = new THREE.Vector3(), _ws = new THREE.Vector3();

// Free 3D rigid body for crashes and rollovers.
export class Tumble {
  constructor(spec, style) {
    this.spec = spec;
    const m = spec.mass, cg = spec.cgHeight;
    const zOff = (spec.a - spec.b) / 2;
    const f = style.len / 2 + zOff, r = -style.len / 2 + zOff, hx = style.width / 2, cx = (style.width * style.cabinW) / 2;
    const P = (x, y, z, wheel = false) => ({ p: new THREE.Vector3(x, y - cg, z), wheel });
    this.points = [
      P(hx, style.bottom, f), P(-hx, style.bottom, f), P(hx, style.bottom, r), P(-hx, style.bottom, r),
      P(hx, style.hoodH, f - 0.5), P(-hx, style.hoodH, f - 0.5), P(hx, style.deckH, r + 0.3), P(-hx, style.deckH, r + 0.3),
      P(cx, style.roofH, style.roofFront + zOff), P(-cx, style.roofH, style.roofFront + zOff), P(cx, style.roofH, style.roofBack + zOff), P(-cx, style.roofH, style.roofBack + zOff),
      P(0, style.noseH * 0.6, f + 0.02), P(0, style.tailH - 0.2, r - 0.02), P(hx, style.hoodH * 0.7, zOff), P(-hx, style.hoodH * 0.7, zOff),
      P(spec.track / 2, 0, spec.a, true), P(-spec.track / 2, 0, spec.a, true), P(spec.track / 2, 0, -spec.b, true), P(-spec.track / 2, 0, -spec.b, true),
    ];
    const len = style.len, wid = style.width, hgt = style.roofH;
    this.I = new THREE.Vector3((m * (len * len + hgt * hgt)) / 12, spec.inertia, (m * (wid * wid + hgt * hgt)) / 12);
    this.X = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.V = new THREE.Vector3();
    this.W = new THREE.Vector3();
    this.active = false;
    this.rest = 0;
    this.hits = []; // { p (world), n (world, into car), speed }
    this.wheelsOn = 0;
  }

  start(X, q, V, W) {
    this.X.copy(X); this.q.copy(q); this.V.copy(V); this.W.copy(W);
    this.active = true;
    this.rest = 0;
  }

  get up() { return _up.set(0, 1, 0).applyQuaternion(this.q); }
  get forward() { return _fwd.set(0, 0, 1).applyQuaternion(this.q); }

  // World-space inverse inertia applied to a vector.
  _iinv(vIn, out) {
    _q.copy(this.q).invert();
    out.copy(vIn).applyQuaternion(_q);
    out.set(out.x / this.I.x, out.y / this.I.y, out.z / this.I.z);
    return out.applyQuaternion(this.q);
  }

  // ground(x, z) -> height; wall(x, z) -> null | { x, z, nx, nz }
  step(h, ground, wall, liftWheels = []) {
    const m = this.spec.mass;
    this.h = h;
    this.V.y -= G * h;
    let maxPen = 0;
    this.wheelsOn = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (let k = 0; k < this.points.length; k++) {
        const pt = this.points[k];
        if (pt.wheel && liftWheels[k - 16]) continue;
        _r.copy(pt.p).applyQuaternion(this.q);
        const px = this.X.x + _r.x, py = this.X.y + _r.y, pz = this.X.z + _r.z;
        // Walls.
        const wl = wall(px, pz, py);
        if (wl) {
          _n.set(wl.nx, 0, wl.nz);
          this.X.x += wl.x - px; this.X.z += wl.z - pz;
          this._impulse(_r, _n, 0.25, 0.4, iter === 0, px, py, pz);
        }
        const g = ground(px, pz, py);
        const pen = g - py;
        if (pen <= 0) continue;
        if (pt.wheel && iter === 0) this.wheelsOn++;
        if (pen > maxPen) maxPen = pen;
        // Ground normal from nearby samples.
        const d = 0.6;
        _n.set(ground(px - d, pz, py) - ground(px + d, pz, py), 2 * d, ground(px, pz - d, py) - ground(px, pz + d, py)).normalize();
        if (pt.wheel) {
          // Tyres roll along the car's heading but grip sideways.
          this._wheelImpulse(_r, _n, iter === 0, px, py, pz);
        } else {
          this._impulse(_r, _n, 0.18, 0.55, iter === 0, px, py, pz);
        }
      }
    }
    if (maxPen > 0) this.X.y += maxPen * 0.35;
    this.X.addScaledVector(this.V, h);
    // Integrate orientation.
    const w = this.W;
    _q.set(w.x * h * 0.5, w.y * h * 0.5, w.z * h * 0.5, 0).multiply(this.q);
    this.q.set(this.q.x + _q.x, this.q.y + _q.y, this.q.z + _q.z, this.q.w + _q.w).normalize();
    // Settle detection.
    if (this.V.lengthSq() < 0.25 && this.W.lengthSq() < 0.2) this.rest += h; else this.rest = 0;
    void m;
  }

  _impulse(r, n, e, mu, record, px, py, pz) {
    const m = this.spec.mass;
    _v.crossVectors(this.W, r).add(this.V);
    const vn = _v.dot(n);
    if (vn >= 0) return;
    _a.crossVectors(r, n);
    this._iinv(_a, _b);
    const kn = 1 / m + n.dot(_b.cross(r));
    const jn = (-(1 + (vn < -2 ? e : 0)) * vn) / kn;
    this._apply(r, _t.copy(n).multiplyScalar(jn));
    if (record && -vn > 2.5) this.hits.push({ x: px, y: py, z: pz, nx: n.x, ny: n.y, nz: n.z, speed: -vn });
    // Friction.
    _v.crossVectors(this.W, r).add(this.V);
    _t.copy(_v).addScaledVector(n, -_v.dot(n));
    const vt = _t.length();
    if (vt < 1e-4) return;
    _t.multiplyScalar(1 / vt);
    _a.crossVectors(r, _t);
    this._iinv(_a, _b);
    const kt = 1 / m + _t.dot(_b.cross(r));
    const jt = Math.min(vt / kt, mu * jn);
    this._apply(r, _t.multiplyScalar(-jt));
  }

  _wheelImpulse(r, n, record, px, py, pz) {
    const m = this.spec.mass;
    _v.crossVectors(this.W, r).add(this.V);
    const vn = _v.dot(n);
    if (vn < 0) {
      _a.crossVectors(r, n);
      this._iinv(_a, _b);
      const kn = 1 / m + n.dot(_b.cross(r));
      const jn = (-vn * 1.05) / kn;
      this._apply(r, _t.copy(n).multiplyScalar(jn));
      if (record && -vn > 5) this.hits.push({ x: px, y: py, z: pz, nx: n.x, ny: n.y, nz: n.z, speed: -vn * 0.6 });
    }
    // Sideways grip only (rolling resistance is tiny).
    _v.crossVectors(this.W, r).add(this.V);
    const side = _a.set(1, 0, 0).applyQuaternion(this.q);
    side.addScaledVector(n, -side.dot(n)).normalize();
    const vs = _v.dot(side);
    _b.crossVectors(r, side);
    const tmp = this._iinv(_b, _ws);
    const ks = 1 / m + side.dot(tmp.cross(r));
    const budget = m * G * 0.25 * 1.1 * this.h; // about one wheel's share of grip per step
    const js = clamp(-vs / ks, -budget, budget);
    this._apply(r, side.multiplyScalar(js));
  }

  _apply(r, Jin) {
    const J = _J.copy(Jin);
    this.V.addScaledVector(J, 1 / this.spec.mass);
    _a.crossVectors(r, J);
    this.W.add(this._iinv(_a, _b));
  }

  // Back on four wheels and calm enough to drive again?
  get canDrive() {
    return this.up.y > 0.85 && this.wheelsOn >= 3 && this.W.length() < 1.6 && Math.abs(this.V.y) < 2.5;
  }

  get upsideDown() {
    return this.up.y < 0.3;
  }
}
