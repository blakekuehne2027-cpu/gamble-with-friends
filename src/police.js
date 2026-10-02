// Police chases for free roam: interceptors that hunt you down, try to ram
// you off the road and box you in. Lose them (get far enough away for long
// enough) to escape; stop with a cop on you for too long and you're busted.

import * as THREE from 'three';
import { CarPhysics, SURFACES } from './physics.js';
import { CarModel } from './carModel.js';
import { CarDamage } from './damage.js';
import { findCar } from './cars.js';
import { collideParked } from './props.js';

const STEP = 1 / 120;

class Cop {
  constructor(scene, x, z, heading, n) {
    const base = findCar('titan');
    // Pursuit-tuned: a touch less power than the Titan, more grip and brakes.
    this.spec = { ...base, name: 'Interceptor', mu: base.mu * 1.04, brakeForce: base.brakeForce * 1.1, torque: base.torque.map(([r, t]) => [r, t * 0.78]) };
    this.car = new CarPhysics(this.spec);
    this.car.reset(x, z, heading);
    this.car.gear = 1;
    this.model = new CarModel(this.spec, 0x0b0b0d, { number: null });
    // Light bar.
    const st = this.model.style;
    const bar = new THREE.Group();
    this.red = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 0 });
    this.blue = new THREE.MeshStandardMaterial({ color: 0x00103f, emissive: 0x1a5cff, emissiveIntensity: 0 });
    const half = new THREE.BoxGeometry(0.42, 0.1, 0.22);
    const l = new THREE.Mesh(half, this.red); l.position.x = 0.22;
    const r = new THREE.Mesh(half, this.blue); r.position.x = -0.22;
    bar.add(l, r);
    bar.position.set(0, st.roofH + 0.1, (st.roofFront + st.roofBack) / 2 + (this.spec.a - this.spec.b) / 2);
    this.model.body.add(bar);
    // White doors so it reads as a cop car.
    for (const p of this.model.parts) if (p.id === 'doorL' || p.id === 'doorR') p.obj.material = new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.35, clearcoat: 1 });
    scene.add(this.model.root);
    this.damage = new CarDamage(this.model, this.spec, 'full');
    this.car.dmg = this.damage.mods;
    this.n = n;
    this.stuck = 0;
    this.reverseT = 0;
    this.acc = 0;
    this.y = 0;
    this.hint = -1;
    this.side = n % 2 ? 1 : -1;
  }

  get out() { return this.damage.dead || this.damage.lost.filter(Boolean).length >= 2; }
}

export class Police {
  constructor(game, count = 3) {
    this.game = game;
    this.scene = game.scene;
    this.cops = [];
    this.state = 'chase'; // 'chase' | 'escaped' | 'busted'
    this.escapeT = 0;
    this.bustT = 0;
    this.time = 0;
    const g = game, c = g.car;
    // Spawn behind the player, spread out.
    for (let i = 0; i < count; i++) {
      const back = 110 + i * 35, side = (i - (count - 1) / 2) * 14;
      const sp = Math.sin(c.psi), cp = Math.cos(c.psi);
      let x = c.x - sp * back + cp * side, z = c.z - cp * back - sp * side;
      const wl = g._wallAt(x, z, g.groundAt(x, z) + 0.2);
      if (wl) { x = wl.x; z = wl.z; }
      this.cops.push(new Cop(this.scene, x, z, c.psi, i));
    }
  }

  get active() { return this.state === 'chase'; }

  nearest() {
    let best = Infinity;
    for (const k of this.cops) if (!k.out) best = Math.min(best, Math.hypot(k.car.x - this.game.car.x, k.car.z - this.game.car.z));
    return best;
  }

  _drive(k, dt) {
    const g = this.game, me = g.car, c = k.car;
    const dx = me.x - c.x, dz = me.z - c.z, dist = Math.hypot(dx, dz);
    // Aim where the player is going; up close, go for the rear quarter (PIT).
    const msp = Math.sin(me.psi), mcp = Math.cos(me.psi);
    const pvx = me.u * msp + me.v * mcp, pvz = me.u * mcp - me.v * msp;
    const lead = Math.min(1.4, dist / 35);
    let tx = me.x + pvx * lead, tz = me.z + pvz * lead;
    if (dist < 14) { tx += mcp * k.side * 1.2 - msp * 1.5; tz += -msp * k.side * 1.2 - mcp * 1.5; }
    let err = Math.atan2(tx - c.x, tz - c.z) - c.psi;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    let steer = Math.max(-1, Math.min(1, -err * 2.4 - c.r * 0.15));
    // Speed to arrive at: close in on the player, but able to stop next to
    // them (and slow for sharp turns).
    let vt = 75;
    if (dist < 120) vt = me.speed + Math.sqrt(2 * 6.5 * Math.max(0, dist - 8));
    if (Math.abs(err) > 0.6) vt = Math.min(vt, 22 / Math.abs(err));
    let throttle = c.u < vt ? (Math.abs(err) < 0.7 ? 1 : 0.5) : 0;
    let brake = c.u > vt + 2 ? Math.min(1, (c.u - vt) / 8) : 0;
    // Stuck against something: back out.
    if (c.speed < 1.2 && throttle > 0.5) k.stuck += dt; else k.stuck = Math.max(0, k.stuck - dt);
    if (k.stuck > 1.6) { k.reverseT = 1.4; k.stuck = 0; }
    if (k.reverseT > 0) {
      k.reverseT -= dt;
      steer = -steer;
      // Auto box: holding the brake at a standstill selects reverse; the
      // caller swaps pedals in reverse, like the player's car.
      return { steer, throttle: c.gear === -1 ? 0.8 : 0, brake: c.gear === -1 ? 0 : 1 };
    }
    return { steer, throttle, brake };
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    for (const k of this.cops) {
      const c = k.car;
      let ctl = this.state === 'chase' && !k.out ? this._drive(k, dt) : { steer: 0, throttle: 0, brake: 1 };
      let throttle = ctl.throttle, brake = ctl.brake;
      if (c.gear === -1) [throttle, brake] = [brake, throttle];
      c.updateTransmission(dt, { mode: 'auto', hGear: 0, shiftUp: false, shiftDown: false, clutch: 0, throttle, brake, autoClutch: true });
      // Surface under the car.
      const p = g.track.project(c.x, c.z, k.hint, k._p || (k._p = {}));
      k.hint = p.i;
      let s = g.track.surfaceAt(p.d, p.i, c.x, c.z);
      const sf = SURFACES[s] || SURFACES.asphalt;
      const env = { mu: sf.mu * g.wet, drag: sf.drag, slope: 0 };
      const inp = { throttle, brake, brakePressure: brake, clutch: 0, steer: ctl.steer, handbrake: false, nitro: false, autoClutch: true, abs: true, tc: true, stability: true };
      k.acc += dt;
      while (k.acc >= STEP) { c.step(STEP, inp, env); k.acc -= STEP; }
      k.damage.update(dt, c);
      // Walls, ramps and the map edge.
      const sp = Math.sin(c.psi), cp = Math.cos(c.psi);
      for (const [lz, lx] of [[2.2, 0.9], [2.2, -0.9], [-2.2, 0.9], [-2.2, -0.9]]) {
        const x = c.x + sp * lz + cp * lx, z = c.z + cp * lz - sp * lx;
        const wl = g._wallAt(x, z, k.y + 0.3);
        if (!wl) continue;
        c.x += wl.x - x; c.z += wl.z - z;
        const v = c.velocityAt(x, z);
        const vn = v.x * wl.nx + v.z * wl.nz;
        if (vn < 0) {
          const J = -1.25 * vn * k.spec.mass * 0.6;
          c.applyImpulse(wl.nx * J, wl.nz * J, x, z);
          k.model.root.updateMatrixWorld(true);
          k.damage.impact(x, k.y + 0.45, z, wl.nx, wl.nz, -vn);
        }
      }
      k.y = g.groundAt(c.x, c.z, k.y + 0.5);
    }
    // Cops against the player.
    const me = g.car;
    const asParked = this.cops.map((k) => ({
      get x() { return k.car.x; }, set x(v) { k.car.x = v; },
      get z() { return k.car.z; }, set z(v) { k.car.z = v; },
      get psi() { return k.car.psi; },
      mass: k.spec.mass, model: k.model, damage: k.damage,
      velocityAt: (x, z) => k.car.velocityAt(x, z),
      applyImpulse: (jx, jz, x, z) => k.car.applyImpulse(jx, jz, x, z),
      hit() {},
    }));
    if (!g.tumble.active) collideParked(me, g.carY, asParked, (sev, x, z, nx, nz, kind, speed) => g._copHit(sev, x, z, nx, nz, speed));
    // Cops against traffic and parked cars (they barge through).
    for (const k of this.cops) {
      if (g.traffic) collideParked(k.car, k.y, g.traffic.cars, () => {});
      if (g.props) collideParked(k.car, k.y, g.props.cars, () => {});
    }
    // Cops against each other.
    for (let i = 0; i < this.cops.length; i++) {
      for (let j = i + 1; j < this.cops.length; j++) {
        const a = this.cops[i].car, b = this.cops[j].car;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d > 3.6 || d < 1e-3) continue;
        const push = (3.6 - d) / 2, nx = dx / d, nz = dz / d;
        a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
      }
    }
    // Poses, lights.
    const flash = Math.floor(this.time * 6) % 2;
    for (const k of this.cops) {
      const c = k.car, m = k.model;
      m.root.position.set(c.x, k.y, c.z);
      m.root.rotation.set(0, c.psi, 0);
      k.spin = (k.spin || 0) + (c.u / this.copSpec().wheelRadius) * dt;
      m.update(dt, { steerRoad: c.delta, spinFront: k.spin, spinRear: c.wheelRot, braking: false, lights: g.night });
      const on = !k.out && this.state === 'chase';
      k.red.emissiveIntensity = on && flash ? 4 : 0;
      k.blue.emissiveIntensity = on && !flash ? 4 : 0;
    }
    this._rules(dt);
  }

  copSpec() { return this.cops[0].spec; }

  _rules(dt) {
    if (this.state !== 'chase') return;
    const g = this.game, me = g.car;
    const near = this.nearest();
    if (this.cops.every((k) => k.out)) { this.state = 'escaped'; this.reason = 'disabled'; return; }
    if (near > 350) this.escapeT += dt; else this.escapeT = Math.max(0, this.escapeT - dt * 0.5);
    if (me.speed < 3 && near < 9) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt * 2);
    if (this.escapeT > 8) { this.state = 'escaped'; this.reason = 'lost'; }
    if (this.bustT > 3) this.state = 'busted';
  }

  dispose() {
    for (const k of this.cops) { this.scene.remove(k.model.root); k.model.dispose(); }
    this.cops = [];
  }
}
