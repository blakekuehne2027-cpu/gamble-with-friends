// Achievements: unlocked once (shared across saves), each pays cash into the
// save you're playing when it pops.

import { loadJSON, saveJSON } from './settings.js';
import { DEALER_CARS } from './cars.js';
import { UPGRADES, saveCareer } from './career.js';

const KEY = 'redline.achievements.v1';

export const ACHIEVEMENTS = [
  { id: 'first_race', icon: '🏁', name: 'Lights Out', desc: 'Finish your first race.', reward: 500 },
  { id: 'first_win', icon: '🥇', name: 'Winner Winner', desc: 'Win a race.', reward: 1000 },
  { id: 'pro_win', icon: '🏆', name: 'Pro Driver', desc: 'Win a race on Pro difficulty.', reward: 5000 },
  { id: 'podiums10', icon: '🍾', name: 'Podium Regular', desc: 'Finish on the podium 10 times.', reward: 3000 },
  { id: 'overtake5', icon: '⏩', name: 'Through the Field', desc: 'Gain 5 places in one race.', reward: 1000 },
  { id: 'speed250', icon: '💨', name: 'Two-Fifty', desc: 'Hit 250 km/h (155 mph).', reward: 1000 },
  { id: 'speed400', icon: '🚀', name: 'Warp Speed', desc: 'Hit 400 km/h (249 mph).', reward: 2500 },
  { id: 'drift5k', icon: '🌀', name: 'Sideways', desc: 'Score 5,000 drift points in one session.', reward: 1500 },
  { id: 'rain_win', icon: '🌧', name: 'Rain Master', desc: 'Win a race in the rain.', reward: 2000 },
  { id: 'night_win', icon: '🌙', name: 'Night Rider', desc: 'Win a race at night.', reward: 1000 },
  { id: 'old_school', icon: '🕹', name: 'Old School', desc: 'Win a race with the H-shifter and the clutch pedal (auto clutch off).', reward: 2500 },
  { id: 'drag_win', icon: '🚦', name: 'Quarter-Mile King', desc: 'Win a drag race.', reward: 750 },
  { id: 'perfect_light', icon: '🟢', name: 'Perfect Light', desc: 'Leave the line with a reaction time under 0.050 s.', reward: 1000 },
  { id: 'perfect_shifts', icon: '⚙', name: 'Money Shifter', desc: 'Make 4 perfect shifts in one drag run.', reward: 1000 },
  { id: 'drag_10', icon: '⏱', name: 'Ten-Second Car', desc: 'Run the quarter mile in under 10.000 seconds.', reward: 2000 },
  { id: 'high_roller', icon: '💰', name: 'High Roller', desc: 'Win a drag bet of $10,000 or more.', reward: 2500 },
  { id: 'pink_win', icon: '📄', name: 'Pink Slip Hustler', desc: 'Win a car on a pink slip.', reward: 2000 },
  { id: 'rock_bottom', icon: '🪣', name: 'Rock Bottom', desc: 'Lose your last real car. Here\'s some sympathy money.', reward: 1000 },
  { id: 'jobs10', icon: '🧰', name: 'Working Class Hero', desc: 'Complete 10 jobs.', reward: 2500 },
  { id: 'smooth_op', icon: '🚕', name: 'Smooth Operator', desc: 'Finish a VIP taxi job without a single complaint.', reward: 750 },
  { id: 'ghostbuster', icon: '👻', name: 'Ghostbuster', desc: 'Beat your own ghost in Time Trial.', reward: 750 },
  { id: 'fully_built', icon: '🔧', name: 'Fully Built', desc: 'Max out every upgrade on one car.', reward: 2000 },
  { id: 'collector', icon: '🚗', name: 'Collector', desc: 'Own every dealership car at once.', reward: 10000 },
  { id: 'do_over', icon: '⏪', name: 'Do-Over', desc: 'Use rewind to fix a mistake.', reward: 100 },
  { id: 'underdog', icon: '👑', name: 'Underdog', desc: 'Beat Viktor "King" Kane and finish the story.', reward: 25000 },
];
const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

let unlocked = loadJSON(KEY, {}) || {};
let notifier = null;

export function onUnlock(fn) {
  notifier = fn;
}

export function isUnlocked(id) {
  return !!unlocked[id];
}

export function unlockedCount() {
  return ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
}

// Unlock (once) and pay the reward into the current save.
export function unlock(id, career) {
  const a = BY_ID[id];
  if (!a || unlocked[id]) return false;
  unlocked[id] = Date.now();
  saveJSON(KEY, unlocked);
  if (a.reward && career) {
    career.money += a.reward;
    saveCareer(career);
  }
  notifier?.(a);
  return true;
}

export function resetAchievements() {
  unlocked = {};
  saveJSON(KEY, unlocked);
}

// Garage-based achievements (call after purchases / pink slips).
export function checkGarage(career) {
  if (DEALER_CARS.every((c) => career.owned[c.id])) unlock('collector', career);
  for (const id of Object.keys(career.owned)) {
    const up = career.owned[id].up || {};
    if (UPGRADES.every((u) => (up[u.id] || 0) >= 3)) unlock('fully_built', career);
  }
}

// After a circuit race result.
export function checkRace(career, r, ctx) {
  unlock('first_race', career);
  if (r.position <= 3 && career.stats.podiums >= 10) unlock('podiums10', career);
  if (ctx.overtakes >= 5) unlock('overtake5', career);
  if (r.position !== 1) return;
  unlock('first_win', career);
  if (ctx.difficulty === 3 && ctx.opponents > 0) unlock('pro_win', career);
  if (ctx.rain) unlock('rain_win', career);
  if (ctx.night) unlock('night_win', career);
  if (ctx.manual) unlock('old_school', career);
}

// After a drag run.
export function checkDrag(career, r) {
  if (r.you.rt !== null && r.you.rt !== undefined && r.you.rt < 0.05 && !r.you.foul) unlock('perfect_light', career);
  if (r.shifts.filter((s) => s === 'PERFECT SHIFT').length >= 4) unlock('perfect_shifts', career);
  if (r.you.et && r.you.et < 10 && !r.you.foul) unlock('drag_10', career);
  if (r.win) {
    unlock('drag_win', career);
    if (!r.pink && r.bet >= 10000) unlock('high_roller', career);
    if (r.pink) unlock('pink_win', career);
  }
}

export function checkPink(career, won, lostEverything) {
  if (won) unlock('pink_win', career);
  if (lostEverything) unlock('rock_bottom', career);
}
