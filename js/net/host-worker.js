/*
 * host-worker.js — the host's simulation, off the page.
 *
 * NeonFox's shape (its js/net/host-worker.js), cut to this game. A browser
 * throttles setInterval hard in a backgrounded tab — fishtank measured 3
 * snapshots against 62 over the same fifteen seconds — so a host who looks at
 * another tab would freeze the board for everybody. Worker timers are not
 * throttled the same way, and the sim gets off the render thread too.
 *
 * js/sim.js was written for exactly this (its header: "no DOM, no canvas, no
 * clock of its own"), so the worker owns one Match and nothing else. It never
 * sees a data channel or a peer: the page hands it seats and cleaned paddle
 * positions and takes back packed frames and the sim's events.
 *
 * TWO TICKS, ONE FRAME. The sim runs at 120 Hz (sim.js TICK) and a frame
 * goes out every second tick, 60 a second: a guest's screen refreshes at 60
 * and its balls are extrapolated between frames anyway (js/net/shadow.js), so
 * the other 60 would double the traffic and change nothing anyone can see.
 * Events are gathered across both ticks and ride with the frame.
 */

import { Match, TICK } from '../sim.js';
import { packFrame } from './protocol.js';

let match = null;
let ticker = null;
let last = 0;
let acc = 0;
let tickNo = 0;
/* Monotonic for the whole session, never reset by a rematch: the guest's
 * queue drops anything not newer, and NeonFox found that a counter which
 * resets stalls every guest at the reset. */
let frameNo = 0;
let version = 0;
let events = [];
/* Per player: null (a bot), or { target, remote } — the host's own paddle,
 * or a guest's, which gets the sim's remote grace. Written only by the page. */
const inputs = [];

function step() {
  match.step(TICK, inputs);
  for (const e of match.events) events.push(e);
  match.events.length = 0;
  if (++tickNo % 2) return;
  const bytes = packFrame(match, ++frameNo, version);
  postMessage({ type: 'FRAME', bytes, events }, [bytes.buffer]);
  events = [];
}

/*
 * A drift-correcting clock: real elapsed time, not a count of intervals, and
 * at most eight ticks a wake-up, so a worker that was descheduled for a
 * moment catches up rather than freezing, and one that was gone for a second
 * does not burst a second of play into one frame.
 */
function pump() {
  if (!match) return;
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  let steps = 0;
  while (acc >= TICK && steps < 8) {
    step();
    acc -= TICK;
    steps++;
  }
  if (steps === 8) acc = 0;
}

onmessage = ({ data }) => {
  switch (data.type) {
    // A match: new, or again. The seats carry over from whatever the page
    // says next; until then everyone but the host is a bot.
    case 'SETUP': {
      match = new Match(data.sides, data.target);
      match.powerLevel = data.power;
      inputs.length = match.players.length;
      inputs.fill(null);
      version = data.version & 0xff;
      events = [];
      last = performance.now();
      acc = 0;
      if (!ticker) ticker = setInterval(pump, 1000 / 120);
      break;
    }

    // The roster changed mid-match (someone joined or left): frames say so.
    case 'VERSION':
      version = data.version & 0xff;
      break;

    // The page has already cleaned this; a non-finite s here would still
    // only make a bot of the seat, never a NaN paddle.
    case 'INPUT': {
      if (!match || !(data.seat >= 0 && data.seat < inputs.length)) break;
      const s = Number(data.s);
      inputs[data.seat] = data.s === null || !Number.isFinite(s) ? null : { target: s, remote: !!data.remote };
      break;
    }

    case 'STOP':
      if (ticker) clearInterval(ticker);
      ticker = null;
      match = null;
      break;

    default:
      break;
  }
};
