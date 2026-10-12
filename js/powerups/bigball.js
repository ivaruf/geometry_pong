/*
 * bigball.js — BIG BALL: every ball on the field swells to 1.8× its radius
 * for eight seconds, easing in and out so no ball pops through a paddle's
 * edge. A bigger ball is easier to see and easier to hit (the paddle test
 * widens with the radius), so this is a gift to the youngest player at the
 * table, whoever collected it. Global, like slow: it works even off a fresh
 * serve.
 *
 * It touches the sim only through match.mods.ballRadius, rewritten every
 * tick, so when it ends there is nothing to undo (ARCHITECTURE.md).
 *
 * NO STACKING. Two players each collecting one would otherwise multiply to
 * 3.2×, a ball the size of a paddle. The effect is the same whoever owns it,
 * so only the live big-ball effect with the most time left writes the
 * modifier; any other simply idles until it runs out, and the swell never
 * goes past FACTOR.
 */

const DURATION = 8;
const FACTOR = 1.8;
const EASE = 0.5; // seconds to grow and to shrink back

function smooth(k) {
  k = Math.max(0, Math.min(1, k));
  return k * k * (3 - 2 * k);
}

// The longest-lived big ball is the one that acts and draws (NO STACKING).
function leading(match, fx) {
  // Ties (two collected on the same tick) go to the earlier in the list.
  const mine = fx.dur - fx.t;
  let before = true;
  for (const o of match.effects) {
    if (o === fx) { before = false; continue; }
    if (o.def !== fx.def) continue;
    const left = o.dur - o.t;
    if (left > mine || (before && left === mine)) return false;
  }
  return true;
}

export default {
  id: 'bigball',
  name: { nb: 'Stor ball', en: 'Big ball' },
  colour: '#f5a3ff', // pale orchid: lighter than the violet player, and Wide already took royal blue
  duration: DURATION,
  weight: 1,
  global: true, // whoever collects it, it is one effect on the whole field

  tick(match, fx) {
    if (!leading(match, fx)) return;
    const edge = smooth(Math.min(fx.t, fx.dur - fx.t, EASE) / EASE);
    match.mods.ballRadius *= 1 + (FACTOR - 1) * edge;
  },

  // A ball with four arrows pushing outward from it, the ball breathing in
  // and out: "the ball gets big".
  glyph(ctx, r, time, px) {
    const g = 0.42 + 0.08 * Math.sin(time * 3);
    ctx.fillStyle = this.colour;
    ctx.beginPath();
    ctx.arc(0, 0, r * g, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.colour;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    const d = Math.SQRT1_2;
    for (let k = 0; k < 4; k++) {
      const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1;
      const tx = sx * d * r * 0.95, ty = sy * d * r * 0.95; // arrow tip
      ctx.moveTo(sx * d * r * 0.62, sy * d * r * 0.62);
      ctx.lineTo(tx, ty);
      ctx.moveTo(tx - sx * r * 0.28, ty);
      ctx.lineTo(tx, ty);
      ctx.lineTo(tx, ty - sy * r * 0.28);
    }
    ctx.stroke();
  },

  // While it lasts: a soft blue ring hugging every ball, drawn under the
  // ball itself, so it is plain which thing has grown and that it will
  // shrink again when the ring fades.
  draw(ctx, match, fx, time, px) {
    if (!leading(match, fx)) return;
    const life = Math.min(1, (fx.dur - fx.t) / EASE, fx.t / EASE);
    const R = match.ballR();
    ctx.strokeStyle = this.colour;
    ctx.lineWidth = 2 * px;
    ctx.globalAlpha = 0.55 * Math.max(0, life);
    ctx.beginPath();
    for (const b of match.balls) {
      if (b.wait > 0 || b.dead) continue;
      ctx.moveTo(b.x + R * 1.35, b.y);
      ctx.arc(b.x, b.y, R * 1.35, 0, Math.PI * 2);
    }
    ctx.stroke();
  },
};
