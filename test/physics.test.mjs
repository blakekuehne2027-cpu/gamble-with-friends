// Headless checks of the vehicle model: performance numbers land in a sane
// range and the simulation stays stable in abuse cases.
import { CarPhysics } from '../src/physics.js';
import { CARS } from '../src/cars.js';

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('  FAIL', msg); } };
const H = 1 / 240;
const env = { mu: 1, drag: 0, slope: 0 };
const assists = { abs: true, tc: true, stability: false, autoClutch: true };

function run(car, seconds, ctlFn, mode = 'auto') {
  let t = 0;
  const log = [];
  while (t < seconds) {
    const c = ctlFn(t, car);
    car.updateTransmission(1 / 60, { mode, autoClutch: true, clutch: 0, throttle: c.throttle, brake: c.brake, hGear: c.hGear ?? 0, shiftUp: false, shiftDown: false, ...c });
    for (let k = 0; k < 4; k++) car.step(H, { clutch: 0, handbrake: false, ...assists, ...c }, env);
    t += 1 / 60;
    if (!Number.isFinite(car.u + car.v + car.r + car.omegaE)) return { nan: true, t };
    log.push({ t, kmh: car.u * 3.6, gear: car.gear, rpm: car.rpm });
  }
  return { log };
}

for (const spec of CARS) {
  console.log(spec.name);
  // 0-100 km/h and top speed.
  let car = new CarPhysics(spec);
  let t100 = null, t200 = null;
  const res = run(car, 60, (t, c) => {
    if (t100 === null && c.u * 3.6 >= 100) t100 = t;
    if (t200 === null && c.u * 3.6 >= 200) t200 = t;
    return { throttle: 1, brake: 0, steer: 0 };
  });
  check(!res.nan, 'NaN in acceleration run');
  const vmax = car.u * 3.6;
  console.log(`  0-100 km/h ${t100?.toFixed(2)} s, 0-200 ${t200?.toFixed(2)} s, speed after 60 s ${vmax.toFixed(0)} km/h, gear ${car.gear}, rpm ${car.rpm.toFixed(0)}`);
  check(t100 > 2.4 && t100 < 6.5, `0-100 ${t100}`);
  check(vmax > 220 && vmax < 340, `top speed ${vmax}`);
  check(Math.abs(car.v) < 0.2 && Math.abs(car.r) < 0.02, 'car drifted sideways in straight line');

  // Braking 100-0.
  car = new CarPhysics(spec);
  car.u = 100 / 3.6; car.gear = 3; car.omegaE = car.totalRatio() * car.u;
  let dist = 0;
  const x0 = car.x, z0 = car.z;
  run(car, 8, () => ({ throttle: 0, brake: 1, steer: 0 }));
  dist = Math.hypot(car.x - x0, car.z - z0);
  console.log(`  100-0 braking ${dist.toFixed(1)} m, final speed ${car.u.toFixed(3)}`);
  check(dist > 25 && dist < 45, `braking distance ${dist}`);
  check(Math.abs(car.u) < 0.05, 'car did not come to rest');

  // Steady cornering at ~100 km/h, half lock: lateral g and stability.
  car = new CarPhysics(spec);
  car.u = 28; car.gear = 3; car.omegaE = car.totalRatio() * car.u;
  let maxAy = 0;
  const r1 = run(car, 6, (t, c) => {
    maxAy = Math.max(maxAy, Math.abs(c.ay));
    return { throttle: c.u < 28 ? 0.6 : 0.2, brake: 0, steer: 0.12 };
  });
  check(!r1.nan, 'NaN in corner');
  console.log(`  cornering: max lat ${(maxAy / 9.81).toFixed(2)} g, yaw rate ${car.r.toFixed(3)}, speed ${(car.u * 3.6).toFixed(0)} km/h`);
  check(maxAy / 9.81 > 0.8 && maxAy / 9.81 < 1.9, `lateral g ${maxAy / 9.81}`);
  check(car.r < 0, 'steering right should yaw right (negative r)');

  // Abuse: full lock + full throttle at speed, no assists, then let go.
  car = new CarPhysics(spec);
  car.u = 45; car.gear = 4; car.omegaE = car.totalRatio() * car.u;
  const r2 = run(car, 4, (t) => ({ throttle: 1, brake: 0, steer: t < 2 ? -1 : 0, tc: false, abs: false }));
  check(!r2.nan, 'NaN in abuse test');
  run(car, 6, () => ({ throttle: 0, brake: 1, steer: 0, tc: false, abs: false }));
  console.log(`  abuse test settled: u=${car.u.toFixed(2)} v=${car.v.toFixed(2)} r=${car.r.toFixed(3)}`);
  check(Math.hypot(car.u, car.v) < 0.5 && Math.abs(car.r) < 0.05, 'car did not settle after abuse');

  // Parked car stays parked.
  car = new CarPhysics(spec);
  run(car, 3, () => ({ throttle: 0, brake: 0, steer: 0.5 }), 'h');
  check(Math.hypot(car.x, car.z) < 0.05, `parked car crept ${Math.hypot(car.x, car.z)}`);

  // H-pattern with manual clutch: dumping the clutch at idle in 1st stalls.
  car = new CarPhysics(spec);
  let stalled = false;
  for (let i = 0; i < 120; i++) {
    const clutch = i < 30 ? 1 : 0;
    car.updateTransmission(1 / 60, { mode: 'h', hGear: 1, clutch, autoClutch: false, throttle: 0, brake: 0 });
    for (let k = 0; k < 4; k++) car.step(H, { throttle: 0, brake: 0, clutch, steer: 0, autoClutch: false, abs: true, tc: false }, env);
    if (!car.engineOn) stalled = true;
  }
  console.log(`  clutch dump at idle stalls: ${stalled}`);
  check(stalled, 'expected a stall');

  // H-pattern manual clutch launch: slip clutch with throttle, should pull away without stalling.
  car = new CarPhysics(spec);
  let ok = true;
  for (let i = 0; i < 360; i++) {
    const t = i / 60;
    const clutch = Math.max(0, 1 - t / 1.5);
    car.updateTransmission(1 / 60, { mode: 'h', hGear: 1, clutch, autoClutch: false, throttle: 0.5, brake: 0 });
    for (let k = 0; k < 4; k++) car.step(H, { throttle: 0.5, brake: 0, clutch, steer: 0, autoClutch: false, abs: true, tc: true }, env);
    if (!car.engineOn) ok = false;
  }
  console.log(`  manual clutch launch: speed ${(car.u * 3.6).toFixed(0)} km/h, engine ${car.engineOn ? 'running' : 'STALLED'}`);
  check(ok && car.u > 5, 'manual launch failed');

  // Grinding: selecting a gear with no clutch and no auto clutch.
  car = new CarPhysics(spec);
  const ev = car.updateTransmission(1 / 60, { mode: 'h', hGear: 2, clutch: 0, autoClutch: false, throttle: 0, brake: 0 });
  check(ev.includes('grind') && car.gear === 0, 'expected a grind');
  const ev2 = car.updateTransmission(1 / 60, { mode: 'h', hGear: 2, clutch: 1, autoClutch: false, throttle: 0, brake: 0 });
  check(ev2.includes('shift') && car.gear === 2, 'clutch should allow the gear');

  // Auto: reverse by holding brake at standstill (pedals swapped by caller).
  car = new CarPhysics(spec);
  run(car, 1.0, (t, c) => (c.gear === -1 ? { throttle: 1, brake: 0, steer: 0 } : { throttle: 0, brake: 1, steer: 0 }));
  run(car, 2.0, () => ({ throttle: 1, brake: 0, steer: 0 }));
  console.log(`  auto reverse: gear ${car.gear}, u ${car.u.toFixed(2)}`);
  check(car.gear === -1 && car.u < -2, 'auto reverse failed');
}

// Traction control keeps every car on its line at any throttle mid-corner.
for (const spec of CARS) {
  for (const thr of [0.3, 0.6, 1]) {
    const car = new CarPhysics(spec);
    car.u = 28; car.gear = 3; car.omegaE = car.totalRatio() * car.u;
    let spun = false;
    run(car, 6, (t, c) => {
      if (Math.abs(c.alphaR) > 0.35) spun = true;
      return { throttle: c.u < 28 ? thr : 0.2, brake: 0, steer: 0.12 };
    });
    check(!spun, `${spec.name} spun with TC at throttle ${thr}`);
  }
}
console.log('traction control: no spins mid-corner');

if (failed) { console.error(`${failed} physics check(s) failed`); process.exit(1); }
console.log('physics tests passed');
