// Tyre smoke, sparks and skid marks.

import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.kind = new Uint8Array(max); // 0 smoke, 1 spark, 2 dirt
    this.colorArr = new Float32Array(max * 3);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.colorArr, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 pcolor;
        varying float vAlpha; varying vec3 vColor; uniform float scale;
        void main(){
          vAlpha = alpha; vColor = pcolor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vAlpha; varying vec3 vColor;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(kind, x, y, z, vx, vy, vz, life, size, r, g, b) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.kind[i] = kind;
    this.colorArr[i * 3] = r; this.colorArr[i * 3 + 1] = g; this.colorArr[i * 3 + 2] = b;
  }

  smoke(x, y, z, vx, vz, intensity, night) {
    const c = night ? 0.55 : 0.82;
    this.emit(0, x + (Math.random() - 0.5) * 0.3, y + 0.15, z + (Math.random() - 0.5) * 0.3,
      vx * 0.3 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.9, vz * 0.3 + (Math.random() - 0.5) * 1.5,
      1.6 + Math.random() * 1.2 * intensity, 0.9 + intensity * 0.7, c, c, c * 1.02);
  }

  spray(x, y, z, vx, vz, night) {
    const c = night ? 0.45 : 0.85;
    this.emit(0, x + (Math.random() - 0.5) * 0.6, y + 0.25, z + (Math.random() - 0.5) * 0.6,
      vx * 0.55 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.2, vz * 0.55 + (Math.random() - 0.5) * 2,
      0.5 + Math.random() * 0.4, 1.1, c, c * 1.02, c * 1.06);
  }

  dirt(x, y, z, vx, vz) {
    this.emit(2, x, y + 0.1, z, vx * 0.2 + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, vz * 0.2 + (Math.random() - 0.5) * 2,
      0.7 + Math.random() * 0.5, 0.35, 0.36, 0.28, 0.18);
  }

  sparks(x, y, z, vx, vz, n = 10) {
    for (let k = 0; k < n; k++) {
      this.emit(1, x, y, z, vx * 0.5 + (Math.random() - 0.5) * 8, 1 + Math.random() * 4, vz * 0.5 + (Math.random() - 0.5) * 8,
        0.25 + Math.random() * 0.35, 0.12, 1.0, 0.75 + Math.random() * 0.2, 0.3);
    }
  }

  glass(x, y, z, vx, vz, n = 12) {
    for (let k = 0; k < n; k++) {
      this.emit(1, x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4,
        vx * 0.6 + (Math.random() - 0.5) * 5, 0.8 + Math.random() * 3, vz * 0.6 + (Math.random() - 0.5) * 5,
        0.6 + Math.random() * 0.6, 0.06 + Math.random() * 0.05, 0.78, 0.9, 0.98);
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const a = (this.age[i] += dt);
      const life = this.life[i];
      if (a > life) { this.alpha[i] = 0; continue; }
      const t = a / life;
      const k = this.kind[i];
      const i3 = i * 3;
      if (k === 0) {
        this.vel[i3] *= 1 - dt * 1.2; this.vel[i3 + 2] *= 1 - dt * 1.2;
        this.vel[i3 + 1] = this.vel[i3 + 1] * (1 - dt) + dt * 0.4;
        this.size[i] += dt * 2.2;
        this.alpha[i] = (1 - t) * Math.min(1, a * 6) * 0.42;
      } else {
        this.vel[i3 + 1] -= 9.8 * dt;
        this.alpha[i] = 1 - t;
      }
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
    }
    for (const n of ['position', 'size', 'alpha', 'pcolor']) this.geo.attributes[n].needsUpdate = true;
  }

  setScale(px) {
    this.points.material.uniforms.scale.value = px;
  }
}

export class SkidMarks {
  constructor(scene, max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, color: 0x0c0c0c });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.next = 0;
    this.last = new Map(); // wheel key -> {x,y,z,lx,lz}
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  // Add a mark segment for a wheel at (x,y,z) with lateral dir (lx,lz). strength 0..1 (0 breaks the trail).
  add(key, x, y, z, lx, lz, strength, width = 0.24) {
    const prev = this.last.get(key);
    if (strength <= 0.02) { this.last.delete(key); return; }
    const cur = { x, y, z, lx, lz, a: Math.min(0.85, strength) };
    if (prev) {
      const d = Math.hypot(x - prev.x, z - prev.z);
      if (d < 0.25) return; // wait until we've moved enough
      if (d < 4) {
        const i = this.next;
        this.next = (this.next + 1) % this.max;
        const w = width / 2;
        const p = this.pos, b = i * 12;
        p[b] = prev.x + prev.lx * w; p[b + 1] = prev.y; p[b + 2] = prev.z + prev.lz * w;
        p[b + 3] = prev.x - prev.lx * w; p[b + 4] = prev.y; p[b + 5] = prev.z - prev.lz * w;
        p[b + 6] = x + lx * w; p[b + 7] = y; p[b + 8] = z + lz * w;
        p[b + 9] = x - lx * w; p[b + 10] = y; p[b + 11] = z - lz * w;
        const c = this.col, cb = i * 16;
        for (let k = 0; k < 4; k++) {
          c[cb + k * 4] = 1; c[cb + k * 4 + 1] = 1; c[cb + k * 4 + 2] = 1;
          c[cb + k * 4 + 3] = k < 2 ? prev.a : cur.a;
        }
        this.dirtyFrom = Math.min(this.dirtyFrom, i);
        this.dirtyTo = Math.max(this.dirtyTo, i);
      }
    }
    this.last.set(key, cur);
  }

  flush() {
    if (this.dirtyTo < 0) return;
    const pa = this.geo.attributes.position, ca = this.geo.attributes.color;
    pa.clearUpdateRanges(); ca.clearUpdateRanges();
    pa.addUpdateRange(this.dirtyFrom * 12, (this.dirtyTo - this.dirtyFrom + 1) * 12);
    ca.addUpdateRange(this.dirtyFrom * 16, (this.dirtyTo - this.dirtyFrom + 1) * 16);
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  clear() {
    this.pos.fill(0);
    this.col.fill(0);
    this.last.clear();
    this.geo.attributes.position.clearUpdateRanges();
    this.geo.attributes.color.clearUpdateRanges();
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// Falling rain streaks in a box that follows the camera.
export class Rain {
  constructor(scene, count = 5000, night = false) {
    this.count = count;
    this.box = { x: 70, y: 36, z: 70 };
    this.off = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.off[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.off[i * 3 + 1] = Math.random() * this.box.y;
      this.off[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
    }
    this.pos = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: night ? 0x8090b0 : 0xc8d2e0, transparent: true, opacity: night ? 0.45 : 0.38, depthWrite: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.center = new THREE.Vector3();
  }

  // focus: world point the box is centred on; wind: world velocity of the
  // viewer (streaks lean back when you drive fast).
  update(dt, focus, vx, vz) {
    const B = this.box, o = this.off, p = this.pos;
    const fall = 16 * dt;
    const lx = -vx * 0.035, lz = -vz * 0.035;
    // Keep the drops fixed in the world while the box follows the camera.
    const dx = focus.x - this.center.x, dz = focus.z - this.center.z;
    this.center.set(focus.x, focus.y, focus.z);
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      let x = o[k] - dx, y = o[k + 1] - fall, z = o[k + 2] - dz;
      if (y < -4) y += B.y;
      if (x < -B.x / 2) x += B.x; else if (x > B.x / 2) x -= B.x;
      if (z < -B.z / 2) z += B.z; else if (z > B.z / 2) z -= B.z;
      o[k] = x; o[k + 1] = y; o[k + 2] = z;
      const wx = focus.x + x, wy = focus.y + y - 6, wz = focus.z + z;
      const j = i * 6;
      p[j] = wx; p[j + 1] = wy; p[j + 2] = wz;
      p[j + 3] = wx + lx; p[j + 4] = wy - 0.55; p[j + 5] = wz + lz;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
