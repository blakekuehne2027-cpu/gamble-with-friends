// Checks for the suspension / airtime / rollover layer (chassis.js).
import * as THREE from 'three';
import { CarPhysics } from '../src/physics.js';
import { Chassis, Tumble } from '../src/chassis.js';
import { CARS, findCar } from '../src/cars.js';

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('  FAIL', msg); } };
const H = 1 / 240;
const STYLE = { len: 4.5, width: 1.9, bottom: 0.24, noseH: 0.58, hoodH: 0.86, cowl: 0.62, roofFront: -0.05, roofBack: -0.85, roofH: 1.25, deckStart: -1.5, deckH: 0.98, tailH: 1.0, wing: 'small', cabinW: 0.76 };

// Drive the planar model + chassis together over ground(x, z).
function drive(spec, ground, seconds, ctl, init = {}) {
  const car = new CarPhysics(spec);
  const ch = new Chassis(spec);
  car.u = init.u ?? 0; car.gear = init.gear ?? 1; car.omegaE = Math.max(spec.idle / 9.549, car.totalRatio() * car.u);
  ch.reset(ground(0, 0));
  const env = { mu: 1, drag: 0, slope: 0 };
  const log = { maxAir: 0, air: 0, maxRoll: 0, maxPitch: 0, minY: Infinity, landing: 0, nan: false, tipped: false };
  for (let t = 0; t < seconds; t += 1 / 60) {
    const c = ctl(t, car, ch);
    car.updateTransmission(1 / 60, { mode: 'auto', autoClutch: true, clutch: 0, throttle: c.throttle, brake: c.brake, hGear: 0 });
    for (let k = 0; k < 4; k++) {
      env.contactF = ch.contactF; env.contactR = ch.contactR; env.slope = ch.groundSlope;
      car.step(H, { clutch: 0, handbrake: false, abs: true, tc: true, autoClutch: true, ...c }, env);
      ch.step(H, car, ground);
      log.landing = Math.max(log.landing, ch.landing);
    }
    if (ch.airborne) { log.air += 1 / 60; log.maxAir = Math.max(log.maxAir, log.air); } else log.air = 0;
    log.maxRoll = Math.max(log.maxRoll, Math.abs(ch.roll));
    log.maxPitch = Math.max(log.maxPitch, Math.abs(ch.pitch));
    if (ch.tipped) log.tipped = true;
    if (!Number.isFinite(ch.y + ch.pitch + ch.roll + car.u)) { log.nan = true; break; }
  }
  return { car, ch, log };
}

const flat = () => 0;
for (const spec of CARS) {
  // Settles at rest on flat ground.
  const rest = drive(spec, flat, 3, () => ({ throttle: 0, brake: 1, steer: 0 }));
  check(Math.abs(rest.ch.y) < 0.02 && Math.abs(rest.ch.pitch) < 0.01 && Math.abs(rest.ch.roll) < 0.01, `${spec.name} doesn't settle: y ${rest.ch.y} pitch ${rest.ch.pitch}`);
  check(rest.ch.contactF > 0.99 && rest.ch.contactR > 0.99, `${spec.name} wheels not loaded at rest`);
  // Cornering hard: body rolls a few degrees, never tips, wheels stay down.
  const corner = drive(spec, flat, 6, (t, c) => ({ throttle: c.u < 28 ? 0.6 : 0.2, brake: 0, steer: 0.12 }), { u: 28, gear: 3 });
  const rollDeg = corner.log.maxRoll * 57.3;
  check(rollDeg > 0.5 && rollDeg < 9 && !corner.log.tipped && corner.log.maxAir === 0, `${spec.name} cornering roll ${rollDeg.toFixed(1)} deg`);
  // Braking dives the nose a little.
  const brake = drive(spec, flat, 3, (t) => ({ throttle: 0, brake: t > 0.5 ? 1 : 0, steer: 0 }), { u: 30, gear: 4 });
  check(brake.log.maxPitch * 57.3 > 0.3 && brake.log.maxPitch * 57.3 < 6, `${spec.name} brake dive ${(brake.log.maxPitch * 57.3).toFixed(1)} deg`);
  console.log(`${spec.name.padEnd(14)} roll ${rollDeg.toFixed(1)} deg, dive ${(brake.log.maxPitch * 57.3).toFixed(1)} deg`);
}

// A kicker ramp: 12 m long, 2 m high, then a drop back to the ground.
const ramp = (x, z) => (z > 40 && z < 52 ? ((z - 40) / 12) * 2 : 0);
const jump = drive(findCar('raptor'), ramp, 6, () => ({ throttle: 0.5, brake: 0, steer: 0 }), { u: 25, gear: 3 });
console.log(`ramp jump at 90 km/h: ${jump.log.maxAir.toFixed(2)} s airborne, landing ${jump.log.landing.toFixed(1)} m/s, max pitch ${(jump.log.maxPitch * 57.3).toFixed(0)} deg`);
check(!jump.log.nan, 'NaN on the ramp');
check(jump.log.maxAir > 0.4 && jump.log.maxAir < 2.5, `airtime ${jump.log.maxAir}`);
check(!jump.log.tipped, 'tipped over on a straight jump');
check(Math.abs(jump.ch.y) < 0.05 && jump.ch.contactF > 0.9 && jump.ch.contactR > 0.9, 'did not land and settle after the jump');

// Rollover: a tumbling car comes to rest without blowing up.
const spec = findCar('rookie');
const T = new Tumble(spec, STYLE);
const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.1, 'YXZ'));
T.start(new THREE.Vector3(0, 1.2, 0), q, new THREE.Vector3(9, 2, 14), new THREE.Vector3(0, 0.6, 5));
let maxV = 0;
for (let i = 0; i < 240 * 12; i++) {
  T.step(H, flat, () => null);
  T.hits.length = 0;
  maxV = Math.max(maxV, T.V.length());
}
console.log(`rollover: settled after 12 s with speed ${T.V.length().toFixed(2)} m/s, spin ${T.W.length().toFixed(2)} rad/s, up.y ${T.up.y.toFixed(2)}, height ${T.X.y.toFixed(2)}`);
check(Number.isFinite(T.X.x + T.X.y + T.q.w), 'NaN in tumble');
check(maxV < 25, `tumble gained energy: ${maxV}`);
check(T.V.length() < 0.5 && T.W.length() < 0.5, 'tumbling car did not come to rest');
check(T.X.y > 0.2 && T.X.y < 1.6, `rest height ${T.X.y}`);

if (failed) { console.error(`${failed} chassis check(s) failed`); process.exit(1); }
console.log('chassis tests passed');
