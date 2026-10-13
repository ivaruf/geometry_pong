// net-smoke.mjs — the online frame codec, headless, under node.
//
//   node tools/net-smoke.mjs
//
// Plays every shape from 2 to 8 sides with bots, at Kaos Off (plain pong)
// and at Kaos Max (the most pickups, effects and extra balls a frame can
// carry), for up to three
// simulated minutes, packs a frame every second tick exactly as
// js/net/host-worker.js does, decodes it with the guest's unpackFrame and
// applies it to a shadow Match (js/net/shadow.js). Fails if a frame does not
// decode, a decoded position is off by more than the quantisation, or the
// shadow's balls, scores or effects disagree with the host's. Prints the
// frame sizes, which docs/P2P.md quotes: what was measured, not assumed.

import { Match, TICK } from '../js/sim.js';
import { packFrame, unpackFrame } from '../js/net/protocol.js';
import { createShadow } from '../js/net/shadow.js';

let failed = false;
const fail = (msg) => {
  console.error(msg);
  failed = true;
};

for (const level of [0, 4])
for (let n = 2; n <= 8; n++) {
  const m = new Match(n, 15);
  m.powerLevel = level;
  const shadow = createShadow({ sides: n, target: 15, mine: 1 });
  shadow.setVersion(7);
  let frames = 0, bytes = 0, largest = 0, maxBalls = 0, maxFx = 0, unpacked = 0;
  const fxSeen = new Set();
  for (let tick = 1; tick <= 180 / TICK && m.winner < 0; tick++) {
    m.step(TICK, []);
    m.events.length = 0;
    if (tick % 2) continue;
    const buf = packFrame(m, ++frames, 7);
    bytes += buf.length;
    largest = Math.max(largest, buf.length);
    const f = unpackFrame(buf);
    if (!f) { fail(`N=${n}: frame ${frames} did not decode`); break; }
    if (f.balls.length !== m.balls.length || f.effects.length !== m.effects.length || f.pickups.length !== m.pickups.length) {
      fail(`N=${n}: frame ${frames} lost something`);
      break;
    }
    for (let i = 0; i < m.balls.length; i++) {
      const b = m.balls[i], fb = f.balls[i];
      if (b.wait > 0) continue;
      if (Math.abs(b.x - fb.x) > 1e-4 || Math.abs(b.y - fb.y) > 1e-4 || Math.abs(b.vx - fb.vx) > 2e-4) {
        fail(`N=${n}: ball ${i} off by more than quantisation at frame ${frames}`);
      }
    }
    // The shadow, as a guest would hold it, with no time passing.
    shadow.push(f, 0);
    shadow.advance(0, null, 0);
    const sm = shadow.match;
    if (sm.players.some((s, i) => s.score !== m.players[i].score)) fail(`N=${n}: scores disagree at frame ${frames}`);
    if (sm.balls.length !== m.balls.length) fail(`N=${n}: shadow ball count at frame ${frames}`);
    for (let i = 0; i < m.effects.length; i++) {
      const fx = sm.effects[i];
      if (!fx || fx.def !== m.effects[i].def) { fail(`N=${n}: effect ${i} at frame ${frames}`); continue; }
      fxSeen.add(fx.def.id);
      if (fx.def.unpack) unpacked++;
    }
    // Draw-state spot checks for the four power-ups that pack.
    for (let i = 0; i < m.effects.length; i++) {
      const a = m.effects[i], b = sm.effects[i];
      if (a.def.id === 'gravity' && Math.hypot(a.data.wx - b.data.wx, a.data.wy - b.data.wy) > 2e-3) fail(`N=${n}: well moved`);
      if (a.def.id === 'bumpers' && a.data.bumpers.length !== b.data.bumpers.length) fail(`N=${n}: bumpers lost`);
      if (a.def.id === 'shield' && a.by >= 0 && Math.abs((a.data.broke ?? -1) - b.data.broke) > 2e-3) fail(`N=${n}: shield break`);
      if (a.def.id === 'curve') {
        for (let k = 0; k < m.balls.length; k++) {
          const st = a.data.balls.get(m.balls[k]), sb = b.data.balls.get(sm.balls[k]);
          if (!!st !== !!sb || (st && st.sign !== sb.sign)) fail(`N=${n}: curve spin for ball ${k}`);
        }
      }
    }
    maxBalls = Math.max(maxBalls, m.balls.length);
    maxFx = Math.max(maxFx, m.effects.length);
  }
  const mean = bytes / frames;
  console.log(
    `kaos ${level}  N=${n}  frames ${frames}  mean ${mean.toFixed(1)} B  largest ${largest} B  ` +
      `${((mean * 60 * 8) / 1000).toFixed(1)} kbit/s to one guest  ` +
      `up to ${maxBalls} balls, ${maxFx} effects  (${fxSeen.size} kinds seen, ${unpacked} unpacks)`,
  );
}
process.exit(failed ? 1 : 0);
