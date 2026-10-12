// sim-smoke.mjs — bots play a match on every shape, headless, under node.
//
//   node tools/sim-smoke.mjs
//
// Imports js/sim.js as it ships (it has no DOM), plays each N from 2 to 8 to
// a target of 5 with every side a bot, and fails if a match does not finish
// within ten simulated minutes, if a ball leaves the arena, or if a number
// goes non-finite. It proves the rules run end to end, not that they are fun.

import { Match, TICK } from '../js/sim.js';

let failed = false;
for (let n = 2; n <= 8; n++) {
  const m = new Match(n, 5);
  let ticks = 0, goals = 0, broken = false;
  const limit = 10 * 60 / TICK;
  while (m.winner < 0 && ticks < limit) {
    m.step(TICK, []);
    for (const e of m.events) if (e.type === 'goal') goals++;
    m.events.length = 0;
    ticks++;
    for (const b of m.balls) {
      if (!Number.isFinite(b.x + b.y + b.vx + b.vy) || Math.hypot(b.x, b.y) > m.radius + 0.5) {
        console.error(`N=${n}: ball escaped or went non-finite at tick ${ticks}`);
        broken = true;
        break;
      }
    }
    if (broken) break;
  }
  const scores = m.players.map((s) => s.score).join(' ');
  const ok = m.winner >= 0 && !broken;
  if (!ok) failed = true;
  console.log(`N=${n}  ${ok ? 'won by ' + m.winner : 'NO WINNER'}  in ${(ticks * TICK).toFixed(0)} s  goals ${goals}  scores ${scores}`);
}
process.exit(failed ? 1 : 0);
