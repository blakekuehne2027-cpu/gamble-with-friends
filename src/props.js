// Things to crash into in the sandbox: cones, barrels, crates, bowling pins,
// concrete barriers and parked cars. Light props fly when you hit them;
// heavy ones stop you (and dent the car).

import * as THREE from 'three';
import { CarModel } from './carModel.js';
import { CarDamage } from './damage.js';
import { findCar, PAINT_COLORS } from './cars.js';

const G = 9.81;
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _r = new THREE.Vector3(), _a = new THREE.Vector3(), _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const TYPES = {
  cone: { mass: 4, hx: 0.2, hy: 0.37, hz: 0.2, e: 0.35, sound: 'plastic' },
  barrel: { mass: 24, hx: 0.32, hy: 0.45, hz: 0.32, e: 0.3, sound: 'metal' },
  crate: { mass: 30, hx: 0.45, hy: 0.45, hz: 0.45, e: 0.2, sound: 'wood' },
  pin: { mass: 6, hx: 0.17, hy: 0.62, hz: 0.17, e: 0.35, sound: 'wood' },
  barrier: { mass: 900, hx: 1.1, hy: 0.42, hz: 0.3, e: 0.1, sound: 'concrete' },
};

let _geo = null;
function geos() {
  if (_geo) return _geo;
  const cone = new THREE.ConeGeometry(0.2, 0.7, 14).translate(0, 0.0, 0);
  const coneBase = new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, -0.35, 0);
  const pin = new THREE.LatheGeometry([
    [0, -0.62], [0.12, -0.6], [0.17, -0.35], [0.15, -0.05], [0.08, 0.15], [0.07, 0.28], [0.1, 0.42], [0.09, 0.56], [0, 0.62],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 14);
  _geo = {
    cone, coneBase, pin,
    barrel: new THREE.CylinderGeometry(0.32, 0.32, 0.9, 16),
    crate: new THREE.BoxGeometry(0.9, 0.9, 0.9),
    barrier: (() => {
      const s = new THREE.Shape();
      s.moveTo(-0.3, -0.42); s.lineTo(0.3, -0.42); s.lineTo(0.22, -0.2); s.lineTo(0.1, 0.42); s.lineTo(-0.1, 0.42); s.lineTo(-0.22, -0.2); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 2.2, bevelEnabled: false });
      g.translate(0, 0, -1.1);
      g.rotateY(Math.PI / 2);
      return g;
    })(),
  };
  return _geo;
}

function makeMesh(type) {
  const g = geos();
  const grp = new THREE.Group();
  const add = (geo, color, opts = {}) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts }));
    m.castShadow = true;
    grp.add(m);
    return m;
  };
  if (type === 'cone') {
    add(g.cone, 0xff6a13);
    add(g.coneBase, 0x222222);
    const band = add(new THREE.CylinderGeometry(0.105, 0.135, 0.1, 14), 0xffffff, { emissive: 0x333333 });
    band.position.y = 0.02;
  } else if (type === 'barrel') {
    add(g.barrel, Math.random() < 0.5 ? 0x1d4ed8 : 0xc2410c, { metalness: 0.4, roughness: 0.45 });
  } else if (type === 'crate') {
    add(g.crate, 0xa47a3e, { roughness: 0.9 });
  } else if (type === 'pin') {
    add(g.pin, 0xf5f5f0, { roughness: 0.35 });
    const stripe = add(new THREE.CylinderGeometry(0.081, 0.081, 0.05, 14), 0xd61f26);
    stripe.position.y = 0.33;
  } else if (type === 'barrier') {
    add(g.barrier, 0xb9b6ae, { roughness: 0.95 });
  }
  return grp;
}

// A small rigid box resting on the ground.
class Prop {
  constructor(type, x, y, z, heading) {
    const t = TYPES[type];
    this.type = type;
    this.t = t;
    this.mass = t.mass;
    this.he = new THREE.Vector3(t.hx, t.hy, t.hz);
    const m = t.mass;
    this.I = new THREE.Vector3(m * (t.hy * t.hy + t.hz * t.hz) / 3, m * (t.hx * t.hx + t.hz * t.hz) / 3, m * (t.hx * t.hx + t.hy * t.hy) / 3);
    this.home = { x, y: y + t.hy, z, heading };
    this.mesh = makeMesh(type);
    this.p = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.w = new THREE.Vector3();
    this.reset();
  }

  reset() {
    const h = this.home;
    this.p.set(h.x, h.y, h.z);
    this.q.setFromAxisAngle(UP, h.heading);
    this.v.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.sleep = true;
    this.still = 0;
    this.sync();
  }

  get radius() { return Math.max(this.he.x, this.he.z); }
  get down() { return _v.copy(UP).applyQuaternion(this.q).y < 0.6; }

  sync() {
    this.mesh.position.copy(this.p);
    this.mesh.quaternion.copy(this.q);
  }

  _iinv(vIn, out) {
    _q.copy(this.q).invert();
    out.copy(vIn).applyQuaternion(_q);
    out.set(out.x / this.I.x, out.y / this.I.y, out.z / this.I.z);
    return out.applyQuaternion(this.q);
  }

  applyImpulse(J, at) {
    this.v.addScaledVector(J, 1 / this.mass);
    _r.subVectors(at, this.p);
    this.w.add(this._iinv(_a.crossVectors(_r, J), _a));
    this.sleep = false;
    this.still = 0;
  }

  step(h, ground) {
    if (this.sleep) return;
    this.v.y -= G * h;
    let maxPen = 0;
    const he = this.he;
    for (let i = 0; i < 8; i++) {
      _r.set(i & 1 ? he.x : -he.x, i & 2 ? he.y : -he.y, i & 4 ? he.z : -he.z).applyQuaternion(this.q);
      const px = this.p.x + _r.x, py = this.p.y + _r.y, pz = this.p.z + _r.z;
      const g = ground(px, pz, py);
      const pen = g - py;
      if (pen <= 0) continue;
      maxPen = Math.max(maxPen, pen);
      _v.crossVectors(this.w, _r).add(this.v);
      const vn = _v.y;
      if (vn < 0) {
        const kn = 1 / this.mass + _n.set(0, 1, 0).dot(this._iinv(_a.crossVectors(_r, _n), _a).cross(_r));
        const jn = (-(1 + (vn < -1.5 ? this.t.e : 0)) * vn) / kn;
        this.v.y += jn / this.mass;
        this.w.add(this._iinv(_a.set(-_r.z * jn, 0, _r.x * jn), _a)); // r × (0, jn, 0)
        // Friction.
        _v.crossVectors(this.w, _r).add(this.v);
        const vt = Math.hypot(_v.x, _v.z);
        if (vt > 1e-4) {
          const jt = Math.min(vt * this.mass * 0.25, 0.6 * jn);
          const fx = (-_v.x / vt) * jt, fz = (-_v.z / vt) * jt;
          this.v.x += fx / this.mass; this.v.z += fz / this.mass;
          this.w.add(this._iinv(_a.set(_r.y * fz, _r.z * fx - _r.x * fz, -_r.y * fx), _a));
        }
      }
    }
    if (maxPen > 0) this.p.y += maxPen * 0.5;
    this.p.addScaledVector(this.v, h);
    _q.set(this.w.x * h * 0.5, this.w.y * h * 0.5, this.w.z * h * 0.5, 0).multiply(this.q);
    this.q.set(this.q.x + _q.x, this.q.y + _q.y, this.q.z + _q.z, this.q.w + _q.w).normalize();
    this.w.multiplyScalar(1 - h * 0.4);
    if (this.v.lengthSq() < 0.04 && this.w.lengthSq() < 0.05 && maxPen > 0) this.still += h; else this.still = 0;
    if (this.still > 0.6) { this.sleep = true; this.v.set(0, 0, 0); this.w.set(0, 0, 0); }
  }
}

// A parked car that can be shunted around (and dented).
export class ParkedCar {
  constructor(scene, carId, color, x, z, heading, damageMode) {
    this.spec = findCar(carId);
    this.model = new CarModel(this.spec, color, { number: null });
    scene.add(this.model.root);
    this.damage = new CarDamage(this.model, this.spec, damageMode === 'off' ? 'off' : 'visual');
    this.home = { x, z, heading };
    this.reset();
  }

  reset() {
    this.x = this.home.x; this.z = this.home.z; this.psi = this.home.heading;
    this.vx = 0; this.vz = 0; this.r = 0;
    this.damage.repair();
  }

  get mass() { return this.spec.mass; }

  velocityAt(px, pz) {
    return { x: this.vx + this.r * (pz - this.z), z: this.vz - this.r * (px - this.x) };
  }

  applyImpulse(jx, jz, px, pz) {
    this.vx += jx / this.mass;
    this.vz += jz / this.mass;
    const rx = px - this.x, rz = pz - this.z;
    this.r += (rz * jx - rx * jz) / this.spec.inertia;
  }

  update(dt, ground) {
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);
    // Tyres: roll easily forwards, grip sideways.
    let u = this.vx * sp + this.vz * cp, v = this.vx * cp - this.vz * sp;
    const dec = (val, a) => (Math.abs(val) <= a * dt ? 0 : val - Math.sign(val) * a * dt);
    u = dec(u, 2.5);
    v = dec(v, 8);
    this.vx = u * sp + v * cp;
    this.vz = u * cp - v * sp;
    this.r = dec(this.r, 2.5);
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.psi += this.r * dt;
    const m = this.model;
    m.root.position.set(this.x, ground(this.x, this.z, Infinity), this.z);
    m.root.rotation.set(0, this.psi, 0);
    m.update(dt, { lights: false });
  }
}

// The player's car against parked/traffic cars (two circles per car, like the
// race cars). onHit(sev, x, z, nx, nz, 'car', speed, otherCar).
export function collideParked(car, carY, cars, onHit) {
  const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
  const R = 1.05;
  for (const pc of cars) {
    const dx0 = pc.x - car.x, dz0 = pc.z - car.z;
    if (dx0 * dx0 + dz0 * dz0 > 49) continue;
    if (carY > pc.model.root.position.y + 1.25) continue; // flying over it
    let best = null;
    for (const po of [1.15, -1.15]) {
      const px = car.x + sp * po, pz = car.z + cp * po;
      for (const ao of [1.15, -1.15]) {
        const ax = pc.x + Math.sin(pc.psi) * ao, az = pc.z + Math.cos(pc.psi) * ao;
        const ddx = px - ax, ddz = pz - az, d = Math.hypot(ddx, ddz);
        const pen = 2 * R - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: ddx / (d || 1), nz: ddz / (d || 1), px, pz };
      }
    }
    if (!best) continue;
    const { pen, nx, nz } = best;
    const wx = best.px - nx * R, wz = best.pz - nz * R;
    car.x += nx * pen * 0.5; car.z += nz * pen * 0.5;
    pc.x -= nx * pen * 0.5; pc.z -= nz * pen * 0.5;
    const va = car.velocityAt(wx, wz), vb = pc.velocityAt(wx, wz);
    const vn = (va.x - vb.x) * nx + (va.z - vb.z) * nz;
    if (vn >= 0) continue;
    const J = (-(1.25) * vn) / (1 / car.spec.mass + 1 / pc.mass);
    car.applyImpulse(nx * J, nz * J, wx, wz);
    pc.applyImpulse(-nx * J, -nz * J, wx, wz);
    pc.hit?.(-vn);
    pc.model.root.updateMatrixWorld(true);
    pc.damage.impact(wx, carY + 0.45, wz, -nx, -nz, -vn);
    onHit(-vn, wx, wz, nx, nz, 'car', -vn, pc);
  }
}

export class Props {
  constructor(scene, ground, damageMode = 'full') {
    this.scene = scene;
    this.ground = ground;
    this.items = [];
    this.cars = [];
    this.damageMode = damageMode;
    this.bowl = null; // { pins, timer, scored }
    this.events = [];
  }

  add(type, x, z, heading = 0) {
    const pr = new Prop(type, x, this.ground(x, z, Infinity), z, heading);
    this.scene.add(pr.mesh);
    this.items.push(pr);
    return pr;
  }

  addCar(carId, color, x, z, heading) {
    const c = new ParkedCar(this.scene, carId, color, x, z, heading, this.damageMode);
    this.cars.push(c);
    return c;
  }

  // The sandbox layout.
  populate() {
    // Slalom cones down the runway.
    for (let i = 0; i < 12; i++) this.add('cone', 40 + i * 20, -250 + (i % 2 ? 3.5 : -3.5));
    // A wall of barrels to plough through.
    for (let row = 0; row < 3; row++) for (let k = 0; k < 9; k++) this.add('barrel', 330 + row * 0.75, -256 + k * 0.72 + (row % 2) * 0.36);
    // Concrete barriers before the crash wall.
    for (let k = 0; k < 5; k++) this.add('barrier', 470, -256 + k * 2.4, Math.PI / 2);
    // Parked cars at the end of the runway and in the stunt park jump.
    const cols = [PAINT_COLORS[0], PAINT_COLORS[2], PAINT_COLORS[5], PAINT_COLORS[7], PAINT_COLORS[9]];
    ['rookie', 'vortex', 'titan'].forEach((id, k) => this.addCar(id, cols[k], 505, -256 + k * 5, 0));
    ['rookie', 'raptor', 'vortex', 'titan', 'rookie'].forEach((id, k) => this.addCar(id, cols[k], -140, -36 + k * 7.5, Math.PI / 2));
    // Crates in the stunt park.
    for (let k = 0; k < 10; k++) this.add('crate', -200 + (k % 5) * 1.0, 120 + Math.floor(k / 5) * 1.0);
    // Bowling: ten pins in a triangle after the little kicker.
    const pins = [];
    const px = -380, pz = 175;
    for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) pins.push(this.add('pin', px + (k - row / 2) * 1.25, pz + row * 1.1));
    this.bowl = { pins, timer: 0, scored: false };
  }

  reset() {
    for (const p of this.items) p.reset();
    for (const c of this.cars) c.reset();
    if (this.bowl) { this.bowl.timer = 0; this.bowl.scored = false; }
  }

  // car: CarPhysics; carY: base height; dims: { len, width, zOff }; onHit(sev, x, z, nx, nz, kind)
  update(dt, car, carY, dims, onHit) {
    const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
    const hl = dims.len / 2 + 0.05, hw = dims.width / 2 + 0.05;
    const cx = car.x + sp * dims.zOff, cz = car.z + cp * dims.zOff;
    for (const p of this.items) {
      const dx = p.p.x - cx, dz = p.p.z - cz;
      if (dx * dx + dz * dz > 25 || p.p.y < carY - 0.4 || p.p.y > carY + 1.8) continue;
      // Closest point of the car's footprint to the prop.
      const lz = dx * sp + dz * cp, lx = dx * cp - dz * sp;
      const clz = Math.max(-hl, Math.min(hl, lz)), clx = Math.max(-hw, Math.min(hw, lx));
      const ox = lx - clx, oz = lz - clz;
      const dist = Math.hypot(ox, oz);
      const rad = p.radius;
      if (dist > rad) continue;
      // World contact point and normal (car -> prop).
      const wx = cx + sp * clz + cp * clx, wz = cz + cp * clz - sp * clx;
      let nx, nz;
      if (dist > 1e-3) { nx = (ox * cp + oz * sp) / dist; nz = (oz * cp - ox * sp) / dist; } else { const l = Math.hypot(dx, dz) || 1; nx = dx / l; nz = dz / l; }
      const pen = rad - dist;
      p.p.x += nx * pen; p.p.z += nz * pen;
      const vc = car.velocityAt(wx, wz);
      const vn = (p.v.x - vc.x) * nx + (p.v.z - vc.z) * nz;
      if (vn >= 0) continue;
      const mCar = car.spec.mass;
      const J = (-(1 + p.t.e) * vn) / (1 / p.mass + 1 / mCar);
      _v.set(nx * J, Math.min(J * 0.35, p.mass * 6), nz * J);
      _r.set(wx, p.p.y + (Math.random() - 0.3) * p.he.y, wz);
      p.applyImpulse(_v, _r);
      car.applyImpulse(-nx * J, -nz * J, wx, wz);
      onHit(-vn * Math.min(1, p.mass / 600), wx, wz, -nx, -nz, p.t.sound, -vn);
    }
    collideParked(car, carY, this.cars, onHit);
    for (const pc of this.cars) pc.update(dt, this.ground);
    // Physics (two substeps) and pin-on-pin knocks.
    const h = dt / 2;
    for (let s = 0; s < 2; s++) for (const p of this.items) p.step(h, this.ground);
    this._pinKnocks();
    for (const p of this.items) if (!p.sleep) p.sync();
    this._bowling(dt);
  }

  _pinKnocks() {
    const its = this.items;
    for (let i = 0; i < its.length; i++) {
      const a = its[i];
      if (a.sleep) continue;
      for (let j = 0; j < its.length; j++) {
        if (i === j) continue;
        const b = its[j];
        const dx = b.p.x - a.p.x, dz = b.p.z - a.p.z, dy = b.p.y - a.p.y;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || Math.abs(dy) > a.he.y + b.he.y) continue;
        const d = Math.sqrt(d2) || 1e-3, nx = dx / d, nz = dz / d;
        const vn = (b.v.x - a.v.x) * nx + (b.v.z - a.v.z) * nz;
        if (vn >= 0) continue;
        const J = (-(1.3) * vn) / (1 / a.mass + 1 / b.mass);
        _v.set(nx * J, 0, nz * J);
        _r.set(a.p.x + nx * a.radius, a.p.y + a.he.y * 0.5, a.p.z + nz * a.radius);
        b.applyImpulse(_v, _r);
        a.applyImpulse(_v.multiplyScalar(-1), _r);
      }
    }
  }

  _bowling(dt) {
    const b = this.bowl;
    if (!b) return;
    const moving = b.pins.some((p) => !p.sleep);
    if (!b.scored && moving) b.timer = Math.max(b.timer, 0.001);
    if (b.timer > 0 && !b.scored) {
      b.timer += dt;
      if (b.timer > 3.5 && !moving) {
        b.scored = true;
        const down = b.pins.filter((p) => p.down || Math.hypot(p.p.x - p.home.x, p.p.z - p.home.z) > 1.5).length;
        this.events.push({ type: 'bowl', down });
        b.timer = 0.001;
      }
    } else if (b.scored) {
      b.timer += dt;
      if (b.timer > 8) {
        for (const p of b.pins) p.reset();
        b.scored = false;
        b.timer = 0;
      }
    }
  }

  dispose() {
    for (const p of this.items) this.scene.remove(p.mesh);
    for (const c of this.cars) { this.scene.remove(c.model.root); c.model.dispose(); }
    this.items = [];
    this.cars = [];
  }
}
