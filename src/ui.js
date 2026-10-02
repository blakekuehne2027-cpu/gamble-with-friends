// Menus: title, main menu, race setup, garage, mod menu, settings, help, pause
// and results.
// Fully navigable with the wheel (paddles = up/down, turn = change, gas =
// select, brake = back), a gamepad, the keyboard or the mouse.

import { TRACKS } from './track.js';
import { CARS, PAINT_COLORS, findCar } from './cars.js';
import { saveSettings, loadJSON } from './settings.js';
import { getTrack } from './game.js';
import { Wizard } from './wizard.js';
import { fmtTime } from './hud.js';
import {
  UPGRADES, buyCar, buyUpgrade, upgradeLevel, upgradeCost, owns, buildSpec, perfStats, carColorIndex,
  saveCareer, saveMods, unlockCar, unlockAll, maxUpgrades, maxPrize, fmtMoney, MOD_DEFAULTS, modsActive, newCareer,
} from './career.js';

const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');
const DIFF = ['Easy', 'Medium', 'Hard', 'Pro'];

export class UI {
  constructor({ input, audio, ffb, settings, game, showroom, career, mods }) {
    this.career = career;
    this.mods = mods;
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
  get root() {
    return this.mode === 'menu' ? this.menu : this.overlay;
  }

  show(name, isBack = false) {
    if (!isBack && this.screen && this.screen !== name) this.stack.push(this.screen);
    if (name === 'garage' && !isBack) this.garageId = this.S.carId;
    this.screen = name;
    this.mode = 'menu';
    this.menu.classList.add('show');
    this.hudEl.classList.remove('show');
    this.overlay.classList.remove('show');
    this.showroom.setVisible(true);
    const r = this['_screen_' + name]();
    this.menu.innerHTML = `<div class="screen screen-${name}">${r}</div>`;
    this.menu.classList.toggle('dense', ['settings', 'mods', 'help'].includes(name));
    this._bind(this.menu);
    this.focus = 0;
    const focusables = this._nav();
    const pref = focusables.findIndex((e) => e.dataset.default);
    this._setFocus(pref >= 0 ? pref : 0);
    this._renderStatus();
    this._syncShowroom();
  }

  // Show the car being looked at (garage) or the selected car everywhere else.
  _syncShowroom() {
    const id = this.screen === 'garage' ? this.garageId : this.S.carId;
    const color = PAINT_COLORS[carColorIndex(this.career, id)];
    const car = findCar(id);
    const glow = car.glow ?? (this.mods.underglow ? 0x22d3ee : null);
    const key = id + color + glow;
    if (key !== this._showKey) {
      this._showKey = key;
      this.showroom.setCar(car, color, glow);
    }
  }

  _rerender() {
    const f = this.focus;
    if (this.mode === 'menu') this.show(this.screen, true);
    else this._showOverlay(this.overlayName);
    this._setFocus(f);
  }

  _money() {
    return `<div class="money-badge">${fmtMoney(this.career.money)}</div>`;
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
      ${this._money()}
      <div class="menu-list">
        <button class="btn big nav" data-act="race" ${needsSetup ? '' : 'data-default="1"'}>Race</button>
        <button class="btn big nav" data-act="tt">Time Trial</button>
        <button class="btn big nav" data-act="garage">Garage</button>
        <button class="btn big nav mod-btn" data-act="mods">Mod Menu${modsActive(this.mods) ? ' <small>ON</small>' : ''}</button>
        <button class="btn big nav" data-act="wizard">Wheel Setup</button>
        <button class="btn big nav" data-act="settings">Settings</button>
        <button class="btn big nav" data-act="help">How to Play</button>
      </div>
      <p class="hint">Driving: <b>${esc(findCar(this.S.carId).name)}</b> · ${this.career.stats.races} races · ${this.career.stats.wins} wins · ${fmtMoney(this.career.stats.earned)} earned</p>
      <p class="hint nav-hint">Wheel: paddles = up/down · turn = change · gas = select · brake = back</p>`;
  }

  _optRow(key, label, display, extra = '') {
    return `<div class="opt nav" data-opt="${key}" ${extra}><label>${label}</label><div class="opt-val"><span class="arr" data-dir="-1">◀</span><b>${display}</b><span class="arr" data-dir="1">▶</span></div></div>`;
  }

  _screen_setup() {
    const S = this.S;
    const race = this.setupMode === 'race';
    const t = TRACKS[S.track], c = findCar(S.carId);
    const best = loadJSON(`redline.ghost.${t.id}.${c.id}`, null);
    const perf = perfStats(buildSpec(c, this.career.owned[c.id]?.up, this.mods));
    const prize = maxPrize({ opponents: S.opponents, laps: S.laps, difficulty: S.difficulty, trackKm: getTrack(S.track).length / 1000 });
    const ups = UPGRADES.reduce((n, u) => n + upgradeLevel(this.career, c.id, u.id), 0);
    const stat = (label, v) => `<div class="stat"><label>${label}</label><div><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
    return `
      <h1 class="title">${race ? 'Race' : 'Time Trial'}</h1>
      ${this._money()}
      <div class="setup">
        <div class="setup-opts">
          ${this._optRow('track', 'Track', t.name)}
          ${this._optRow('car', 'Car (owned)', c.name)}
          ${this._optRow('color', 'Paint', `<i class="swatch" style="background:${hexCss(PAINT_COLORS[carColorIndex(this.career, c.id)])}"></i>`)}
          ${race ? this._optRow('laps', 'Laps', S.laps) : ''}
          ${race ? this._optRow('opponents', 'Opponents', S.opponents) : ''}
          ${race ? this._optRow('difficulty', 'AI difficulty', DIFF[S.difficulty]) : ''}
          ${this._optRow('transmission', 'Transmission', transName(S.transmission))}
          <p class="prize">${race ? `Win up to <b>${fmtMoney(prize)}</b> + overtake, drift &amp; speed-trap bonuses` : `Earn <b>${fmtMoney(Math.round(getTrack(S.track).length / 1000 * 110 / 10) * 10)}</b> per lap + <b>$1,200</b> for a new personal best`}</p>
          <button class="btn primary big nav" data-act="go" data-default="1">${race ? 'Start Race' : 'Start Session'}</button>
          <button class="btn nav" data-act="garage">Garage &amp; upgrades</button>
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
            <p class="dim">${perf.hp} hp · ${perf.kg} kg · ${ups}/18 upgrades${perf.nitro > 0 ? ` · nitro ${perf.nitro}s` : ''}</p>
          </div>
        </div>
      </div>`;
  }

  _screen_garage() {
    const C = this.career;
    const car = findCar(this.garageId);
    const owned = owns(C, car.id);
    const spec = buildSpec(car, C.owned[car.id]?.up);
    const p = perfStats(spec);
    const stock = perfStats(buildSpec(car, {}));
    const units = this.S.units === 'mph';
    const spd = (ms) => Math.round(units ? ms * 2.23694 : ms * 3.6) + (units ? ' mph' : ' km/h');
    const bar = (label, v, max, txt) => `<div class="stat"><label>${label}</label><div><i style="width:${Math.min(100, Math.round((v / max) * 100))}%"></i></div><span>${txt}</span></div>`;
    let status;
    if (owned) status = `<p class="owned">✓ Owned — this is the car you'll race</p>`;
    else if (car.modOnly) status = `<p class="locked">🔒 Mod Menu exclusive — unlock it in the Mod Menu</p>`;
    else {
      const can = C.money >= car.price;
      status = `<button class="btn big nav ${can ? 'primary' : 'disabled'}" data-act="buycar" data-default="1">Buy for ${fmtMoney(car.price)}</button>${can ? '' : `<p class="dim">You need ${fmtMoney(car.price - C.money)} more. Win races to earn it.</p>`}`;
    }
    const upRows = owned ? UPGRADES.map((u) => {
      const lv = upgradeLevel(C, car.id, u.id);
      const pips = [1, 2, 3].map((i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('');
      const next = lv < 3 ? `<em>${u.levels[lv]}</em><b>${fmtMoney(upgradeCost(car, u.id, lv + 1))}</b>` : '<b class="max">MAXED</b>';
      const afford = lv < 3 && C.money >= upgradeCost(car, u.id, lv + 1);
      return `<button class="upg nav ${lv >= 3 ? 'maxed' : afford ? '' : 'poor'}" data-act="up:${u.id}" title="${u.desc}"><span class="upg-name">${u.name}</span><span class="pips">${pips}</span>${next}</button>`;
    }).join('') : '';
    return `
      <h1 class="title">Garage</h1>
      ${this._money()}
      <div class="setup">
        <div class="setup-opts">
          ${this._optRow('garageCar', 'Car', `${car.name}`)}
          ${status}
          ${owned ? this._optRow('paint', 'Paint', `<i class="swatch" style="background:${hexCss(PAINT_COLORS[carColorIndex(C, car.id)])}"></i>`) : ''}
          ${owned ? `<h4 class="sec">Upgrades</h4>${upRows}` : ''}
          <button class="btn ghost nav" data-act="back">Back</button>
        </div>
        <div class="setup-info">
          <div class="card">
            <h3>${car.name}</h3><p>${car.blurb}</p>
            ${bar('Power', p.hp, 2400, `${p.hp} hp${p.hp > stock.hp ? ` <small>(+${p.hp - stock.hp})</small>` : ''}`)}
            ${bar('Weight', 1700 - p.kg, 1000, `${p.kg} kg`)}
            ${bar('Grip', p.grip, 2.6, `${p.grip.toFixed(2)} g`)}
            ${bar('Top speed', p.top, 150, spd(p.top))}
            ${bar('Nitro', p.nitro, 6, p.nitro ? p.nitro + ' s' : 'none')}
            <p class="dim">${car.cylinders === 12 ? 'V12' : car.cylinders === 8 ? 'V8' : 'Inline-4'} · redline ${car.redline} rpm · class ${car.tier}${car.price ? ` · ${fmtMoney(car.price)}` : ''}</p>
          </div>
          <div class="card garage-list">${CARS.map((c) => `<div class="${c.id === car.id ? 'cur' : ''}"><span>${c.name}</span><em>${owns(C, c.id) ? (c.id === this.S.carId ? 'DRIVING' : 'OWNED') : c.modOnly ? 'MOD' : fmtMoney(c.price)}</em></div>`).join('')}</div>
        </div>
      </div>`;
  }

  _modRows() {
    const M = this.mods;
    const onoff = (v) => (v ? '<span class="on">ON</span>' : 'Off');
    const aiName = { 0.6: 'Snail', 1: 'Normal', 1.25: 'Turbo', 1.5: 'Insane' }[M.aiSpeed] || M.aiSpeed + '×';
    return `
      ${this._optRow('m:power', 'Engine power', M.power === 1 ? 'Normal' : `<span class="on">${M.power}×</span>`)}
      ${this._optRow('m:superGrip', 'Super grip', onoff(M.superGrip))}
      ${this._optRow('m:drift', 'Drift mode (slidey rear)', onoff(M.drift))}
      ${this._optRow('m:infiniteNitro', 'Infinite nitro (any car)', onoff(M.infiniteNitro))}
      ${this._optRow('m:ghost', 'Ghost mode (drive through cars)', onoff(M.ghost))}
      ${this._optRow('m:slowmo', 'Slow motion', onoff(M.slowmo))}
      ${this._optRow('m:aiSpeed', 'AI speed', M.aiSpeed === 1 ? 'Normal' : `<span class="on">${aiName}</span>`)}
      ${this._optRow('m:rainbow', 'Rainbow paint', onoff(M.rainbow))}
      ${this._optRow('m:underglow', 'Neon underglow', onoff(M.underglow))}`;
  }

  _screen_mods() {
    const ownsOP = owns(this.career, 'hypernova');
    const cur = findCar(this.S.carId);
    return `
      <h1 class="title mod-title">Mod Menu</h1>
      ${this._money()}
      <p class="tag small">Cheats &amp; chaos. Changes apply instantly, even mid-race (pause → Mod Menu).</p>
      <div class="settings">
        <div class="col">
          <h4>Unlocks</h4>
          <button class="btn primary nav" data-act="mod:op" data-default="1">${ownsOP && this.S.carId === 'hypernova' ? '✓ Driving HYPERNOVA X (OP car)' : ownsOP ? 'Drive HYPERNOVA X (OP car)' : 'Get the OP car: HYPERNOVA X'}</button>
          <button class="btn nav" data-act="mod:money">+ $100,000</button>
          <button class="btn nav" data-act="mod:unlock">Unlock every car</button>
          <button class="btn nav" data-act="mod:max">Max upgrades on ${esc(cur.name)}</button>
          <button class="btn ghost nav" data-act="mod:off">Turn all mods off</button>
          <button class="btn ghost nav" data-act="back">Back</button>
        </div>
        <div class="col">
          <h4>Mods</h4>
          ${this._modRows()}
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
          <button class="btn nav" data-act="bindnitro">Set NITRO button on wheel${this.input.mapping?.buttons?.nitro ? ` (now: button ${this.input.mapping.buttons.nitro.button})` : ''}</button>
          <h4>Career</h4>
          <button class="btn ghost nav" data-act="resetcareer">Reset career (money, cars, upgrades)</button>
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
            <tr><td>N / Left Shift</td><td>Nitro (hold)</td></tr>
          </table>
          <h3>Xbox / PlayStation controller</h3>
          <p>RT gas · LT brake · left stick steer · RB/LB shift · A nitro · Y camera · B handbrake · View reset · Menu pause.</p>
          <h3>Career</h3>
          <p>You start with the Rookie Coupe. Races pay prize money (more for better finishes, harder AI and more laps) plus bonuses for overtakes, drifts and the speed trap. Spend it in the <b>Garage</b> on new cars and upgrades. Nitrous is an upgrade: hold the NITRO button for a boost.</p>
        </div>
      </div>
      <button class="btn ghost nav" data-act="back" data-default="1">Back</button>`;
  }

  // ------------------------------------------------------------ behaviour
  _bind(root) {
    for (const el of root.querySelectorAll('[data-act]')) {
      el.addEventListener('click', () => this._act(el.dataset.act));
    }
    for (const el of root.querySelectorAll('.opt')) {
      for (const a of el.querySelectorAll('.arr')) {
        a.addEventListener('click', (e) => { e.stopPropagation(); this._change(el.dataset.opt, +a.dataset.dir); });
      }
      el.addEventListener('click', () => this._change(el.dataset.opt, 1));
    }
    Array.from(root.querySelectorAll('.nav')).forEach((el, i) => el.addEventListener('mouseenter', () => this._setFocus(i)));
    const map = root.querySelector('#trackmap');
    if (map) drawTrackPreview(map, getTrack(this.S.track));
  }

  _nav() {
    return Array.from(this.root.querySelectorAll('.nav'));
  }

  _setFocus(i) {
    const n = this._nav();
    if (!n.length) return;
    this.focus = (i + n.length) % n.length;
    n.forEach((e, k) => e.classList.toggle('focus', k === this.focus));
    n[this.focus].scrollIntoView({ block: 'nearest' });
  }

  // Shared wheel/pad/keyboard navigation for menus and overlays.
  _navigate(m) {
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
      case 'garage': this.show('garage'); break;
      case 'mods': this.show('mods'); break;
      case 'pausemods': this._showOverlay('pausemods'); break;
      case 'pauseback': this._showOverlay('pause'); break;
      case 'results-garage': this.closeOverlay(); this.game.stop(); this.stack = ['title', 'main']; this.show('garage'); break;
      case 'buycar': {
        const car = findCar(this.garageId);
        if (buyCar(this.career, car.id)) {
          this.S.carId = car.id;
          saveCareer(this.career);
          saveSettings(this.S);
          this.audio.cash?.();
          this.toast(`You bought the ${car.name}!`);
        } else this.toast('Not enough money yet. Win some races!');
        this._rerender();
        break;
      }
      case 'bindnitro': this._startBind('nitro'); break;
      case 'resetcareer':
        if (this._confirmReset && performance.now() - this._confirmReset < 4000) {
          Object.assign(this.career, newCareer());
          this.S.carId = 'rookie';
          saveCareer(this.career);
          saveSettings(this.S);
          this.toast('Career reset. Back to the Rookie Coupe.');
          this._confirmReset = 0;
          this._rerender();
        } else {
          this._confirmReset = performance.now();
          this.toast('Press reset again within 4 seconds to confirm.');
        }
        break;
      default:
        if (a.startsWith('up:')) this._buyUpgrade(a.slice(3));
        else if (a.startsWith('mod:')) this._modAction(a.slice(4));
    }
  }

  _buyUpgrade(upId) {
    const car = findCar(this.garageId);
    const u = UPGRADES.find((x) => x.id === upId);
    const lv = upgradeLevel(this.career, car.id, upId);
    if (lv >= 3) { this.toast(`${u.name} is already maxed.`); return; }
    if (buyUpgrade(this.career, car.id, upId)) {
      saveCareer(this.career);
      this.toast(`${u.name}: ${u.levels[lv]} installed!`);
    } else this.toast(`Not enough money for ${u.name} (${fmtMoney(upgradeCost(car, upId, lv + 1))}).`);
    this._rerender();
  }

  _modAction(what) {
    const C = this.career;
    if (what === 'op') {
      unlockCar(C, 'hypernova');
      this.S.carId = 'hypernova';
      this.toast('HYPERNOVA X unlocked. 1,800 hp. Good luck.');
    } else if (what === 'money') {
      C.money += 100000;
      this.toast('+$100,000');
    } else if (what === 'unlock') {
      unlockAll(C);
      this.toast('Every car unlocked.');
    } else if (what === 'max') {
      maxUpgrades(C, this.S.carId);
      this.toast(`${findCar(this.S.carId).name}: every upgrade maxed.`);
    } else if (what === 'off') {
      Object.assign(this.mods, MOD_DEFAULTS);
      saveMods(this.mods);
      this.game.applyMods();
      this.toast('All mods off.');
    }
    saveCareer(C);
    saveSettings(this.S);
    this._rerender();
  }

  // Wait for a wheel button press and bind it to an action.
  _startBind(action) {
    if (!this.input.mapping?.steer) {
      this.toast('Run Wheel Setup first.');
      return;
    }
    this.binding = { action, base: this.input.snapshot(), until: performance.now() + 8000 };
    this.toast(`Press the wheel button you want for ${action.toUpperCase()}…`);
  }

  _updateBind() {
    const b = this.binding;
    if (performance.now() > b.until) {
      this.binding = null;
      this.toast('Button binding cancelled.');
      return;
    }
    for (const p of this.input.snapshot()) {
      const bp = b.base.find((q) => q.id === p.id && q.index === p.index);
      for (let i = 0; i < p.buttons.length; i++) {
        const down = p.buttons[i].pressed || p.buttons[i].value > 0.5;
        const was = bp && (bp.buttons[i]?.pressed || bp.buttons[i]?.value > 0.5);
        if (down && !was) {
          const m = this.input.mapping;
          m.buttons = { ...(m.buttons || {}), [b.action]: { pad: p.id, button: i } };
          this.input.setMapping(m);
          this.binding = null;
          this.toast(`${b.action.toUpperCase()} = button ${i}`);
          this._rerender();
          return;
        }
      }
    }
  }

  _change(key, dir) {
    const S = this.S;
    const cyc = (arr, v) => arr[(arr.indexOf(v) + dir + arr.length) % arr.length];
    const step = (v, lo, hi, st) => Math.round(Math.max(lo, Math.min(hi, v + dir * st)) / st) * st;
    switch (key) {
      case 'track': S.track = (S.track + dir + TRACKS.length) % TRACKS.length; break;
      case 'car': {
        const mine = CARS.filter((c) => owns(this.career, c.id));
        const i = mine.findIndex((c) => c.id === S.carId);
        S.carId = mine[(i + dir + mine.length) % mine.length].id;
        break;
      }
      case 'color': case 'paint': {
        const id = key === 'paint' ? this.garageId : S.carId;
        const o = this.career.owned[id];
        if (o) {
          o.color = (carColorIndex(this.career, id) + dir + PAINT_COLORS.length) % PAINT_COLORS.length;
          saveCareer(this.career);
        }
        break;
      }
      case 'garageCar': {
        const i = CARS.findIndex((c) => c.id === this.garageId);
        this.garageId = CARS[(i + dir + CARS.length) % CARS.length].id;
        if (owns(this.career, this.garageId)) S.carId = this.garageId;
        break;
      }
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
        if (key.startsWith('m:')) this._changeMod(key.slice(2), dir);
        else if (typeof S[key] === 'boolean') S[key] = !S[key];
    }
    if (key === 'ffb' && !S.ffb) this.ffb.setForce(0);
    saveSettings(S);
    this.audio.click();
    this._rerender();
  }

  _changeMod(k, dir) {
    const M = this.mods;
    const cyc = (arr) => arr[(Math.max(0, arr.indexOf(M[k])) + dir + arr.length) % arr.length];
    if (k === 'power') M.power = cyc([1, 1.5, 2, 3, 5]);
    else if (k === 'aiSpeed') M.aiSpeed = cyc([0.6, 1, 1.25, 1.5]);
    else M[k] = !M[k];
    saveMods(M);
    this.game.applyMods();
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
    if (!owns(this.career, S.carId)) S.carId = 'rookie';
    this.game.start({
      mode: this.setupMode, track: S.track, carId: S.carId, color: carColorIndex(this.career, S.carId),
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
      this._showOverlay('pause');
    } else if (this.mode === 'pause') {
      this.closeOverlay();
      this.mode = 'race';
      this.game.setPaused(false);
    }
  }

  _overlay_pause() {
    return `
      <h1 class="title">Paused</h1>
      <div class="menu-list">
        <button class="btn big nav" data-act="resume" data-default="1">Resume</button>
        <button class="btn big nav" data-act="restart">Restart</button>
        <button class="btn big nav mod-btn" data-act="pausemods">Mod Menu${modsActive(this.mods) ? ' <small>ON</small>' : ''}</button>
        <button class="btn big nav" data-act="quit">Quit to menu</button>
      </div>
      <p class="hint">Quitting a race early pays nothing. Settings like FFB strength are in the main menu.</p>`;
  }

  _overlay_pausemods() {
    return `
      <h1 class="title mod-title">Mod Menu</h1>
      <div class="col pause-mods">${this._modRows()}</div>
      <div class="menu-list row">
        <button class="btn primary nav" data-act="resume" data-default="1">Resume race</button>
        <button class="btn nav" data-act="pauseback">Back</button>
      </div>`;
  }

  _overlay_results() {
    const r = this.lastResults;
    const rows = r.rows.map((x) => `<tr class="${x.player ? 'me' : ''}"><td>${x.pos}</td><td><i class="dot" style="background:${x.color}"></i>${esc(x.name)}</td><td>${esc(x.car)}</td><td>${x.best}</td><td>${x.time}</td></tr>`).join('');
    const pay = r.reward.lines.map(([label, v]) => `<div><span>${esc(label)}</span><b>+${fmtMoney(v)}</b></div>`).join('');
    return `
      <h1 class="title">${r.position === 1 ? 'Victory!' : `You finished P${r.position}`}</h1>
      <p class="dim">${esc(r.track)} · top speed ${Math.round(this.S.units === 'mph' ? r.topSpeed * 2.23694 : r.topSpeed * 3.6)} ${this.S.units === 'mph' ? 'mph' : 'km/h'}</p>
      <div class="results-wrap">
        <table class="results"><thead><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Best lap</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="earnings"><h4>Earnings</h4>${pay}<div class="total"><span>Total</span><b>+${fmtMoney(r.reward.total)}</b></div><div class="bal"><span>Balance</span><b>${fmtMoney(r.balance)}</b></div></div>
      </div>
      <div class="menu-list row">
        <button class="btn primary big nav" data-act="again" data-default="1">Race again</button>
        <button class="btn big nav" data-act="results-garage">Garage</button>
        <button class="btn big nav" data-act="quit">Main menu</button>
      </div>`;
  }

  showResults(r) {
    this.mode = 'results';
    this.game.setPaused(true);
    this.lastResults = r;
    this.audio.cash?.();
    this._showOverlay('results');
  }

  _showOverlay(name) {
    this.overlayName = name;
    this.overlay.innerHTML = `<div class="panel">${this['_overlay_' + name]()}</div>`;
    this.overlay.classList.add('show');
    this._bind(this.overlay);
    const nav = this._nav();
    const d = nav.findIndex((e) => e.dataset.default);
    this._setFocus(d >= 0 ? d : 0);
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
    if (this.binding) { this._updateBind(); return; }
    const m = this.input.state.menu;
    if (this.mode === 'menu') {
      if (this.screen === 'title') {
        if (m.select || this.input.state.throttle > 0.6 && !this._titleLatch) {
          this._titleLatch = true;
          this._act('start');
        }
        return;
      }
      this._navigate(m);
      if (m.back) this.back();
      if (this.frameCount++ % 60 === 0) this._renderStatus();
    } else if (this.mode === 'race') {
      if (this.input.state.pressed.pause) this.togglePause();
    } else if (this.mode === 'pause' || this.mode === 'results') {
      if (this.mode === 'pause' && this.input.state.pressed.pause) { this.togglePause(); return; }
      if (this.mode === 'pause' && m.back) {
        if (this.overlayName === 'pausemods') this._showOverlay('pause');
        else this.togglePause();
        return;
      }
      this._navigate(m);
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
