// AI opponents: they ride the racing line with a speed profile built for
// their car, overtake around slower traffic and react to contact.

import { CARS } from './cars.js';

const NAMES = ['M. Rossi', 'K. Tanaka', 'L. Moreau', 'S. Novak', 'D. Okafor', 'A. Lindqvist', 'J. Alvarez', 'R. Kowalski', 'E. Brennan', 'T. Haddad'];
const COLORS = [0x1fa2ff, 0xf2b705, 0x22c55e, 0xf97316, 0xa855f7, 0xf5f5f5, 0xec4899, 0x14b8a6, 0x1b1b1f, 0x84cc16];

// difficulty: 0 easy .. 3 pro -> fraction of the ideal speed profile
const PACE = [0.82, 0.885, 0.935, 0.975];

export class AIDriver {
  // opts.tier: the player's car class (rivals come from the same or one class
  // below). opts.speed: mod-menu AI speed multiplier.
  constructor(track, idx, startS, startD, difficulty, opts = {}) {
    this.track = track;
    this.index = idx;
    this.name = NAMES[idx % NAMES.length];
    this.color = COLORS[idx % COLORS.length];
    this.number = 2 + idx * 3 + (idx % 3);
    const tier = opts.tier ?? 2;
    let pool = CARS.filter((c) => !c.modOnly && (!c.junker || tier === 0) && c.tier <= tier && c.tier >= tier - 1);
    if (!pool.length) pool = CARS.filter((c) => !c.modOnly);
    this.spec = pool[(idx + 1) % pool.length];
    // Each driver has their own pace & style.
    const base = PACE[difficulty] ?? PACE[1];
    this.baseSkill = base * (0.975 + ((idx * 37) % 10) / 200);
    this.skill = this.baseSkill * (opts.speed || 1);
    this.aggression = 0.4 + ((idx * 53) % 10) / 16;
    this.s = startS; // continuous distance (can exceed track length)
    this.d = startD;
    this.v = 0;
    this.targetD = startD;
    this.lap = 0;
    this.finished = false;
    this.finishTime = 0;
    this.x = 0; this.z = 0; this.h = 0; this.psi = 0;
    this.steer = 0;
    this.wheelRot = 0;
    this.braking = false;
    this.bump = 0;
    this.dVel = 0;
    this.rpm = this.spec.idle;
    this.gear = 1;
    this.lastLapTime = 0;
    this.bestLap = Infinity;
    this.lapStart = 0;
    this._buildProfile();
    this._place();
  }

  _buildProfile() {
    const s = this.spec;
    const mu = s.mu * 0.97;
    const power = Math.max(...s.torque.map(([rpm, t]) => (rpm * t) / 9549)) * 1000; // W
    const accel = (v) => Math.min(mu * 9.81 * 0.9, power * 0.85 / (s.mass * Math.max(v, 4))) - (0.5 * 1.2 * s.cdA * v * v) / s.mass;
    this.accel = accel;
    this.profile = this.track.speedProfile(mu, mu * 9.81 * 0.9, 95, accel);
  }

  setSpeed(mult) {
    this.skill = this.baseSkill * (mult || 1);
  }

  get progress() {
    return this.s;
  }

  update(dt, ctx) {
    const t = this.track;
    if (!ctx.racing) { this._place(); return; }
    if (this.finished && this.v < 0.5) { this._place(); return; }

    // Target speed from the profile, with mild rubber-banding.
    let target = t.sampleArray(this.profile, this.s) * this.skill;
    const gap = ctx.playerProgress - this.s;
    if (gap > 120) target *= 1 + Math.min(0.05, (gap - 120) / 4000);
    else if (gap < -200) target *= 1 - Math.min(0.04, (-gap - 200) / 5000);
    if (this.finished) target = Math.min(target, 22);

    // Traffic: look ahead for cars in our lane.
    let avoid = 0;
    let follow = Infinity;
    for (const o of ctx.cars) {
      if (o === this) continue;
      let ds = o.s - this.s;
      ds -= Math.round(ds / t.length) * t.length;
      if (ds <= 0 || ds > 30) continue;
      const dd = o.d - this.d;
      if (Math.abs(dd) < 2.4) {
        // Pass on the side with more room.
        const room = o.d > 0 ? -1 : 1;
        avoid += room * (2.8 - Math.abs(dd)) * (1 - ds / 30) * (0.8 + this.aggression * 0.6);
        if (ds < 14 && o.v < this.v) follow = Math.min(follow, o.v + ds * 0.4);
      }
    }
    if (follow < target) target = Math.max(follow, target * 0.8);

    const lineD = t.sampleArray(t.lineOffset, this.s + 8);
    this.targetD = Math.max(-t.halfWidth + 1.2, Math.min(t.halfWidth - 1.2, lineD + avoid));

    // Longitudinal.
    const a = this.v < target ? Math.max(0.5, this.accel(this.v)) : -this.spec.mu * 9.81 * 0.85;
    this.braking = this.v > target + 0.5;
    this.v += a * dt;
    if (a > 0) this.v = Math.min(this.v, target);
    else this.v = Math.max(this.v, target);
    this.v = Math.max(0, this.v);

    // Lateral (smoothed, rate-limited) + response to bumps.
    const maxRate = 1.5 + this.v * 0.05;
    const err = this.targetD - this.d;
    this.dVel += (Math.max(-maxRate, Math.min(maxRate, err * 1.6)) - this.dVel) * Math.min(1, dt * 4);
    this.dVel += this.bump;
    this.bump *= Math.exp(-dt * 6);
    this.d += this.dVel * dt;
    this.d = Math.max(-t.wallDist + 1.2, Math.min(t.wallDist - 1.2, this.d));

    this.s += this.v * dt;
    this._place();

    // Visual drivetrain state.
    const ratioFor = (g) => (this.spec.gears[g] * this.spec.final) / this.spec.wheelRadius;
    let g = this.gear;
    const rpmIn = (gg) => this.v * ratioFor(gg) * 9.549;
    if (rpmIn(g) > this.spec.redline - 200 && g < 6) g++;
    else if (g > 1 && rpmIn(g - 1) < this.spec.redline * 0.7) g--;
    this.gear = g;
    this.rpm = Math.max(this.spec.idle, rpmIn(g));
    this.wheelRot += (this.v / this.spec.wheelRadius) * dt;
  }

  _place() {
    const t = this.track;
    const p = t.pointAt(this.s, this.d, this._pt || (this._pt = {}));
    const yawOff = Math.atan2(this.dVel, Math.max(3, this.v));
    // dVel > 0 means moving left, which is a positive heading change.
    this.x = p.x; this.z = p.z; this.h = p.h;
    this.psi = p.heading + yawOff;
    this.grade = p.grade;
    const curv = t.sampleArray(t.curv, this.s);
    this.steer = Math.max(-0.5, Math.min(0.5, curv * 2.6 + yawOff * 0.5));
  }

  // Push from a collision: world impulse direction (nx,nz) and magnitude in m/s.
  push(nx, nz, dv, dSpeed) {
    const t = this.track;
    const p = t.pointAt(this.s, 0, this._pt2 || (this._pt2 = {}));
    const lat = nx * p.nx + nz * p.nz;
    this.bump += lat * dv * 0.6;
    this.v = Math.max(0, this.v + dSpeed);
  }
}
