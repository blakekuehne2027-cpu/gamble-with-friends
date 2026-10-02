// Career economy and mod-menu specs: purchases, rewards, and physics staying
// stable even with absurd mod combinations.
import { CARS, findCar } from '../src/cars.js';
import { newCareer, buyCar, buyUpgrade, upgradeLevel, upgradeCost, buildSpec, raceReward, lapReward, maxUpgrades, unlockAll, perfStats, MOD_DEFAULTS, UPGRADES } from '../src/career.js';
import { CarPhysics } from '../src/physics.js';

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('  FAIL', msg); } };

// Buying.
const c = newCareer();
check(c.money === 5000 && c.owned.rookie, 'new career starts with the Rookie and $5,000');
check(!buyCar(c, 'vortex'), 'cannot afford the Vortex at the start');
check(!buyCar(c, 'hypernova'), 'HYPERNOVA is mod-menu only');
const cost1 = upgradeCost(findCar('rookie'), 'engine', 1);
check(buyUpgrade(c, 'rookie', 'engine') && c.money === 5000 - cost1, 'engine upgrade bought');
check(upgradeLevel(c, 'rookie', 'engine') === 1, 'engine level 1');
c.money = 1e6;
check(buyCar(c, 'vortex') && c.owned.vortex, 'Vortex bought');
for (let i = 0; i < 5; i++) buyUpgrade(c, 'vortex', 'tires');
check(upgradeLevel(c, 'vortex', 'tires') === 3, 'upgrades cap at level 3');
unlockAll(c);
check(CARS.every((car) => c.owned[car.id]), 'unlock all');

// Rewards.
const win = raceReward({ position: 1, opponents: 5, laps: 3, difficulty: 1, trackKm: 2.73, fastestLap: true, overtakes: 5, drift: 2400 });
const last = raceReward({ position: 6, opponents: 5, laps: 3, difficulty: 1, trackKm: 2.73, fastestLap: false });
const pro = raceReward({ position: 1, opponents: 5, laps: 3, difficulty: 3, trackKm: 2.73, fastestLap: true });
console.log(`win (medium): $${win.total}  last: $${last.total}  win (pro): $${pro.total}`);
check(win.total > 5000 && win.total < 10000, 'a medium 3-lap win pays $5k-$10k');
check(last.total >= 250 && last.total < win.total / 3, 'last place still pays a little');
check(pro.total > win.total * 1.5, 'pro pays much more');
const races = Math.ceil(findCar('vortex').price / win.total);
console.log(`Vortex GT affordable after ~${races} medium wins`);
check(races >= 3 && races <= 7, 'progression pace');
check(lapReward({ trackKm: 2.7, newBest: true, hadBest: true }).total > 1000, 'TT PB bonus');

// Upgrades make cars measurably better.
for (const car of CARS) {
  const stock = perfStats(buildSpec(car, {}));
  const full = perfStats(buildSpec(car, Object.fromEntries(UPGRADES.map((u) => [u.id, 3]))));
  check(full.hp > stock.hp * 1.2 && full.kg < stock.kg && full.grip > stock.grip, `${car.name} upgrades improve stats`);
  console.log(`${car.name.padEnd(13)} ${stock.hp} hp -> ${full.hp} hp, ${stock.kg} kg -> ${full.kg} kg, top ${(stock.top * 3.6).toFixed(0)} km/h`);
}

// Physics must survive the craziest mod combinations.
const H = 1 / 240;
const env = { mu: 1, drag: 0, slope: 0 };
const combos = [
  { power: 5, superGrip: true },
  { power: 5, drift: true },
  { power: 3, superGrip: true, infiniteNitro: true },
];
for (const car of CARS) {
  for (const m of combos) {
    const spec = buildSpec(car, Object.fromEntries(UPGRADES.map((u) => [u.id, 3])), { ...MOD_DEFAULTS, ...m });
    const p = new CarPhysics(spec);
    let bad = false;
    for (let f = 0; f < 60 * 12; f++) {
      const t = f / 60;
      const ctl = { throttle: t < 8 ? 1 : 0, brake: t >= 8 ? 1 : 0, clutch: 0, steer: t > 4 && t < 6 ? -0.6 : 0.05, nitro: t < 4, autoClutch: true, abs: true, tc: !m.drift, handbrake: false };
      p.updateTransmission(1 / 60, { mode: 'auto', ...ctl });
      for (let k = 0; k < 4; k++) p.step(H, ctl, env);
      if (!Number.isFinite(p.u + p.v + p.r + p.omegaE + p.x)) { bad = true; break; }
    }
    check(!bad, `${car.name} ${JSON.stringify(m)} produced NaN`);
    check(Math.hypot(p.u, p.v) < 80, `${car.name} ${JSON.stringify(m)} did not slow down (${Math.hypot(p.u, p.v)})`);
  }
}
console.log('extreme mods: physics stable');

// Max upgrades helper.
const c2 = newCareer();
maxUpgrades(c2, 'hypernova');
check(c2.owned.hypernova && UPGRADES.every((u) => c2.owned.hypernova.up[u.id] === 3), 'max upgrades unlocks + maxes');

if (failed) { console.error(`${failed} career check(s) failed`); process.exit(1); }
console.log('career tests passed');
