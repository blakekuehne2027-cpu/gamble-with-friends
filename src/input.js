// Input: Logitech wheel (via a calibrated mapping), standard gamepads and
// keyboard, merged into one control state every frame.

import { loadJSON, saveJSON } from './settings.js';

const MAP_KEY = 'redline.mapping.v2';

export const WHEEL_HINT = /wheel|g29|g920|g923|g27|g25|driving force|046d|logitech|thrustmaster|fanatec|moza|simagic|c24f|c262|c260|c266|c26e/i;

const KEYS = {
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  handbrake: ['Space'],
  clutch: ['KeyX'],
  shiftUp: ['KeyE', 'ShiftRight'],
  shiftDown: ['KeyQ', 'ControlRight'],
  camera: ['KeyC'],
  lookBack: ['KeyB'],
  reset: ['KeyR'],
  nitro: ['KeyN', 'ShiftLeft'],
  rewind: ['KeyT'],
  radio: ['KeyM'],
  pause: ['Escape', 'KeyP'],
};

export const ACTIONS = ['shiftUp', 'shiftDown', 'camera', 'pause', 'reset', 'lookBack', 'handbrake', 'nitro', 'rewind', 'radio'];
export const GEAR_KEYS = ['1', '2', '3', '4', '5', '6', 'R'];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Input {
  constructor() {
    this.mapping = loadJSON(MAP_KEY, null);
    this.keys = new Set();
    this.tapped = new Set(); // keys pressed since the last poll (so quick taps are never missed)
    this.prev = {};
    this.axisFirst = new Map(); // binding key -> first value seen (Chrome reports 0 until a pedal moves)
    this.armed = new Set();
    this.menuHeld = {};
    this.menuRepeat = {};
    this.lastSource = 'keys';
    this.state = this._blank();
    this.connected = [];

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Typing in a text box (e.g. a bet amount) isn't driving or menu input.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
      this.tapped.add(e.code);
      this.lastSource = 'keys';
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', () => this._refreshConnected());
    window.addEventListener('gamepaddisconnected', () => this._refreshConnected());
  }

  _blank() {
    return {
      source: 'keys', wheel: false, steerRaw: 0, steer: 0,
      throttle: 0, brake: 0, clutch: 0, hGear: null,
      handbrake: false, lookBack: false,
      pressed: {}, menu: {},
    };
  }

  _refreshConnected() {
    this.connected = this.pads().map((p) => p.id);
  }

  pads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    return Array.from(list || []).filter(Boolean);
  }

  findPad(id) {
    return this.pads().find((p) => p.id === id) || null;
  }

  detectedWheel() {
    return this.pads().find((p) => WHEEL_HINT.test(p.id) && p.mapping !== 'standard') || null;
  }

  standardPad() {
    return this.pads().find((p) => p.mapping === 'standard' && !WHEEL_HINT.test(p.id)) || null;
  }

  setMapping(m) {
    this.mapping = m;
    this.axisFirst.clear();
    this.armed.clear();
    saveJSON(MAP_KEY, m);
  }

  clearMapping() {
    this.mapping = null;
    try { localStorage.removeItem(MAP_KEY); } catch (e) { /* ignore */ }
  }

  wheelConnected() {
    const m = this.mapping;
    return !!(m && m.steer && this.findPad(m.steer.pad));
  }

  shifterMapped() {
    const m = this.mapping;
    return !!(m && m.gears && Object.keys(m.gears).length >= 6);
  }

  // Raw value of an axis or analog button binding.
  raw(b) {
    if (!b) return null;
    const pad = this.findPad(b.pad);
    if (!pad) return null;
    if (b.axis !== undefined) return pad.axes[b.axis] ?? null;
    if (b.button !== undefined) return pad.buttons[b.button]?.value ?? null;
    return null;
  }

  pedal(b) {
    const v = this.raw(b);
    if (v === null) return 0;
    const key = b.pad + '|' + (b.axis ?? 'b' + b.button);
    if (!this.armed.has(key)) {
      // Chrome reports some pedal axes as 0 until they first move; ignore until then.
      if (!this.axisFirst.has(key)) this.axisFirst.set(key, v);
      if (Math.abs(v - this.axisFirst.get(key)) > 0.02 || Math.abs(v - b.rest) < 0.02) this.armed.add(key);
      else return 0;
    }
    const span = b.full - b.rest;
    if (Math.abs(span) < 1e-3) return 0;
    let x = (v - b.rest) / span;
    x = clamp01((x - 0.03) / 0.94);
    return x;
  }

  steerValue(b) {
    const v = this.raw(b);
    if (v === null) return 0;
    if (v >= b.center) return Math.min(1, (v - b.center) / ((b.right - b.center) || 1));
    return Math.max(-1, -(b.center - v) / ((b.center - b.left) || 1));
  }

  buttonDown(b) {
    if (!b) return false;
    const pad = this.findPad(b.pad);
    if (!pad) return false;
    const btn = pad.buttons[b.button];
    return !!btn && (btn.pressed || btn.value > 0.5);
  }

  keyDown(action) {
    const list = KEYS[action];
    for (const k of list) if (this.keys.has(k) || this.tapped.has(k)) return true;
    return false;
  }

  _keyTapped(action) {
    for (const k of KEYS[action]) if (this.tapped.has(k)) return true;
    return false;
  }

  poll() {
    const st = this.state;
    const m = this.mapping;
    const down = {};
    for (const a of ACTIONS) down[a] = this.keyDown(a);

    // --- Keyboard ---
    const kThrottle = this.keyDown('throttle') ? 1 : 0;
    const kBrake = this.keyDown('brake') ? 1 : 0;
    const kSteer = (this.keyDown('right') ? 1 : 0) - (this.keyDown('left') ? 1 : 0);
    const kClutch = this.keyDown('clutch') ? 1 : 0;

    // --- Wheel ---
    let wheel = false, wSteer = 0, wThrottle = 0, wBrake = 0, wClutch = 0, hGear = null;
    if (m && m.steer && this.findPad(m.steer.pad)) {
      wheel = true;
      wSteer = this.steerValue(m.steer);
      wThrottle = this.pedal(m.throttle);
      wBrake = this.pedal(m.brake);
      wClutch = m.clutch ? this.pedal(m.clutch) : 0;
      if (m.gears && Object.keys(m.gears).length && this.findPad(Object.values(m.gears)[0].pad)) {
        hGear = 0;
        for (const g of GEAR_KEYS) {
          if (m.gears[g] && this.buttonDown(m.gears[g])) { hGear = g === 'R' ? -1 : +g; break; }
        }
      }
      if (m.buttons) for (const a of ACTIONS) if (m.buttons[a] && this.buttonDown(m.buttons[a])) down[a] = true;
      if (Math.abs(wSteer - (this._lastWSteer ?? wSteer)) > 0.01 || wThrottle > 0.05 || wBrake > 0.05) this.lastSource = 'wheel';
      this._lastWSteer = wSteer;
    }

    // --- Standard gamepad ---
    let pSteer = 0, pThrottle = 0, pBrake = 0;
    const pad = this.standardPad();
    const padMenu = {};
    if (pad) {
      const ax = pad.axes[0] || 0;
      pSteer = Math.abs(ax) < 0.08 ? 0 : Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.4;
      pThrottle = pad.buttons[7]?.value || 0;
      pBrake = pad.buttons[6]?.value || 0;
      const b = (i) => !!pad.buttons[i] && pad.buttons[i].pressed;
      if (b(5)) down.shiftUp = true;
      if (b(4)) down.shiftDown = true;
      if (b(3)) down.camera = true;
      if (b(2)) down.lookBack = true;
      if (b(1)) down.handbrake = true;
      if (b(0)) down.nitro = true;
      if (b(14)) down.rewind = true;
      if (b(11)) down.radio = true; // right stick click
      if (b(8)) down.reset = true;
      if (b(9)) down.pause = true;
      padMenu.up = b(12) || (pad.axes[1] || 0) < -0.6;
      padMenu.down = b(13) || (pad.axes[1] || 0) > 0.6;
      padMenu.left = b(14) || ax < -0.6;
      padMenu.right = b(15) || ax > 0.6;
      padMenu.select = b(0);
      padMenu.back = b(1) || b(9);
      if (Math.abs(pSteer) > 0.1 || pThrottle > 0.1 || pBrake > 0.1) this.lastSource = 'pad';
    }

    // --- Merge ---
    st.throttle = Math.max(kThrottle, wThrottle, pThrottle);
    st.brake = Math.max(kBrake, wBrake, pBrake);
    st.clutch = Math.max(kClutch, wClutch);
    st.hGear = hGear;
    st.wheel = wheel && kSteer === 0;
    st.steerRaw = wSteer;
    st.steer = kSteer !== 0 ? kSteer : pSteer;
    st.source = kSteer !== 0 || kThrottle || kBrake ? 'keys' : this.lastSource;
    if (st.source === 'pad' && !pad) st.source = 'keys';
    st.handbrake = down.handbrake;
    st.nitro = down.nitro;
    st.rewind = down.rewind;
    st.lookBack = down.lookBack;
    st.pressed = {};
    for (const a of ACTIONS) {
      st.pressed[a] = (down[a] && !this.prev[a]) || this._keyTapped(a);
      this.prev[a] = down[a];
    }

    // --- Menu navigation (keyboard, gamepad, wheel) ---
    const k = (...codes) => codes.some((c) => this.keys.has(c));
    const menuDown = {
      up: k('ArrowUp', 'KeyW') || !!padMenu.up || (wheel && down.shiftDown),
      down: k('ArrowDown', 'KeyS') || !!padMenu.down || (wheel && down.shiftUp),
      left: k('ArrowLeft', 'KeyA') || !!padMenu.left || (wheel && this._wheelDir(wSteer) < 0),
      right: k('ArrowRight', 'KeyD') || !!padMenu.right || (wheel && this._wheelDir(wSteer) > 0),
      select: k('Enter', 'NumpadEnter') || !!padMenu.select || (wheel && this._pedalLatch('thr', wThrottle)),
      back: k('Escape', 'Backspace') || !!padMenu.back || (wheel && (this._pedalLatch('brk', wBrake) || (m?.buttons?.pause && this.buttonDown(m.buttons.pause)))),
    };
    // Taps that started and ended between two polls.
    const tapMap = { up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], select: ['Enter', 'NumpadEnter'], back: ['Escape', 'Backspace'] };
    const now = performance.now();
    st.menu = {};
    for (const key in menuDown) {
      const was = this.menuHeld[key];
      if ((menuDown[key] && !was) || tapMap[key].some((c) => this.tapped.has(c))) {
        st.menu[key] = true;
        this.menuRepeat[key] = now + 420;
      } else if (menuDown[key] && ['up', 'down', 'left', 'right'].includes(key) && now > (this.menuRepeat[key] || 0)) {
        st.menu[key] = true;
        this.menuRepeat[key] = now + 110;
      }
      this.menuHeld[key] = menuDown[key];
    }
    this.tapped.clear();
    return st;
  }

  _wheelDir(v) {
    if (this._wdir === undefined) this._wdir = 0;
    if (this._wdir === 0) {
      if (v > 0.12) this._wdir = 1;
      else if (v < -0.12) this._wdir = -1;
    } else if (Math.abs(v) < 0.06) this._wdir = 0;
    return this._wdir;
  }

  _pedalLatch(key, v) {
    this._latch = this._latch || {};
    if (!this._latch[key] && v > 0.6) this._latch[key] = true;
    else if (this._latch[key] && v < 0.25) this._latch[key] = false;
    return this._latch[key];
  }

  // Snapshot of every pad for the wizard and the raw-input debug view.
  snapshot() {
    return this.pads().map((p) => ({
      id: p.id,
      index: p.index,
      mapping: p.mapping,
      axes: Array.from(p.axes),
      buttons: p.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
    }));
  }
}
