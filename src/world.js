// Builds the 3D environment for a track: sky, lighting, terrain, road, kerbs,
// walls, scenery and the start-light gantry.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothstep, fbm } from './track.js';

export const ROAD_Y = 0.1; // road surface sits slightly above the terrain

export const THEMES = {
  day: {
    skyTop: 0x2f6fd0, skyHorizon: 0xcfe3f2, skyBottom: 0x8aa7bf,
    fog: 0xc4d9ea, fogNear: 350, fogFar: 3200,
    sunDir: [0.45, 0.62, -0.35], sunColor: 0xfff1d8, sunIntensity: 3.2,
    hemiSky: 0xcfe6ff, hemiGround: 0x546b3a, hemiIntensity: 1.25,
    grass: [0x4e8a2a, 0x6b9c35], mow: 0x5b9a33, sand: 0xd8c690, rock: 0x7d7b74,
    trees: 'round', treeCount: 1300, water: true, mountains: 0x7f97ad, exposure: 1.0,
  },
  forest: {
    skyTop: 0x4d79b8, skyHorizon: 0xf2d6b0, skyBottom: 0x9a8a7a,
    fog: 0xd9c9b0, fogNear: 200, fogFar: 2200,
    sunDir: [-0.6, 0.32, 0.5], sunColor: 0xffd29a, sunIntensity: 3.0,
    hemiSky: 0xffe4c4, hemiGround: 0x3d4a2a, hemiIntensity: 1.1,
    grass: [0x3f6e24, 0x587f2c], mow: 0x4c7f2a, sand: 0xb59c6c, rock: 0x6f6a62,
    trees: 'pine', treeCount: 3200, water: false, mountains: 0x8a8f99, exposure: 1.05,
  },
  night: {
    skyTop: 0x02040c, skyHorizon: 0x1b2140, skyBottom: 0x0a0c16,
    fog: 0x0d1122, fogNear: 80, fogFar: 900,
    sunDir: [0.3, 0.8, 0.4], sunColor: 0x9fb4ff, sunIntensity: 0.35,
    hemiSky: 0x4a5a99, hemiGround: 0x15151c, hemiIntensity: 0.55,
    grass: [0x1f2f1a, 0x2a3a22], mow: 0x263822, sand: 0x444038, rock: 0x3a3a40,
    trees: null, treeCount: 0, water: false, mountains: null, city: true, lamps: true, exposure: 1.15,
  },
};

const rand = mulberry32(1234);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(g, w, h, n, base, spread, alpha = 1) {
  for (let i = 0; i < n; i++) {
    const v = base + (Math.random() - 0.5) * spread;
    g.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},${alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

export function makeTextures() {
  const asphalt = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#45474b';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 26000, 70, 50, 0.9);
    speckle(g, w, h, 4000, 110, 40, 0.5);
    // Darker rubbered lane in the middle third.
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.35, 'rgba(0,0,0,0.12)');
    grd.addColorStop(0.65, 'rgba(0,0,0,0.12)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // White edge lines.
    g.fillStyle = '#e8e8e8';
    g.fillRect(10, 0, 9, h);
    g.fillRect(w - 19, 0, 9, h);
  });
  const kerb = canvasTexture(64, 128, (g, w, h) => {
    g.fillStyle = '#d42020';
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, h / 2, w, h / 2);
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0.25)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.2)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  const grass = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 18000, 200, 110, 0.6);
  });
  const mow = canvasTexture(64, 256, (g, w, h) => {
    g.fillStyle = '#d0d0d0';
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#b0b0b0';
    g.fillRect(0, h / 2, w, h / 2);
    speckle(g, w, h, 5000, 190, 90, 0.5);
  });
  const wall = canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#b9b9b4';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 3000, 170, 60, 0.6);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, 2, h);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f2f2f2' : '#d42020';
      g.fillRect((i * w) / 8, 0, w / 8, 12);
    }
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, h - 6, w, 6);
  });
  const crowd = canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#2b2b33';
    g.fillRect(0, 0, w, h);
    const cols = ['#e63946', '#f1faee', '#a8dadc', '#ffbe0b', '#3a86ff', '#ff006e', '#8338ec', '#fb5607', '#222'];
    for (let i = 0; i < 900; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.fillRect(Math.random() * w, Math.random() * h, 3, 4);
    }
  });
  return { asphalt, kerb, grass, mow, wall, crowd };
}

function sponsorTexture(text, bg, fg) {
  return canvasTexture(512, 96, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = 'italic 900 64px Arial Black, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  }, { repeat: false });
}

function boardTexture(text) {
  return canvasTexture(128, 160, (g, w, h) => {
    g.fillStyle = '#f4f4f4';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111';
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#111';
    g.font = 'bold 64px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2);
  }, { repeat: false });
}

// Strip between two rows of points. a[i], b[i] = [x, y, z]; v[i] texture coordinate.
function ribbon(a, b, v, uA = 0, uB = 1) {
  const n = a.length;
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4);
  const idx = [];
  for (let i = 0; i < n; i++) {
    pos.set(a[i], i * 6);
    pos.set(b[i], i * 6 + 3);
    uv[i * 4] = uA; uv[i * 4 + 1] = v[i];
    uv[i * 4 + 2] = uB; uv[i * 4 + 3] = v[i];
    if (i < n - 1) {
      const A = i * 2, B = i * 2 + 1, A1 = i * 2 + 2, B1 = i * 2 + 3;
      idx.push(A, B, A1, B, B1, A1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class World {
  constructor(renderer, track, themeName, quality = 'high') {
    this.renderer = renderer;
    this.track = track;
    this.theme = THEMES[themeName];
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.tex = makeTextures();
    this.startLights = [];
    this._build();
  }

  _build() {
    const T = this.theme, scene = this.scene;
    scene.fog = new THREE.Fog(T.fog, T.fogNear, T.fogFar);
    scene.background = new THREE.Color(T.fog);

    this._buildSky();
    // Lights.
    this.hemi = new THREE.HemisphereLight(T.hemiSky, T.hemiGround, T.hemiIntensity);
    scene.add(this.hemi);
    this.sunDir = new THREE.Vector3(...T.sunDir).normalize();
    this.sun = new THREE.DirectionalLight(T.sunColor, T.sunIntensity);
    this.sun.castShadow = true;
    const sm = this.quality === 'low' ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    this._buildTerrain();
    this._buildRoad();
    this._buildWalls();
    this._buildStart();
    this._buildBrakeBoards();
    if (T.trees) this._buildTrees();
    if (T.water) this._buildWater();
    if (T.mountains) this._buildMountains();
    if (T.lamps) this._buildLamps();
    if (T.city) this._buildCity();
    this._buildEnvMap();
  }

  _skyMaterial() {
    const T = this.theme;
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(T.skyTop) },
        horizon: { value: new THREE.Color(T.skyHorizon) },
        bottom: { value: new THREE.Color(T.skyBottom) },
        sunDir: { value: new THREE.Vector3(...T.sunDir).normalize() },
        sunColor: { value: new THREE.Color(T.sunColor) },
        night: { value: T.city ? 1 : 0 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 top, horizon, bottom, sunDir, sunColor; uniform float night; varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55));
          col = mix(col, bottom, smoothstep(0.0, -0.25, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 900.0) * (night > 0.5 ? 1.5 : 6.0) + pow(s, 10.0) * (night > 0.5 ? 0.05 : 0.22));
          if (night > 0.5 && h > 0.02) {
            vec3 q = floor(d * 400.0);
            float st = hash(q);
            col += vec3(step(0.9965, st)) * (0.6 + 0.4*hash(q+1.0)) * smoothstep(0.02, 0.3, h);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }

  _buildSky() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this._skyMaterial());
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _buildEnvMap() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this._skyMaterial()));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 32), new THREE.MeshBasicMaterial({ color: this.theme.grass[0] }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    envScene.add(ground);
    this.envMap = pm.fromScene(envScene, 0.02).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = this.theme.city ? 0.35 : 0.9;
    pm.dispose();
  }

  _buildTerrain() {
    const t = this.track, T = this.theme;
    const margin = 900;
    const b = t.bounds;
    const x0 = b.minX - margin, x1 = b.maxX + margin, z0 = b.minZ - margin, z1 = b.maxZ + margin;
    const step = this.quality === 'low' ? 12 : 8;
    const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const H = new Float32Array(nx * nz);
    const D = new Float32Array(nx * nz);
    const tmp = {};
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        t.terrainAt(x, z, tmp);
        let h = tmp.h;
        // Sink the terrain under the road + run-off so the ribbons on top never clip.
        h -= 0.45 * (1 - smoothstep(t.wallDist + 2, t.wallDist + 8, tmp.d));
        H[j * nx + i] = h;
        D[j * nx + i] = tmp.d;
      }
    }
    const c1 = new THREE.Color(T.grass[0]), c2 = new THREE.Color(T.grass[1]);
    const sand = new THREE.Color(T.sand), rock = new THREE.Color(T.rock);
    const c = new THREE.Color();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = x0 + i * step, z = z0 + j * step;
        pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
        uv[k * 2] = x / 10; uv[k * 2 + 1] = z / 10;
        const hx = H[j * nx + Math.min(nx - 1, i + 1)] - H[j * nx + Math.max(0, i - 1)];
        const hz = H[Math.min(nz - 1, j + 1) * nx + i] - H[Math.max(0, j - 1) * nx + i];
        const slope = Math.hypot(hx, hz) / (2 * step);
        c.copy(c1).lerp(c2, fbm(x / 60, z / 60, 11));
        if (T.water && H[k] < 3.5) c.lerp(sand, smoothstep(3.5, 1.5, H[k]));
        c.lerp(rock, smoothstep(0.35, 0.8, slope));
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b2 = a + 1, c3 = a + nx, d = c3 + 1;
        idx[p++] = a; idx[p++] = c3; idx[p++] = b2;
        idx[p++] = b2; idx[p++] = c3; idx[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: this.tex.grass, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrainInfo = { x0, z0, nx, nz, step, H, D };
  }

  _buildRoad() {
    const t = this.track, n = t.count;
    const rows = (d, yOff, filter) => {
      const out = [];
      for (let i = 0; i <= n; i++) {
        const k = i % n;
        out.push([t.x[k] + t.nx[k] * d(k), t.h[k] + yOff, t.z[k] + t.nz[k] * d(k)]);
      }
      return out;
    };
    const vs = [];
    for (let i = 0; i <= n; i++) vs.push((i * t.ds) / (t.def.width));
    const hw = t.halfWidth;
    // Asphalt.
    const road = new THREE.Mesh(
      ribbon(rows(() => hw, ROAD_Y), rows(() => -hw, ROAD_Y), vs),
      new THREE.MeshStandardMaterial({ map: this.tex.asphalt, roughness: 0.92, metalness: 0.0, color: 0xffffff }),
    );
    road.receiveShadow = true;
    this.scene.add(road);

    // Mowed grass run-off on both sides.
    const mowMat = new THREE.MeshStandardMaterial({ map: this.tex.mow, color: this.theme.mow, roughness: 1 });
    const vs2 = vs.map((v) => v * t.def.width / 12);
    const wd = t.wallDist + 6;
    for (const side of [1, -1]) {
      const inner = rows(() => side * hw, ROAD_Y - 0.03);
      const outer = rows(() => side * wd, ROAD_Y - 0.06);
      const geo = side > 0 ? ribbon(outer, inner, vs2) : ribbon(inner, outer, vs2);
      const m = new THREE.Mesh(geo, mowMat);
      m.receiveShadow = true;
      this.scene.add(m);
    }

    // Kerbs on corners.
    const kerbGeos = [];
    const kw = 1.3;
    for (const side of [1, -1]) {
      let i = 0;
      while (i < n) {
        if (!t.kerb[i]) { i++; continue; }
        let j = i;
        while (j < n && t.kerb[j]) j++;
        const a = [], b = [], v = [];
        for (let k = i; k <= Math.min(j, n - 1) + 1; k++) {
          const q = k % n;
          const x0 = t.x[q], z0 = t.z[q], h = t.h[q] + ROAD_Y + 0.025;
          const pIn = [x0 + t.nx[q] * side * (hw - 0.2), h, z0 + t.nz[q] * side * (hw - 0.2)];
          const pOut = [x0 + t.nx[q] * side * (hw + kw), h - 0.02, z0 + t.nz[q] * side * (hw + kw)];
          if (side > 0) { a.push(pOut); b.push(pIn); } else { a.push(pIn); b.push(pOut); }
          v.push((k * t.ds) / 3);
        }
        if (a.length > 1) kerbGeos.push(ribbon(a, b, v));
        i = j;
      }
    }
    if (kerbGeos.length) {
      const kerb = new THREE.Mesh(mergeGeometries(kerbGeos), new THREE.MeshStandardMaterial({ map: this.tex.kerb, roughness: 0.7 }));
      kerb.receiveShadow = true;
      this.scene.add(kerb);
    }
  }

  _buildWalls() {
    const t = this.track, n = t.count;
    const wd = t.wallDist, hgt = 1.05;
    const geos = [];
    for (const side of [1, -1]) {
      const top = [], bot = [], v = [];
      for (let i = 0; i <= n; i++) {
        const k = i % n;
        const x = t.x[k] + t.nx[k] * side * wd, z = t.z[k] + t.nz[k] * side * wd;
        top.push([x, t.h[k] + ROAD_Y + hgt, z]);
        bot.push([x, t.h[k] - 0.4, z]);
        v.push((i * t.ds) / 4);
      }
      const g = ribbon(top, bot, v);
      // Rotate UVs: u runs along the wall, v up.
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), vv = uv.getY(i);
        uv.setXY(i, vv, u === 0 ? 1 : 0);
      }
      geos.push(g);
    }
    const mat = new THREE.MeshStandardMaterial({ map: this.tex.wall, roughness: 0.85, side: THREE.DoubleSide });
    const walls = new THREE.Mesh(mergeGeometries(geos), mat);
    walls.castShadow = true;
    walls.receiveShadow = true;
    this.scene.add(walls);

    // Sponsor boards on the straights, mounted on the walls.
    const sponsors = [
      ['REDLINE', '#d61f26', '#ffffff'], ['G29 READY', '#111111', '#ffd200'], ['APEX OIL', '#0b5ed7', '#ffffff'],
      ['TORQUE', '#ffffff', '#d61f26'], ['SHIFTER', '#14b8a6', '#06201c'], ['CLUTCH IN', '#f97316', '#111'],
    ];
    const boardGeos = sponsors.map(() => []);
    let k = 0;
    for (let i = 0; i < n; i += 22) {
      if (Math.abs(t.curv[i]) > 1 / 400) continue;
      for (const side of [1, -1]) {
        const d = side * (wd - 0.06);
        const p0 = t.pointAt(i * t.ds - 3, d), p1 = t.pointAt(i * t.ds + 3, d);
        const y0 = p0.h + ROAD_Y + 0.05, y1 = y0 + 0.95;
        const a = side > 0 ? [[p1.x, y1, p1.z], [p0.x, y1, p0.z]] : [[p0.x, y1, p0.z], [p1.x, y1, p1.z]];
        const b = side > 0 ? [[p1.x, y0, p1.z], [p0.x, y0, p0.z]] : [[p0.x, y0, p0.z], [p1.x, y0, p1.z]];
        const g = ribbon(a, b, [0, 1]);
        const uv = g.attributes.uv;
        uv.setXY(0, 1, 1); uv.setXY(1, 1, 0); uv.setXY(2, 0, 1); uv.setXY(3, 0, 0);
        boardGeos[k % sponsors.length].push(g);
        k++;
      }
    }
    sponsors.forEach((sp, j) => {
      if (!boardGeos[j].length) return;
      const m = new THREE.Mesh(mergeGeometries(boardGeos[j]), new THREE.MeshStandardMaterial({ map: sponsorTexture(...sp), roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
      this.scene.add(m);
    });
  }

  _buildStart() {
    const t = this.track, scene = this.scene;
    const hw = t.halfWidth;
    const p = t.pointAt(0, 0);
    // Chequered start/finish line.
    const check = canvasTexture(256, 32, (g, w, h) => {
      const s = 16;
      for (let x = 0; x < w / s; x++) for (let y = 0; y < h / s; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
        g.fillRect(x * s, y * s, s, s);
      }
    }, { repeat: false });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(t.def.width, 1.6), new THREE.MeshStandardMaterial({ map: check, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4 }));
    line.rotation.order = 'YXZ';
    line.rotation.set(-Math.PI / 2, p.heading, 0);
    line.position.set(p.x, p.h + ROAD_Y + 0.01, p.z);
    line.receiveShadow = true;
    scene.add(line);

    // Grid slots.
    const gridMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee, polygonOffset: true, polygonOffsetFactor: -4 });
    for (let i = 0; i < 12; i++) {
      const s = -12 - i * 9;
      const d = i % 2 ? -2.6 : 2.6;
      const q = t.pointAt(s, d);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.25), gridMat);
      bar.rotation.order = 'YXZ';
      bar.rotation.set(-Math.PI / 2, q.heading, 0);
      const f = t.pointAt(s + 2.6, d);
      bar.position.set(f.x, f.h + ROAD_Y + 0.012, f.z);
      scene.add(bar);
    }

    // Gantry with the start lights.
    const gantry = new THREE.Group();
    gantry.position.set(p.x, p.h + ROAD_Y, p.z);
    gantry.rotation.y = p.heading;
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 });
    for (const side of [1, -1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), metal);
      pillar.position.set(side * (hw + 1.4), 4, 0);
      pillar.castShadow = true;
      gantry.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(t.def.width + 3.4, 1.4, 0.8), metal);
    beam.position.set(0, 7.5, 0);
    beam.castShadow = true;
    gantry.add(beam);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(t.def.width, 1.1), new THREE.MeshBasicMaterial({ map: sponsorTexture('REDLINE RACING', '#d61f26', '#ffffff') }));
    banner.position.set(0, 7.5, -0.41);
    banner.rotation.y = Math.PI;
    gantry.add(banner);
    const housing = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.4 });
    for (let i = 0; i < 5; i++) {
      const pod = new THREE.Group();
      pod.position.set((i - 2) * 1.3, 5.8, -0.3);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.4), housing);
      pod.add(box);
      const lamps = [];
      for (let j = 0; j < 2; j++) {
        const m = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, emissiveIntensity: 3, roughness: 0.3 });
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), m);
        lamp.position.set(0, 0.42 - j * 0.85, -0.21);
        lamp.rotation.y = Math.PI;
        pod.add(lamp);
        lamps.push(m);
      }
      gantry.add(pod);
      this.startLights.push(lamps);
    }
    scene.add(gantry);

    // Grandstands on both sides of the main straight.
    const standMat = new THREE.MeshStandardMaterial({ map: this.tex.crowd, roughness: 0.9 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xd61f26, roughness: 0.6, metalness: 0.2 });
    for (const [s0, side] of [[30, 1], [-60, -1], [-150, 1]]) {
      const q = t.pointAt(s0, side * (t.wallDist + 4));
      const stand = new THREE.Group();
      stand.position.set(q.x, q.h, q.z);
      stand.rotation.y = q.heading;
      const len = 70;
      for (let r = 0; r < 7; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9 + r * 0.9, len), r === 0 ? concrete : standMat);
        step.position.set(side * (r * 1.4 + 0.7), (0.9 + r * 0.9) / 2, 0);
        step.castShadow = true;
        step.receiveShadow = true;
        stand.add(step);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(11, 0.3, len + 2), roofMat);
      roof.position.set(side * 5, 10.5, 0);
      roof.rotation.z = side * 0.08;
      roof.castShadow = true;
      stand.add(roof);
      for (let c = -1; c <= 1; c++) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 10.5), concrete);
        col.position.set(side * 10, 5.25, c * (len / 2 - 2));
        stand.add(col);
      }
      scene.add(stand);
    }
  }

  _buildBrakeBoards() {
    const t = this.track;
    const v = t.speedProfile(1.2, 9, 85, (x) => 8 - x * 0.06);
    const n = t.count;
    const tex = { 150: boardTexture('150'), 100: boardTexture('100'), 50: boardTexture('50') };
    const mats = {};
    for (const k in tex) mats[k] = new THREE.MeshStandardMaterial({ map: tex[k], roughness: 0.6 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    let i = 0;
    let guard = 0;
    while (i < n && guard++ < n) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      if (v[i] >= v[a] && v[i] > v[b]) {
        // Local max: follow to the minimum.
        let j = i, steps = 0;
        while (v[(j + 1) % n] <= v[j % n] && steps < n) { j++; steps++; }
        const drop = v[i] - v[j % n];
        if (drop > 14 && steps * t.ds > 60) {
          const sTurn = j * t.ds;
          const outside = t.curv[j % n] > 0 ? -1 : 1;
          for (const dist of [150, 100, 50]) {
            if (dist > steps * t.ds + 60) continue;
            const q = t.pointAt(sTurn - dist, outside * (t.halfWidth + 2.6));
            const g = new THREE.Group();
            g.position.set(q.x, q.h + ROAD_Y, q.z);
            g.rotation.y = q.heading + Math.PI;
            const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), mats[dist]);
            board.position.y = 1.4;
            g.add(board);
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), postMat);
            post.position.y = 0.45;
            g.add(post);
            board.castShadow = true;
            this.scene.add(g);
          }
        }
        i = j + 1;
      } else i++;
    }
  }

  _scatter(count, minD, filter) {
    const t = this.track, b = t.bounds;
    const pts = [];
    const tmp = {};
    let tries = 0;
    while (pts.length < count && tries++ < count * 8) {
      const x = b.minX - 500 + rand() * (b.maxX - b.minX + 1000);
      const z = b.minZ - 500 + rand() * (b.maxZ - b.minZ + 1000);
      t.terrainAt(x, z, tmp);
      if (tmp.d < minD) continue;
      if (filter && !filter(x, z, tmp)) continue;
      pts.push([x, tmp.h, z, tmp.d]);
    }
    return pts;
  }

  _buildTrees() {
    const T = this.theme, t = this.track;
    const count = this.quality === 'low' ? Math.floor(T.treeCount / 2) : T.treeCount;
    const start = t.pointAt(0, 0);
    const pts = this._scatter(count, t.wallDist + 7, (x, z, info) => {
      if (T.water && info.h < 3) return false;
      if (Math.hypot(x - start.x, z - start.z) < 170 && info.d < t.wallDist + 30) return false;
      // Clump trees using noise so the landscape has clearings.
      return fbm(x / 140, z / 140, 5) > (T.trees === 'pine' ? 0.36 : 0.45);
    });
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 3, 6);
    trunkGeo.translate(0, 1.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4030, roughness: 1 });
    let leafGeo;
    if (T.trees === 'pine') {
      const c1 = new THREE.ConeGeometry(2.4, 5.5, 7); c1.translate(0, 4.6, 0);
      const c2 = new THREE.ConeGeometry(1.8, 4.5, 7); c2.translate(0, 7.2, 0);
      leafGeo = mergeGeometries([c1.toNonIndexed(), c2.toNonIndexed()]);
    } else {
      leafGeo = new THREE.IcosahedronGeometry(2.6, 1);
      leafGeo.scale(1, 0.9, 1);
      leafGeo.translate(0, 4.8, 0);
    }
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, pts.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const base = T.trees === 'pine' ? [0x2c4a22, 0x3b5e2b, 0x22401f] : [0x3f7a2a, 0x588f2f, 0x2f6a26, 0x6d9a35];
    pts.forEach((pt, i) => {
      const sc = 0.75 + rand() * 0.75;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      s.set(sc, sc * (0.85 + rand() * 0.4), sc);
      p.set(pt[0], pt[1] - 0.2, pt[2]);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
      col.set(base[(rand() * base.length) | 0]).multiplyScalar(0.85 + rand() * 0.3);
      leaves.setColorAt(i, col);
    });
    for (const im of [trunks, leaves]) {
      im.castShadow = true;
      im.receiveShadow = true;
      this.scene.add(im);
    }
  }

  _buildWater() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(14000, 14000),
      new THREE.MeshStandardMaterial({ color: 0x1b5f8a, roughness: 0.08, metalness: 0.2, envMapIntensity: 1.2 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    this.water = water;
    this.scene.add(water);
  }

  _buildMountains() {
    const t = this.track, b = t.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const mat = new THREE.MeshStandardMaterial({ color: this.theme.mountains, roughness: 1, flatShading: true });
    const snow = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.8, flatShading: true });
    const geo = new THREE.ConeGeometry(1, 1, 9, 3);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0.49) {
        pos.setX(i, pos.getX(i) * (0.85 + rand() * 0.3));
        pos.setZ(i, pos.getZ(i) * (0.85 + rand() * 0.3));
      }
    }
    geo.computeVertexNormals();
    const capGeo = new THREE.ConeGeometry(0.3, 0.3, 9);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rand() * 0.1;
      if (this.theme.water && Math.sin(a) < -0.2) continue; // leave the ocean side open
      const r = 2400 + rand() * 900;
      const hgt = 350 + rand() * 650;
      const w = 500 + rand() * 600;
      const mtn = new THREE.Mesh(geo, mat);
      mtn.position.set(cx + Math.cos(a) * r, hgt / 2 - 40, cz + Math.sin(a) * r);
      mtn.scale.set(w, hgt, w);
      this.scene.add(mtn);
      if (hgt > 700) {
        const cap = new THREE.Mesh(capGeo, snow);
        cap.position.set(mtn.position.x, hgt - 40 - hgt * 0.15 + 2, mtn.position.z);
        cap.scale.set(w * 1.0, hgt, w * 1.0);
        this.scene.add(cap);
      }
    }
  }

  _buildLamps() {
    const t = this.track;
    const spacing = 32;
    const list = [];
    let k = 0;
    for (let s = 0; s < t.length; s += spacing) {
      const side = k++ % 2 ? 1 : -1;
      list.push([s, side]);
    }
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 9, 6); poleGeo.translate(0, 4.5, 0);
    const armGeo = new THREE.BoxGeometry(2.6, 0.15, 0.2); armGeo.translate(-1.3, 9, 0);
    const headGeo = new THREE.BoxGeometry(1.0, 0.18, 0.45); headGeo.translate(-2.4, 8.88, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.6, metalness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfff1cc, emissive: 0xffd89a, emissiveIntensity: 4 });
    const poolTex = canvasTexture(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,220,160,0.75)');
      grd.addColorStop(0.5, 'rgba(255,200,130,0.28)');
      grd.addColorStop(1, 'rgba(255,190,120,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }, { repeat: false });
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 });
    const poolGeo = new THREE.PlaneGeometry(16, 16); poolGeo.rotateX(-Math.PI / 2);
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, list.length);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, list.length);
    const heads = new THREE.InstancedMesh(headGeo, headMat, list.length);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    list.forEach(([s, side], i) => {
      const pt = t.pointAt(s, side * (t.halfWidth + 2.4));
      // Arm points towards the road: local -x must face the centreline.
      q.setFromAxisAngle(up, pt.heading + (side > 0 ? 0 : Math.PI));
      p.set(pt.x, pt.h + ROAD_Y, pt.z);
      m.compose(p, q, one);
      poles.setMatrixAt(i, m); arms.setMatrixAt(i, m); heads.setMatrixAt(i, m);
      const c = t.pointAt(s, side * (t.halfWidth - 0.6));
      p.set(c.x, c.h + ROAD_Y + 0.02, c.z);
      m.compose(p, q, one);
      pools.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    this.scene.add(poles, arms, heads, pools);
  }

  _buildCity() {
    const t = this.track;
    const winTex = canvasTexture(128, 256, (g, w, h) => {
      g.fillStyle = '#0a0b10';
      g.fillRect(0, 0, w, h);
      for (let y = 4; y < h; y += 10) {
        for (let x = 4; x < w; x += 9) {
          const r = Math.random();
          if (r < 0.38) {
            g.fillStyle = r < 0.08 ? '#9fd4ff' : r < 0.3 ? '#ffd88a' : '#ffefc2';
            g.fillRect(x, y, 5, 6);
          }
        }
      }
    });
    const pts = this._scatter(this.quality === 'low' ? 220 : 420, t.wallDist + 12, (x, z, info) => info.d < 260);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x15171f, roughness: 0.8, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 1.6, map: winTex });
    const im = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    pts.forEach((pt, i) => {
      const w = 14 + rand() * 26, d = 14 + rand() * 26;
      const h = 12 + rand() * (pt[3] > 80 ? 110 : 45);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      s.set(w, h, d);
      p.set(pt[0], pt[1] - 0.3, pt[2]);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
    });
    im.castShadow = false;
    im.receiveShadow = true;
    this.scene.add(im);
  }

  // n red lights lit (0..5); green => all lights off (go!).
  setStartLights(n) {
    this.startLights.forEach((lamps, i) => {
      for (const m of lamps) {
        const on = i < n;
        m.emissive.setHex(on ? 0xff1a00 : 0x000000);
        m.color.setHex(on ? 0xff2200 : 0x220000);
      }
    });
  }

  update(focus, camera) {
    // Keep the shadow camera centred on the player.
    const d = this.sunDir;
    this.sun.position.set(focus.x + d.x * 250, focus.y + d.y * 250, focus.z + d.z * 250);
    this.sun.target.position.copy(focus);
    this.sky.position.copy(camera.position);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const k of ['map', 'emissiveMap']) if (m[k]) m[k].dispose();
          m.dispose();
        }
      }
    });
    if (this.envMap) this.envMap.dispose();
  }
}
