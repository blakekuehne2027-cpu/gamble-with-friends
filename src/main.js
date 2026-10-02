// Entry point: renderer, systems and the main loop.

import * as THREE from 'three';
import { loadSettings } from './settings.js';
import { Input } from './input.js';
import { AudioSystem } from './audio.js';
import { ForceFeedback } from './ffb.js';
import { HUD } from './hud.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { Showroom } from './showroom.js';
import { CARS, PAINT_COLORS } from './cars.js';

const settings = loadSettings();
const app = document.getElementById('app');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('fatal').style.display = 'flex';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.graphics === 'low' ? 1 : 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.prepend(renderer.domElement);

const input = new Input();
const audio = new AudioSystem();
audio.volume = settings.volume;
const ffb = new ForceFeedback();
const hud = new HUD(document.getElementById('hud'));
const game = new Game({ renderer, input, audio, ffb, hud, settings });
const showroom = new Showroom(renderer);
showroom.setCar(CARS[settings.car], PAINT_COLORS[settings.color] ?? CARS[settings.car].color);
const ui = new UI({ input, audio, ffb, settings, game, showroom });

// Browsers only allow audio after a click or key press.
const unlock = () => audio.init();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

ffb.autoConnect();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  game.resize();
  showroom.resize(w, h);
}
window.addEventListener('resize', resize);
resize();
ui.show('title');

// Debug/automation hook.
window.__redline = { game, input, ui, settings, ffb, audio };

let last = performance.now();
const fpsEl = document.getElementById('fps');
let fpsAcc = 0, fpsN = 0;
const showFps = /[?&]fps/.test(location.search);
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.poll();
  ui.update(dt);
  if (ui.mode === 'menu') {
    showroom.update(dt);
    showroom.render();
  } else {
    game.update(dt);
    game.render();
  }
  if (showFps) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) {
      fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} fps`;
      fpsAcc = 0; fpsN = 0;
    }
  }
}
requestAnimationFrame(frame);
