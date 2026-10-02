// Menus: title, main menu, race setup, settings, help, pause and results.
// Fully navigable with the wheel (paddles = up/down, turn = change, gas =
// select, brake = back), a gamepad, the keyboard or the mouse.

import { TRACKS } from './track.js';
import { CARS, PAINT_COLORS } from './cars.js';
import { saveSettings, loadJSON } from './settings.js';
import { getTrack } from './game.js';
import { Wizard } from './wizard.js';
import { fmtTime } from './hud.js';

const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');
const DIFF = ['Easy', 'Medium', 'Hard', 'Pro'];

export class UI {
  constructor({ input, audio, ffb, settings, game, showroom }) {
    this.input = input;
    this.audio = audio;
    this.ffb = ffb;
    this.S = settings;
    this.game = game;
    this.showroom = showroom;
    this.menu = document.getElementById('menu');
    this.overlay = document.getElementById('overlay');
    this.hudEl = document.getElementById('hud');
    this.statusEl = document.getElementById('status');
    this.screen = null;
    this.stack = [];
    this.focus = 0;
    this.wizard = new Wizard(input, document.getElementById('wizard'), {
      onDone: (m) => this._afterWizard(m),
      onCancel: () => this.show(this.stack.pop() || 'main', true),
    });
    ffb.onChange(() => this._renderStatus());
    window.addEventListener('gamepadconnected', () => this._renderStatus());
    window.addEventListener('gamepaddisconnected', () => this._renderStatus());
    game.onFinish = (r) => this.showResults(r);
    this.mode = 'menu';
  }

  // ------------------------------------------------------------ screens
  show(name, isBack = false) {
    if (!isBack && this.screen && this.screen !== name) this.stack.push(this.screen);
    this.screen = name;
    this.mode = 'menu';
    this.menu.classList.add('show');
    this.hudEl.classList.remove('show');
    this.overlay.classList.remove('show');
    this.showroom.setVisible(true);
    const r = this['_screen_' + name]();
    this.menu.innerHTML = `<div class="screen screen-${name}">${r}</div>`;
    this._bind();
    this.focus = 0;
    const focusables = this._nav();
    const pref = focusables.findIndex((e) => e.dataset.default);
    this._setFocus(pref >= 0 ? pref : 0);
    this._renderStatus();
    this._afterRender?.();
    this._afterRender = null;
  }

  back() {
    if (this.wizard.active) return;
    const prev = this.stack.pop();
    if (prev) this.show(prev, true);
  }

  _screen_title() {
    return `
      <div class="logo"><span class="logo-red">RED</span>LINE<small>WHEEL RACING</small></div>
      <p class="tag">Built for the Logitech G29 / G920 with the Driving Force Shifter</p>
      <button class="btn primary big nav" data-act="start" data-default="1">Press GAS or click to start</button>
      <p class="hint">Use Chrome or Edge for wheel, force feedback and rev lights.</p>`;
  }

  _screen_main() {
    const wheel = this.input.detectedWheel();
    const needsSetup = wheel && !this.input.wheelConnected();
    return `
      <div class="logo small"><span class="logo-red">RED</span>LINE<small>WHEEL RACING</small></div>
      ${needsSetup ? `<div class="callout"><b>Wheel detected:</b> ${esc(wheel.id)}<br>Run the 30-second setup so your pedals and shifter work. <button class="btn primary nav" data-act="wizard" data-default="1">Set up wheel</button></div>` : ''}
      <div class="menu-list">
        <button class="btn big nav" data-act="race" ${needsSetup ? '' : 'data-default="1"'}>Race</button>
        <button class="btn big nav" data-act="tt">Time Trial</button>
        <button class="btn big nav" data-act="wizard">Wheel Setup</button>
        <button class="btn big nav" data-act="settings">Settings</button>
        <button class="btn big nav" data-act="help">How to Play</button>
      </div>
      <p class="hint nav-hint">Wheel: paddles = up/down · turn = change · gas = select · brake = back</p>`;
  }

  _optRow(key, label, display, extra = '') {
    return `<div class="opt nav" data-opt="${key}" ${extra}><label>${label}</label><div class="opt-val"><span class="arr" data-dir="-1">◀</span><b>${display}</b><span class="arr" data-dir="1">▶</span></div></div>`;
  }

  _screen_setup() {
    const S = this.S;
    const race = this.setupMode === 'race';
    const t = TRACKS[S.track], c = CARS[S.car];
    const best = loadJSON(`redline.ghost.${t.id}.${c.id}`, null);
    const stat = (label, v) => `<div class="stat"><label>${label}</label><div><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
    return `
      <h1 class="title">${race ? 'Race' : 'Time Trial'}</h1>
      <div class="setup">
        <div class="setup-opts">
          ${this._optRow('track', 'Track', t.name)}
          ${this._optRow('car', 'Car', c.name)}
          ${this._optRow('color', 'Paint', `<i class="swatch" style="background:${hexCss(PAINT_COLORS[S.color])}"></i>`)}
          ${race ? this._optRow('laps', 'Laps', S.laps) : ''}
          ${race ? this._optRow('opponents', 'Opponents', S.opponents) : ''}
          ${race ? this._optRow('difficulty', 'AI difficulty', DIFF[S.difficulty]) : ''}
          ${this._optRow('transmission', 'Transmission', transName(S.transmission))}
          <button class="btn primary big nav" data-act="go" data-default="1">${race ? 'Start Race' : 'Start Session'}</button>
          <button class="btn ghost nav" data-act="back">Back</button>
        </div>
        <div class="setup-info">
          <div class="card">
            <canvas id="trackmap" width="300" height="220"></canvas>
            <h3>${t.name}</h3><p>${t.blurb}</p>
            <p class="dim">${(getTrack(S.track).length / 1000).toFixed(2)} km · ${t.theme === 'night' ? 'Night' : t.theme === 'forest' ? 'Golden hour' : 'Midday'}</p>
            ${!race ? `<p class="dim">Your best (${c.name}): <b>${best ? fmtTime(best.time) : 'none yet'}</b> ${best ? '· ghost car will race you' : ''}</p>` : ''}
          </div>
          <div class="card">
            <h3>${c.name}</h3><p>${c.blurb}</p>
            ${stat('Power', c.stats.power)}${stat('Grip', c.stats.grip)}${stat('Agility', c.stats.weight)}
            <p class="dim">${c.cylinders === 12 ? 'V12' : c.cylinders === 8 ? 'V8' : 'Inline-4'} · ${c.mass} kg · redline ${c.redline} rpm · 6-speed</p>
          </div>
        </div>
      </div>`;
  }

  _screen_settings() {
    const S = this.S;
    const pct = (v) => Math.round(v * 100) + '%';
    const onoff = (v) => (v ? 'On' : 'Off');
    const ffbState = this.ffb.ready ? `<span class="ok">● ${esc(this.ffb.status)}</span>` : `<span class="dim">● ${esc(this.ffb.status)}</span>`;
    return `
      <h1 class="title">Settings</h1>
      <div class="settings">
        <div class="col">
          <h4>Driving</h4>
          ${this._optRow('transmission', 'Transmission', transName(S.transmission))}
          ${this._optRow('autoClutch', 'Auto clutch (no stalling)', onoff(S.autoClutch))}
          ${this._optRow('abs', 'ABS', onoff(S.abs))}
          ${this._optRow('tc', 'Traction control', onoff(S.tc))}
          ${this._optRow('stability', 'Stability assist', onoff(S.stability))}
          <h4>Wheel</h4>
          ${this._optRow('wheelRange', 'Wheel rotation (match G HUB)', S.wheelRange + '°')}
          ${this._optRow('steerRatio', 'Steering ratio (lower = quicker)', S.steerRatio + ':1')}
          <button class="btn nav" data-act="wizard">Run wheel setup again</button>
        </div>
        <div class="col">
          <h4>Force feedback &amp; rev lights</h4>
          <p class="ffb-status">${ffbState}</p>
          <button class="btn primary nav" data-act="ffbconnect">${this.ffb.ready ? 'Reconnect wheel' : 'Connect wheel for force feedback'}</button>
          ${this._optRow('ffb', 'Force feedback', onoff(S.ffb))}
          ${this._optRow('ffbStrength', 'FFB strength', pct(S.ffbStrength))}
          ${this._optRow('ffbInvert', 'Invert FFB direction', onoff(S.ffbInvert))}
          <button class="btn nav" data-act="ffbtest">Test: wheel should turn RIGHT then LEFT</button>
          ${this._optRow('revLeds', 'Rev lights on wheel (G29)', onoff(S.revLeds))}
          <h4>Display &amp; sound</h4>
          ${this._optRow('units', 'Speed units', S.units === 'mph' ? 'MPH' : 'KM/H')}
          ${this._optRow('camera', 'Default camera', camName(S.camera))}
          ${this._optRow('fov', 'Cockpit field of view', S.fov + '°')}
          ${this._optRow('showTelemetry', 'Pedal / wheel overlay', onoff(S.showTelemetry))}
          ${this._optRow('graphics', 'Graphics', S.graphics === 'high' ? 'High' : 'Low')}
          ${this._optRow('volume', 'Volume', pct(S.volume))}
          <button class="btn ghost nav" data-act="back">Back</button>
        </div>
      </div>`;
  }

  _screen_help() {
    return `
      <h1 class="title">How to Play</h1>
      <div class="help">
        <div class="card">
          <h3>Logitech G29 / G920</h3>
          <ol>
            <li>Plug in the wheel, pedals and the Driving Force Shifter (shifter plugs into the back of the wheel base).</li>
            <li>Open this page in <b>Chrome</b> or <b>Edge</b> and press a button on the wheel.</li>
            <li>Run <b>Wheel Setup</b> once. Follow the prompts: turn, press each pedal, click through the gears.</li>
            <li>In <b>Settings</b>, click <b>Connect wheel for force feedback</b> and pick your wheel to get FFB and the rev lights (G29).</li>
            <li>In G HUB set rotation to 900° (or match <i>Wheel rotation</i> in Settings) and turn <b>off</b> the centering spring.</li>
          </ol>
          <h3>Driving the H-pattern</h3>
          <p>Shifter in a gear = in gear; shifter in the middle = neutral. With <b>Auto clutch</b> off you must press the clutch to change gear, or you'll grind. Dump the clutch at idle and you stall. Press the clutch to restart.</p>
        </div>
        <div class="card">
          <h3>Keyboard</h3>
          <table class="keys">
            <tr><td>W / ↑</td><td>Gas</td></tr><tr><td>S / ↓</td><td>Brake / reverse</td></tr>
            <tr><td>A D / ← →</td><td>Steer</td></tr><tr><td>E / Q</td><td>Shift up / down</td></tr>
            <tr><td>X</td><td>Clutch</td></tr><tr><td>Space</td><td>Handbrake</td></tr>
            <tr><td>C</td><td>Camera</td></tr><tr><td>B</td><td>Look back</td></tr>
            <tr><td>R</td><td>Reset car</td></tr><tr><td>Esc / P</td><td>Pause</td></tr>
          </table>
          <h3>Xbox / PlayStation controller</h3>
          <p>RT gas · LT brake · left stick steer · RB/LB shift · Y camera · B handbrake · View reset · Menu pause.</p>
        </div>
      </div>
      <button class="btn ghost nav" data-act="back" data-default="1">Back</button>`;
  }

  // ------------------------------------------------------------ behaviour
  _bind() {
    for (const el of this.menu.querySelectorAll('[data-act]')) {
      el.addEventListener('click', () => this._act(el.dataset.act));
    }
    for (const el of this.menu.querySelectorAll('.opt')) {
      for (const a of el.querySelectorAll('.arr')) {
        a.addEventListener('click', (e) => { e.stopPropagation(); this._change(el.dataset.opt, +a.dataset.dir); });
      }
      el.addEventListener('click', () => this._change(el.dataset.opt, 1));
    }
    this._nav().forEach((el, i) => el.addEventListener('mouseenter', () => this._setFocus(i)));
    const map = this.menu.querySelector('#trackmap');
    if (map) drawTrackPreview(map, getTrack(this.S.track));
  }

  _nav() {
    return Array.from(this.menu.querySelectorAll('.nav'));
  }

  _setFocus(i) {
    const n = this._nav();
    if (!n.length) return;
    this.focus = (i + n.length) % n.length;
    n.forEach((e, k) => e.classList.toggle('focus', k === this.focus));
    n[this.focus].scrollIntoView({ block: 'nearest' });
  }

  _act(a) {
    this.audio.init();
    this.audio.click();
    switch (a) {
      case 'start': this.show('main'); break;
      case 'race': this.setupMode = 'race'; this.show('setup'); break;
      case 'tt': this.setupMode = 'tt'; this.show('setup'); break;
      case 'settings': this.show('settings'); break;
      case 'help': this.show('help'); break;
      case 'wizard': this.openWizard(); break;
      case 'back': this.back(); break;
      case 'go': this.startRace(); break;
      case 'ffbconnect':
        this.ffb.connect().then(() => this.show('settings', true));
        break;
      case 'ffbtest': this.ffb.test(this.S.ffbInvert); break;
      case 'resume': this.togglePause(); break;
      case 'restart': this.closeOverlay(); this.game.restart(); this._enterRace(); break;
      case 'quit': this.closeOverlay(); this.game.stop(); this.show('main', true); this.stack = ['title']; break;
      case 'again': this.closeOverlay(); this.game.restart(); this._enterRace(); break;
    }
  }

  _change(key, dir) {
    const S = this.S;
    const cyc = (arr, v) => arr[(arr.indexOf(v) + dir + arr.length) % arr.length];
    const step = (v, lo, hi, st) => Math.round(Math.max(lo, Math.min(hi, v + dir * st)) / st) * st;
    switch (key) {
      case 'track': S.track = (S.track + dir + TRACKS.length) % TRACKS.length; break;
      case 'car': S.car = (S.car + dir + CARS.length) % CARS.length; S.color = PAINT_COLORS.indexOf(CARS[S.car].color); break;
      case 'color': S.color = (S.color + dir + PAINT_COLORS.length) % PAINT_COLORS.length; break;
      case 'laps': S.laps = Math.max(1, Math.min(20, S.laps + dir)); break;
      case 'opponents': S.opponents = Math.max(0, Math.min(9, S.opponents + dir)); break;
      case 'difficulty': S.difficulty = (S.difficulty + dir + 4) % 4; break;
      case 'transmission': S.transmission = cyc(['h', 'seq', 'auto'], S.transmission); break;
      case 'wheelRange': S.wheelRange = step(S.wheelRange, 180, 1080, 30); break;
      case 'steerRatio': S.steerRatio = step(S.steerRatio, 6, 20, 1); break;
      case 'ffbStrength': S.ffbStrength = +step(S.ffbStrength, 0, 1, 0.05).toFixed(2); break;
      case 'volume': S.volume = +step(S.volume, 0, 1, 0.1).toFixed(1); this.audio.setVolume(S.volume); break;
      case 'fov': S.fov = step(S.fov, 40, 100, 2); break;
      case 'units': S.units = S.units === 'mph' ? 'kmh' : 'mph'; break;
      case 'camera': S.camera = cyc(['cockpit', 'hood', 'chase', 'far'], S.camera); break;
      case 'graphics': S.graphics = S.graphics === 'high' ? 'low' : 'high'; break;
      default:
        if (typeof S[key] === 'boolean') S[key] = !S[key];
    }
    if (key === 'ffb' && !S.ffb) this.ffb.setForce(0);
    saveSettings(S);
    this.audio.click();
    const f = this.focus;
    this.show(this.screen, true);
    this._setFocus(f);
    if (['car', 'color'].includes(key)) this.showroom.setCar(CARS[S.car], PAINT_COLORS[S.color]);
  }

  openWizard() {
    if (this.screen) this.stack.push(this.screen);
    this.menu.classList.remove('show');
    this.wizard.open();
  }

  _afterWizard(m) {
    const S = this.S;
    const hasShifter = Object.keys(m.gears).length >= 6;
    S.transmission = hasShifter ? 'h' : m.buttons.shiftUp ? 'seq' : 'auto';
    if (!m.clutch) S.autoClutch = true;
    saveSettings(S);
    this.toast(`Wheel saved. Transmission set to ${transName(S.transmission)}.`);
    this.stack = ['title'];
    this.show('main', true);
    if (!this.ffb.ready && this.ffb.supported) setTimeout(() => this.toast('Tip: Settings → Connect wheel for force feedback'), 3500);
  }

  startRace() {
    const S = this.S;
    saveSettings(S);
    this.audio.init();
    this.game.start({
      mode: this.setupMode, track: S.track, car: S.car, color: S.color,
      laps: S.laps, opponents: S.opponents, difficulty: S.difficulty,
    });
    this._enterRace();
  }

  _enterRace() {
    this.mode = 'race';
    this.menu.classList.remove('show');
    this.hudEl.classList.add('show');
    this.showroom.setVisible(false);
  }

  togglePause() {
    if (this.mode === 'race') {
      this.mode = 'pause';
      this.game.setPaused(true);
      this._overlay(`
        <h1 class="title">Paused</h1>
        <div class="menu-list">
          <button class="btn big nav" data-act="resume" data-default="1">Resume</button>
          <button class="btn big nav" data-act="restart">Restart</button>
          <button class="btn big nav" data-act="quit">Quit to menu</button>
        </div>
        <p class="hint">Settings like FFB strength can be changed from the main menu.</p>`);
    } else if (this.mode === 'pause') {
      this.closeOverlay();
      this.mode = 'race';
      this.game.setPaused(false);
    }
  }

  showResults(r) {
    this.mode = 'results';
    this.game.setPaused(true);
    const rows = r.rows.map((x) => `<tr class="${x.player ? 'me' : ''}"><td>${x.pos}</td><td><i class="dot" style="background:${x.color}"></i>${esc(x.name)}</td><td>${esc(x.car)}</td><td>${x.best}</td><td>${x.time}</td></tr>`).join('');
    this._overlay(`
      <h1 class="title">${r.position === 1 ? 'Victory!' : `You finished P${r.position}`}</h1>
      <p class="dim">${esc(r.track)}</p>
      <table class="results"><thead><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Best lap</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="menu-list row">
        <button class="btn primary big nav" data-act="again" data-default="1">Race again</button>
        <button class="btn big nav" data-act="quit">Main menu</button>
      </div>`);
  }

  _overlay(html) {
    this.overlay.innerHTML = `<div class="panel">${html}</div>`;
    this.overlay.classList.add('show');
    for (const el of this.overlay.querySelectorAll('[data-act]')) el.addEventListener('click', () => this._act(el.dataset.act));
    const nav = Array.from(this.overlay.querySelectorAll('.nav'));
    nav.forEach((el, i) => el.addEventListener('mouseenter', () => this._setOverlayFocus(i)));
    const d = nav.findIndex((e) => e.dataset.default);
    this._setOverlayFocus(d >= 0 ? d : 0);
  }

  _setOverlayFocus(i) {
    const nav = Array.from(this.overlay.querySelectorAll('.nav'));
    if (!nav.length) return;
    this.ofocus = (i + nav.length) % nav.length;
    nav.forEach((e, k) => e.classList.toggle('focus', k === this.ofocus));
  }

  closeOverlay() {
    this.overlay.classList.remove('show');
    this.overlay.innerHTML = '';
  }

  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 4000);
  }

  _renderStatus() {
    const pads = this.input.pads();
    const wheel = this.input.detectedWheel();
    const mapped = this.input.wheelConnected();
    const parts = [];
    if (wheel || mapped) {
      parts.push(`<span class="${mapped ? 'ok' : 'warn'}">● ${esc(shortName((wheel || {}).id || this.input.mapping?.padName || 'Wheel'))} ${mapped ? '' : '(needs setup)'}</span>`);
      if (mapped) parts.push(`<span class="${this.input.shifterMapped() ? 'ok' : 'dim'}">● Shifter ${this.input.shifterMapped() ? 'ready' : 'not set up'}</span>`);
      parts.push(`<span class="${this.ffb.ready ? 'ok' : 'dim'}">● FFB ${this.ffb.ready ? 'on' : 'off'}</span>`);
    } else if (pads.length) {
      parts.push(`<span class="ok">● ${esc(shortName(pads[0].id))}</span>`);
    } else {
      parts.push('<span class="dim">● No wheel detected yet. Press a button on it. (Keyboard works too.)</span>');
    }
    this.statusEl.innerHTML = parts.join('');
  }

  // Per-frame: wheel/gamepad/keyboard navigation.
  update(dt) {
    if (this.wizard.active) {
      this.wizard.update(dt);
      return;
    }
    const m = this.input.state.menu;
    if (this.mode === 'menu') {
      if (this.screen === 'title') {
        if (m.select || this.input.state.throttle > 0.6 && !this._titleLatch) {
          this._titleLatch = true;
          this._act('start');
        }
        return;
      }
      if (m.up) this._setFocus(this.focus - 1);
      if (m.down) this._setFocus(this.focus + 1);
      const cur = this._nav()[this.focus];
      if (cur && cur.dataset.opt) {
        if (m.left) this._change(cur.dataset.opt, -1);
        if (m.right) this._change(cur.dataset.opt, 1);
        if (m.select) this._change(cur.dataset.opt, 1);
      } else if (cur && m.select) cur.click();
      else if (m.left) this._setFocus(this.focus - 1);
      else if (m.right) this._setFocus(this.focus + 1);
      if (m.back) this.back();
      if (this.frameCount++ % 60 === 0) this._renderStatus();
    } else if (this.mode === 'race') {
      if (this.input.state.pressed.pause) this.togglePause();
    } else if (this.mode === 'pause' || this.mode === 'results') {
      const nav = Array.from(this.overlay.querySelectorAll('.nav'));
      if (m.up || m.left) this._setOverlayFocus(this.ofocus - 1);
      if (m.down || m.right) this._setOverlayFocus(this.ofocus + 1);
      if (this.mode === 'pause' && this.input.state.pressed.pause) this.togglePause();
      else if (m.select) nav[this.ofocus]?.click();
    }
  }
}
UI.prototype.frameCount = 0;

function transName(t) {
  return t === 'h' ? 'H-Shifter' : t === 'seq' ? 'Sequential (paddles)' : 'Automatic';
}
function camName(c) {
  return { cockpit: 'Cockpit', hood: 'Bonnet', chase: 'Chase', far: 'Far chase' }[c];
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function shortName(id) {
  return id.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
}

export function drawTrackPreview(canvas, track) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, pad = 16;
  g.clearRect(0, 0, W, H);
  const b = track.bounds;
  const sc = Math.min((W - pad * 2) / (b.maxX - b.minX), (H - pad * 2) / (b.maxZ - b.minZ));
  const ox = (W - (b.maxX - b.minX) * sc) / 2, oy = (H - (b.maxZ - b.minZ) * sc) / 2;
  const tf = (x, z) => [ox + (x - b.minX) * sc, H - oy - (z - b.minZ) * sc];
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i <= track.count; i += 2) {
    const k = i % track.count;
    const [x, y] = tf(track.x[k], track.z[k]);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 12;
  g.stroke();
  g.strokeStyle = '#f5f5f5';
  g.lineWidth = 4;
  g.stroke();
  const [sx, sy] = tf(track.x[0], track.z[0]);
  g.fillStyle = '#e1262d';
  g.beginPath();
  g.arc(sx, sy, 6, 0, Math.PI * 2);
  g.fill();
}
