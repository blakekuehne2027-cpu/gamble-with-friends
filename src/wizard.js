// Wheel setup wizard: detects steering, pedals, H-shifter gears and buttons by
// watching what changes while the player follows each prompt. Works no matter
// how the browser numbers the wheel's axes/buttons.

const STEPS = [
  { id: 'steerLeft', title: 'Steering', text: 'Turn the wheel all the way to the <b>LEFT</b> and hold it there.', kind: 'steerLeft' },
  { id: 'steerRight', title: 'Steering', text: 'Now turn it all the way to the <b>RIGHT</b> and hold it.', kind: 'steerRight' },
  { id: 'steerCenter', title: 'Steering', text: 'Bring the wheel back to the <b>CENTER</b> and let go.', kind: 'steerCenter' },
  { id: 'throttle', title: 'Gas pedal', text: 'Press the <b>GAS</b> pedal all the way down, hold it a moment, then let it go.', kind: 'pedal' },
  { id: 'brake', title: 'Brake pedal', text: 'Press the <b>BRAKE</b> pedal all the way down, hold it a moment, then let it go.', kind: 'pedal' },
  { id: 'clutch', title: 'Clutch pedal', text: 'Press the <b>CLUTCH</b> pedal all the way down, hold it a moment, then let it go.', kind: 'pedal', optional: 'No clutch pedal' },
  { id: 'g1', title: 'H-Shifter', text: 'Put the shifter into <b>1st</b> gear.', kind: 'gear', gear: '1', group: 'shifter', optional: "I don't have a shifter" },
  { id: 'g2', title: 'H-Shifter', text: 'Now <b>2nd</b> gear.', kind: 'gear', gear: '2', group: 'shifter', optional: 'Skip shifter' },
  { id: 'g3', title: 'H-Shifter', text: '<b>3rd</b> gear.', kind: 'gear', gear: '3', group: 'shifter', optional: 'Skip shifter' },
  { id: 'g4', title: 'H-Shifter', text: '<b>4th</b> gear.', kind: 'gear', gear: '4', group: 'shifter', optional: 'Skip shifter' },
  { id: 'g5', title: 'H-Shifter', text: '<b>5th</b> gear.', kind: 'gear', gear: '5', group: 'shifter', optional: 'Skip shifter' },
  { id: 'g6', title: 'H-Shifter', text: '<b>6th</b> gear.', kind: 'gear', gear: '6', group: 'shifter', optional: 'Skip shifter' },
  { id: 'gR', title: 'H-Shifter', text: '<b>REVERSE</b>: push the knob down and move it to the reverse slot (next to 6th).', kind: 'gear', gear: 'R', group: 'shifter', optional: 'Skip reverse' },
  { id: 'shiftUp', title: 'Paddle shifters', text: 'Pull the <b>RIGHT</b> paddle (shift up).', kind: 'button', action: 'shiftUp', optional: 'Skip' },
  { id: 'shiftDown', title: 'Paddle shifters', text: 'Pull the <b>LEFT</b> paddle (shift down).', kind: 'button', action: 'shiftDown', optional: 'Skip' },
  { id: 'camera', title: 'Buttons', text: 'Press the wheel button you want for <b>CHANGE CAMERA</b>.', kind: 'button', action: 'camera', optional: 'Skip' },
  { id: 'pause', title: 'Buttons', text: 'Press the button you want for <b>PAUSE / MENU</b>.', kind: 'button', action: 'pause', optional: 'Skip' },
  { id: 'reset', title: 'Buttons', text: 'Press the button you want for <b>RESET CAR</b> (puts you back on track).', kind: 'button', action: 'reset', optional: 'Skip' },
  { id: 'lookBack', title: 'Buttons', text: 'Press the button you want for <b>LOOK BEHIND</b> (hold).', kind: 'button', action: 'lookBack', optional: 'Skip' },
  { id: 'handbrake', title: 'Buttons', text: 'Press the button you want for <b>HANDBRAKE</b>.', kind: 'button', action: 'handbrake', optional: 'Skip' },
  { id: 'nitro', title: 'Buttons', text: 'Press the button you want for <b>NITRO</b> (hold it for a boost).', kind: 'button', action: 'nitro', optional: 'Skip' },
  { id: 'rewind', title: 'Buttons', text: 'Press the button you want for <b>REWIND</b> (hold to rewind time).', kind: 'button', action: 'rewind', optional: 'Skip' },
  { id: 'done', title: 'All set!', text: 'Check everything below responds correctly, then press <b>Finish</b>.', kind: 'done' },
];

const validAxis = (v) => v !== undefined && Math.abs(v) <= 1.01;

export class Wizard {
  constructor(input, root, { onDone, onCancel }) {
    this.input = input;
    this.root = root;
    this.onDone = onDone;
    this.onCancel = onCancel;
  }

  open() {
    this.mapping = { steer: null, throttle: null, brake: null, clutch: null, gears: {}, buttons: {} };
    this.stepIndex = 0;
    this.root.classList.add('show');
    this.root.innerHTML = `
      <div class="wiz">
        <div class="wiz-head"><span class="wiz-kicker" id="wz-kicker"></span><h2 id="wz-title"></h2></div>
        <div class="wiz-progress" id="wz-progress"></div>
        <p class="wiz-text" id="wz-text"></p>
        <div class="wiz-live" id="wz-live"></div>
        <div class="wiz-status" id="wz-status"></div>
        <div class="wiz-actions">
          <button class="btn ghost" id="wz-cancel">Cancel</button>
          <button class="btn ghost" id="wz-back">Back</button>
          <button class="btn ghost" id="wz-skip">Skip</button>
          <button class="btn primary" id="wz-finish">Finish</button>
        </div>
        <details class="wiz-raw"><summary>Raw input monitor (for troubleshooting)</summary><pre id="wz-raw"></pre></details>
      </div>`;
    const $ = (id) => this.root.querySelector('#' + id);
    this.el = { kicker: $('wz-kicker'), title: $('wz-title'), text: $('wz-text'), live: $('wz-live'), status: $('wz-status'), progress: $('wz-progress'), raw: $('wz-raw'), skip: $('wz-skip'), finish: $('wz-finish'), back: $('wz-back') };
    $('wz-cancel').onclick = () => this.close(true);
    this.el.skip.onclick = () => this.skip();
    this.el.back.onclick = () => this.back();
    this.el.finish.onclick = () => this.finish();
    this.el.progress.innerHTML = STEPS.map(() => '<i></i>').join('');
    this.active = true;
    this._enter();
  }

  close(cancelled) {
    this.active = false;
    this.root.classList.remove('show');
    this.root.innerHTML = '';
    if (cancelled) this.onCancel?.();
  }

  get step() { return STEPS[this.stepIndex]; }

  _enter() {
    const st = this.step;
    this.base = this.input.snapshot();
    this.track = new Map();
    this.stable = 0;
    this.lastVal = null;
    this.got = null;
    this.gotAt = 0;
    this.phaseVal = null;
    this.pedal = null;
    this.lastKey = null;
    this.el.kicker.textContent = `Step ${this.stepIndex + 1} of ${STEPS.length} · ${st.title}`;
    this.el.title.textContent = st.title;
    this.el.text.innerHTML = st.text;
    this.el.status.textContent = st.kind === 'done' ? '' : 'Waiting for input…';
    this.el.status.className = 'wiz-status';
    this.el.skip.style.display = st.optional ? '' : 'none';
    this.el.skip.textContent = st.optional || 'Skip';
    this.el.back.style.display = this.stepIndex > 0 ? '' : 'none';
    this.el.finish.style.display = st.kind === 'done' ? '' : 'none';
    Array.from(this.el.progress.children).forEach((c, i) => {
      c.className = i < this.stepIndex ? 'done' : i === this.stepIndex ? 'cur' : '';
    });
    if (st.kind === 'done') {
      this.input.setMapping(this._finalMapping());
    }
    this._renderLive(true);
  }

  next() {
    this.stepIndex = Math.min(STEPS.length - 1, this.stepIndex + 1);
    this._enter();
  }

  back() {
    let i = this.stepIndex - 1;
    // Don't land on the auto-detected steering sub-steps out of order.
    if (i >= 0 && i <= 2) i = 0;
    this.stepIndex = Math.max(0, i);
    if (this.stepIndex === 0) this.mapping.steer = null;
    this._enter();
  }

  skip() {
    const st = this.step;
    if (st.group === 'shifter' && st.gear !== 'R') {
      if (st.gear === '1') this.mapping.gears = {};
      while (this.step.group === 'shifter') this.stepIndex++;
      this._enter();
      return;
    }
    this.next();
  }

  finish() {
    const m = this._finalMapping();
    this.input.setMapping(m);
    this.close(false);
    this.onDone?.(m);
  }

  _finalMapping() {
    const m = this.mapping;
    return { ...m, created: Date.now(), padName: m.steer?.pad || '' };
  }

  _bound() {
    const used = new Set();
    for (const b of Object.values(this.mapping.gears)) used.add(b.pad + '#' + b.button);
    for (const b of Object.values(this.mapping.buttons)) used.add(b.pad + '#' + b.button);
    return used;
  }

  _usedAxes() {
    const used = new Set();
    for (const k of ['steer', 'throttle', 'brake', 'clutch']) {
      const b = this.mapping[k];
      if (b) used.add(b.pad + (b.axis !== undefined ? '|a' + b.axis : '|b' + b.button));
    }
    return used;
  }

  // Called every frame.
  update(dt) {
    if (!this.active) return;
    const st = this.step;
    const snap = this.input.snapshot();
    this._raw(snap);
    if (this.got && performance.now() - this.gotAt > 450) {
      this.got = null;
      this.next();
      return;
    }
    if (this.got) { this._renderLive(); return; }
    if (st.kind === 'steerLeft') this._detectSteerLeft(snap, dt);
    else if (st.kind === 'steerRight' || st.kind === 'steerCenter') this._detectSteerPhase(snap, dt, st.kind);
    else if (st.kind === 'pedal') this._detectPedal(snap, dt, st.id);
    else if (st.kind === 'gear' || st.kind === 'button') this._detectButton(snap, st);
    this._renderLive();
  }

  _accept(msg) {
    this.got = true;
    this.gotAt = performance.now();
    this.el.status.textContent = '✓ ' + msg;
    this.el.status.className = 'wiz-status ok';
  }

  _detectSteerLeft(snap, dt) {
    let best = null;
    for (const p of snap) {
      const bp = this.base.find((b) => b.id === p.id && b.index === p.index);
      if (!bp) continue;
      p.axes.forEach((v, i) => {
        const b0 = bp.axes[i];
        if (!validAxis(v) || !validAxis(b0)) return;
        const d = Math.abs(v - b0);
        if (d > 0.6 && (!best || d > best.d)) best = { pad: p.id, axis: i, v, d };
      });
    }
    if (!best) { this.stable = 0; return; }
    this.el.status.textContent = `Detected axis ${best.axis} on ${short(best.pad)} — hold still…`;
    if (this.lastVal && this.lastVal.axis === best.axis && Math.abs(this.lastVal.v - best.v) < 0.01) this.stable += dt;
    else this.stable = 0;
    this.lastVal = best;
    if (this.stable > 0.5) {
      this.mapping.steer = { pad: best.pad, axis: best.axis, left: best.v, right: null, center: null };
      this._accept(`Steering = axis ${best.axis}`);
    }
  }

  _detectSteerPhase(snap, dt, kind) {
    const s = this.mapping.steer;
    const v = this._axisVal(snap, s.pad, s.axis);
    if (v === null) return;
    if (this.lastVal !== null && Math.abs(v - this.lastVal) < 0.008) this.stable += dt;
    else this.stable = 0;
    this.lastVal = v;
    if (kind === 'steerRight') {
      if (Math.abs(v - s.left) > 1.0 && this.stable > 0.5) {
        s.right = v;
        this._accept('Right limit saved');
      }
    } else {
      const mid = (s.left + s.right) / 2;
      if (Math.abs(v - mid) < Math.abs(s.right - s.left) * 0.2 && this.stable > 0.6) {
        s.center = v;
        this._accept('Center saved');
      }
    }
  }

  _axisVal(snap, pad, axis) {
    const p = snap.find((q) => q.id === pad);
    if (!p) return null;
    const v = p.axes[axis];
    return validAxis(v) ? v : null;
  }

  // Two phases: (1) find the input that moved furthest from where it started
  // and wait until it's held there (= fully pressed), (2) wait for it to come
  // back and settle (= released / rest position).
  _detectPedal(snap, dt, id) {
    const used = this._usedAxes();
    const inputs = [];
    for (const p of snap) {
      const bp = this.base.find((b) => b.id === p.id && b.index === p.index);
      p.axes.forEach((v, i) => inputs.push({ key: p.id + '|a' + i, pad: p.id, axis: i, v, b0: bp?.axes[i] }));
      p.buttons.forEach((b, i) => inputs.push({ key: p.id + '|b' + i, pad: p.id, button: i, v: b.value, b0: bp?.buttons[i]?.value }));
    }
    const valid = (it) => !used.has(it.key) && validAxis(it.v) && validAxis(it.b0);
    if (!this.pedal) {
      // Phase 1: pressed and held.
      let best = null;
      for (const it of inputs) {
        if (!valid(it)) continue;
        const d = Math.abs(it.v - it.b0);
        if (d > 0.5 && (!best || d > best.d)) best = { ...it, d };
      }
      this.track.clear();
      if (best) this.track.set(best.key, { min: Math.min(best.b0, best.v), max: Math.max(best.b0, best.v) });
      if (!best) { this.stable = 0; this.el.status.textContent = 'Waiting for the pedal…'; return; }
      if (this.lastKey === best.key && Math.abs(best.v - this.lastVal) < 0.006) this.stable += dt;
      else this.stable = 0;
      this.lastKey = best.key;
      this.lastVal = best.v;
      this.el.status.textContent = `Pedal detected (${best.axis !== undefined ? 'axis ' + best.axis : 'button ' + best.button}). Hold it down…`;
      if (this.stable > 0.25) {
        this.pedal = { ...best, full: best.v };
        this.stable = 0;
        this.lastVal = null;
      }
      return;
    }
    // Phase 2: released.
    const pd = this.pedal;
    const it = inputs.find((x) => x.key === pd.key);
    if (!it || !validAxis(it.v)) return;
    const v = it.v;
    const travel = Math.abs(pd.full - pd.b0);
    this.track.set(pd.key, { min: Math.min(pd.full, v), max: Math.max(pd.full, v) });
    if (this.lastVal !== null && Math.abs(v - this.lastVal) < 0.006) this.stable += dt;
    else this.stable = 0;
    this.lastVal = v;
    const released = Math.abs(v - pd.full) > Math.max(0.5, travel * 0.6);
    this.el.status.textContent = released ? 'Released…' : 'Got it, now let the pedal go';
    if (released && this.stable > 0.35) {
      const b = { pad: pd.pad, rest: v, full: pd.full };
      if (pd.axis !== undefined) b.axis = pd.axis; else b.button = pd.button;
      this.mapping[id] = b;
      this._accept(`${id[0].toUpperCase() + id.slice(1)} = ${pd.axis !== undefined ? 'axis ' + pd.axis : 'button ' + pd.button}`);
    }
  }

  _detectButton(snap, st) {
    const used = this._bound();
    for (const p of snap) {
      const bp = this.base.find((b) => b.id === p.id && b.index === p.index);
      for (let i = 0; i < p.buttons.length; i++) {
        const b = p.buttons[i];
        const down = b.pressed || b.value > 0.5;
        const wasDown = bp && (bp.buttons[i]?.pressed || bp.buttons[i]?.value > 0.5);
        if (!down || wasDown || used.has(p.id + '#' + i)) continue;
        // Analog pedals that also report as buttons on some pads: ignore if bound as a pedal.
        if (this._usedAxes().has(p.id + '|b' + i)) continue;
        const bind = { pad: p.id, button: i };
        if (st.kind === 'gear') this.mapping.gears[st.gear] = bind;
        else this.mapping.buttons[st.action] = bind;
        this._accept(`${st.kind === 'gear' ? 'Gear ' + st.gear : st.action} = button ${i}`);
        return;
      }
    }
  }

  _renderLive(force) {
    const st = this.step;
    const m = this.mapping;
    let html = '';
    const bar = (label, v, cls) => `<div class="wl-bar ${cls || ''}"><label>${label}</label><div><i style="transform:scaleX(${Math.max(0, Math.min(1, v)).toFixed(3)})"></i></div></div>`;
    if (st.kind.startsWith('steer') || st.kind === 'done') {
      let deg = 0;
      if (m.steer && m.steer.right !== null && m.steer.center !== null) deg = this.input.steerValue(m.steer) * 450;
      else if (m.steer) {
        const v = this._axisVal(this.input.snapshot(), m.steer.pad, m.steer.axis) ?? 0;
        deg = v * 450;
      }
      html += `<svg class="wl-wheel" viewBox="-50 -50 100 100" style="transform:rotate(${deg.toFixed(1)}deg)"><circle r="40" fill="none" stroke="currentColor" stroke-width="8"/><rect x="-40" y="-4" width="80" height="8" fill="currentColor"/><rect x="-4" y="0" width="8" height="40" fill="currentColor"/><rect x="-3" y="-49" width="6" height="12" fill="#ffd200"/></svg>`;
    }
    if (st.kind === 'pedal' || st.kind === 'done') {
      html += '<div class="wl-pedals">';
      for (const id of ['throttle', 'brake', 'clutch']) {
        if (m[id]) html += bar(id, this.input.pedal(m[id]), id);
      }
      if (st.kind === 'pedal' && !m[st.id]) {
        const tr = this.track.values().next().value;
        html += bar('detecting', tr ? Math.min(1, (tr.max - tr.min) / 2) : 0, 'detect');
      }
      html += '</div>';
    }
    if (st.kind === 'gear' || st.kind === 'done') {
      const cells = ['1', '3', '5', '2', '4', '6', 'R'];
      html += '<div class="wl-gears">' + cells.map((g) => {
        const b = m.gears[g];
        const on = b && this.input.buttonDown(b);
        return `<span class="${b ? 'set' : ''} ${on ? 'on' : ''} ${st.gear === g ? 'cur' : ''}">${g}</span>`;
      }).join('') + '</div>';
    }
    if (st.kind === 'button' || st.kind === 'done') {
      const names = { shiftUp: 'Shift up', shiftDown: 'Shift down', camera: 'Camera', pause: 'Pause', reset: 'Reset', lookBack: 'Look back', handbrake: 'Handbrake', nitro: 'Nitro', rewind: 'Rewind' };
      html += '<div class="wl-buttons">' + Object.keys(names).map((k) => {
        const b = m.buttons[k];
        const on = b && this.input.buttonDown(b);
        return `<span class="${b ? 'set' : ''} ${on ? 'on' : ''} ${st.action === k ? 'cur' : ''}">${names[k]}${b ? ' · ' + b.button : ''}</span>`;
      }).join('') + '</div>';
    }
    if (force || html !== this._lastHtml) {
      this._lastHtml = html;
      this.el.live.innerHTML = html;
    }
  }

  _raw(snap) {
    if (!this.el.raw.parentElement.open) return;
    this.el.raw.textContent = snap.length ? snap.map((p) =>
      `[${p.index}] ${p.id}  (mapping: ${p.mapping || 'none'})\n` +
      '  axes:    ' + p.axes.map((v, i) => `${i}:${v.toFixed(2)}`).join('  ') + '\n' +
      '  buttons: ' + p.buttons.map((b, i) => (b.pressed || b.value > 0.5 ? `[${i}]` : null)).filter(Boolean).join(' ')
    ).join('\n\n') : 'No controllers detected. Press a button on the wheel so the browser notices it.';
  }
}

function short(id) {
  return id.length > 32 ? id.slice(0, 32) + '…' : id;
}
