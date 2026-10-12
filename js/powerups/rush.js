/*
 * rush.js — RUSH: every ball on the field speeds up to 1.4× for six seconds,
 * easing in and out so nobody's timing is yanked mid-swing. Slow's opposite
 * and its natural counter: the one an older player reaches for. Global: it
 * works whoever hit the ball, even a fresh serve.
 *
 * It touches the sim only through match.mods.ballSpeed, rewritten every
 * tick, so when it ends there is nothing to undo (ARCHITECTURE.md). At the
 * ball's top speed (1.9) a rushed ball moves 1.9 × 1.4 / 120 ≈ 0.022 a tick,
 * still under the ball's radius, so the sim's no-tunnelling promise holds.
 *
 * NO STACKING. Two owners collecting one each would otherwise multiply to
 * 1.96×, past that promise. The effect is the same whoever owns it, so only
 * the live rush with the most time left writes the modifier; any other
 * idles until it runs out.
 */

const DURATION = 6;
const FACTOR = 1.4;
const EASE = 0.5; // seconds to ease in and out

function smooth(k) {
  k = Math.max(0, Math.min(1, k));
  return k * k * (3 - 2 * k);
}

// The longest-lived rush is the one that acts and draws (see NO STACKING).
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
  id: 'rush',
  name: { nb: 'Fart', en: 'Rush' },
  colour: '#ffcf8a', // pale amber, a heat colour paler than the orange player; Shrink took the lime
  duration: DURATION,
  weight: 1,
  global: true, // whoever collects it, it is one effect on the whole field

  tick(match, fx) {
    if (!leading(match, fx)) return;
    const edge = smooth(Math.min(fx.t, fx.dur - fx.t, EASE) / EASE);
    match.mods.ballSpeed *= 1 + (FACTOR - 1) * edge;
  },

  // A ball with speed lines streaming off behind it, the lines flickering
  // along: the comic-book "fast".
  glyph(ctx, r, time, px) {
    ctx.fillStyle = this.colour;
    ctx.beginPath();
    ctx.arc(r * 0.42, 0, r * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.colour;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    for (let k = -1; k <= 1; k++) {
      const shift = ((time * 2.5 + k * 0.33) % 1) * r * 0.25;
      const len = k === 0 ? 0.95 : 0.7;
      const y = k * r * 0.3;
      ctx.moveTo(-r * 0.05 - shift, y);
      ctx.lineTo(-r * (0.05 + len) - shift, y);
    }
    ctx.stroke();
  },

  // While it lasts: speed streaks trailing every ball, and the arena's rim
  // shimmering amber, so the whole table can see the field is running hot.
  draw(ctx, match, fx, time, px) {
    if (!leading(match, fx)) return;
    const life = Math.max(0, Math.min(1, (fx.dur - fx.t) / EASE, fx.t / EASE));
    const R = match.ballR();
    ctx.strokeStyle = this.colour;
    ctx.lineWidth = 1.5 * px;
    // Streaks: two short lines behind each moving ball, either side of its
    // path, pointing back along its velocity.
    ctx.globalAlpha = 0.6 * life;
    ctx.beginPath();
    for (const b of match.balls) {
      if (b.wait > 0 || b.dead) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (v < 1e-6) continue;
      const dx = -b.vx / v, dy = -b.vy / v; // backwards
      const len = R * (3 + 2 * v);
      for (let k = -1; k <= 1; k += 2) {
        const ox = -dy * R * 0.8 * k, oy = dx * R * 0.8 * k;
        ctx.moveTo(b.x + ox + dx * R * 1.4, b.y + oy + dy * R * 1.4);
        ctx.lineTo(b.x + ox + dx * len, b.y + oy + dy * len);
      }
    }
    ctx.stroke();
    // Heat at the rim: the polygon outline, its brightness rippling slowly.
    ctx.lineWidth = 3 * px;
    ctx.globalAlpha = (0.12 + 0.08 * Math.sin(time * 5)) * life;
    ctx.beginPath();
    for (let i = 0; i < match.sides.length; i++) {
      const s = match.sides[i];
      const mx = s.ux * s.a, my = s.uy * s.a;
      ctx.moveTo(mx - s.tx * s.half, my - s.ty * s.half);
      ctx.lineTo(mx + s.tx * s.half, my + s.ty * s.half);
    }
    ctx.stroke();
  },
};
