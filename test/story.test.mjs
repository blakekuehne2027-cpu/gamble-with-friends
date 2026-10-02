// Story content sanity: every event builds a valid game config, requirements
// and completion logic behave, and the whole story can be completed.
import { CHAPTERS, CHARACTERS, eventConfig, eventPassed, completeEvent, currentEvent, meetsRequirement, storyState } from '../src/story.js';
import { newStoryCareer } from '../src/career.js';
import { findCar } from '../src/cars.js';
import { TRACKS } from '../src/track.js';

let failed = 0;
const check = (c, m) => { if (!c) { failed++; console.error('  FAIL', m); } };

const career = newStoryCareer();
const settings = { carId: 'junker' };
check(career.money === 500 && career.owned.junker && Object.keys(career.owned).length === 1, 'story starts broke with a Rust Bucket');

let n = 0;
for (const ch of CHAPTERS) {
  for (const line of ch.intro) check(CHARACTERS[line[0]], `unknown speaker ${line[0]}`);
  for (const ev of ch.events) {
    n++;
    for (const line of [...(ev.before || []), ...(ev.after || [])]) check(CHARACTERS[line[0]], `${ev.id}: unknown speaker ${line[0]}`);
    if (ev.type === 'own') continue;
    // Give the player a qualifying car to build the config with.
    const tierCar = { 0: 'junker', 1: 'rookie', 2: 'vortex', 3: 'titan' }[ev.minTier || 0];
    career.owned[tierCar] = career.owned[tierCar] || { up: {}, color: 0 };
    settings.carId = tierCar;
    check(meetsRequirement(ev, career, settings), `${ev.id}: requirement`);
    const cfg = eventConfig(ev, career, settings);
    check(cfg && ['race', 'drag', 'job'].includes(cfg.mode), `${ev.id}: config mode`);
    check(TRACKS[cfg.track], `${ev.id}: track`);
    check(cfg.story === ev.id, `${ev.id}: story id`);
    if (cfg.mode === 'race') {
      check(cfg.opponents >= (cfg.rivals?.length || 0), `${ev.id}: rivals fit in the field`);
      for (const r of cfg.rivals) check(findCar(r.carId).id === r.carId, `${ev.id}: rival car`);
      if (cfg.pink) check(cfg.rivals.length >= 1, `${ev.id}: pink race needs a rival`);
    }
    if (cfg.mode === 'drag') check(cfg.opp && cfg.opp.odds > 1 && TRACKS[cfg.track].drag, `${ev.id}: drag opponent`);
    if (cfg.mode === 'job') {
      check(cfg.job && cfg.job.pay > 0 && cfg.job.name, `${ev.id}: job`);
      if (cfg.job.type === 'test') check(cfg.job.target > 30 && cfg.carId === cfg.job.carId, `${ev.id}: test target / loaner`);
    }
    console.log(`  ${ev.id.padEnd(9)} ${cfg.mode.padEnd(5)} ${TRACKS[cfg.track].name}${cfg.pink ? ' (pink slips)' : ''}`);
  }
}
console.log(`${n} story events`);

// Requirement gate: a class-3 event with only a Rust Bucket can't start.
const poor = newStoryCareer();
const ps = { carId: 'junker' };
check(!meetsRequirement(CHAPTERS[3].events[1], poor, ps), 'class-3 gate blocks a Rust Bucket');

// Play through: pass every event.
const c = newStoryCareer();
const s = { carId: 'junker' };
let guard = 0;
while (currentEvent(c) && guard++ < 50) {
  const ev = currentEvent(c);
  if (ev.type === 'own') {
    const id = { 1: 'rookie', 3: 'titan' }[ev.minTier];
    c.owned[id] = { up: {}, color: 0 };
  }
  const res = ev.type === 'race' ? { position: 1 } : ev.type === 'drag' ? { win: true } : ev.type === 'job' ? { success: true } : null;
  check(eventPassed(ev, res, c), `${ev.id}: passes`);
  check(!eventPassed(ev, ev.type === 'race' ? { position: 9 } : {}, ev.type === 'own' ? { owned: { junker: {} } } : c) || ev.type === 'own', `${ev.id}: failure detected`);
  completeEvent(c, ev);
}
check(storyState(c).finished, 'story can be finished');
console.log('story finished with', c.money, 'in rewards');

if (failed) { console.error(`${failed} story check(s) failed`); process.exit(1); }
console.log('story tests passed');
