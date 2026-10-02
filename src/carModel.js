// Procedural low-poly race cars with spinning/steering wheels, brake lights and
// a driveable cockpit (steering wheel with rev LEDs + digital display).
//
// Car local space: +z forward, +x LEFT, +y up, origin on the ground under the CG.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';

const STYLES = {
  gt: { len: 4.5, width: 1.9, bottom: 0.24, noseH: 0.58, hoodH: 0.86, cowl: 0.62, roofFront: -0.05, roofBack: -0.85, roofH: 1.25, deckStart: -1.5, deckH: 0.98, tailH: 1.0, wing: 'small', cabinW: 0.76 },
  proto: { len: 4.6, width: 1.95, bottom: 0.2, noseH: 0.44, hoodH: 0.78, cowl: 0.5, roofFront: -0.15, roofBack: -0.8, roofH: 1.1, deckStart: -1.35, deckH: 0.92, tailH: 0.96, wing: 'big', cabinW: 0.66 },
  coupe: { len: 4.2, width: 1.82, bottom: 0.24, noseH: 0.62, hoodH: 0.9, cowl: 0.55, roofFront: -0.1, roofBack: -0.9, roofH: 1.32, deckStart: -1.4, deckH: 0.98, tailH: 0.98, wing: 'none', cabinW: 0.8 },
  hyper: { len: 4.8, width: 2.05, bottom: 0.16, noseH: 0.38, hoodH: 0.72, cowl: 0.45, roofFront: -0.2, roofBack: -0.75, roofH: 1.05, deckStart: -1.25, deckH: 0.88, tailH: 0.92, wing: 'big', cabinW: 0.62 },
  truck: { len: 5.3, width: 2.02, bottom: 0.44, noseH: 1.02, hoodH: 1.24, cowl: 0.95, roofFront: 0.38, roofBack: -0.9, roofH: 2.0, deckStart: -1.0, deckH: 1.22, tailH: 1.22, wing: 'none', cabinW: 0.9 },
  muscle: { len: 4.75, width: 1.95, bottom: 0.26, noseH: 0.72, hoodH: 0.95, cowl: 0.55, roofFront: -0.05, roofBack: -0.95, roofH: 1.32, deckStart: -1.65, deckH: 1.05, tailH: 1.04, wing: 'duck', cabinW: 0.8 },
};

const TUB = 0.46; // cockpit floor height
const geoCache = {};
function cached(key, make) {
  return geoCache[key] || (geoCache[key] = make());
}

function bodyShape(st, zOff, wheelZ, R) {
  const s = new THREE.Shape();
  const f = st.len / 2 + zOff, r = -st.len / 2 + zOff;
  const b = st.bottom;
  const Ra = R + 0.07;
  const alpha = Math.asin(Math.min(0.99, (R - b) / Ra));
  const dz = Ra * Math.cos(alpha);
  const [zr, zf] = wheelZ;
  s.moveTo(r + 0.12, b);
  s.lineTo(zr - dz, b);
  s.absarc(zr, R, Ra, Math.PI + alpha, -alpha, true);
  s.lineTo(zf - dz, b);
  s.absarc(zf, R, Ra, Math.PI + alpha, -alpha, true);
  s.lineTo(f - 0.3, b);
  s.quadraticCurveTo(f + 0.04, b, f, st.noseH * 0.62);
  s.quadraticCurveTo(f - 0.04, st.noseH, f - 0.45, st.noseH + 0.06);
  s.quadraticCurveTo(st.cowl + 0.6 + zOff, st.hoodH - 0.02, st.cowl + zOff, st.hoodH);
  // Open cockpit tub (closed off by the glass house and door panels) so the
  // driver's-eye camera can see the dash and steering wheel.
  s.lineTo(st.cowl + zOff - 0.04, TUB);
  s.lineTo(st.deckStart + zOff + 0.04, TUB);
  s.lineTo(st.deckStart + zOff, st.deckH);
  s.lineTo(r + 0.2, st.tailH);
  s.quadraticCurveTo(r - 0.02, st.tailH, r, st.tailH - 0.22);
  s.lineTo(r, b + 0.12);
  s.quadraticCurveTo(r, b, r + 0.12, b);
  return s;
}

function cabinShape(st, zOff) {
  const s = new THREE.Shape();
  s.moveTo(st.cowl + 0.06 + zOff, st.hoodH - 0.06);
  s.lineTo(st.roofFront + zOff, st.roofH);
  s.lineTo(st.roofBack + zOff, st.roofH - 0.01);
  s.quadraticCurveTo(st.deckStart + 0.25 + zOff, st.roofH - 0.12, st.deckStart - 0.02 + zOff, st.deckH - 0.02);
  s.lineTo(st.deckStart + 0.1 + zOff, st.hoodH - 0.12);
  s.closePath();
  return s;
}

function extrude(shape, width, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 10 });
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function numberTexture(num, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#111';
  g.stroke();
  g.fillStyle = '#111';
  g.font = 'bold 72px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

function makeWheel(R, left, mats) {
  const pivot = new THREE.Group();
  const spin = new THREE.Group();
  pivot.add(spin);
  const tire = new THREE.Mesh(cached('tire' + R, () => new THREE.CylinderGeometry(R, R, 0.27, 26, 1).rotateZ(Math.PI / 2)), mats.tire);
  tire.castShadow = true;
  spin.add(tire);
  const rim = new THREE.Mesh(cached('rim' + R, () => new THREE.CylinderGeometry(R * 0.66, R * 0.66, 0.275, 20, 1).rotateZ(Math.PI / 2)), mats.rimDark);
  spin.add(rim);
  const side = left ? 1 : -1;
  const spokeGeo = cached('spoke' + R, () => new THREE.BoxGeometry(0.03, R * 1.22, 0.07));
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Mesh(spokeGeo, mats.rim);
    sp.position.x = side * 0.13;
    sp.rotation.x = (i / 5) * Math.PI * 2;
    spin.add(sp);
  }
  const hub = new THREE.Mesh(cached('hub', () => new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10).rotateZ(Math.PI / 2)), mats.rim);
  hub.position.x = side * 0.14;
  spin.add(hub);
  const caliper = new THREE.Mesh(cached('cal' + R, () => new THREE.BoxGeometry(0.08, R * 0.5, R * 0.32)), mats.caliper);
  caliper.position.set(side * 0.06, R * 0.32, -R * 0.25);
  pivot.add(caliper);
  return { pivot, spin };
}

const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
function isUnder(o, root) {
  for (let p = o; p; p = p.parent) if (p === root) return true;
  return false;
}

let _crackTex = null;
function crackTexture() {
  if (_crackTex) return _crackTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(40,46,54,1)';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(235,240,245,0.85)';
  for (let k = 0; k < 3; k++) {
    const cx = 40 + Math.random() * 176, cy = 40 + Math.random() * 176;
    for (let i = 0; i < 14; i++) {
      let x = cx, y = cy;
      const a0 = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      g.lineWidth = 1 + Math.random();
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        const a = a0 + (Math.random() - 0.5) * 0.6;
        x += Math.cos(a) * (10 + Math.random() * 18);
        y += Math.sin(a) * (10 + Math.random() * 18);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let ring = 1; ring < 4; ring++) {
      g.beginPath();
      g.arc(cx, cy, ring * 14 + Math.random() * 6, 0, Math.PI * 2);
      g.lineWidth = 0.8;
      g.stroke();
    }
  }
  _crackTex = new THREE.CanvasTexture(c);
  _crackTex.wrapS = _crackTex.wrapT = THREE.RepeatWrapping;
  _crackTex.repeat.set(0.6, 0.6);
  _crackTex.colorSpace = THREE.SRGBColorSpace;
  return _crackTex;
}

export class CarModel {
  constructor(spec, color, { number = 7, cockpit = false, helmet = 0xffffff, glow = null } = {}) {
    this.spec = spec;
    const st = STYLES[spec.style] || STYLES.gt;
    this.style = st;
    const R = spec.wheelRadius;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // receives pitch/roll
    this.root.add(this.body);
    // Damage: meshes that dent, and parts that can break off.
    this.deformables = [];
    this.parts = [];
    const part = (id, obj, kind, hp, extra = {}) => {
      obj.updateMatrix();
      const anchor = new THREE.Vector3();
      new THREE.Box3().setFromObject(obj, true).getCenter(anchor);
      this.parts.push({ id, obj, kind, hp, maxHp: hp, anchor, parent: obj.parent, pos: obj.position.clone(), rot: obj.rotation.clone(), detached: false, broken: false, ...extra });
    };
    this._part = part;

    const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    this.paint = paint;
    const mats = {
      tire: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.92 }),
      rim: new THREE.MeshStandardMaterial({ color: 0xd8dadf, metalness: 0.9, roughness: 0.25 }),
      rimDark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.7, roughness: 0.35 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0xd61f26, roughness: 0.4 }),
    };
    const dark = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6, metalness: 0.2 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1016, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.78, envMapIntensity: 1.5 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.35, metalness: 0.5 });

    const zOff = (spec.a - spec.b) / 2;
    const wheelZ = [-spec.b, spec.a];
    const key = spec.style + R;
    const bodyGeo = cached('body' + key, () => extrude(bodyShape(st, zOff, wheelZ, R), st.width));
    const body = new THREE.Mesh(bodyGeo, paint);
    body.castShadow = true;
    body.receiveShadow = true;
    this.body.add(body);
    this.deformables.push(body);

    // Door panels closing the sides of the cockpit tub.
    const doorGeo = cached('door' + key, () => {
      const d = new THREE.Shape();
      d.moveTo(st.cowl + zOff, TUB - 0.02);
      d.lineTo(st.cowl + zOff, st.hoodH);
      d.lineTo(st.deckStart + zOff, st.deckH);
      d.lineTo(st.deckStart + zOff, TUB - 0.02);
      d.closePath();
      const g = new THREE.ExtrudeGeometry(d, { depth: 0.05, bevelEnabled: false });
      g.rotateY(-Math.PI / 2);
      return g;
    });
    this.doorGeo = doorGeo;
    for (const sx of [1, -1]) {
      const door = new THREE.Mesh(doorGeo, paint);
      door.position.x = sx > 0 ? st.width / 2 - 0.0 : -st.width / 2 + 0.05;
      door.castShadow = true;
      this.body.add(door);
      this.deformables.push(door);
      part(sx > 0 ? 'doorL' : 'doorR', door, 'panel', 26);
    }
    const tubMat = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(st.width - 0.12, 0.04, st.cowl - st.deckStart), tubMat);
    floor.position.set(0, TUB, (st.cowl + st.deckStart) / 2 + zOff);
    this.body.add(floor);
    for (const sx of [0.36, -0.36]) {
      const seat = new THREE.Mesh(cached('seat', () => new THREE.BoxGeometry(0.5, 0.62, 0.12)), tubMat);
      seat.position.set(sx, TUB + 0.38, st.roofBack + zOff + 0.12);
      seat.rotation.x = -0.18;
      this.body.add(seat);
      const base = new THREE.Mesh(cached('seatb', () => new THREE.BoxGeometry(0.5, 0.12, 0.5)), tubMat);
      base.position.set(sx, TUB + 0.08, st.roofBack + zOff + 0.4);
      this.body.add(base);
    }

    const cabW = st.width * st.cabinW;
    const cabin = new THREE.Mesh(cached('cabin' + key, () => extrude(cabinShape(st, zOff), cabW, 0.06)), glass);
    cabin.castShadow = true;
    this.body.add(cabin);
    this.cabin = cabin;
    this.glassMat = glass;
    this.deformables.push(cabin);
    const roofLen = st.roofFront - st.roofBack;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cabW - 0.02, 0.05, roofLen + 0.05), paint);
    roof.position.set(0, st.roofH + 0.03, (st.roofFront + st.roofBack) / 2 + zOff);
    roof.castShadow = true;
    this.body.add(roof);
    this.deformables.push(roof);

    // Underbody fill + front splitter + diffuser.
    const under = new THREE.Mesh(new THREE.BoxGeometry(st.width - 0.5, 0.2, st.len - 0.4), dark);
    under.position.set(0, st.bottom + 0.06, zOff);
    this.body.add(under);
    // Bumpers (painted, with the splitter and grille on the front one).
    const f = st.len / 2 + zOff, r = -st.len / 2 + zOff;
    const bumpH = Math.min(0.3, st.noseH * 0.62 - st.bottom + 0.06);
    const frontBumper = new THREE.Group();
    const fb = new THREE.Mesh(cached('bump' + key, () => new RoundedBoxGeometry(st.width - 0.06, bumpH, 0.26, 2, 0.06)), paint);
    fb.position.set(0, st.bottom + bumpH / 2, f - 0.1);
    fb.castShadow = true;
    frontBumper.add(fb);
    this.deformables.push(fb);
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(st.width - 0.1, 0.04, 0.3), trim);
    splitter.position.set(0, st.bottom - 0.02, f - 0.12);
    frontBumper.add(splitter);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(st.width * 0.5, 0.14, 0.05), trim);
    grille.position.set(0, Math.max(st.bottom + bumpH + 0.06, st.noseH * 0.45), f + 0.01);
    frontBumper.add(grille);
    this.body.add(frontBumper);
    part('bumperF', frontBumper, 'panel', 18);
    const rearBumper = new THREE.Group();
    const rbH = Math.min(0.32, st.tailH - 0.3 - st.bottom);
    const rb = new THREE.Mesh(cached('rbump' + key, () => new RoundedBoxGeometry(st.width - 0.06, rbH, 0.24, 2, 0.06)), paint);
    rb.position.set(0, st.bottom + rbH / 2 + 0.02, r + 0.08);
    rb.castShadow = true;
    rearBumper.add(rb);
    this.deformables.push(rb);
    this.body.add(rearBumper);
    part('bumperR', rearBumper, 'panel', 18);

    // Bonnet: a panel following the body's curve, hinged at the windscreen
    // end so it can spring open in a crash before it tears off.
    const hz0 = f - 0.45, hy0 = st.noseH + 0.06, hz1 = st.cowl + zOff, hy1 = st.hoodH;
    const hingeZ = hz1 - 0.02;
    const hoodGeo = cached('hood' + key, () => {
      const curve = new THREE.QuadraticBezierCurve(new THREE.Vector2(hz0, hy0), new THREE.Vector2(st.cowl + 0.6 + zOff, st.hoodH - 0.02), new THREE.Vector2(hz1, hy1));
      const pts = curve.getPoints(12);
      const sh = new THREE.Shape();
      pts.forEach((p, i) => (i ? sh.lineTo(p.x - hingeZ, p.y + 0.014) : sh.moveTo(p.x - hingeZ, p.y + 0.014)));
      for (let i = pts.length - 1; i >= 0; i--) sh.lineTo(pts[i].x - hingeZ, pts[i].y - 0.02);
      const w = st.width * 0.8;
      const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
      g.rotateY(-Math.PI / 2);
      g.translate(w / 2, -hy1, 0);
      g.computeVertexNormals();
      return g;
    });
    const hood = new THREE.Mesh(hoodGeo, paint);
    hood.castShadow = true;
    const hoodPivot = new THREE.Group();
    hoodPivot.position.set(0, hy1, hingeZ);
    hoodPivot.add(hood);
    this.body.add(hoodPivot);
    this.deformables.push(hood);
    part('hood', hoodPivot, 'hood', 22);

    // Lights.
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 1.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.6 });
    this.headMats = [];
    this.tailMats = [];
    for (const sx of [1, -1]) {
      const hm = this.headMat.clone(), tm = this.tailMat.clone();
      this.headMats.push(hm);
      this.tailMats.push(tm);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.1), hm);
      hl.position.set(sx * (st.width / 2 - 0.32), st.noseH * 0.85, st.len / 2 + zOff - 0.28);
      hl.rotation.x = -0.35;
      this.body.add(hl);
      part(sx > 0 ? 'headL' : 'headR', hl, 'light', 5, { mat: hm });
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.06), tm);
      tl.position.set(sx * (st.width / 2 - 0.35), st.tailH - 0.16, -st.len / 2 + zOff - 0.005);
      this.body.add(tl);
      part(sx > 0 ? 'tailL' : 'tailR', tl, 'light', 5, { mat: tm });
      const ex = new THREE.Mesh(cached('exhaust', () => new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10).rotateX(Math.PI / 2)), mats.rim);
      ex.position.set(sx * 0.35, st.bottom + 0.12, -st.len / 2 + zOff - 0.02);
      this.body.add(ex);
      // Mirrors.
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.12), paint);
      mirror.position.set(sx * (cabW / 2 + 0.12), st.hoodH + 0.08, st.cowl + zOff - 0.12);
      this.body.add(mirror);
      part(sx > 0 ? 'mirrorL' : 'mirrorR', mirror, 'panel', 5);
    }

    // Pickup bed: a dark liner on top of the load area, plus a tailgate edge.
    if (spec.style === 'truck') {
      const bedLen = st.deckStart - (-st.len / 2) - 0.25;
      const liner = new THREE.Mesh(new THREE.BoxGeometry(st.width - 0.26, 0.02, bedLen), new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.95 }));
      liner.position.set(0, st.deckH + 0.012, (st.deckStart - 0.05 + (-st.len / 2 + 0.2)) / 2 + zOff);
      this.body.add(liner);
      for (const sx of [1, -1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, bedLen), paint);
        rail.position.set(sx * (st.width / 2 - 0.09), st.deckH + 0.04, liner.position.z);
        this.body.add(rail);
      }
    }

    // Stripes.
    if (spec.style !== 'muscle' && spec.style !== 'truck') {
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 });
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, roofLen + 0.05), stripeMat);
      stripe.position.set(0.16, st.roofH + 0.06, (st.roofFront + st.roofBack) / 2 + zOff);
      this.body.add(stripe);
      const s2 = stripe.clone();
      s2.position.x = -0.16;
      this.body.add(s2);
    }

    // Wings.
    if (st.wing === 'big' || st.wing === 'small') {
      const big = st.wing === 'big';
      const wingGroup = new THREE.Group();
      this.body.add(wingGroup);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(st.width - (big ? 0.05 : 0.25), 0.05, big ? 0.42 : 0.3), trim);
      const wy = st.tailH + (big ? 0.38 : 0.2);
      wing.position.set(0, wy, -st.len / 2 + zOff + 0.25);
      wing.rotation.x = 0.12;
      wing.castShadow = true;
      wingGroup.add(wing);
      for (const sx of [1, -1]) {
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, wy - st.tailH + 0.05, 0.16), trim);
        stand.position.set(sx * (big ? 0.55 : 0.45), (wy + st.tailH) / 2, -st.len / 2 + zOff + 0.28);
        wingGroup.add(stand);
        if (big) {
          const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.5), paint);
          plate.position.set(sx * (st.width / 2 - 0.02), wy, -st.len / 2 + zOff + 0.25);
          wingGroup.add(plate);
        }
      }
      part('wing', wingGroup, 'panel', 14);
    } else if (st.wing === 'duck') {
      const duck = new THREE.Mesh(new THREE.BoxGeometry(st.width - 0.2, 0.06, 0.25), paint);
      duck.position.set(0, st.tailH + 0.03, -st.len / 2 + zOff + 0.12);
      duck.rotation.x = 0.35;
      this.body.add(duck);
      part('spoiler', duck, 'panel', 12);
    }

    // Race numbers on the doors and bonnet (road cars have none).
    const numMat = number === null ? null : new THREE.MeshStandardMaterial({ map: numberTexture(number), transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4 });
    for (const sx of numMat ? [1, -1] : []) {
      const plate = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), numMat);
      plate.position.set(sx * (st.width / 2 + 0.035), (st.bottom + st.hoodH) / 2 + 0.04, zOff - 0.2);
      plate.rotation.y = sx * Math.PI / 2;
      this.body.add(plate);
      this.deformables.push(plate);
    }
    if (numMat) {
      const bonnet = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24), numMat);
      bonnet.rotation.x = -Math.PI / 2 + 0.12;
      bonnet.position.set(0, st.noseH + 0.136, f - 0.75 - hingeZ);
      bonnet.position.y -= hy1;
      hood.add(bonnet);
    }

    // Driver.
    const driverX = Math.min(0.37, cabW * 0.27);
    this.helmet = new THREE.Mesh(cached('helmet', () => new THREE.SphereGeometry(0.15, 16, 12)), new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.25, metalness: 0.3 }));
    // Driver's eye ~1 m behind the base of the windscreen, low enough to clear the roof.
    const eyeZ = st.cowl + zOff - 1.05;
    const eyeY = Math.min(st.roofH - 0.17, st.hoodH + 0.24);
    this.helmet.position.set(driverX, eyeY - 0.02, eyeZ - 0.08);
    this.body.add(this.helmet);

    // Wheels: FL, FR, RL, RR.
    this.wheels = [];
    for (const [z, left] of [[spec.a, true], [spec.a, false], [-spec.b, true], [-spec.b, false]]) {
      const w = makeWheel(R, left, mats);
      w.pivot.position.set((left ? 1 : -1) * (spec.track / 2), R, z);
      this.root.add(w.pivot);
      this.wheels.push(w);
      part('wheel' + ['FL', 'FR', 'RL', 'RR'][this.wheels.length - 1], w.pivot, 'wheel', 60);
    }

    this.eye = new THREE.Vector3(driverX, eyeY, eyeZ);
    this.hoodCam = new THREE.Vector3(0, st.hoodH + 0.35, st.cowl + zOff + 0.2);
    if (cockpit) this._buildCockpit(st, zOff, driverX, cabW);

    // Nitrous flames out of the exhausts.
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x5ab4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const flameGeo = cached('flame', () => new THREE.ConeGeometry(0.1, 0.85, 10, 1, true).translate(0, 0.425, 0).rotateX(-Math.PI / 2));
    this.flames = [];
    for (const sx of [1, -1]) {
      const f = new THREE.Group();
      f.position.set(sx * 0.35, st.bottom + 0.12, -st.len / 2 + zOff - 0.1);
      f.add(new THREE.Mesh(flameGeo, flameMat));
      const core = new THREE.Mesh(flameGeo, coreMat);
      core.scale.set(0.5, 0.5, 0.55);
      f.add(core);
      f.visible = false;
      this.body.add(f);
      this.flames.push(f);
    }

    // Underglow (neon strip light on the ground under the car).
    this.glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x22d3ee, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8 });
    this.glow = new THREE.Mesh(cached('glow' + key, () => new THREE.PlaneGeometry(st.width + 1.6, st.len + 1.4).rotateX(-Math.PI / 2)), this.glowMat);
    this.glow.position.set(0, 0.04, zOff);
    this.glow.renderOrder = 2;
    this.root.add(this.glow);
    this.setGlow(glow);
  }

  _buildCockpit(st, zOff, driverX, cabW) {
    const g = new THREE.Group();
    this.body.add(g);
    this.cockpit = g;
    const dashMat = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.75 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.35, metalness: 0.4 });
    const alcantara = new THREE.MeshStandardMaterial({ color: 0x232327, roughness: 1 });
    const eye = this.eye;
    const cowlZ = st.cowl + zOff;

    // Everything is laid out relative to the eye and the windscreen base so
    // each body style gets a sensible cockpit.
    const wheelPos = new THREE.Vector3(driverX, eye.y - 0.28, eye.z + 0.55);
    const dashBack = wheelPos.z + 0.1, dashFront = cowlZ + 0.06;
    const dashTop = st.hoodH + 0.03;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(cabW + 0.1, 0.24, dashFront - dashBack), dashMat);
    dash.position.set(0, dashTop - 0.12, (dashBack + dashFront) / 2);
    g.add(dash);
    const binnacle = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.18), carbon);
    binnacle.position.set(driverX, dashTop + 0.03, dashBack + 0.1);
    g.add(binnacle);

    // Door cards (same outline as the door skins) so the inside isn't body-coloured.
    for (const sx of [1, -1]) {
      const door = new THREE.Mesh(this.doorGeo, alcantara);
      door.position.x = sx > 0 ? st.width / 2 - 0.05 : -st.width / 2 + 0.1;
      door.position.y = 0.005;
      g.add(door);
    }

    // A-pillars and header rail.
    const pillarGeo = new THREE.CylinderGeometry(0.026, 0.034, 1, 8);
    for (const sx of [1, -1]) {
      const a = new THREE.Vector3(sx * (cabW / 2 - 0.02), st.hoodH - 0.02, cowlZ + 0.04);
      const b = new THREE.Vector3(sx * (cabW / 2 - 0.06), st.roofH - 0.03, st.roofFront + zOff);
      const p = new THREE.Mesh(pillarGeo, carbon);
      p.position.copy(a).add(b).multiplyScalar(0.5);
      p.scale.y = a.distanceTo(b);
      p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(p);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(cabW - 0.04, 0.06, 0.12), carbon);
    header.position.set(0, st.roofH - 0.04, st.roofFront + zOff - 0.04);
    g.add(header);
    const liner = new THREE.Mesh(new THREE.BoxGeometry(cabW - 0.04, 0.02, st.roofFront - st.roofBack), alcantara);
    liner.position.set(0, st.roofH - 0.02, (st.roofFront + st.roofBack) / 2 + zOff);
    g.add(liner);
    const rvm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.03), carbon);
    rvm.position.set(0, st.roofH - 0.1, st.roofFront + zOff - 0.05);
    g.add(rvm);

    // Dim cabin light so the wheel and dash are readable at night (game turns it on).
    this.cabinLight = new THREE.PointLight(0xffe2c4, 0, 1.6, 1.5);
    this.cabinLight.position.set(driverX * 0.5, eye.y + 0.05, eye.z + 0.25);
    g.add(this.cabinLight);

    // Steering wheel: tilt group -> rotation group.
    const tilt = new THREE.Group();
    tilt.position.copy(wheelPos);
    tilt.rotation.x = 0.32;
    g.add(tilt);
    const rot = new THREE.Group();
    tilt.add(rot);
    this.steeringWheel = rot;
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.85 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 10, 40), rimMat);
    rot.add(rim);
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 0.7, roughness: 0.35 });
    for (const ang of [0, Math.PI, -Math.PI / 2]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.015), spokeMat);
      sp.position.set(Math.cos(ang) * 0.085, Math.sin(ang) * 0.085, 0.005);
      sp.rotation.z = ang;
      rot.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.03), carbon);
    hub.position.z = -0.005;
    rot.add(hub);
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.05), new THREE.MeshStandardMaterial({ color: 0xffd200, emissive: 0x806600 }));
    marker.position.set(0, 0.172, 0);
    rot.add(marker);
    // Shift paddles stay with the column (don't rotate).
    for (const sx of [1, -1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.01), spokeMat);
      pad.position.set(sx * 0.12, 0.03, 0.05);
      tilt.add(pad);
    }

    // Rev LEDs across the top of the wheel.
    this.leds = [];
    const ledGeo = new THREE.BoxGeometry(0.012, 0.012, 0.008);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const led = new THREE.Mesh(ledGeo, m);
      led.position.set((4.5 - i) * 0.016, 0.06, -0.025); // +x is the driver's left
      rot.add(led);
      this.leds.push(m);
    }
    // Digital display on the hub.
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    this.displayCanvas = cv;
    this.displayCtx = cv.getContext('2d');
    this.displayTex = new THREE.CanvasTexture(cv);
    this.displayTex.colorSpace = THREE.SRGBColorSpace;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.055), new THREE.MeshBasicMaterial({ map: this.displayTex }));
    disp.position.set(0, 0.005, -0.022);
    disp.rotation.y = Math.PI;
    rot.add(disp);
    this._lastDisp = '';
  }

  setCockpitVisible(v) {
    if (this.cockpit) this.cockpit.visible = v;
    this.helmet.visible = !v;
  }

  // steerRoad: road-wheel angle (rad, + = left). wheelDeg: steering wheel rotation (deg, + = right).
  update(dt, { steerRoad = 0, spinFront = 0, spinRear = 0, braking = false, pitch = 0, roll = 0, wheelDeg = 0, lights = false }) {
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (i < 2) w.pivot.rotation.y = steerRoad;
      w.spin.rotation.x = i < 2 ? spinFront : spinRear;
    }
    this.body.rotation.set(pitch, 0, roll, 'YXZ');
    for (const m of this.tailMats) if (!m.userData.broken) m.emissiveIntensity = braking ? 3.2 : lights ? 1.0 : 0.5;
    for (const m of this.headMats) if (!m.userData.broken) m.emissiveIntensity = lights ? 3 : 1.2;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.pivot.rotation.z = this.camber ? this.camber[i] : 0;
      w.pivot.position.y = this.spec.wheelRadius + (this.susp ? this.susp[i] : 0) - (this.flat ? this.flat[i] * 0.075 : 0);
    }
    if (this.steeringWheel) this.steeringWheel.rotation.z = (wheelDeg * Math.PI) / 180;
  }

  setLeds(fraction, flash) {
    if (!this.leds) return;
    const n = this.leds.length;
    for (let i = 0; i < n; i++) {
      const on = flash ? true : fraction * n > i + 0.5;
      const c = flash ? 0x2a6bff : i < 4 ? 0x22ff44 : i < 7 ? 0xff2020 : 0x3b6bff;
      this.leds[i].color.setHex(on ? c : 0x111111);
    }
  }

  setDisplay(gearText, speedText, extra) {
    if (!this.displayCtx) return;
    const key = gearText + '|' + speedText + '|' + extra;
    if (key === this._lastDisp) return;
    this._lastDisp = key;
    const g = this.displayCtx;
    g.fillStyle = '#050608';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffd200';
    g.font = 'bold 92px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(gearText, 128, 66);
    g.fillStyle = '#e8f0ff';
    g.font = 'bold 34px monospace';
    g.textAlign = 'left';
    g.fillText(speedText, 10, 30);
    g.textAlign = 'right';
    g.fillStyle = '#7fd4ff';
    g.fillText(extra, 246, 30);
    this.displayTex.needsUpdate = true;
  }

  setGlow(hex) {
    this.glow.visible = hex !== null && hex !== undefined;
    if (this.glow.visible) this.glowMat.color.setHex(hex);
  }

  setGlowColor(color) {
    if (this.glow.visible) this.glowMat.color.copy(color);
  }

  setNitro(on, t) {
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      f.visible = on;
      if (on) {
        const k = 0.75 + Math.abs(Math.sin(t * 47 + i * 2.1)) * 0.5 + Math.random() * 0.2;
        f.scale.set(1, 1, k);
      }
    }
  }

  setColor(hex) {
    this.paint.color.setHex(hex);
  }

  // ------------------------------------------------------------- damage
  // Dent the bodywork: P (point) and D (crush direction, unit) are in body
  // space. Meshes get extra vertices the first time they're hit so the
  // panels can crumple.
  crush(P, D, depth, radius) {
    this.root.updateMatrixWorld(true);
    const inv = _m1.copy(this.body.matrixWorld).invert();
    const side = _v3.crossVectors(D, _up);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    for (const mesh of this.deformables) {
      if (!isUnder(mesh, this.body)) continue;
      // Quick reject on the mesh's bounds.
      const rel = _m2.multiplyMatrices(inv, mesh.matrixWorld);
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const bs = mesh.geometry.boundingSphere;
      _v1.copy(bs.center).applyMatrix4(rel);
      if (_v1.distanceTo(P) > bs.radius + radius) continue;
      const dm = this._prepDeform(mesh);
      const relInv = _m3.copy(rel).invert();
      const p = _v1.copy(P).applyMatrix4(relInv);
      const d = _v2.copy(D).transformDirection(relInv);
      const sd = _v4.copy(side).transformDirection(relInv);
      const pos = mesh.geometry.attributes.position;
      const a = pos.array, base = dm.base, r2 = radius * radius;
      let moved = false;
      for (let i = 0, n = pos.count; i < n; i++) {
        const k = i * 3;
        const dx = base[k] - p.x, dy = base[k + 1] - p.y, dz = base[k + 2] - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r2) continue;
        const f = 1 - d2 / r2;
        let amt = depth * f * f * (0.75 + 0.5 * dm.noise[i]);
        const room = dm.max - dm.crushed[i];
        if (room <= 0) continue;
        if (amt > room) amt = room;
        dm.crushed[i] += amt;
        const wr = (dm.noise[i] - 0.5) * amt * 0.28; // crumple wrinkles
        dm.off[k] += d.x * amt + sd.x * wr;
        dm.off[k + 1] += d.y * amt + sd.y * wr;
        dm.off[k + 2] += d.z * amt + sd.z * wr;
        moved = true;
      }
      if (!moved) continue;
      for (let i = 0; i < a.length; i++) a[i] = base[i] + dm.off[i];
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    }
  }

  _prepDeform(mesh) {
    if (mesh.userData.dmg) return mesh.userData.dmg;
    const orig = mesh.geometry;
    let g = orig.index ? orig.toNonIndexed() : orig.clone();
    g = new TessellateModifier(0.24, 6).modify(g);
    const pos = g.attributes.position;
    const base = Float32Array.from(pos.array);
    const noise = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const h = Math.sin(base[i * 3] * 127.1 + base[i * 3 + 1] * 311.7 + base[i * 3 + 2] * 74.7) * 43758.5453;
      noise[i] = h - Math.floor(h);
    }
    mesh.geometry = g;
    const dm = { orig, base, noise, off: new Float32Array(base.length), crushed: new Float32Array(pos.count), max: 0.55 };
    mesh.userData.dmg = dm;
    return dm;
  }

  // Wear a part down; returns 'pop' | 'sag' | 'broken' | 'detach' | null.
  hurtPart(part, amount) {
    if (part.detached) return null;
    part.hp -= amount;
    const frac = part.hp / part.maxHp;
    if (part.hp <= 0 && part.kind !== 'wheel') return 'detach';
    if (part.kind === 'wheel') return part.hp <= 0 ? 'detach' : null;
    if (part.kind === 'light' && !part.broken && frac < 0.6) {
      part.broken = true;
      part.mat.userData.broken = true;
      part.mat.emissiveIntensity = 0;
      part.mat.color.setHex(0x222428);
      return 'broken';
    }
    if (part.kind === 'hood' && !part.popped && frac < 0.55) {
      part.popped = true;
      part.obj.rotation.x = -(0.22 + Math.random() * 0.35);
      part.obj.rotation.z = (Math.random() - 0.5) * 0.12;
      return 'pop';
    }
    if (part.kind === 'panel' && !part.sagged && frac < 0.5) {
      part.sagged = true;
      part.obj.rotation.z += (Math.random() - 0.5) * 0.18;
      part.obj.rotation.x += (Math.random() - 0.5) * 0.1;
      part.obj.position.y -= 0.03;
      return 'sag';
    }
    return null;
  }

  // Take a part off the car; returns its world transform for the debris sim.
  detachPart(part) {
    if (part.detached) return null;
    part.detached = true;
    this.root.updateMatrixWorld(true);
    const m = part.obj.matrixWorld.clone();
    part.obj.parent?.remove(part.obj);
    if (part.kind === 'light') { part.mat.userData.broken = true; part.mat.emissiveIntensity = 0; }
    return m;
  }

  // Suspension: per-wheel vertical offset from the rest position (m).
  setSuspension(arr) {
    this.susp = arr;
  }

  // Bent wheels (camber, radians) and flat tyres (0..1) for the visuals.
  setWheelDamage(camber, flat) {
    this.camber = camber;
    this.flat = flat;
  }

  setGlassDamage(level) {
    const want = level > 0.25;
    if (want === !!this._cracked) return;
    this._cracked = want;
    if (want) {
      this.glassMat.map = crackTexture();
      this.glassMat.color.setHex(0x9aa3ad);
      this.glassMat.opacity = 0.9;
    } else {
      this.glassMat.map = null;
      this.glassMat.color.setHex(0x0c1016);
      this.glassMat.opacity = 0.78;
    }
    this.glassMat.needsUpdate = true;
  }

  // Put everything back the way it left the factory.
  repair() {
    for (const mesh of this.deformables) {
      const dm = mesh.userData.dmg;
      if (!dm) continue;
      mesh.geometry.dispose();
      mesh.geometry = dm.orig;
      mesh.userData.dmg = null;
    }
    for (const p of this.parts) {
      if (p.detached) {
        p.obj.parent?.remove(p.obj);
        p.parent.add(p.obj);
      }
      p.obj.position.copy(p.pos);
      p.obj.rotation.copy(p.rot);
      p.hp = p.maxHp;
      p.detached = p.broken = p.popped = p.sagged = false;
      if (p.mat) {
        p.mat.userData.broken = false;
        p.mat.color.setHex(p.kind === 'light' && p.id.startsWith('head') ? 0xffffff : 0x550000);
      }
    }
    this.camber = null;
    for (const w of this.wheels) { w.pivot.rotation.z = 0; w.pivot.position.y = this.spec.wheelRadius; }
    this.setGlassDamage(0);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }
}
