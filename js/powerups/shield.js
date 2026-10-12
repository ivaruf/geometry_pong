/*
 * shield.js — SHIELD: a barrier behind the collector's paddle turns away the
 * next goal, and waits up to twelve seconds for it (DESIGN.md §3).
 *
 * Owned: it goes to whoever hit the ball last (fx.by). A fresh serve that
 * touches it (fx.by < 0) wastes it, as DESIGN.md §3 says — a shield for
 * everyone would only stall the match. It fizzles at once.
 *
 * Unlike the modifiers, side.shield is a counter the sim spends (it reflects
 * the ball just behind the paddle line and decrements it), so this one has
 * real state to manage:
 *  - collect gives one charge;
 *  - tick watches for it being spent, and then cuts the effect short so the
 *    break can play out for BREAK seconds and the effect is gone;
 *  - a refresh (the same owner collecting SHIELD again while this runs) does
 *    not call collect, only sets fx.t back to 0, so tick spots t going
 *    backwards and re-arms a spent barrier;
 *  - end takes back only the charge it gave, and only if it is still there:
 *    it decrements rather than zeroes, so it can never eat a charge that
 *    came from anywhere else.
 */

const DURATION = 12;
const BREAK = 0.6; // seconds the shattering plays after the barrier is spent
const OUT = 0.03; // how far behind the goal line the barrier sits
const BOW = 0.045; // how far its middle bows out further
const SEG = 12; // straight pieces per curve; even, so it breaks in the middle

// Point k of SEG along the bow behind side s, into px/py via the out arg.
// A plain parabola between the side's two corners: cheap, and no allocation.
function bow(s, k, o) {
  const u = k / SEG * 2 - 1; // -1 .. 1 along the side
  const d = s.a + OUT + BOW * (1 - u * u);
  o.x = s.ux * d + s.tx * s.half * u;
  o.y = s.uy * d + s.ty * s.half * u;
}
const pt = { x: 0, y: 0 };

function trace(ctx, s, from, to, dx, dy) {
  for (let k = from; k <= to; k++) {
    bow(s, k, pt);
    if (k === from) ctx.moveTo(pt.x + dx, pt.y + dy);
    else ctx.lineTo(pt.x + dx, pt.y + dy);
  }
}

export default {
  id: 'shield',
  name: { nb: 'Skjold', en: 'Shield' },
  // Ice white-blue, the colour render.js already gives a shield's sparks.
  colour: '#bfefff',
  duration: DURATION,
  weight: 1,

  collect(match, fx) {
    if (fx.by < 0) { fx.dur = 0; return; }
    const s = match.players[fx.by];
    s.shield += 1;
    fx.data.lastT = 0;
    fx.data.broke = -1; // fx.t when the barrier was spent; -1 while whole
  },

  tick(match, fx) {
    if (fx.by < 0) return;
    const s = match.players[fx.by], d = fx.data;
    if (fx.t < d.lastT) {
      // Refreshed: a full twelve seconds again, and a whole barrier.
      fx.dur = DURATION;
      if (d.broke >= 0) { s.shield += 1; d.broke = -1; }
    }
    d.lastT = fx.t;
    if (d.broke < 0 && s.shield <= 0) {
      d.broke = fx.t;
      fx.dur = Math.min(fx.dur, fx.t + BREAK);
    }
  },

  end(match, fx) {
    if (fx.by < 0) return;
    const s = match.players[fx.by];
    if (fx.data.broke < 0 && s.shield > 0) s.shield -= 1;
  },

  // A dome over a short paddle: something sheltering it.
  glyph(ctx, r, time, px) {
    ctx.strokeStyle = this.colour;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.arc(0, r * 0.35, r * 0.85, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.globalAlpha *= 0.55 + 0.45 * Math.sin(time * 3) ** 2;
    ctx.lineWidth = 4 * px;
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, r * 0.5);
    ctx.lineTo(r * 0.4, r * 0.5);
    ctx.stroke();
  },

  // While whole: a glowing bow across the whole goal, just behind the line,
  // that blinks through its last two seconds. When spent: it snaps in the
  // middle and both halves fly outward and fade.
  draw(ctx, match, fx, time, px) {
    if (fx.by < 0) return;
    const s = match.players[fx.by], d = fx.data;
    ctx.strokeStyle = this.colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (d.broke < 0) {
      const left = fx.dur - fx.t;
      const blink = left < 2 ? 0.5 + 0.5 * Math.cos(time * 12) : 1;
      const life = Math.min(1, fx.t / 0.25) * blink * (0.85 + 0.15 * Math.sin(time * 5));
      // three passes, wide and faint to thin and bright: render.js's glow
      for (let i = 0; i < 3; i++) {
        ctx.lineWidth = (i === 0 ? 10 : i === 1 ? 5 : 2.5) * px;
        ctx.globalAlpha = (i === 0 ? 0.1 : i === 1 ? 0.25 : 0.9) * life;
        ctx.beginPath();
        trace(ctx, s, 0, SEG, 0, 0);
        ctx.stroke();
      }
      return;
    }
    const k = Math.min(1, (fx.t - d.broke) / BREAK);
    const fly = 0.06 * k, push = 0.05 * k;
    ctx.lineWidth = 3 * px;
    ctx.globalAlpha = 1 - k;
    ctx.beginPath();
    trace(ctx, s, 0, SEG / 2 - 1, -s.tx * fly + s.ux * push, -s.ty * fly + s.uy * push);
    trace(ctx, s, SEG / 2 + 1, SEG, s.tx * fly + s.ux * push, s.ty * fly + s.uy * push);
    ctx.stroke();
    // a few shards from the crack
    ctx.fillStyle = this.colour;
    bow(s, SEG / 2, pt);
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.5;
      const r = 0.02 + 0.09 * k;
      const x = pt.x + (s.ux * Math.cos(a) + s.tx * Math.sin(a)) * r;
      const y = pt.y + (s.uy * Math.cos(a) + s.ty * Math.sin(a)) * r;
      ctx.fillRect(x - 2 * px, y - 2 * px, 4 * px, 4 * px);
    }
  },
};
