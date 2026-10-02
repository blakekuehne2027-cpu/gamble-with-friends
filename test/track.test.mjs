// Validates track layouts: no sections closer than the walls allow, sane
// elevation, projection round-trips and a usable racing line.
import { TRACKS, Track } from '../src/track.js';

let failed = 0;
const check = (cond, msg) => {
  if (!cond) { failed++; console.error('  FAIL', msg); }
};

for (const def of TRACKS) {
  const t = new Track(def);
  console.log(`${def.name}: ${(t.length / 1000).toFixed(2)} km, ${t.count} samples`);

  // Minimum separation between parts of the track that are far apart along s.
  const minGap = 2 * t.wallDist + 8;
  let worst = Infinity, worstAt = null;
  const window = Math.ceil((t.wallDist * 4) / t.ds);
  for (let i = 0; i < t.count; i += 2) {
    for (let j = i + window; j < t.count; j += 2) {
      if (t.count - (j - i) < window) continue;
      const d = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
      if (d < worst) { worst = d; worstAt = [i, j]; }
    }
  }
  console.log(`  closest non-adjacent sections: ${worst.toFixed(1)} m (need > ${minGap})`);
  check(worst > minGap, `${def.name}: sections ${worstAt} only ${worst.toFixed(1)} m apart`);

  // Tightest corner radius on the centreline.
  let maxK = 0;
  for (let i = 0; i < t.count; i++) maxK = Math.max(maxK, Math.abs(t.curv[i]));
  console.log(`  tightest radius: ${(1 / maxK).toFixed(1)} m`);
  check(1 / maxK > 14, `${def.name}: corner radius too tight (${(1 / maxK).toFixed(1)} m)`);

  // Grade sanity.
  let maxGrade = 0;
  for (let i = 0; i < t.count; i++) maxGrade = Math.max(maxGrade, Math.abs(t.grade[i]));
  console.log(`  max grade: ${(maxGrade * 100).toFixed(1)} %`);
  check(maxGrade < 0.12, `${def.name}: grade too steep`);

  // Projection round trip.
  for (let k = 0; k < 50; k++) {
    const s = Math.random() * t.length;
    const d = (Math.random() * 2 - 1) * t.wallDist;
    const p = t.pointAt(s, d);
    const q = t.project(p.x, p.z, -1);
    let ds = Math.abs(q.s - s);
    ds = Math.min(ds, t.length - ds);
    check(ds < 1.5 && Math.abs(q.d - d) < 0.5, `${def.name}: projection mismatch s=${s.toFixed(1)} d=${d.toFixed(2)} -> s=${q.s.toFixed(1)} d=${q.d.toFixed(2)}`);
  }

  // Racing line stays on the road.
  let maxOff = 0;
  for (let i = 0; i < t.count; i++) maxOff = Math.max(maxOff, Math.abs(t.lineOffset[i]));
  check(maxOff <= t.halfWidth, `${def.name}: racing line leaves road`);

  const prof = t.speedProfile(1.15, 9, 80, (v) => 7 - v * 0.07);
  let lap = 0, vmin = Infinity;
  for (let i = 0; i < t.count; i++) { lap += t.ds / prof[i]; vmin = Math.min(vmin, prof[i]); }
  console.log(`  ideal AI lap ~ ${lap.toFixed(1)} s, slowest corner ${(vmin * 3.6).toFixed(0)} km/h`);
}

if (failed) { console.error(`${failed} track check(s) failed`); process.exit(1); }
console.log('track tests passed');
