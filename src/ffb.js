// Force feedback + rev LEDs for Logitech wheels over WebHID (Chrome / Edge).
//
// The browser Gamepad API can't drive a wheel's motor, so we talk to the wheel
// directly:
//  * G29 / G923 (PlayStation versions) and older wheels: the classic Logitech
//    7-byte FFB protocol (same commands the Linux hid-lg4ff driver sends).
//  * G920 / G923 (Xbox versions): HID++ 2.0 feature 0x8123 (as in the Linux
//    hid-logitech-hidpp driver).
// Everything here is best-effort: if the wheel refuses, the game still plays.

const LOGITECH = 0x046d;
const HIDPP_PRODUCTS = new Set([0xc261, 0xc262, 0xc26d, 0xc26e]); // G920 / G923 Xbox
const FEATURE_FFB = 0x8123;
const SW_ID = 0x0d;

export class ForceFeedback {
  constructor() {
    this.supported = typeof navigator !== 'undefined' && !!navigator.hid;
    this.device = null;
    this.kind = null; // 'classic' | 'hidpp'
    this.status = this.supported ? 'Not connected' : 'Needs Chrome or Edge (WebHID)';
    this.ready = false;
    this.busy = false;
    this.lastForce = null;
    this.lastLeds = -1;
    this.lastSend = 0;
    this.listeners = new Set();
    this.hidppSlot = 0;
    this.pending = new Map();
    this.range = 0;
    if (this.supported) {
      navigator.hid.addEventListener('disconnect', (e) => {
        if (e.device === this.device) this._lost('Wheel disconnected');
      });
      window.addEventListener('beforeunload', () => this.stop());
    }
  }

  onChange(fn) { this.listeners.add(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  _lost(msg) {
    this.device = null;
    this.ready = false;
    this.status = msg;
    this._emit();
  }

  get name() {
    return this.device ? this.device.productName : '';
  }

  // Try to reconnect to a wheel the user already granted access to.
  async autoConnect() {
    if (!this.supported) return false;
    try {
      const list = await navigator.hid.getDevices();
      const dev = this._pick(list);
      if (dev) return await this._open(dev);
    } catch (e) { /* ignore */ }
    return false;
  }

  // Must be called from a click handler (browser permission prompt).
  async connect() {
    if (!this.supported) return false;
    try {
      const list = await navigator.hid.requestDevice({ filters: [{ vendorId: LOGITECH }] });
      const dev = this._pick(list);
      if (!dev) {
        this.status = 'No wheel selected';
        this._emit();
        return false;
      }
      return await this._open(dev);
    } catch (e) {
      this.status = 'Permission denied: ' + e.message;
      this._emit();
      return false;
    }
  }

  _pick(list) {
    const outs = (d) => d.collections.reduce((n, c) => n + (c.outputReports?.length || 0), 0);
    const cands = list.filter((d) => d.vendorId === LOGITECH && outs(d) > 0);
    // Prefer the interface that carries HID++ long reports for G920-type wheels.
    const hidpp = cands.find((d) => HIDPP_PRODUCTS.has(d.productId) && this._hasReport(d, 0x11));
    return hidpp || cands.find((d) => !HIDPP_PRODUCTS.has(d.productId)) || cands[0] || null;
  }

  _hasReport(d, id) {
    return d.collections.some((c) => (c.outputReports || []).some((r) => r.reportId === id));
  }

  _outputReport(d) {
    for (const c of d.collections) {
      for (const r of c.outputReports || []) {
        let bits = 0;
        for (const it of r.items || []) bits += (it.reportSize || 0) * (it.reportCount || 0);
        return { id: r.reportId, len: Math.max(7, Math.round(bits / 8)) };
      }
    }
    return { id: 0, len: 7 };
  }

  async _open(dev) {
    try {
      if (!dev.opened) await dev.open();
    } catch (e) {
      this.status = 'Could not open wheel: ' + e.message;
      this._emit();
      return false;
    }
    this.device = dev;
    this.kind = HIDPP_PRODUCTS.has(dev.productId) ? 'hidpp' : 'classic';
    this.report = this._outputReport(dev);
    this.lastForce = null;
    this.lastLeds = -1;
    try {
      if (this.kind === 'hidpp') await this._hidppInit();
      else await this._classicInit();
      this.ready = true;
      this.status = 'Active: ' + dev.productName;
    } catch (e) {
      this.ready = false;
      this.status = 'Wheel refused force feedback (' + e.message + ')';
    }
    this._emit();
    return this.ready;
  }

  // ---------- classic protocol (G29 etc.) ----------
  async _classic(bytes) {
    const d = new Uint8Array(this.report.len);
    d.set(bytes.slice(0, this.report.len));
    await this.device.sendReport(this.report.id, d);
  }

  async _classicInit() {
    await this._classic([0xf5, 0, 0, 0, 0, 0, 0]); // autocentre off: the game makes its own centring
    await this._classic([0x13, 0, 0, 0, 0, 0, 0]); // stop slot 1
  }

  // ---------- HID++ (G920 etc.) ----------
  _hidppListen() {
    if (this._listening) return;
    this._listening = true;
    this.device.addEventListener('inputreport', (e) => {
      if (e.reportId !== 0x11 && e.reportId !== 0x10) return;
      const b = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      // Reply:  [device, feature, func|swid, params...]
      // Error:  [device, 0xff (2.0) or 0x8f (1.0), feature, func|swid, code]
      const isErr = b[1] === 0xff || b[1] === 0x8f;
      const key = isErr ? b[2] + ':' + b[3] : b[1] + ':' + b[2];
      const p = this.pending.get(key);
      if (!p) return;
      this.pending.delete(key);
      if (isErr) p.reject(new Error('HID++ error ' + b[4]));
      else p.resolve(b.slice(3));
    });
  }

  _hidppSend(feature, func, params = [], wait = true) {
    const data = new Uint8Array(19);
    data[0] = 0xff;
    data[1] = feature;
    data[2] = ((func & 0x0f) << 4) | SW_ID;
    data.set(params.slice(0, 16), 3);
    const send = this.device.sendReport(0x11, data);
    if (!wait) return send;
    return new Promise((resolve, reject) => {
      const key = feature + ':' + data[2];
      this.pending.set(key, { resolve, reject });
      setTimeout(() => {
        if (this.pending.get(key)) { this.pending.delete(key); reject(new Error('timeout')); }
      }, 600);
      send.catch(reject);
    });
  }

  async _hidppInit() {
    this._hidppListen();
    const r = await this._hidppSend(0x00, 0, [FEATURE_FFB >> 8, FEATURE_FFB & 0xff]);
    this.ffbIndex = r[0];
    if (!this.ffbIndex) throw new Error('no FFB feature');
    await this._hidppSend(this.ffbIndex, 1); // reset all effects
    this.hidppSlot = 0;
    await this._hidppConstant(0, true);
  }

  async _hidppConstant(level, wait = false) {
    // DOWNLOAD_EFFECT: slot, type (constant | autostart), duration 0 (infinite), delay 0, level (int16)
    const v = Math.max(-32767, Math.min(32767, Math.round(level))) & 0xffff;
    const params = [this.hidppSlot, 0x00 | 0x80, 0, 0, 0, 0, v >> 8, v & 0xff, 0, 0, 0, 0, 0, 0];
    if (!this.hidppSlot || wait) {
      const r = await this._hidppSend(this.ffbIndex, 2, params, true);
      if (r && r[0]) this.hidppSlot = r[0];
    } else {
      await this._hidppSend(this.ffbIndex, 2, params, false);
    }
  }

  // ---------- public API ----------

  // force: -1..1, positive pushes the rim to the RIGHT (before inversion).
  setForce(force, invert = false) {
    if (!this.ready || this.busy) return;
    const cmd = this._forceCmd(force, invert);
    if (cmd) this._run(cmd);
  }

  _forceCmd(force, invert) {
    const f = Math.max(-1, Math.min(1, force)) * (invert ? -1 : 1);
    if (this.kind === 'classic') {
      // 0x80 = no force; values above 0x80 pull left, below pull right.
      const byte = Math.max(0, Math.min(255, Math.round(0x80 - f * 127)));
      if (byte === this.lastForce) return null;
      this.lastForce = byte;
      return () => this._classic(byte === 0x80 ? [0x13, 0, 0, 0, 0, 0, 0] : [0x11, 0x08, byte, 0x80, 0, 0, 0]);
    }
    const level = Math.round(-f * 32767);
    if (this.lastForce !== null && Math.abs(level - this.lastForce) < 160) return null;
    this.lastForce = level;
    return () => this._hidppConstant(level);
  }

  // leds: bitmask of the 5 rev LEDs (G29 only).
  setLeds(mask) {
    if (!this.ready || this.kind !== 'classic' || mask === this.lastLeds || this.busy) return;
    this.lastLeds = mask;
    this._run(() => this._classic([0xf8, 0x12, mask & 0x1f, 0, 0, 0, 0]));
  }

  // Hardware rotation range in degrees (stops the rim at the car's lock).
  setRange(deg) {
    if (!this.ready || this.range === deg) return;
    this.range = deg;
    const r = Math.max(40, Math.min(900, Math.round(deg)));
    if (this.kind === 'classic') {
      this._run(() => this._classic([0xf8, 0x81, r & 0xff, (r >> 8) & 0xff, 0, 0, 0]));
    } else {
      this._run(() => this._hidppSend(this.ffbIndex, 6, [r >> 8, r & 0xff], false));
    }
  }

  async _run(fn) {
    this.busy = true;
    try {
      await fn();
    } catch (e) {
      // A failed write usually means the device went away.
      if (String(e).includes('NotAllowed') || String(e).includes('closed')) this._lost('Wheel connection lost');
    } finally {
      this.busy = false;
    }
  }

  stop() {
    if (!this.device || !this.ready) return;
    this.lastForce = null;
    this.lastLeds = -1;
    if (this.kind === 'classic') {
      this._classic([0x13, 0, 0, 0, 0, 0, 0]).catch(() => {});
      this._classic([0xf8, 0x12, 0, 0, 0, 0, 0]).catch(() => {});
    } else {
      this._hidppConstant(0).catch(() => {});
    }
  }

  // Short right-then-left pulse so players can check the direction.
  async test(invert) {
    if (!this.ready) return;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    while (this.busy) await wait(10);
    this.busy = true;
    try {
      for (const f of [0.6, -0.6, 0]) {
        this.lastForce = null;
        const cmd = this._forceCmd(f, invert);
        if (cmd) await cmd();
        if (f) await wait(450);
      }
    } catch (e) { /* ignore */ }
    this.busy = false;
  }
}
