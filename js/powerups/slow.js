/*
 * slow.js — SLOW: every ball on the field slows to a little over half speed
 * for six seconds, easing in and out so nobody's timing is yanked. The one
 * kids reach for (DESIGN.md §3). Global: it works whoever hit the ball, even
 * a fresh serve.
 *
 * The reference power-up for the contract in ARCHITECTURE.md: it touches the
 * sim only through match.mods, written every tick while it lives, so when it
 * ends there is nothing to undo.
 */

const DURATION = 6;
const FACTOR = 0.55;
const EASE = 0.6; // seconds to ease in and out

export default {
  id: 'slow',
  name: { nb: 'Sakte', en: 'Slow' },
  colour: '#8fd3ff',
  duration: DURATION,
  weight: 1,
  global: true, // two players collecting it is still one slow-down, not 0.3×

  tick(match, fx) {
    const edge = Math.min(fx.t, fx.dur - fx.t, EASE) / EASE;
    match.mods.ballSpeed *= 1 - (1 - FACTOR) * Math.max(0, Math.min(1, edge));
  },

  // An hourglass.
  glyph(ctx, r, time, px) {
    ctx.strokeStyle = this.colour;
    ctx.lineWidth = 2.5 * px;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.6);
    ctx.lineTo(r * 0.5, -r * 0.6);
    ctx.lineTo(-r * 0.5, r * 0.6);
    ctx.lineTo(r * 0.5, r * 0.6);
    ctx.closePath();
    ctx.stroke();
    // the sand, running
    const k = (time * 0.5) % 1;
    ctx.fillStyle = this.colour;
    ctx.globalAlpha *= 0.7;
    ctx.beginPath();
    ctx.moveTo(-r * 0.3 * (1 - k), r * 0.6);
    ctx.lineTo(r * 0.3 * (1 - k), r * 0.6);
    ctx.lineTo(0, r * 0.6 - r * 0.45 * (1 - k));
    ctx.fill();
  },

  // While it lasts: slow ripples out from the centre, so everyone can see
  // why the balls are dawdling.
  draw(ctx, match, fx, time, px) {
    const life = Math.min(1, (fx.dur - fx.t) / 0.6, fx.t / 0.3);
    ctx.strokeStyle = this.colour;
    ctx.lineWidth = 2 * px;
    for (let k = 0; k < 3; k++) {
      const p = (time * 0.25 + k / 3) % 1;
      ctx.globalAlpha = 0.25 * (1 - p) * life;
      ctx.beginPath();
      ctx.arc(0, 0, match.inradius * p, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};
