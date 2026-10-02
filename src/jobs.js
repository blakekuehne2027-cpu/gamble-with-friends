// Jobs: objective missions that pay cash. Courier runs, VIP taxi rides, test
// driving, drift shows and radar runs on the regular circuits.

import { DEALER_CARS, findCar } from './cars.js';
import { TRACKS, getTrack } from './track.js';
import { buildSpec } from './career.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v, s) => Math.round(v / s) * s;

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const JOB_TYPES = {
  courier: { name: 'Courier Run', icon: '📦', blurb: 'Fragile cargo. Get it there on time and in one piece: every wall hit costs you.' },
  taxi: { name: 'VIP Taxi', icon: '🚕', blurb: 'Your passenger hates g-forces. Drive smooth: three complaints and you\'re fired.' },
  test: { name: 'Test Driver', icon: '🔧', blurb: 'A dealer wants a lap time out of one of their cars. Beat the target in 3 laps.' },
  drift: { name: 'Drift Show', icon: '🌀', blurb: 'The crowd wants smoke. Score the drift points before the clock runs out.' },
  radar: { name: 'Radar Run', icon: '📸', blurb: 'A magazine wants a speed-trap photo. Hit the target speed through the radar.' },
};

const CIRCUITS = TRACKS.map((t, i) => (t.drag ? -1 : i)).filter((i) => i >= 0);

// Lap time an expert would do in this car (from the AI speed profile).
export function idealLap(track, spec) {
  const mu = spec.mu * 0.97;
  let power = 0;
  for (const [rpm, t] of spec.torque) power = Math.max(power, (rpm * t) / 9549);
  power *= 1000;
  const accel = (v) => Math.min(mu * 9.81 * 0.9, (power * 0.85) / (spec.mass * Math.max(v, 4))) - (0.5 * 1.2 * spec.cdA * v * v) / spec.mass;
  const prof = track.speedProfile(mu, mu * 9.81 * 0.9, 95, accel);
  let t = 0;
  for (let i = 0; i < track.count; i++) t += track.ds / prof[i];
  return { lap: t, prof };
}

// The fastest point on a lap for this car (where the radar goes).
function radarSpot(track, spec) {
  const { prof } = idealLap(track, spec);
  let best = 0;
  for (let i = 0; i < track.count; i++) if (prof[i] > prof[best]) best = i;
  // A little before the braking point, so you're still flat out through it.
  const i = (best - Math.round(45 / track.ds) + track.count) % track.count;
  return { s: i * track.ds, v: prof[i] };
}

// Build one job. `power` scales targets with the player's car.
export function makeJob(type, trackIdx, r, playerCarId, playerUp) {
  const track = getTrack(trackIdx);
  const tname = TRACKS[trackIdx].name;
  const night = r() < 0.25, rain = r() < 0.2;
  const extra = (night ? 0.15 : 0) + (rain ? 0.25 : 0);
  const job = { type, track: trackIdx, trackName: tname, time: night ? 'night' : 'default', rain, ...JOB_TYPES[type] };
  const mySpec = buildSpec(findCar(playerCarId), playerUp);
  if (type === 'courier') {
    const dist = round(1100 + r() * 1100, 50);
    const lap = idealLap(track, mySpec).lap;
    const avg = track.length / lap;
    job.dist = dist;
    job.limit = Math.round((dist / avg) * (1.35 + (rain ? 0.15 : 0)) + 6);
    job.pay = round((700 + dist * 0.45) * (1 + extra), 50);
    job.title = `Deliver parts ${(dist / 1000).toFixed(1)} km across ${tname}`;
  } else if (type === 'taxi') {
    const dist = round(900 + r() * 900, 50);
    job.dist = dist;
    job.limit = Math.round(dist / 13 + 20);
    job.gLimit = 0.62;
    job.pay = round((900 + dist * 0.5) * (1 + extra), 50);
    job.title = `Drive a VIP ${(dist / 1000).toFixed(1)} km. Smoothly.`;
  } else if (type === 'test') {
    const pool = DEALER_CARS.filter((c) => c.id !== playerCarId);
    const car = pool[Math.floor(r() * pool.length)];
    const ideal = idealLap(track, buildSpec(car, {})).lap;
    job.carId = car.id;
    job.target = Math.round(ideal * (rain ? 1.35 : 1.22) * 10) / 10;
    job.laps = 3;
    job.pay = round((1500 + car.tier * 650) * (1 + extra), 50);
    job.title = `Lap ${tname} in a ${car.name} under ${fmtLap(job.target)}`;
  } else if (type === 'drift') {
    job.points = round(1500 + r() * 2500, 100);
    job.limit = 90;
    job.pay = round((800 + job.points * 0.4) * (1 + extra * 0.5), 50);
    job.title = `Score ${job.points.toLocaleString('en-US')} drift points in 90 s`;
  } else if (type === 'radar') {
    const spot = radarSpot(track, mySpec);
    job.trapS = spot.s;
    job.speed = Math.max(60, round(spot.v * 2.23694 * (rain ? 0.78 : 0.85), 5)); // mph
    job.laps = 2;
    job.pay = round((700 + job.speed * 6) * (1 + extra * 0.5), 50);
    job.title = `Hit ${job.speed} mph through the radar on ${tname}`;
  }
  return job;
}

// The job board: five jobs that change whenever you finish one.
export function jobBoard(career, playerCarId) {
  const r = rng((career.jobSeed || 1) * 9973 + 17);
  const types = ['courier', 'taxi', 'test', 'drift', 'radar'];
  const up = career.owned[playerCarId]?.up || {};
  return types.map((type) => makeJob(type, CIRCUITS[Math.floor(r() * CIRCUITS.length)], r, playerCarId, up));
}

export function fmtLap(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

// ---------------------------------------------------------------- runner
export class JobRunner {
  constructor(game, job) {
    this.game = game;
    this.job = job;
    this.t = 0;
    this.done = false;
    this.success = false;
    this.cargo = 100;
    this.complaints = 0;
    this.gTimer = 0;
    this.trap = null;
    this.prog0 = null;
    this.reason = '';
    this.lapsSeen = 0;
    this.bestLap = Infinity;
    this.trapsSeen = 0;
    this.lastS = null;
  }

  get timeLeft() {
    return this.job.limit ? this.job.limit - this.t : Infinity;
  }

  update(dt) {
    if (this.done) return;
    const g = this.game, j = this.job, car = g.car;
    this.t += dt;
    if (this.prog0 === null) this.prog0 = g.prog;
    let line1 = '', line2 = '', warn = false;
    if (j.type === 'courier' || j.type === 'taxi') {
      const togo = Math.max(0, j.dist - (g.prog - this.prog0));
      line2 = `${Math.round(togo).toLocaleString('en-US')} m to go`;
      if (j.type === 'courier') {
        if (g.lastImpact > 2.5) {
          const dmg = Math.round(clamp(g.lastImpact * 4, 8, 40));
          this.cargo = Math.max(0, this.cargo - dmg);
          g.hud.cash(`CARGO DAMAGED -${dmg}%`, true);
        }
        line1 = `Cargo ${this.cargo}%`;
        warn = this.cargo < 50;
        if (this.cargo <= 0) return this._end(false, 'The cargo is destroyed.');
      } else {
        const gForce = Math.hypot(car.ax, car.ay) / 9.81;
        if (gForce > j.gLimit && car.speed > 3) this.gTimer += dt; else this.gTimer = Math.max(0, this.gTimer - dt * 0.5);
        if (g.lastImpact > 2) this.gTimer = 1;
        if (this.gTimer > 0.45) {
          this.gTimer = -1.5; // grace period after a complaint
          this.complaints++;
          const lines = ['"Easy on the corners!"', '"Are you TRYING to kill me?"', '"That\'s it, pull over!"'];
          g.hud.cash(lines[Math.min(2, this.complaints - 1)], true);
          if (this.complaints >= 3) return this._end(false, 'Your passenger got out and walked.');
        }
        line1 = `Comfort ${'★'.repeat(3 - this.complaints)}${'☆'.repeat(this.complaints)}  ·  ${gForce.toFixed(2)} g`;
        warn = gForce > j.gLimit * 0.85;
      }
      if (togo <= 0) return this._end(true, j.type === 'courier' ? 'Delivered!' : 'Your VIP arrived.');
    } else if (j.type === 'test') {
      if (g.lapsDone > this.lapsSeen) {
        this.lapsSeen = g.lapsDone;
        this.bestLap = Math.min(this.bestLap, g.lastLap);
        if (g.lastLap <= j.target) return this._end(true, `Lap ${fmtLap(g.lastLap)} beats the target.`);
        g.hud.cash(`${fmtLap(g.lastLap)} (+${(g.lastLap - j.target).toFixed(1)}s)`, true);
        if (this.lapsSeen >= j.laps) return this._end(false, `Best lap ${fmtLap(this.bestLap)} wasn't fast enough.`);
      }
      line1 = `Target ${fmtLap(j.target)}  ·  Lap ${Math.min(j.laps, this.lapsSeen + 1)}/${j.laps}`;
      line2 = g.lapStart !== null ? `Current ${fmtLap(g.time - g.lapStart)}` : 'Cross the line to start';
    } else if (j.type === 'drift') {
      const pts = g.drift.total + Math.round(g.drift.combo);
      line1 = `${pts.toLocaleString('en-US')} / ${j.points.toLocaleString('en-US')} pts`;
      if (pts >= j.points) return this._end(true, 'The crowd goes wild.');
    } else if (j.type === 'radar') {
      const L = g.track.length;
      const s = g.trackPos.s;
      if (this.lastS !== null) {
        let a = this.lastS, b = s;
        const crossed = (a <= j.trapS && b >= j.trapS && b - a < 100) || (a > b && a - b > L / 2 && (j.trapS >= a || j.trapS <= b));
        if (crossed) {
          this.trapsSeen++;
          const mph = car.speed * 2.23694;
          this.trap = Math.max(this.trap || 0, mph);
          g.hud.cash(`RADAR ${Math.round(mph)} MPH`, mph < j.speed);
          if (mph >= j.speed) return this._end(true, `Clocked at ${Math.round(mph)} mph.`);
          if (this.trapsSeen >= j.laps + 1) return this._end(false, `Best ${Math.round(this.trap)} mph. Not fast enough.`);
        }
      }
      this.lastS = s;
      let dist = j.trapS - s;
      if (dist < 0) dist += L;
      line1 = `Target ${j.speed} mph  ·  Best ${this.trap ? Math.round(this.trap) : '--'} mph`;
      line2 = `Radar in ${Math.round(dist)} m  ·  ${Math.max(0, j.laps + 1 - this.trapsSeen)} passes left`;
    }
    if (j.limit && this.t >= j.limit) return this._end(false, 'Out of time.');
    const left = j.limit ? Math.max(0, j.limit - this.t) : null;
    g.hud.jobUpdate({ title: `${j.icon} ${j.name}`, timer: left, line1, line2, warn: warn || (left !== null && left < 10) });
  }

  // World position of the objective (for the beacon), or null.
  target() {
    const g = this.game, j = this.job, t = g.track;
    if (j.type === 'courier' || j.type === 'taxi') {
      if (this.prog0 === null) return null;
      return t.pointAt(this.prog0 + j.dist, 0);
    }
    if (j.type === 'radar') return t.pointAt(j.trapS, 0);
    return null;
  }

  _end(success, reason) {
    this.done = true;
    this.success = success;
    this.reason = reason;
    const g = this.game;
    g.hud.message(success ? 'JOB DONE' : 'JOB FAILED', 3, success ? 'go' : 'warn');
    g.state = 'finished';
    g.finishedAt = g.time;
  }

  results(career) {
    if (this.settled) return this.settled;
    const j = this.job;
    const lines = [];
    let pay = 0;
    if (this.success) {
      pay = j.pay;
      if (j.type === 'courier') pay = Math.round((j.pay * this.cargo) / 100 / 10) * 10;
      lines.push([this.reason, pay]);
      if (j.type === 'taxi' && this.complaints === 0) {
        const tip = Math.round(j.pay * 0.3 / 10) * 10;
        lines.push(['Smooth-ride tip', tip]);
        pay += tip;
      }
      if (j.type === 'courier' || j.type === 'taxi') {
        const spare = Math.max(0, j.limit - this.t);
        if (spare > 10) {
          const bonus = Math.round(spare * 12 / 10) * 10;
          lines.push([`Early by ${Math.round(spare)} s`, bonus]);
          pay += bonus;
        }
      }
      career.money += pay;
      career.stats.earned += pay;
      career.stats.jobs = (career.stats.jobs || 0) + 1;
      career.jobSeed = (career.jobSeed || 1) + 1; // fresh jobs on the board
    } else {
      lines.push([this.reason, 0]);
    }
    this.settled = { type: 'job', job: j, success: this.success, pay, lines, balance: career.money, story: this.game.cfg.story || null };
    return this.settled;
  }
}

