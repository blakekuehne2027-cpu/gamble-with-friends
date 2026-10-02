// Career progression (money, owned cars, upgrades, rewards) and the mod menu
// state. Pure JS + localStorage so the maths can be tested in Node.

import { CARS, findCar, PAINT_COLORS } from './cars.js';
import { loadJSON, saveJSON } from './settings.js';

const CAREER_KEY = 'redline.career.v1';
const MODS_KEY = 'redline.mods.v1';
export const START_MONEY = 5000;

// Each upgrade has 3 levels. values[level] (level 0 = stock). cost = fraction
// of the car's value per level.
export const UPGRADES = [
  { id: 'engine', name: 'Engine', desc: 'More power everywhere in the rev range', levels: ['Street tune', 'Cams + exhaust', 'Full race engine'], values: [1, 1.08, 1.17, 1.28], cost: [0.1, 0.22, 0.4] },
  { id: 'weight', name: 'Weight reduction', desc: 'Lighter car: accelerates, brakes and turns better', levels: ['Lightweight seats', 'Carbon panels', 'Stripped race shell'], values: [1, 0.95, 0.9, 0.85], cost: [0.06, 0.14, 0.28] },
  { id: 'tires', name: 'Tyres', desc: 'More grip for cornering and braking', levels: ['Sport', 'Semi-slick', 'Racing slick'], values: [1, 1.04, 1.08, 1.13], cost: [0.08, 0.16, 0.3] },
  { id: 'brakes', name: 'Brakes', desc: 'Stronger brakes, shorter stopping distances', levels: ['Fast-road pads', 'Big brake kit', 'Carbon-ceramic'], values: [1, 1.12, 1.25, 1.4], cost: [0.05, 0.1, 0.18] },
  { id: 'aero', name: 'Aero kit', desc: 'Downforce: more grip at high speed', levels: ['Splitter', 'Splitter + wing', 'Full race aero'], values: [0, 0.5, 1.0, 1.6], cost: [0.07, 0.15, 0.25] },
  { id: 'nitro', name: 'Nitrous', desc: 'Hold the NITRO button for a big power boost', levels: ['Small bottle', 'Twin bottles', 'Race system'], values: [0, 2.5, 4, 6], cost: [0.08, 0.15, 0.25] },
];
const UP = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

export const MOD_DEFAULTS = {
  power: 1,
  superGrip: false,
  drift: false,
  infiniteNitro: false,
  ghost: false,
  slowmo: false,
  aiSpeed: 1,
  rainbow: false,
  underglow: false,
};

const roundTo = (v, step) => Math.round(v / step) * step;
const carValue = (car) => Math.max(15000, car.price || 0);

// ---------------------------------------------------------------- career
export function newCareer() {
  return {
    money: START_MONEY,
    owned: { rookie: { up: {}, color: PAINT_COLORS.indexOf(findCar('rookie').color) } },
    stats: { races: 0, wins: 0, podiums: 0, earned: 0, bestPayout: 0, drift: 0, overtakes: 0, topSpeed: 0 },
  };
}

export function loadCareer() {
  const c = loadJSON(CAREER_KEY, null) || newCareer();
  c.owned = c.owned || {};
  if (!c.owned.rookie) c.owned.rookie = { up: {}, color: 3 };
  c.stats = { ...newCareer().stats, ...(c.stats || {}) };
  if (!Number.isFinite(c.money)) c.money = START_MONEY;
  return c;
}

export function saveCareer(c) {
  saveJSON(CAREER_KEY, c);
}

export const owns = (c, id) => !!c.owned[id];
export const upgradeLevel = (c, carId, upId) => c.owned[carId]?.up?.[upId] || 0;

export function carColorIndex(c, id) {
  const car = findCar(id);
  const idx = c.owned[id]?.color;
  if (Number.isInteger(idx)) return idx;
  const def = PAINT_COLORS.indexOf(car.color);
  return def >= 0 ? def : 0;
}

export function buyCar(c, id) {
  const car = findCar(id);
  if (owns(c, id) || car.modOnly || c.money < car.price) return false;
  c.money -= car.price;
  c.owned[id] = { up: {}, color: carColorIndex(c, id) };
  return true;
}

export function upgradeCost(car, upId, level /* level being bought, 1..3 */) {
  const u = UP[upId];
  if (!u || level < 1 || level > 3) return Infinity;
  return roundTo(carValue(car) * u.cost[level - 1], 50);
}

export function buyUpgrade(c, carId, upId) {
  if (!owns(c, carId)) return false;
  const lv = upgradeLevel(c, carId, upId);
  if (lv >= 3) return false;
  const cost = upgradeCost(findCar(carId), upId, lv + 1);
  if (c.money < cost) return false;
  c.money -= cost;
  c.owned[carId].up = { ...c.owned[carId].up, [upId]: lv + 1 };
  return true;
}

// Mod-menu helpers.
export function unlockCar(c, id) {
  if (!c.owned[id]) c.owned[id] = { up: {}, color: carColorIndex(c, id) };
}
export function unlockAll(c) {
  for (const car of CARS) unlockCar(c, car.id);
}
export function maxUpgrades(c, carId) {
  unlockCar(c, carId);
  const up = {};
  for (const u of UPGRADES) up[u.id] = 3;
  c.owned[carId].up = up;
}

// ---------------------------------------------------------------- spec
// Build the physics spec for a car with its upgrades and the active mods.
export function buildSpec(base, up = {}, mods = MOD_DEFAULTS) {
  const s = JSON.parse(JSON.stringify(base));
  const lv = (k) => Math.max(0, Math.min(3, up[k] || 0));
  const power = UP.engine.values[lv('engine')] * (mods.power || 1);
  s.torque = s.torque.map(([r, t]) => [r, t * power]);
  s.clutchTorque *= Math.max(1, power);
  const w = UP.weight.values[lv('weight')];
  s.mass *= w;
  s.inertia *= w;
  s.mu *= UP.tires.values[lv('tires')];
  s.brakeForce *= UP.brakes.values[lv('brakes')];
  const aero = UP.aero.values[lv('aero')];
  s.clA += aero;
  s.cdA += aero * 0.035;
  s.nitro = UP.nitro.values[lv('nitro')]; // seconds of boost
  s.nitroBoost = 0.6;
  if (s.nitro > 0 || mods.infiniteNitro) s.clutchTorque *= 1.5; // clutch must hold the extra torque
  if (mods.superGrip) { s.mu *= 1.8; s.brakeForce *= 1.7; }
  if (mods.drift) { s.rearGrip *= 0.8; s.frontGrip *= 1.06; }
  if (mods.infiniteNitro) s.nitro = Math.max(s.nitro, 4);
  return s;
}

// Rough performance figures for the garage screen.
export function perfStats(spec) {
  let hp = 0;
  for (const [rpm, t] of spec.torque) if (rpm <= spec.limiter) hp = Math.max(hp, (t * rpm) / 7121);
  const topGear = (spec.limiter / 9.549) * spec.wheelRadius / (spec.gears[6] * spec.final); // m/s
  let maxP = 0;
  for (const [rpm, t] of spec.torque) if (rpm <= spec.limiter) maxP = Math.max(maxP, (t * rpm) / 9.549);
  const drag = Math.cbrt(maxP * 0.9 / (0.5 * 1.2 * spec.cdA));
  return {
    hp: Math.round(hp),
    kg: Math.round(spec.mass),
    grip: spec.mu * spec.rearGrip,
    top: Math.min(topGear, drag), // m/s
    hpPerTon: hp / (spec.mass / 1000),
    nitro: spec.nitro || 0,
  };
}

// ---------------------------------------------------------------- rewards
const POS_PAY = [1, 0.65, 0.45, 0.32, 0.22, 0.16, 0.12, 0.1, 0.08, 0.07];
export const DIFF_PAY = [0.6, 1, 1.5, 2.2];

// Prize money for a finished race.
export function raceReward({ position, opponents, laps, difficulty, trackKm, fastestLap, drift = 0, overtakes = 0, topSpeedBonus = 0 }) {
  const lines = [];
  const field = Math.min(1.25, 0.25 + (0.75 * Math.min(opponents, 5)) / 5 + Math.max(0, opponents - 5) * 0.05);
  const purse = trackKm * laps * 700 * field * DIFF_PAY[difficulty];
  const prize = roundTo(purse * (POS_PAY[position - 1] ?? 0.05), 10);
  lines.push([`P${position} finish`, Math.max(250, prize)]);
  if (fastestLap) lines.push(['Fastest lap', roundTo(600 * DIFF_PAY[difficulty], 10)]);
  if (overtakes > 0) lines.push([`Overtakes ×${overtakes}`, overtakes * 150]);
  if (drift > 0) lines.push(['Drift points', roundTo(drift / 10, 10)]);
  if (topSpeedBonus > 0) lines.push(['Speed trap', topSpeedBonus]);
  const total = lines.reduce((a, [, v]) => a + v, 0);
  return { lines, total };
}

// Pay-per-lap in Time Trial.
export function lapReward({ trackKm, newBest, hadBest }) {
  const lines = [['Lap completed', roundTo(trackKm * 110, 10)]];
  if (newBest) lines.push([hadBest ? 'New personal best' : 'First timed lap', hadBest ? 1200 : 300]);
  return { lines, total: lines.reduce((a, [, v]) => a + v, 0) };
}

export function maxPrize(opts) {
  return raceReward({ ...opts, position: 1, fastestLap: true }).total;
}

// ---------------------------------------------------------------- mods
export function loadMods() {
  return { ...MOD_DEFAULTS, ...(loadJSON(MODS_KEY, {}) || {}) };
}
export function saveMods(m) {
  saveJSON(MODS_KEY, m);
}
export function modsActive(m) {
  return Object.keys(MOD_DEFAULTS).some((k) => m[k] !== MOD_DEFAULTS[k]);
}

export function fmtMoney(v) {
  return '$' + Math.round(v).toLocaleString('en-US');
}
