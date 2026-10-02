// Story mode: "UNDERDOG". A broke kid with a Rust Bucket works jobs, wins
// bets and pink slips, and takes on the man who owns the city's racing scene.

import { findCar } from './cars.js';
import { TRACKS, getTrack } from './track.js';
import { buildSpec, owns, saveCareer } from './career.js';
import { simulateRun, oddsFor, dragTrackIndex } from './drag.js';
import { JOB_TYPES, idealLap } from './jobs.js';

export const CHARACTERS = {
  you: { name: 'You', color: '#22c55e', initials: 'ME' },
  pops: { name: 'Pops', color: '#f59e0b', initials: 'P', role: 'Runs the garage. Taught you everything.' },
  tank: { name: 'Tank Delgado', color: '#ef4444', initials: 'TD', role: 'Loud. Fast. Louder.', car: 0xd61f26 },
  lola: { name: 'Lola Vega', color: '#3b82f6', initials: 'LV', role: 'Circuit queen. Never smiles.', car: 0x1fa2ff },
  dutch: { name: 'Dutch', color: '#14b8a6', initials: 'D', role: 'Kane\'s driver. Doesn\'t talk.', car: 0x14b8a6 },
  kane: { name: 'Viktor "King" Kane', color: '#a855f7', initials: 'VK', role: 'Owns the city\'s racing scene. And half its cars.', car: 0x1b1b1f },
};

const COAST = 0, PINE = 1, CITY = 2;

export const CHAPTERS = [
  {
    title: 'Rock Bottom',
    intro: [
      ['pops', 'Morning, kid. That Rust Bucket parked out front... is that YOURS?'],
      ['you', 'Bought it with my last $500. It runs!'],
      ['pops', 'Barely. Listen, you want to race? Racing costs money. Money comes from work.'],
      ['pops', 'I\'ve got jobs for you. Do \'em right and I\'ll get you into a real race.'],
    ],
    events: [
      {
        id: 'c1_parts', type: 'job', title: 'Pops\' Parts Run', reward: 0,
        desc: 'Deliver brake pads 1.2 km down the coast road. Don\'t bend the box.',
        job: { type: 'courier', track: COAST, dist: 1200, limit: 120, pay: 900 },
        before: [['pops', 'Brake pads for the shop. Coastline road. Every bump you hit, I hear about it.']],
        after: [['pops', 'Not bad! Here\'s your cut. Don\'t spend it all on air fresheners.']],
      },
      {
        id: 'c1_taxi', type: 'job', title: 'Night Shift', reward: 0,
        desc: 'Drive a nervous VIP across the city at night. Smooth is fast.',
        job: { type: 'taxi', track: CITY, dist: 1000, limit: 120, gLimit: 0.62, pay: 1100, time: 'night' },
        before: [['pops', 'My buddy runs a car service. His VIP hates speed. Go easy, kid.']],
        after: [['pops', 'He tipped you? Nobody gets a tip from that guy. You might have a future.']],
      },
      {
        id: 'c1_race', type: 'race', title: 'First Street Race', reward: 2000, needPos: 3,
        desc: 'Midnight Circuit, 2 laps. Finish on the podium. Tank Delgado is there.',
        race: { track: CITY, laps: 2, opponents: 4, difficulty: 0, time: 'night', rivals: [{ char: 'tank', carId: 'rookie', up: { engine: 1 }, pace: 0.83 }] },
        before: [['tank', 'Ha! Who brought the lawnmower?'], ['you', 'Line up and find out.'], ['tank', 'Cute. Try not to rust on the grid.']],
        after: [['tank', 'Lucky. Real lucky.'], ['tank', 'Thunder Valley, Friday night. Bring cash, kid.']],
      },
    ],
  },
  {
    title: 'The Strip',
    intro: [
      ['pops', 'Thunder Valley Dragway. Friday nights, real money. And Tank called you out.'],
      ['pops', 'Tip: hold the brake AND the gas on the line. Go on GREEN, not a hair before.'],
    ],
    events: [
      {
        id: 'c2_tank', type: 'drag', title: 'Called Out', reward: 1000,
        desc: 'Quarter mile vs Tank for $500. Win it.',
        drag: { char: 'tank', carId: 'rookie', up: { engine: 1 }, rt: 0.3, spread: 0.08, bet: 500 },
        before: [['tank', 'Five hundred bucks says you can\'t even find the start line.']],
        after: [['tank', 'No way. NO WAY.'], ['tank', 'Run it back. For PINK SLIPS this time. Get a real car first.']],
      },
      {
        id: 'c2_buy', type: 'own', title: 'Get a Real Car', minTier: 1, reward: 0,
        desc: 'Buy a Rookie Coupe ($8,000) or better in the Garage. Earn it with jobs and bets.',
        before: [['pops', 'You\'re not racing Tank for pinks in that Rust Bucket. Buy something real.'], ['pops', 'The job board\'s always open. So is the drag strip, if you\'re feeling lucky.']],
        after: [['pops', 'Now THAT\'S a car. Go get Tank\'s.']],
      },
      {
        id: 'c2_pinks', type: 'drag', title: 'Pink Slips', reward: 1500, minTier: 1,
        desc: 'Drag Tank for pink slips. Win his tuned coupe. Lose yours.',
        drag: { char: 'tank', carId: 'rookie', up: { engine: 2, weight: 1, tires: 1 }, rt: 0.26, spread: 0.07, pink: true },
        before: [['tank', 'Pink slips. Winner drives home in both cars. Still in?'], ['you', 'Sign the paper, Tank.']],
        after: [['tank', '...Take care of her. She pulls a little left.'], ['pops', 'Two cars! Now you\'re a racer.']],
      },
    ],
  },
  {
    title: 'Climbing',
    intro: [
      ['lola', 'So you\'re the kid who took Tank\'s car. Drag racing is just driving in a straight line, sweetie.'],
      ['lola', 'Real racers turn. Come find me at Pinewood.'],
    ],
    events: [
      {
        id: 'c3_pine', type: 'race', title: 'Pinewood Proving', reward: 4000, needPos: 3,
        desc: 'Pinewood Ring, 3 laps, a full field. Finish top 3.',
        race: { track: PINE, laps: 3, opponents: 5, difficulty: 1 },
        before: [['lola', 'Top three at Pinewood and I\'ll know you\'re serious.']],
        after: [['lola', 'Hm. Not terrible.']],
      },
      {
        id: 'c3_test', type: 'job', title: 'Favour for a Dealer', reward: 0,
        desc: 'Test-drive a Vortex GT and beat the dealer\'s lap target on Coastline.',
        job: { type: 'test', track: COAST, carId: 'vortex', laps: 3, slack: 1.25, pay: 3000 },
        before: [['pops', 'A dealer owes me a favour. Show \'em what a Vortex can do.']],
        after: [['pops', 'They want to hire you full-time. I told \'em you\'re busy.']],
      },
      {
        id: 'c3_lola', type: 'race', title: 'Queen of the Coast', reward: 8000, needPos: 1, minTier: 2,
        desc: 'One-on-one with Lola at Coastline, 3 laps. You need a class 2+ car (Vortex GT or better).',
        race: { track: COAST, laps: 3, opponents: 1, difficulty: 1, time: 'sunset', rivals: [{ char: 'lola', carId: 'raptor', up: { engine: 1, tires: 1 }, pace: 0.9 }] },
        before: [['lola', 'Just you and me. Coastline. Three laps.'], ['lola', 'Try to keep up.']],
        after: [['lola', '...You\'re good. Kane is going to want to meet you.'], ['lola', 'That\'s not a compliment.']],
      },
    ],
  },
  {
    title: 'Pink Slips',
    intro: [
      ['kane', 'So. The kid with the borrowed luck.'],
      ['kane', 'In my city we don\'t race for trophies. We race for PINK SLIPS.'],
      ['kane', 'Beat my driver, and maybe I\'ll race you myself.'],
    ],
    events: [
      {
        id: 'c4_power', type: 'own', title: 'Serious Horsepower', minTier: 3, reward: 0,
        desc: 'Get a class 3 car: Raptor R ($45,000) or Titan V12 ($70,000).',
        before: [['pops', 'Kane\'s crew runs big power. You\'ll need a Raptor or a Titan. Or better.']],
        after: [['pops', 'Now we\'re talking. Careful with that throttle.']],
      },
      {
        id: 'c4_dutch', type: 'drag', title: 'The Silent Driver', reward: 5000, minTier: 3,
        desc: 'Drag Kane\'s driver Dutch for pink slips. He runs a tuned Titan V12.',
        drag: { char: 'dutch', carId: 'titan', up: { engine: 1, weight: 1, tires: 1 }, rt: 0.2, spread: 0.05, pink: true },
        before: [['dutch', '...'], ['dutch', 'Pinks.']],
        after: [['dutch', '...'], ['kane', 'Interesting. Midnight Circuit. Rain is coming.'], ['kane', 'Bring your best car, kid. You won\'t be driving it home.']],
      },
      {
        id: 'c4_kane', type: 'race', title: 'The King of the City', reward: 50000, needPos: 1, minTier: 3, final: true,
        desc: 'Final race: Kane\'s Phantom LMP, Midnight Circuit, night, rain, 3 laps. Pink slips.',
        race: { track: CITY, laps: 3, opponents: 1, difficulty: 2, time: 'night', rain: true, pink: true, rivals: [{ char: 'kane', carId: 'phantom', up: { engine: 1, weight: 1, tires: 1 }, pace: 0.86 }] },
        before: [['kane', 'Phantom LMP. Carbon everything. You can\'t win.'], ['you', 'Then you\'ve got nothing to worry about.'], ['pops', 'Kid... whatever happens out there, I\'m proud of you.']],
        after: [['kane', '...Impossible.'], ['kane', 'The keys are in it. Get out of my sight.'], ['pops', 'You did it, kid. From a Rust Bucket to the king of the city.'], ['pops', 'Now... how about you help me fix this transmission?']],
      },
    ],
  },
];

export function storyState(career) {
  career.story = career.story || { chapter: 0, done: {}, seen: {}, finished: false };
  return career.story;
}

export function chapter(career) {
  return CHAPTERS[Math.min(storyState(career).chapter, CHAPTERS.length - 1)];
}

// Next event to play in the current chapter (events unlock in order).
export function currentEvent(career) {
  const st = storyState(career);
  if (st.finished) return null;
  return chapter(career).events.find((e) => !st.done[e.id]) || null;
}

export function bestOwnedTier(career) {
  return Math.max(...Object.keys(career.owned).map((id) => findCar(id).tier));
}

// Can the event start with what you own? Picks a qualifying car if needed.
export function meetsRequirement(ev, career, settings) {
  if (!ev.minTier) return true;
  if (findCar(settings.carId).tier >= ev.minTier && owns(career, settings.carId)) return true;
  const ok = Object.keys(career.owned).map(findCar).filter((c) => c.tier >= ev.minTier).sort((a, b) => b.tier - a.tier);
  if (ok.length) {
    settings.carId = ok[0].id;
    return true;
  }
  return false;
}

// Event completed? 'own' events check the garage; the others check results.
export function eventPassed(ev, res, career) {
  if (ev.type === 'own') return bestOwnedTier(career) >= ev.minTier;
  if (!res) return false;
  if (ev.type === 'job') return !!res.success;
  if (ev.type === 'drag') return !!res.win;
  if (ev.type === 'race') return res.position <= (ev.needPos || 1);
  return false;
}

// Mark done, pay the reward and move to the next chapter when this one is complete.
export function completeEvent(career, ev) {
  const st = storyState(career);
  if (st.done[ev.id]) return { reward: 0, chapterDone: false };
  st.done[ev.id] = Date.now();
  if (ev.reward) {
    career.money += ev.reward;
    career.stats.earned += ev.reward;
  }
  const chap = chapter(career);
  const chapterDone = chap.events.every((e) => st.done[e.id]);
  if (chapterDone) {
    if (ev.final || st.chapter >= CHAPTERS.length - 1) st.finished = true;
    else st.chapter++;
  }
  saveCareer(career);
  return { reward: ev.reward || 0, chapterDone, finished: st.finished };
}

function rivalFor(r) {
  const ch = CHARACTERS[r.char];
  return { name: ch.name, color: ch.car ?? 0x888888, carId: r.carId, up: r.up || {}, pace: r.pace, number: 13 };
}

// Turn an event into a game config.
export function eventConfig(ev, career, settings) {
  const carId = settings.carId;
  const common = { carId, color: career.owned[carId]?.color ?? 0, story: ev.id };
  if (ev.type === 'race') {
    const r = ev.race;
    return {
      mode: 'race', track: r.track, laps: r.laps, opponents: r.opponents, difficulty: r.difficulty,
      time: r.time || 'default', rain: !!r.rain, pink: !!r.pink, rivals: (r.rivals || []).map(rivalFor), ...common,
    };
  }
  if (ev.type === 'drag') {
    const d = ev.drag;
    const ch = CHARACTERS[d.char];
    const mine = career.owned[carId]?.up || {};
    const youEt = simulateRun(buildSpec(findCar(carId), mine), `story:${carId}:${JSON.stringify(mine)}`).et;
    const themEt = simulateRun(buildSpec(findCar(d.carId), d.up), `story:${d.carId}:${JSON.stringify(d.up)}`).et;
    const opp = { name: ch.name, color: ch.car, carId: d.carId, up: d.up, rt: d.rt, spread: d.spread, foul: 0.02, et: themEt, odds: oddsFor(youEt, themEt) };
    const bet = d.pink ? 0 : Math.min(d.bet || 0, Math.max(0, Math.floor(career.money)));
    return { mode: 'drag', track: dragTrackIndex(TRACKS), laps: 1, opponents: 0, difficulty: 1, time: 'night', rain: false, opp, bet, pink: !!d.pink, ...common };
  }
  if (ev.type === 'job') {
    const j = { ...JOB_TYPES[ev.job.type], ...ev.job, trackName: TRACKS[ev.job.track].name, time: ev.job.time || 'default', rain: !!ev.job.rain };
    j.title = ev.desc;
    if (j.type === 'test') {
      const ideal = idealLap(getTrack(j.track), buildSpec(findCar(j.carId), {})).lap;
      j.target = Math.round(ideal * (j.slack || 1.25) * 10) / 10;
    }
    const cfg = { mode: 'job', track: j.track, laps: 1, opponents: 0, difficulty: 1, time: j.time, rain: j.rain, job: j, ...common };
    if (j.carId) { cfg.carId = j.carId; cfg.color = 1; }
    return cfg;
  }
  return null;
}
