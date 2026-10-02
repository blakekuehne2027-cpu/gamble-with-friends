// In-race HUD: speed/gear/RPM cluster, timing, positions, minimap and live
// pedal/wheel/shifter telemetry.

export function fmtTime(t) {
  if (!Number.isFinite(t) || t <= 0) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

export function fmtDelta(d) {
  if (!Number.isFinite(d)) return '';
  return (d >= 0 ? '+' : '-') + Math.abs(d).toFixed(2);
}

const H_SLOTS = { 1: [0, 0], 2: [0, 2], 3: [1, 0], 4: [1, 2], 5: [2, 0], 6: [2, 2], '-1': [3, 2], 0: [1, 1] };

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-tl">
        <div class="hud-pos"><span id="h-pos">P1</span><small id="h-of">/6</small></div>
        <div class="hud-lap">LAP <b id="h-lap">1</b><small id="h-laps">/3</small></div>
        <div class="hud-board" id="h-board"></div>
      </div>
      <div class="hud-tr">
        <div class="hud-time-row"><label>LAP</label><b id="h-cur">0:00.000</b></div>
        <div class="hud-time-row"><label>LAST</label><span id="h-last">--:--.---</span></div>
        <div class="hud-time-row"><label>BEST</label><span id="h-best">--:--.---</span></div>
        <div class="hud-delta" id="h-delta"></div>
      </div>
      <canvas class="hud-map" id="h-map" width="220" height="220"></canvas>
      <div class="hud-br">
        <div class="hud-leds" id="h-leds"></div>
        <div class="hud-rpm"><div class="hud-rpm-fill" id="h-rpmfill"></div><div class="hud-rpm-red" id="h-rpmred"></div></div>
        <div class="hud-cluster">
          <div class="hud-gear" id="h-gear">N</div>
          <div class="hud-speed"><b id="h-speed">0</b><small id="h-unit">MPH</small></div>
        </div>
        <div class="hud-flags"><span id="h-abs">ABS</span><span id="h-tc">TC</span><span id="h-clutch">AUTO CLUTCH</span><span id="h-trans">H</span></div>
      </div>
      <div class="hud-bl" id="h-tele">
        <svg class="hud-wheel" id="h-wheel" viewBox="-50 -50 100 100"><circle r="40" fill="none" stroke="currentColor" stroke-width="9"/><rect x="-40" y="-4" width="80" height="8" fill="currentColor"/><rect x="-4" y="0" width="8" height="40" fill="currentColor"/><rect x="-3" y="-49" width="6" height="12" fill="#ffd200"/></svg>
        <div class="hud-pedals">
          <div class="hud-pedal"><div class="fill clutch" id="h-pc"></div><label>C</label></div>
          <div class="hud-pedal"><div class="fill brake" id="h-pb"></div><label>B</label></div>
          <div class="hud-pedal"><div class="fill throttle" id="h-pt"></div><label>T</label></div>
        </div>
        <svg class="hud-hpattern" id="h-hp" viewBox="0 0 100 110">
          <g stroke="rgba(255,255,255,0.35)" stroke-width="5" stroke-linecap="round" fill="none">
            <path d="M15 15 V85 M50 15 V85 M85 15 V95 M15 50 H85"/>
          </g>
          <g fill="rgba(255,255,255,0.55)" font-size="13" font-weight="700" text-anchor="middle">
            <text x="15" y="10">1</text><text x="15" y="100">2</text><text x="50" y="10">3</text><text x="50" y="100">4</text><text x="85" y="10">5</text><text x="72" y="100">6</text><text x="96" y="104">R</text>
          </g>
          <circle id="h-knob" cx="50" cy="50" r="9" fill="#ffd200"/>
        </svg>
      </div>
      <div class="hud-msg" id="h-msg"></div>
      <div class="hud-sub" id="h-sub"></div>
      <div class="hud-lights" id="h-lights"><i></i><i></i><i></i><i></i><i></i></div>
    `;
    const $ = (id) => root.querySelector('#' + id);
    this.el = {};
    for (const id of ['pos', 'of', 'lap', 'laps', 'board', 'cur', 'last', 'best', 'delta', 'map', 'leds', 'rpmfill', 'rpmred', 'gear', 'speed', 'unit', 'abs', 'tc', 'clutch', 'trans', 'tele', 'wheel', 'pc', 'pb', 'pt', 'hp', 'knob', 'msg', 'sub', 'lights']) {
      this.el[id] = $('h-' + id);
    }
    this.ledEls = [];
    for (let i = 0; i < 10; i++) {
      const d = document.createElement('i');
      this.el.leds.appendChild(d);
      this.ledEls.push(d);
    }
    this.lightEls = Array.from(this.el.lights.children);
    this.mapCtx = this.el.map.getContext('2d');
    this.msgTimer = 0;
    this.subTimer = 0;
    this.cache = {};
  }

  _set(key, el, text) {
    if (this.cache[key] !== text) {
      this.cache[key] = text;
      el.textContent = text;
    }
  }

  setTrack(track) {
    this.track = track;
    const b = track.bounds;
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const size = 220, pad = 18;
    const sc = (size - pad * 2) / Math.max(w, h);
    this.mapTf = (x, z) => [pad + (x - b.minX) * sc + ((size - pad * 2) - w * sc) / 2, size - pad - (z - b.minZ) * sc - ((size - pad * 2) - h * sc) / 2];
    // Pre-render the track outline.
    const off = document.createElement('canvas');
    off.width = off.height = size;
    const g = off.getContext('2d');
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= track.count; i += 2) {
        const k = i % track.count;
        const [px, py] = this.mapTf(track.x[k], track.z[k]);
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
    };
    path();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 9;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 4.5;
    g.stroke();
    const [sx, sy] = this.mapTf(track.x[0], track.z[0]);
    const [sx2, sy2] = this.mapTf(track.x[0] + track.nx[0] * 30, track.z[0] + track.nz[0] * 30);
    const [sx3, sy3] = this.mapTf(track.x[0] - track.nx[0] * 30, track.z[0] - track.nz[0] * 30);
    g.strokeStyle = '#ffd200';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(sx2, sy2); g.lineTo(sx3, sy3); g.stroke();
    void sx; void sy;
    this.mapBase = off;
  }

  drawMap(cars) {
    const g = this.mapCtx;
    g.clearRect(0, 0, 220, 220);
    if (this.mapBase) g.drawImage(this.mapBase, 0, 0);
    // Draw AI first, the player last (on top).
    for (const c of cars) {
      const [x, y] = this.mapTf(c.x, c.z);
      g.beginPath();
      g.arc(x, y, c.player ? 6 : 4.2, 0, Math.PI * 2);
      g.fillStyle = c.color;
      g.fill();
      g.lineWidth = c.player ? 2.5 : 1.5;
      g.strokeStyle = c.player ? '#fff' : '#000';
      g.stroke();
    }
  }

  setMode({ race, laps, units, cars }) {
    this.root.classList.toggle('tt', !race);
    this._set('laps', this.el.laps, race ? `/${laps}` : '');
    this._set('of', this.el.of, `/${cars}`);
    this._set('unit', this.el.unit, units === 'mph' ? 'MPH' : 'KM/H');
  }

  setTelemetryVisible(v) {
    this.el.tele.style.display = v ? '' : 'none';
  }

  update(d) {
    const e = this.el;
    this._set('pos', e.pos, `P${d.position}`);
    this._set('lap', e.lap, String(Math.max(1, Math.min(d.lap, d.laps || 99))));
    this._set('cur', e.cur, fmtTime(d.lapTime));
    this._set('last', e.last, fmtTime(d.lastLap));
    this._set('best', e.best, fmtTime(d.bestLap));
    const delta = d.delta;
    const dTxt = Number.isFinite(delta) ? fmtDelta(delta) : '';
    if (this.cache.delta !== dTxt) {
      this.cache.delta = dTxt;
      e.delta.textContent = dTxt;
      e.delta.className = 'hud-delta ' + (delta < 0 ? 'good' : 'bad');
    }
    this._set('gear', e.gear, d.gear === 0 ? 'N' : d.gear < 0 ? 'R' : String(d.gear));
    e.gear.classList.toggle('grind', !!d.grinding);
    this._set('speed', e.speed, String(Math.round(d.speedDisplay)));
    const frac = Math.min(1, d.rpm / d.maxRpm);
    e.rpmfill.style.transform = `scaleX(${frac.toFixed(3)})`;
    e.rpmred.style.left = ((d.redline / d.maxRpm) * 100).toFixed(1) + '%';
    const ledFrac = Math.max(0, (d.rpm - d.redline * 0.62) / (d.redline * 0.36));
    const flash = d.rpm > d.redline - 120 && (performance.now() / 70) % 2 < 1;
    for (let i = 0; i < 10; i++) {
      const on = flash || ledFrac * 10 > i + 0.5;
      const cls = flash ? 'b' : on ? (i < 4 ? 'g' : i < 7 ? 'r' : 'b') : '';
      if (this.ledEls[i].className !== cls) this.ledEls[i].className = cls;
    }
    e.abs.className = d.abs ? (d.absActive ? 'on act' : 'on') : '';
    e.tc.className = d.tc ? (d.tcActive ? 'on act' : 'on') : '';
    e.clutch.className = d.autoClutch ? 'on' : '';
    this._set('trans', e.trans, d.trans === 'h' ? 'H-SHIFTER' : d.trans === 'seq' ? 'SEQ' : 'AUTO');

    // Telemetry.
    e.wheel.style.transform = `rotate(${d.wheelDeg.toFixed(1)}deg)`;
    e.pc.style.transform = `scaleY(${d.clutch.toFixed(3)})`;
    e.pb.style.transform = `scaleY(${d.brake.toFixed(3)})`;
    e.pt.style.transform = `scaleY(${d.throttle.toFixed(3)})`;
    e.hp.style.display = d.trans === 'h' ? '' : 'none';
    if (d.trans === 'h') {
      const slot = H_SLOTS[d.hGear ?? 0] || H_SLOTS[0];
      const xs = [15, 50, 85, 85], ys = [15, 50, 85];
      const cx = d.hGear === -1 ? 85 : xs[slot[0]];
      const cy = d.hGear === -1 ? 95 : ys[slot[1]];
      e.knob.setAttribute('cx', cx);
      e.knob.setAttribute('cy', cy);
      e.knob.setAttribute('fill', d.grinding ? '#ff3030' : '#ffd200');
    }

    // Leaderboard.
    if (d.board) {
      const html = d.board.map((r) => `<div class="${r.player ? 'me' : ''}"><span>${r.pos}</span><i style="background:${r.color}"></i>${r.name}<em>${r.gap}</em></div>`).join('');
      if (html !== this.cache.board) {
        this.cache.board = html;
        e.board.innerHTML = html;
      }
    }

    if (this.msgTimer > 0) {
      this.msgTimer -= d.dt;
      if (this.msgTimer <= 0) e.msg.classList.remove('show');
    }
    if (this.subTimer > 0) {
      this.subTimer -= d.dt;
      if (this.subTimer <= 0) e.sub.classList.remove('show');
    }
  }

  message(text, seconds = 2, cls = '') {
    const e = this.el.msg;
    e.textContent = text;
    e.className = 'hud-msg show ' + cls;
    this.msgTimer = seconds;
  }

  sub(text, seconds = 2) {
    const e = this.el.sub;
    e.textContent = text;
    e.classList.add('show');
    this.subTimer = seconds;
  }

  // n red lights (0..5); go=true shows green.
  setLights(n, go = false, visible = true) {
    this.el.lights.style.display = visible ? '' : 'none';
    this.lightEls.forEach((l, i) => {
      l.className = go ? 'go' : i < n ? 'on' : '';
    });
  }
}
