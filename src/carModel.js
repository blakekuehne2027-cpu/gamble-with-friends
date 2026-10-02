// Procedural low-poly race cars with spinning/steering wheels, brake lights and
// a driveable cockpit (steering wheel with rev LEDs + digital display).
//
// Car local space: +z forward, +x LEFT, +y up, origin on the ground under the CG.

import * as THREE from 'three';

const STYLES = {
  gt: { len: 4.5, width: 1.9, bottom: 0.24, noseH: 0.58, hoodH: 0.86, cowl: 0.62, roofFront: -0.05, roofBack: -0.85, roofH: 1.25, deckStart: -1.5, deckH: 0.98, tailH: 1.0, wing: 'small', cabinW: 0.76 },
  proto: { len: 4.6, width: 1.95, bottom: 0.2, noseH: 0.44, hoodH: 0.78, cowl: 0.5, roofFront: -0.15, roofBack: -0.8, roofH: 1.1, deckStart: -1.35, deckH: 0.92, tailH: 0.96, wing: 'big', cabinW: 0.66 },
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

export class CarModel {
  constructor(spec, color, { number = 7, cockpit = false, helmet = 0xffffff } = {}) {
    this.spec = spec;
    const st = STYLES[spec.style] || STYLES.gt;
    this.style = st;
    const R = spec.wheelRadius;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // receives pitch/roll
    this.root.add(this.body);

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
    const roofLen = st.roofFront - st.roofBack;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cabW - 0.02, 0.05, roofLen + 0.05), paint);
    roof.position.set(0, st.roofH + 0.03, (st.roofFront + st.roofBack) / 2 + zOff);
    roof.castShadow = true;
    this.body.add(roof);

    // Underbody fill + front splitter + diffuser.
    const under = new THREE.Mesh(new THREE.BoxGeometry(st.width - 0.5, 0.2, st.len - 0.4), dark);
    under.position.set(0, st.bottom + 0.06, zOff);
    this.body.add(under);
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(st.width - 0.1, 0.04, 0.3), trim);
    splitter.position.set(0, st.bottom - 0.02, st.len / 2 + zOff - 0.12);
    this.body.add(splitter);

    // Grille / lights.
    const grille = new THREE.Mesh(new THREE.BoxGeometry(st.width * 0.5, 0.14, 0.05), trim);
    grille.position.set(0, st.noseH * 0.45, st.len / 2 + zOff + 0.01);
    this.body.add(grille);
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 1.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.6 });
    for (const sx of [1, -1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.1), this.headMat);
      hl.position.set(sx * (st.width / 2 - 0.32), st.noseH * 0.85, st.len / 2 + zOff - 0.28);
      hl.rotation.x = -0.35;
      this.body.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.06), this.tailMat);
      tl.position.set(sx * (st.width / 2 - 0.35), st.tailH - 0.16, -st.len / 2 + zOff - 0.005);
      this.body.add(tl);
      const ex = new THREE.Mesh(cached('exhaust', () => new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10).rotateX(Math.PI / 2)), mats.rim);
      ex.position.set(sx * 0.35, st.bottom + 0.12, -st.len / 2 + zOff - 0.02);
      this.body.add(ex);
      // Mirrors.
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.12), paint);
      mirror.position.set(sx * (cabW / 2 + 0.12), st.hoodH + 0.08, st.cowl + zOff - 0.12);
      this.body.add(mirror);
    }

    // Stripes.
    if (spec.style !== 'muscle') {
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
      const wing = new THREE.Mesh(new THREE.BoxGeometry(st.width - (big ? 0.05 : 0.25), 0.05, big ? 0.42 : 0.3), trim);
      const wy = st.tailH + (big ? 0.38 : 0.2);
      wing.position.set(0, wy, -st.len / 2 + zOff + 0.25);
      wing.rotation.x = 0.12;
      wing.castShadow = true;
      this.body.add(wing);
      for (const sx of [1, -1]) {
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, wy - st.tailH + 0.05, 0.16), trim);
        stand.position.set(sx * (big ? 0.55 : 0.45), (wy + st.tailH) / 2, -st.len / 2 + zOff + 0.28);
        this.body.add(stand);
        if (big) {
          const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.5), paint);
          plate.position.set(sx * (st.width / 2 - 0.02), wy, -st.len / 2 + zOff + 0.25);
          this.body.add(plate);
        }
      }
    } else if (st.wing === 'duck') {
      const duck = new THREE.Mesh(new THREE.BoxGeometry(st.width - 0.2, 0.06, 0.25), paint);
      duck.position.set(0, st.tailH + 0.03, -st.len / 2 + zOff + 0.12);
      duck.rotation.x = 0.35;
      this.body.add(duck);
    }

    // Race numbers on the doors and bonnet.
    const numMat = new THREE.MeshStandardMaterial({ map: numberTexture(number), transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4 });
    for (const sx of [1, -1]) {
      const plate = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), numMat);
      plate.position.set(sx * (st.width / 2 + 0.035), (st.bottom + st.hoodH) / 2 + 0.04, zOff - 0.2);
      plate.rotation.y = sx * Math.PI / 2;
      this.body.add(plate);
    }
    const bonnet = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24), numMat);
    bonnet.rotation.x = -Math.PI / 2 + 0.12;
    bonnet.position.set(0, st.noseH + 0.12, st.len / 2 + zOff - 0.75);
    this.body.add(bonnet);

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
    }

    this.eye = new THREE.Vector3(driverX, eyeY, eyeZ);
    this.hoodCam = new THREE.Vector3(0, st.hoodH + 0.35, st.cowl + zOff + 0.2);
    if (cockpit) this._buildCockpit(st, zOff, driverX, cabW);
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
    this.tailMat.emissiveIntensity = braking ? 3.2 : lights ? 1.0 : 0.5;
    this.headMat.emissiveIntensity = lights ? 3 : 1.2;
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

  setColor(hex) {
    this.paint.color.setHex(hex);
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
