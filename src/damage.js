// Crash damage, BeamNG style (within reason for a browser game): impacts dent
// the bodywork, knock parts off, and hurt the engine, radiator, steering,
// wheels and tyres, which changes how the car drives.

import * as THREE from 'three';

export const DAMAGE_MODES = ['off', 'visual', 'full'];
export const DAMAGE_NAMES = { off: 'Off', visual: 'Cosmetic', full: 'Realistic' };

// Physics modifiers for an undamaged car.
export function noDamage() {
  return { power: 1, steerMul: 1, toe: 0, gripF: 1, gripR: 1, drag: 1, roll: 0, engineDead: false };
}

const WHEEL_IDS = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const _P = new THREE.Vector3(), _D = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class CarDamage {
  // model: CarModel, spec: car spec, mode: 'off' | 'visual' | 'full'
  constructor(model, spec, mode = 'full') {
    this.model = model;
    this.spec = spec;
    this.mode = mode;
    this.events = []; // drained by the game: { type, ... }
    this.reset();
  }

  reset() {
    this.zones = { front: 0, rear: 0, left: 0, right: 0, top: 0 };
    this.engine = 0; // 0..1, dead at 1
    this.radiator = 0;
    this.temp = 90; // coolant °C
    this.bent = [0, 0, 0, 0]; // wheel damage FL FR RL RR
    this.tyre = [1, 1, 1, 1]; // pressure, 0 = flat
    this.leak = [0, 0, 0, 0]; // puncture deflation rate per second
    this.lost = [false, false, false, false]; // wheel torn off
    this.toeBias = 0;
    this.misfire = 0;
    this.dead = false;
    this.total = 0;
    this.warned = {};
    // Keep the same object: the physics holds a reference to it.
    if (this.mods) Object.assign(this.mods, noDamage());
    else this.mods = noDamage();
  }

  get enabled() {
    return this.mode !== 'off';
  }

  get mechanical() {
    return this.mode === 'full';
  }

  // An impact at world point (x, y, z). (nx, nz) is the direction the
  // bodywork gets pushed (into the car); speed is the closing speed in m/s.
  impact(x, y, z, nx, nz, speed) {
    if (!this.enabled || speed < 1.8) return 0;
    const m = this.model;
    m.root.updateMatrixWorld(true);
    _P.set(x, y, z);
    m.body.worldToLocal(_P);
    // Direction into body space (rotation only).
    m.body.getWorldQuaternion(_q).invert();
    _D.set(nx, 0, nz).applyQuaternion(_q).normalize();
    const sev = speed - 1.8; // severity in m/s above "a tap"
    const depth = Math.min(0.5, sev * 0.028);
    const radius = Math.min(1.5, 0.55 + sev * 0.035);
    m.crush(_P, _D, depth, radius);

    // Which part of the car took it.
    const st = m.style, zOff = (this.spec.a - this.spec.b) / 2;
    const lz = _P.z - zOff, lx = _P.x;
    const hit = sev * 0.035;
    if (lz > st.len / 2 - 1.1) this.zones.front = Math.min(1, this.zones.front + hit);
    if (lz < -st.len / 2 + 1.0) this.zones.rear = Math.min(1, this.zones.rear + hit);
    if (lx > st.width / 2 - 0.45) this.zones.left = Math.min(1, this.zones.left + hit);
    if (lx < -st.width / 2 + 0.45) this.zones.right = Math.min(1, this.zones.right + hit);
    if (_P.y > st.roofH - 0.2) this.zones.top = Math.min(1, this.zones.top + hit);

    // Parts near the hit lose "health".
    for (const p of m.parts) {
      if (p.detached) continue;
      const d = p.anchor.distanceTo(_P);
      const reach = radius * 1.5 + (p.kind === 'wheel' ? 0.2 : 0);
      if (d > reach) continue;
      const amount = sev * (1 - d / reach) * (p.kind === 'wheel' ? 1 : 1.2);
      const wi = WHEEL_IDS.indexOf(p.id);
      if (wi >= 0) this._hitWheel(wi, amount, speed);
      const res = m.hurtPart(p, amount);
      if (res === 'detach') this._detach(p, x, y, z, nx, nz, sev);
      else if (res === 'broken') this.events.push({ type: 'glass', x, y, z, n: 14 });
      else if (res === 'pop') this.events.push({ type: 'pop' });
    }

    // Mechanical damage.
    const mid = st.wing === 'big' || this.spec.style === 'proto' || this.spec.style === 'hyper';
    const engineZone = mid ? this.zones.rear : this.zones.front;
    if (this.mechanical) {
      const nearEngine = mid ? lz < -0.4 : lz > 0.6;
      if (nearEngine) this.engine = Math.min(1, this.engine + Math.max(0, sev - 3) * 0.022 * (0.6 + engineZone));
      if (lz > st.len / 2 - 1.0) this.radiator = Math.min(1, this.radiator + Math.max(0, sev - 3) * 0.028);
    }
    const glassHit = Math.abs(lx) < st.width / 2 && _P.y > st.hoodH - 0.1;
    if (glassHit || this.zones.top > 0.2 || sev > 14) m.setGlassDamage(Math.max(this.zones.top, sev > 14 ? 0.5 : 0, glassHit ? sev * 0.04 : 0));
    if (sev > 9) this.events.push({ type: 'glass', x, y: y + 0.5, z, n: Math.min(30, sev * 1.5) });
    this.total = Math.min(1, (this.zones.front + this.zones.rear + this.zones.left + this.zones.right + this.zones.top) / 2.5 + this.engine * 0.3);
    return sev;
  }

  _hitWheel(i, amount, speed) {
    if (!this.mechanical) return;
    this.bent[i] = Math.min(1, this.bent[i] + amount * 0.035);
    if (this.toeBias === 0) this.toeBias = Math.random() < 0.5 ? -1 : 1;
    // Hard knocks can puncture the tyre.
    if (this.tyre[i] > 0.5 && this.leak[i] === 0 && speed > 9 && Math.random() < (speed - 9) / 16) {
      this.leak[i] = 0.3 + Math.random() * 0.6;
      this.events.push({ type: 'puncture', wheel: i });
    }
  }

  _detach(p, x, y, z, nx, nz, sev) {
    const wi = WHEEL_IDS.indexOf(p.id);
    if (wi >= 0) {
      if (!this.mechanical) { p.hp = 1; return; }
      this.lost[wi] = true;
      this.tyre[wi] = 0;
      this.bent[wi] = 1;
    }
    const mat = this.model.detachPart(p);
    if (!mat) return;
    this.events.push({ type: 'detach', part: p, matrix: mat, nx, nz, sev, x, y, z });
  }

  // Per-frame: overheating, punctures, misfires; writes physics modifiers.
  update(dt, car) {
    const md = this.mods;
    if (!this.mechanical) {
      Object.assign(md, noDamage());
      this.model.setWheelDamage([0, 0, 0, 0], [0, 0, 0, 0]);
      return md;
    }
    for (let i = 0; i < 4; i++) {
      if (this.leak[i] > 0 && this.tyre[i] > 0) this.tyre[i] = Math.max(0, this.tyre[i] - this.leak[i] * dt);
    }
    // A cracked radiator loses coolant; the engine cooks if you keep driving.
    const rpmF = car.engineOn ? car.rpm / this.spec.redline : 0;
    // Driving gently (low revs) keeps it cooler.
    const target = 90 + Math.max(0, this.radiator - 0.3) * 110 * (0.4 + rpmF * 0.8);
    this.temp += (target - this.temp) * Math.min(1, dt * 0.06);
    if (!car.engineOn) this.temp += (70 - this.temp) * Math.min(1, dt * 0.02);
    if (this.temp > 125 && car.engineOn) this.engine = Math.min(1, this.engine + (this.temp - 125) * 0.0025 * dt);
    if (this.temp > 118 && !this.warned.hot) { this.warned.hot = true; this.events.push({ type: 'overheat' }); }
    if (this.engine > 0.35 && !this.warned.engine) { this.warned.engine = true; this.events.push({ type: 'engine' }); }
    if (this.engine >= 1 && !this.dead) { this.dead = true; this.events.push({ type: 'dead' }); }

    const bF = Math.max(this.bent[0], this.bent[1]);
    const flatF = (2 - this.tyre[0] - this.tyre[1]) / 2, flatR = (2 - this.tyre[2] - this.tyre[3]) / 2;
    const lostF = (this.lost[0] ? 1 : 0) + (this.lost[1] ? 1 : 0), lostR = (this.lost[2] ? 1 : 0) + (this.lost[3] ? 1 : 0);
    md.power = Math.max(0.15, 1 - this.engine * 0.75);
    md.engineDead = this.dead;
    md.steerMul = Math.max(0.45, 1 - bF * 0.45 - lostF * 0.25);
    // Bent front wheels and flat tyres make the car pull to one side.
    md.toe = this.toeBias * (this.bent[0] * 0.05 - this.bent[1] * 0.05 + Math.abs(this.bent[0] - this.bent[1]) * 0.03)
      + (this.tyre[1] - this.tyre[0]) * 0.035 + (this.tyre[3] - this.tyre[2]) * 0.02 + (this.lost[1] - this.lost[0]) * 0.06;
    md.gripF = Math.max(0.3, 1 - (this.bent[0] + this.bent[1]) * 0.12 - flatF * 0.35 - lostF * 0.3);
    md.gripR = Math.max(0.3, 1 - (this.bent[2] + this.bent[3]) * 0.12 - flatR * 0.35 - lostR * 0.3);
    md.drag = 1 + this.zones.front * 0.3 + (this.model.parts.some((p) => p.id === 'wing' && p.detached) ? -0.05 : 0);
    md.roll = (flatF + flatR) * 0.03 + (lostF + lostR) * 0.12;
    // Misfires once the engine is hurt.
    this.misfire = this.engine > 0.3 ? (this.engine - 0.3) * 1.4 : 0;
    // Visuals: bent wheels lean, flat tyres sit lower.
    this.model.setWheelDamage(
      this.bent.map((b, i) => (i % 2 ? -1 : 1) * b * 0.22),
      this.tyre.map((t, i) => (this.lost[i] ? 0 : 1 - t)),
    );
    return md;
  }

  repair() {
    this.model.repair();
    this.reset();
  }
}

// Bits of car lying around the track after a crash.
export class Debris {
  constructor(scene, ground, bounds) {
    this.scene = scene;
    this.ground = ground; // (x, z) -> height
    this.bounds = bounds; // (x, z) -> { x, z, hit } kept inside the walls
    this.items = [];
  }

  add(obj, matrix, vx, vy, vz, spin) {
    matrix.decompose(obj.position, obj.quaternion, obj.scale);
    this.scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const r = Math.max(0.12, box.getSize(_s).length() / 3);
    this.items.push({ obj, vx, vy, vz, wx: (Math.random() - 0.5) * spin, wy: (Math.random() - 0.5) * spin, wz: (Math.random() - 0.5) * spin, r, rest: false });
    if (this.items.length > 70) {
      const old = this.items.shift();
      this.scene.remove(old.obj);
    }
  }

  update(dt, car, carY) {
    for (const it of this.items) {
      const o = it.obj;
      // The player's car shoves debris out of the way.
      if (car) {
        const dx = o.position.x - car.x, dz = o.position.z - car.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 5 && car.speed > 1.5 && Math.abs(o.position.y - carY) < 1.5) {
          const sp = Math.sin(car.psi), cp = Math.cos(car.psi);
          const cvx = car.u * sp + car.v * cp, cvz = car.u * cp - car.v * sp;
          const d = Math.sqrt(d2) || 1;
          it.vx = cvx * 1.1 + (dx / d) * 2; it.vz = cvz * 1.1 + (dz / d) * 2;
          it.vy = 1.5 + car.speed * 0.12;
          it.wx = (Math.random() - 0.5) * 12; it.wz = (Math.random() - 0.5) * 12;
          it.rest = false;
        }
      }
      if (it.rest) continue;
      it.vy -= 9.81 * dt;
      o.position.x += it.vx * dt;
      o.position.y += it.vy * dt;
      o.position.z += it.vz * dt;
      const b = this.bounds?.(o.position.x, o.position.z);
      if (b && b.hit) {
        o.position.x = b.x; o.position.z = b.z;
        it.vx *= -0.3; it.vz *= -0.3;
      }
      _q.setFromEuler(new THREE.Euler(it.wx * dt, it.wy * dt, it.wz * dt));
      o.quaternion.premultiply(_q);
      const g = this.ground(o.position.x, o.position.z) + it.r * 0.4;
      if (o.position.y < g) {
        o.position.y = g;
        if (it.vy < 0) it.vy = -it.vy * 0.28;
        const fr = Math.exp(-dt * 5);
        it.vx *= fr; it.vz *= fr;
        it.wx *= fr; it.wy *= fr; it.wz *= fr;
        if (Math.abs(it.vy) < 0.4 && it.vx * it.vx + it.vz * it.vz < 0.05) { it.rest = true; it.vy = 0; }
      }
    }
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.obj);
    this.items = [];
  }
}
