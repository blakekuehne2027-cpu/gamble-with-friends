// Drag racing: quarter-mile runs against one rival with a Christmas-tree
// start, reaction times, shift grading, time slips, bets and pink slips.

import { CarPhysics } from './physics.js';
import { CARS, DEALER_CARS, findCar, PAINT_COLORS } from './cars.js';
import { buildSpec, MOD_DEFAULTS, UPGRADES, upgradeCost, carColorIndex } from './career.js';
import { QUARTER_MILE } from './track.js';
import { checkPink } from './achievements.js';

const STEP = 1 / 240;
export const LANE = 4.5; // lane centre offset from the strip centreline
export const SPLITS = [['60 ft', 18.29], ['330 ft', 100.58], ['1/8 mile', 201.17], ['1000 ft', 304.8], ['1/4 mile', QUARTER_MILE]];
export const BETS = [0, 500, 1000, 2500, 5000, 10000, 25000, 50000, 'custom', 'all', 'pink'];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------- simulation
const runCache = new Map();

// Ideal quarter-mile run (auto box, perfect launch) used for odds and rivals.
export function simulateRun(spec, key = null) {
  if (key && runCache.has(key)) return runCache.get(key);
  const car = new CarPhysics(spec);
  car.gear = 1;
  const env = { mu: 1, drag: 0, slope: 0 };
  let t = 0, eighth = null, eighthMph = 0, nitroLeft = spec.nitro || 0;
  const inp = { throttle: 1, brake: 0, clutch: 0, steer: 0, handbrake: false, autoClutch: true, abs: true, tc: true, stability: false, nitro: false };
  let sub = 0;
  while (car.z < QUARTER_MILE && t < 60) {
    if (sub++ % 4 === 0) car.updateTransmission(STEP * 4, { mode: 'auto', throttle: 1, brake: 0, clutch: 0, autoClutch: true });
    inp.nitro = nitroLeft > 0 && car.gear >= 2;
    if (inp.nitro) nitroLeft -= STEP;
    car.step(STEP, inp, env);
    t += STEP;
    if (eighth === null && car.z >= 201.17) { eighth = t; eighthMph = car.speed * 2.23694; }
  }
  const res = { et: t, trap: car.speed * 2.23694, eighth, eighthMph };
  if (key) runCache.set(key, res);
  return res;
}

const RIVALS = [
  { name: 'Street Sam', color: 0xf97316 }, { name: 'Nitro Nina', color: 0xec4899 }, { name: 'Big Earl', color: 0xf2b705 },
  { name: 'Slick Rick', color: 0x14b8a6 }, { name: 'Dutch', color: 0x1fa2ff }, { name: 'The Ghost', color: 0xf5f5f5 },
  { name: 'Professor Torque', color: 0xa855f7 }, { name: 'Mama Jo', color: 0x22c55e }, { name: 'Blackout', color: 0x1b1b1f },
];

const TIERS = [
  { label: 'Easy', dEt: 1.1, rt: 0.34, spread: 0.12, foul: 0 },
  { label: 'Even', dEt: 0.1, rt: 0.24, spread: 0.08, foul: 0.02 },
  { label: 'Tough', dEt: -0.4, rt: 0.17, spread: 0.06, foul: 0.03 },
  { label: 'Brutal', dEt: -1.0, rt: 0.11, spread: 0.04, foul: 0.05 },
];

function upFor(level) {
  return { engine: level, weight: level, tires: level };
}

// Four opponents from easy to brutal, picked by simulated ET relative to the player.
export function makeOpponents(playerSpec, playerKey, seed = 1) {
  const you = simulateRun(playerSpec, playerKey);
  const pool = [];
  for (const car of [...DEALER_CARS, findCar('junker')]) {
    for (const lvl of [0, 1, 2, 3]) {
      const up = upFor(lvl);
      pool.push({ carId: car.id, up, run: simulateRun(buildSpec(car, up), `${car.id}:${lvl}`) });
    }
  }
  const used = new Set();
  return TIERS.map((tier, i) => {
    const target = you.et + tier.dEt;
    let best = null;
    for (const c of pool) {
      const score = Math.abs(c.run.et - target) + (used.has(c.carId) ? 0.35 : 0);
      if (!best || score < best.score) best = { ...c, score };
    }
    used.add(best.carId);
    const r = RIVALS[(seed + i * 2) % RIVALS.length];
    return {
      ...r, label: tier.label, carId: best.carId, up: best.up, et: best.run.et, trap: best.run.trap,
      rt: tier.rt, spread: tier.spread, foul: tier.foul, odds: oddsFor(you.et, best.run.et),
    };
  });
}

// Winner's purse (on top of any bet): the tougher the opponent, the more it pays.
// Roughly $375 Easy, $800 Even, $1,400 Tough, $2,200 Brutal.
export function purseFor(opp) {
  return Math.round((300 * Math.pow(opp?.odds || 1.5, 1.6)) / 50) * 50;
}

export function oddsFor(playerEt, oppEt) {
  return Math.round(clamp(2 + (playerEt - oppEt) * 1.5, 1.15, 6) * 20) / 20;
}

// custom: the amount the player typed in.
export function betAmount(bet, money, custom = 0) {
  if (bet === 'all') return Math.max(0, Math.floor(money));
  if (bet === 'custom') return Math.max(0, Math.floor(custom || 0));
  if (bet === 'pink') return 0;
  return bet;
}

export function carValue(career, carId) {
  const car = findCar(carId);
  let v = car.price || 8000;
  const up = career.owned[carId]?.up || {};
  for (const u of UPGRADES) for (let l = 1; l <= (up[u.id] || 0); l++) v += upgradeCost(car, u.id, l);
  return Math.round(v * 0.6 / 100) * 100;
}

// Apply the bet / pink slip to the career. Returns text lines for the results screen.
export function settle(career, settings, res) {
  const lines = [];
  const { win, bet, pink, odds } = res;
  if (pink) {
    if (win) {
      const id = res.opp.carId;
      if (career.owned[id]) {
        const cash = Math.round(((findCar(id).price || 8000) * 0.6) / 100) * 100;
        career.money += cash;
        lines.push([`You already own a ${findCar(id).name}, so you sold theirs`, cash]);
      } else {
        const ci = PAINT_COLORS.indexOf(res.opp.color);
        career.owned[id] = { up: { ...res.opp.up }, color: ci >= 0 ? ci : 0 };
        lines.push([`PINK SLIP WON: the ${findCar(id).name} is yours`, 0]);
      }
      checkPink(career, true, false);
    } else {
      const lost = res.carId;
      delete career.owned[lost];
      lines.push([`PINK SLIP LOST: ${res.opp.name} drives off in your ${findCar(lost).name}`, 0]);
      const left = Object.keys(career.owned);
      if (!left.length) {
        career.owned.junker = { up: {}, color: carColorIndex(career, 'junker') };
        settings.carId = 'junker';
        lines.push(['You have nothing left but a Rust Bucket. Time to work your way back up.', 0]);
        checkPink(career, false, true);
      } else {
        settings.carId = left.map(findCar).sort((a, b) => b.tier - a.tier)[0].id;
      }
    }
  } else if (bet > 0) {
    if (win) {
      const profit = Math.round(bet * (odds - 1));
      career.money += profit;
      lines.push([`Bet won (${odds.toFixed(2)}×)`, profit]);
    } else {
      career.money -= bet;
      lines.push(['Bet lost', -bet]);
    }
  }
  return lines;
}

// ---------------------------------------------------------------- runner
// One drag run inside a Game session. The Game owns the player car; this
// owns the rival, the tree, timing and grading.
export class DragRace {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.opp = cfg.opp;
    this.bet = cfg.bet || 0;
    this.pink = !!cfg.pink;
    this.odds = cfg.opp.odds || 2;
    const t = game.track;
    const p0 = t.pointAt(0, 0);
    this.origin = { x: p0.x, z: p0.z, tx: p0.tx, tz: p0.tz };
    const base = findCar(this.opp.carId);
    this.rivalSpec = buildSpec(base, this.opp.up, MOD_DEFAULTS);
    this.rival = new CarPhysics(this.rivalSpec);
    const rp = t.pointAt(-2.4, LANE);
    this.rival.reset(rp.x, rp.z, rp.heading);
    this.rival.gear = 1;
    this.rivalAcc = 0;
    this.rivalStart = this.dist(this.rival.x, this.rival.z);
    this.youStart = this.dist(game.car.x, game.car.z);
    this.phase = 'staging';
    this.t = 0;
    this.treeAt = 1.4 + Math.random() * 1.4;
    this.ambers = 0;
    this.greenT = null;
    this.rivalRT = Math.max(0.03, this.opp.rt + (Math.random() - 0.5) * 2 * this.opp.spread);
    this.rivalFouls = Math.random() < (this.opp.foul || 0);
    this.you = { left: null, rt: null, splits: {}, speeds: {}, finishT: null, foul: false };
    this.them = { left: null, rt: null, splits: {}, speeds: {}, finishT: null, foul: false };
    this.shifts = [];
    this.lastGear = game.car.gear;
    this.lastGearRpm = 0;
    this.done = false;
    this.settled = null;
    this.redline = game.spec.redline;
  }

  dist(x, z) {
    const o = this.origin;
    return (x - o.x) * o.tx + (z - o.z) * o.tz;
  }

  // Rival driver inputs.
  _rivalInput() {
    const go = this.greenT !== null && this.t >= this.greenT + this.rivalRT;
    const jump = this.rivalFouls && this.phase === 'tree' && this.ambers >= 3 && this.t > this.treeAt + 1.0 - 0.06;
    const launch = go || jump || this.them.left !== null;
    const t = this.game.track;
    const p = t.project(this.rival.x, this.rival.z, -1);
    let err = this.rival.psi - p.heading;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const steer = clamp(0.05 * (p.d - LANE) + 1.4 * err, -0.25, 0.25);
    const finished = this.them.finishT !== null && this.t - this.them.finishT > 0.6;
    return {
      throttle: finished ? 0 : 1, brake: launch && !finished ? 0 : 1, clutch: 0, steer, handbrake: false,
      autoClutch: true, abs: true, tc: true, stability: false, nitro: false, noAutoReverse: true,
    };
  }

  update(dt) {
    if (this.done) return;
    const g = this.game, car = g.car, hud = g.hud;
    this.t += dt;
    const t = this.t;

    // Christmas tree: staged -> three ambers 0.5 s apart -> green.
    if (this.phase === 'staging' && t > 0.8) {
      this.phase = 'tree';
      hud.message('STAGED', 1.0);
    }
    if (this.phase === 'tree') {
      const n = Math.max(0, Math.min(3, Math.floor((t - this.treeAt) / 0.5) + 1));
      if (n !== this.ambers) {
        this.ambers = n;
        if (n > 0) g.audio.beep(false);
      }
      if (t >= this.treeAt + 1.5) {
        this.phase = 'racing';
        this.greenT = t;
        g.audio.beep(true);
      }
    }

    // Rival physics (same fixed step as the player).
    const rin = this._rivalInput();
    const env = { mu: g.wet, drag: 0, slope: 0 };
    this.rival.updateTransmission(dt, { mode: 'auto', throttle: rin.throttle, brake: rin.brake, clutch: 0, autoClutch: true, noAutoReverse: true });
    this.rivalAcc += dt;
    while (this.rivalAcc >= STEP) {
      this.rival.step(STEP, rin, env);
      this.rivalAcc -= STEP;
    }

    // Timing for both lanes.
    this._timing(this.you, car, this.youStart, true);
    this._timing(this.them, this.rival, this.rivalStart, false);

    // Shift grading (works for the H-shifter too: neutral in between is fine).
    if (car.gear >= 1 && car.gear > this.lastGear && this.lastGear >= 1 && this.you.left !== null && !this.you.finishT) this._gradeShift(this.lastGearRpm);
    if (car.gear >= 1) {
      this.lastGear = car.gear;
      this.lastGearRpm = car.rpm;
    }

    // End of the run.
    const youDone = this.you.finishT !== null || this.you.foul;
    const themDone = this.them.finishT !== null || this.them.foul;
    if ((youDone && themDone && t - Math.max(this.you.finishT || 0, this.them.finishT || 0) > 1.2) || (youDone && t - (this.you.finishT || this.you.left || t) > 6) || (this.greenT !== null && t - this.greenT > 45)) {
      this.done = true;
      g.state = 'finished';
      g.finishedAt = g.time;
    }
  }

  _timing(lane, phys, start, isYou) {
    const t = this.t;
    const moved = this.dist(phys.x, phys.z) - start;
    if (lane.left === null && (phys.speed > 0.3 || moved > 0.2)) {
      lane.left = t;
      if (this.greenT === null) {
        lane.foul = true;
        if (isYou) { this.game.hud.message('RED LIGHT!', 3, 'warn'); this.game.audio.grind(); }
        else this.game.hud.cash(`${this.opp.name} RED-LIT!`);
      } else {
        lane.rt = t - this.greenT;
        if (isYou) {
          const r = lane.rt;
          this.game.hud.cash(`R/T ${r.toFixed(3)} ${r < 0.05 ? 'PERFECT LIGHT!' : r < 0.15 ? 'GREAT' : r < 0.3 ? 'GOOD' : 'SLOW'}`, r >= 0.3);
        }
      }
    }
    if (lane.left === null) return;
    for (const [name, d] of SPLITS) {
      if (lane.splits[name] === undefined && moved >= d) {
        lane.splits[name] = t - lane.left;
        lane.speeds[name] = phys.speed * 2.23694;
        if (d === QUARTER_MILE) {
          lane.finishT = t;
          if (isYou) {
            this.game.hud.message(lane.splits[name].toFixed(3) + 's', 3, 'go');
            this.game.hud.sub(`${Math.round(lane.speeds[name])} mph`, 3);
          }
        }
      }
    }
  }

  _gradeShift(rpm) {
    const opt = this.redline - 150;
    const lim = this.game.spec.limiter;
    let grade, bad = false;
    if (rpm >= lim - 40) { grade = 'LATE (limiter)'; bad = true; }
    else if (Math.abs(rpm - opt) < 350) grade = 'PERFECT SHIFT';
    else if (Math.abs(rpm - opt) < 900) grade = 'GOOD SHIFT';
    else { grade = rpm < opt ? 'EARLY SHIFT' : 'LATE SHIFT'; bad = true; }
    this.shifts.push(grade);
    this.game.hud.cash(grade, bad);
  }

  // State for the HUD tree / progress bars.
  hudState() {
    const g = this.game;
    return {
      phase: this.phase, ambers: this.ambers, green: this.greenT !== null,
      redYou: this.you.foul, redThem: this.them.foul,
      timer: this.you.left !== null ? (this.you.finishT ?? this.t) - this.you.left : 0,
      you: clamp((this.dist(g.car.x, g.car.z) - this.youStart) / QUARTER_MILE, 0, 1),
      them: clamp((this.dist(this.rival.x, this.rival.z) - this.rivalStart) / QUARTER_MILE, 0, 1),
      rivalName: this.opp.name,
      shift: g.car.gear > 0 && g.car.gear < 6 && g.car.rpm > this.redline - 450 && this.you.left !== null && !this.you.finishT,
    };
  }

  // Who won? Fouls lose; otherwise first to the finish line.
  winner() {
    const y = this.you, r = this.them;
    if (y.foul && r.foul) return y.left > r.left;
    if (y.foul) return false;
    if (r.foul) return true;
    if (y.finishT === null) return false;
    if (r.finishT === null) return true;
    return y.finishT <= r.finishT;
  }

  results(career, settings) {
    if (this.settled) return this.settled;
    const win = this.winner();
    const g = this.game;
    const bet = betAmount(this.bet, career.money);
    const res = {
      type: 'drag', win, bet, pink: this.pink, odds: this.odds, opp: this.opp, carId: g.base.id, carName: g.base.name,
      rivalCar: findCar(this.opp.carId).name,
      you: { rt: this.you.rt, foul: this.you.foul, splits: this.you.splits, speeds: this.you.speeds, et: this.you.splits['1/4 mile'] ?? null },
      them: { rt: this.them.rt, foul: this.them.foul, splits: this.them.splits, speeds: this.them.speeds, et: this.them.splits['1/4 mile'] ?? null },
      shifts: this.shifts, story: this.cfg.story || null,
    };
    res.lines = settle(career, settings, res);
    if (win) {
      const purse = purseFor(this.opp);
      career.money += purse;
      res.lines.push([`Winner's purse (${this.opp.label || 'rival'})`, purse]);
    }
    const st = career.stats;
    st.dragRuns = (st.dragRuns || 0) + 1;
    if (win) st.dragWins = (st.dragWins || 0) + 1;
    if (res.you.et && !res.you.foul && (!st.bestEt || res.you.et < st.bestEt)) st.bestEt = res.you.et;
    res.balance = career.money;
    this.settled = res;
    return res;
  }
}

export function dragTrackIndex(tracks) {
  return tracks.findIndex((t) => t.drag);
}

export function rivalCarList() {
  return CARS;
}
