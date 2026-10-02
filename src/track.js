// Track geometry shared by physics, AI and rendering. No three.js in here so it
// can be unit-tested in Node.
//
// Coordinate conventions (used everywhere in the game):
//   world ground plane is x/z, y is up.
//   heading psi: forward vector = (sin psi, cos psi); psi grows when turning LEFT.
//   left vector  = (cos psi, -sin psi)

export const TRACKS = [
  {
    id: 'coast',
    name: 'Coastline GP',
    blurb: 'Fast sweepers above the ocean. Big braking into the hairpin.',
    theme: 'day',
    width: 13,
    wallDist: 18,
    terrain: { base: 2, amp: 26, oceanSide: -1 },
    points: [
      [-260, 0, 8], [-80, 0, 8], [100, 0, 8], [260, 0, 8],
      [380, 25, 8], [450, 120, 9], [440, 250, 11], [370, 340, 13],
      [270, 350, 14], [200, 420, 15], [210, 540, 16], [140, 640, 17],
      [20, 650, 17], [-60, 570, 16], [-40, 470, 15], [-120, 400, 14],
      [-260, 420, 12], [-400, 380, 11], [-470, 260, 10], [-450, 130, 9],
      [-380, 30, 8],
    ],
  },
  {
    id: 'pine',
    name: 'Pinewood Ring',
    blurb: 'Hilly, technical forest circuit with blind crests and an esses section.',
    theme: 'forest',
    width: 12,
    wallDist: 17,
    terrain: { base: 0, amp: 45, oceanSide: 0 },
    points: [
      [-200, 0, 20], [0, 0, 20], [180, 0, 21], [300, 40, 24],
      [340, 150, 30], [280, 250, 35], [300, 350, 37], [400, 400, 36],
      [500, 340, 33], [560, 420, 30], [520, 540, 27], [400, 600, 24],
      [260, 560, 22], [150, 610, 20], [30, 560, 18], [-30, 450, 17],
      [-140, 420, 16], [-250, 480, 15], [-350, 420, 15], [-330, 300, 16],
      [-230, 230, 17], [-300, 130, 18], [-310, 40, 19],
    ],
  },
  {
    id: 'night',
    name: 'Midnight Circuit',
    blurb: 'Flat-out street circuit under the lights. 90-degree corners, close walls.',
    theme: 'night',
    width: 12,
    wallDist: 13,
    terrain: { base: 0, amp: 4, oceanSide: 0 },
    points: [
      [-300, 0, 0], [-100, 0, 0], [100, 0, 0], [300, 0, 0], [350, 20, 0],
      [370, 70, 0], [370, 250, 0], [350, 300, 0], [300, 320, 0], [150, 320, 0],
      [110, 340, 0], [100, 380, 0], [100, 480, 0], [80, 530, 0], [30, 550, 0],
      [-150, 550, 0], [-200, 530, 0], [-220, 480, 0], [-220, 300, 0], [-260, 260, 0],
      [-330, 240, 0], [-370, 200, 0], [-380, 150, 0], [-380, 60, 0], [-355, 15, 0],
    ],
  },
  {
    id: 'strip',
    name: 'Thunder Valley Dragway',
    blurb: 'Quarter-mile drag strip. Two lanes, one winner.',
    theme: 'strip',
    drag: true,
    width: 18,
    wallDist: 14,
    terrain: { base: 0, amp: 10, oceanSide: 0 },
    // A long straight (the strip + shutdown area) closed into a loop so the
    // track code can treat it like any other circuit.
    points: [
      [0, 0, 0], [400, 0, 0], [800, 0, 0], [1200, 0, 0], [1500, 0, 0], [1606, 44, 0], [1650, 150, 0], [1606, 256, 0],
      [1500, 300, 0], [1000, 300, 0], [500, 300, 0], [0, 300, 0], [-500, 300, 0], [-606, 256, 0], [-650, 150, 0],
      [-606, 44, 0], [-500, 0, 0],
    ],
  },
];

export const QUARTER_MILE = 402.34;

const SAMPLE_SPACING = 2; // metres between track samples

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Small deterministic value-noise so terrain looks the same every run.
function hash2(ix, iz, seed) {
  let h = ix * 374761393 + iz * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h & 0xffff) / 0xffff;
}
function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
export function fbm(x, z, seed = 1, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + i * 17);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum; // ~0..1
}

// Centripetal Catmull-Rom between p1 and p2.
function catmullRom(p0, p1, p2, p3, t) {
  const dist = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), 0.5) || 1e-4;
  const t0 = 0, t1 = t0 + dist(p0, p1), t2 = t1 + dist(p1, p2), t3 = t2 + dist(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a1 = ((t1 - tt) * p0[k] + (tt - t0) * p1[k]) / (t1 - t0);
    const a2 = ((t2 - tt) * p1[k] + (tt - t1) * p2[k]) / (t2 - t1);
    const a3 = ((t3 - tt) * p2[k] + (tt - t2) * p3[k]) / (t3 - t2);
    const b1 = ((t2 - tt) * a1 + (tt - t0) * a2) / (t2 - t0);
    const b2 = ((t3 - tt) * a2 + (tt - t1) * a3) / (t3 - t1);
    out[k] = ((t2 - tt) * b1 + (tt - t1) * b2) / (t2 - t1);
  }
  return out;
}

export class Track {
  constructor(def) {
    this.def = def;
    this.halfWidth = def.width / 2;
    this.wallDist = def.wallDist;
    this._buildSamples();
    this._buildGrid();
    this._buildRacingLine();
  }

  _buildSamples() {
    const P = this.def.points;
    const n = P.length;
    // Dense polyline first.
    const dense = [];
    const SUB = 60;
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      for (let j = 0; j < SUB; j++) dense.push(catmullRom(p0, p1, p2, p3, j / SUB));
    }
    dense.push(dense[0]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    }
    const total = cum[cum.length - 1];
    const count = Math.round(total / SAMPLE_SPACING);
    this.count = count;
    this.length = total;
    this.ds = total / count;
    const X = new Float64Array(count), Z = new Float64Array(count), H = new Float64Array(count);
    let k = 0;
    for (let i = 0; i < count; i++) {
      const s = i * this.ds;
      while (k < cum.length - 2 && cum[k + 1] < s) k++;
      const f = (s - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]);
      X[i] = dense[k][0] + (dense[k + 1][0] - dense[k][0]) * f;
      Z[i] = dense[k][1] + (dense[k + 1][1] - dense[k][1]) * f;
      H[i] = dense[k][2] + (dense[k + 1][2] - dense[k][2]) * f;
    }
    // The polyline was built from the control points so x is the 1st component,
    // z the 2nd and height the 3rd.
    this.x = X; this.z = Z; this.h = H;
    this.tx = new Float64Array(count); this.tz = new Float64Array(count);
    this.nx = new Float64Array(count); this.nz = new Float64Array(count);
    this.heading = new Float64Array(count);
    this.curv = new Float64Array(count);
    this.grade = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const a = (i - 1 + count) % count, b = (i + 1) % count;
      let dx = X[b] - X[a], dz = Z[b] - Z[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz;
      this.nx[i] = dz; this.nz[i] = -dx; // left normal
      this.heading[i] = Math.atan2(dx, dz);
      this.grade[i] = (H[b] - H[a]) / (2 * this.ds);
    }
    for (let i = 0; i < count; i++) {
      const a = (i - 2 + count) % count, b = (i + 2) % count;
      this.curv[i] = wrapAngle(this.heading[b] - this.heading[a]) / (4 * this.ds);
    }
    // Smoothed curvature magnitude for kerb placement.
    this.kerb = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      let m = 0;
      for (let j = -6; j <= 6; j++) m = Math.max(m, Math.abs(this.curv[(i + j + count) % count]));
      this.kerb[i] = m > 1 / 120 ? 1 : 0;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, sumH = 0;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]);
      minZ = Math.min(minZ, Z[i]); maxZ = Math.max(maxZ, Z[i]);
      sumH += H[i];
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    this.avgHeight = sumH / count;
  }

  _buildGrid() {
    this.cell = 40;
    this.grid = new Map();
    for (let i = 0; i < this.count; i++) {
      const key = this._key(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, (arr = []));
      arr.push(i);
    }
  }
  _key(cx, cz) { return cx * 100003 + cz; }

  wrapIndex(i) { return ((i % this.count) + this.count) % this.count; }
  wrapS(s) { return ((s % this.length) + this.length) % this.length; }

  // Nearest sample by brute force in the spatial grid around (x, z).
  _nearestGlobal(x, z, rings = 2) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= rings; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (r > 0 && ix > cx - r && ix < cx + r && iz > cz - r && iz < cz + r) continue;
          const arr = this.grid.get(this._key(ix, iz));
          if (!arr) continue;
          for (const i of arr) {
            const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    if (best < 0) {
      for (let i = 0; i < this.count; i++) {
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  // Project (x, z) onto the centreline. `hint` is a sample index near the
  // expected answer (pass -1 to search the whole track).
  // Result: { i, s, d (signed lateral, +left), h, tx, tz, nx, nz, heading, curv, grade }
  project(x, z, hint = -1, out = {}) {
    let best = -1;
    if (hint >= 0) {
      let bd = Infinity;
      for (let j = -40; j <= 40; j++) {
        const i = this.wrapIndex(hint + j);
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (bd > (this.wallDist * 2.5) ** 2) best = this._nearestGlobal(x, z);
    } else {
      best = this._nearestGlobal(x, z);
    }
    // Refine on the two neighbouring segments.
    const prev = this.wrapIndex(best - 1);
    const next = this.wrapIndex(best + 1);
    let i0 = best, i1 = next;
    const segT = (a, b) => {
      const ex = this.x[b] - this.x[a], ez = this.z[b] - this.z[a];
      return ((x - this.x[a]) * ex + (z - this.z[a]) * ez) / (ex * ex + ez * ez);
    };
    let t = segT(best, next);
    if (t < 0) {
      i0 = prev; i1 = best;
      t = segT(prev, best);
    }
    t = Math.min(1, Math.max(0, t));
    const px = this.x[i0] + (this.x[i1] - this.x[i0]) * t;
    const pz = this.z[i0] + (this.z[i1] - this.z[i0]) * t;
    const tx = this.tx[i0] + (this.tx[i1] - this.tx[i0]) * t;
    const tz = this.tz[i0] + (this.tz[i1] - this.tz[i0]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    out.i = t < 0.5 ? i0 : i1;
    out.s = this.wrapS((i0 + t) * this.ds);
    out.tx = tx / tl; out.tz = tz / tl;
    out.nx = out.tz; out.nz = -out.tx;
    out.d = (x - px) * out.nx + (z - pz) * out.nz;
    out.h = this.h[i0] + (this.h[i1] - this.h[i0]) * t;
    out.heading = Math.atan2(out.tx, out.tz);
    out.curv = this.curv[i0];
    out.grade = this.grade[i0];
    return out;
  }

  // Sample point along the centreline at distance s, offset laterally by d.
  pointAt(s, d = 0, out = {}) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const i0 = Math.floor(f) % this.count, i1 = (i0 + 1) % this.count, t = f - Math.floor(f);
    const tx = this.tx[i0] + (this.tx[i1] - this.tx[i0]) * t;
    const tz = this.tz[i0] + (this.tz[i1] - this.tz[i0]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    out.tx = tx / tl; out.tz = tz / tl;
    out.nx = out.tz; out.nz = -out.tx;
    out.x = this.x[i0] + (this.x[i1] - this.x[i0]) * t + out.nx * d;
    out.z = this.z[i0] + (this.z[i1] - this.z[i0]) * t + out.nz * d;
    out.h = this.h[i0] + (this.h[i1] - this.h[i0]) * t;
    out.heading = Math.atan2(out.tx, out.tz);
    out.i = i0;
    out.grade = this.grade[i0];
    return out;
  }

  // Interpolated per-sample array value at distance s.
  sampleArray(arr, s) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const i0 = Math.floor(f) % this.count, i1 = (i0 + 1) % this.count, t = f - Math.floor(f);
    return arr[i0] + (arr[i1] - arr[i0]) * t;
  }

  // Ambient landscape height far away from the track.
  farHeight(x, z) {
    const T = this.def.terrain;
    let h = T.base + (fbm(x / 420, z / 420, 7) - 0.45) * T.amp * 2 + (fbm(x / 90, z / 90, 3) - 0.5) * T.amp * 0.25;
    if (T.oceanSide) {
      // Land slopes down into the sea on one side (negative z for oceanSide -1).
      const edge = T.oceanSide < 0 ? this.bounds.minZ - 80 : this.bounds.maxZ + 80;
      const dist = T.oceanSide < 0 ? edge - z : z - edge;
      h -= smoothstep(-60, 260, dist) * (T.amp + 20);
    }
    return h;
  }

  // Ground height anywhere (used for the terrain mesh and off-track physics).
  heightAt(x, z, hint = -1) {
    const p = this.project(x, z, hint, _tmpProj);
    const ad = Math.abs(p.d);
    if (ad <= this.wallDist + 3) return p.h;
    const t = smoothstep(this.wallDist + 3, this.wallDist + 70, ad);
    return p.h + (this.farHeight(x, z) - p.h) * t;
  }

  // Fast terrain query for mesh building: returns { h, d } where d is the
  // distance to the centreline (Infinity if further than ~80 m).
  terrainAt(x, z, out = {}) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let ix = cx - 2; ix <= cx + 2; ix++) {
      for (let iz = cz - 2; iz <= cz + 2; iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (const i of arr) {
          const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (best < 0) {
      out.h = this.farHeight(x, z);
      out.d = Infinity;
      return out;
    }
    const p = this.project(x, z, best, _tmpProj);
    const ad = Math.abs(p.d);
    out.d = ad;
    out.i = p.i;
    if (ad <= this.wallDist + 3) out.h = p.h;
    else {
      const t = smoothstep(this.wallDist + 3, this.wallDist + 70, ad);
      out.h = p.h + (this.farHeight(x, z) - p.h) * t;
    }
    return out;
  }

  // Surface type for the given lateral offset.
  surfaceAt(d, i) {
    const ad = Math.abs(d);
    if (ad <= this.halfWidth) return 'asphalt';
    if (ad <= this.halfWidth + 1.4 && this.kerb[i]) return 'kerb';
    return 'grass';
  }

  // Minimum-curvature racing line: offsets (+left) per sample within the road.
  _buildRacingLine() {
    const n = this.count;
    const limit = this.halfWidth - 1.6;
    const off = new Float64Array(n);
    const px = new Float64Array(n), pz = new Float64Array(n);
    for (let iter = 0; iter < 400; iter++) {
      for (let i = 0; i < n; i++) {
        px[i] = this.x[i] + this.nx[i] * off[i];
        pz[i] = this.z[i] + this.nz[i] * off[i];
      }
      for (let i = 0; i < n; i++) {
        const a = (i - 3 + n) % n, b = (i + 3) % n;
        const mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2;
        const target = (mx - this.x[i]) * this.nx[i] + (mz - this.z[i]) * this.nz[i];
        off[i] = Math.max(-limit, Math.min(limit, off[i] + (target - off[i]) * 0.6));
      }
    }
    this.lineOffset = off;
    // Speed profile along the racing line (normalised later by car grip).
    const curvLine = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = this.x[i] + this.nx[i] * off[i];
      pz[i] = this.z[i] + this.nz[i] * off[i];
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 4 + n) % n, b = (i + 4) % n;
      const h1 = Math.atan2(px[i] - px[a], pz[i] - pz[a]);
      const h2 = Math.atan2(px[b] - px[i], pz[b] - pz[i]);
      const l = Math.hypot(px[b] - px[a], pz[b] - pz[a]) / 2 || 1;
      curvLine[i] = wrapAngle(h2 - h1) / l;
    }
    // Light smoothing.
    this.lineCurv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -3; j <= 3; j++) s += Math.abs(curvLine[(i + j + n) % n]);
      this.lineCurv[i] = s / 7;
    }
  }

  // Build a target-speed profile for a car with lateral grip `mu` (g),
  // braking decel `brake` (m/s^2), top speed `vmax` and accel function a(v).
  speedProfile(mu, brake, vmax, accel) {
    const n = this.count, g = 9.81;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = this.lineCurv[i];
      v[i] = Math.min(vmax, k > 1e-5 ? Math.sqrt((mu * g) / k) : vmax);
    }
    const ds = this.ds;
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 2 * n; j > 0; j--) {
        const i = j % n, nx = (i + 1) % n;
        v[i] = Math.min(v[i], Math.sqrt(v[nx] * v[nx] + 2 * brake * ds));
      }
      for (let j = 0; j < 2 * n; j++) {
        const i = j % n, nx = (i + 1) % n;
        v[nx] = Math.min(v[nx], Math.sqrt(v[i] * v[i] + 2 * Math.max(0.3, accel(v[i])) * ds));
      }
    }
    return v;
  }
}

const _tmpProj = {};

const trackCache = new Map();
export function getTrack(i) {
  if (!trackCache.has(i)) trackCache.set(i, new Track(TRACKS[i]));
  return trackCache.get(i);
}
