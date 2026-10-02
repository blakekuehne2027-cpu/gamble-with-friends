// Persistent settings (localStorage, wrapped so private windows still work).

const KEY = 'redline.settings.v1';

export const DEFAULTS = {
  transmission: 'h', // 'h' (H-pattern shifter), 'seq' (paddles), 'auto'
  autoClutch: true,
  abs: true,
  tc: true,
  stability: false,
  wheelRange: 900, // what the wheel is set to in G HUB / driver
  steerRatio: 12, // degrees of wheel rotation per degree of road-wheel angle
  ffb: true,
  ffbStrength: 0.7,
  ffbInvert: false,
  revLeds: true,
  units: 'mph',
  volume: 0.8,
  fov: 56,
  camera: 'cockpit',
  laps: 3,
  opponents: 5,
  difficulty: 1, // 0 easy, 1 medium, 2 hard, 3 pro
  track: 0,
  carId: 'rookie',
  showTelemetry: true,
  graphics: 'high',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) };
      delete s.car; // pre-career saves stored a car index
      delete s.color;
      return s;
    }
  } catch (e) { /* ignore */ }
  return { ...DEFAULTS };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

export function loadJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

export function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}
