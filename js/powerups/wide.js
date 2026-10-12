/*
 * wide.js — WIDE: the collector's paddle grows by half for ten seconds,
 * easing in and out so it never jumps out from under a ball (DESIGN.md §3).
 *
 * Owned: it goes to whoever hit the ball last (fx.by). A fresh serve that
 * touches it (fx.by < 0) wastes it, as DESIGN.md §3 says a fresh serve
 * should — there is nobody to give it to, and handing everyone a wider
 * paddle would change nothing between them. It fizzles at once.
 *
 * Touches the sim only through side.mods.hl, written every tick while it
 * lives, so when it ends there is nothing to undo. The sim clamps the half
 * length to 90 % of the side, so on an octagon the growth is smaller than
 * half: that is the arena's limit, not a bug here.
 */

const DURATION = 10;
const GROW = 0.5; // +50 %
const EASE = 0.6; // seconds to ease in and out
const INSET = 0.018; // where render.js draws the paddle, inside its line

export default {
  id: 'wide',
  name: { nb: 'Bred', en: 'Wide' },
  // A royal blue: no player wears blue (sim.js COLORS), and it sits well
  // apart from slow's pale sky.
  colour: '#4d7cff',
  duration: DURATION,
  weight: 1,

  collect(match, fx) {
    // Nobody to give it to: end on the next tick, quietly.
    if (fx.by < 0) fx.dur = 0;
  },

  tick(match, fx) {
    if (fx.by < 0) return;
    const edge = Math.max(0, Math.min(1, Math.min(fx.t, fx.dur - fx.t, EASE) / EASE));
    match.players[fx.by].mods.hl *= 1 + GROW * edge;
  },

  // A long bar with an arrowhead at each end, pointing out: "bigger".
  glyph(ctx, r, time, px) {
    const breathe = 1 + 0.08 * Math.sin(time * 3);
    const w = r * 0.95 * breathe;
    ctx.strokeStyle = this.colour;
    ctx.lineCap = 'round';
    ctx.lineWidth = 4 * px;
    ctx.beginPath();
    ctx.moveTo(-w * 0.75, 0);
    ctx.lineTo(w * 0.75, 0);
    ctx.stroke();
    ctx.lineWidth = 2.5 * px;
    ctx.beginPath();
    ctx.moveTo(-w + r * 0.3, -r * 0.35);
    ctx.lineTo(-w, 0);
    ctx.lineTo(-w + r * 0.3, r * 0.35);
    ctx.moveTo(w - r * 0.3, -r * 0.35);
    ctx.lineTo(w, 0);
    ctx.lineTo(w - r * 0.3, r * 0.35);
    ctx.stroke();
  },

  // While it lasts: an outward chevron just past each end of the grown
  // paddle, so the whole table can see whose paddle got big and why.
  draw(ctx, match, fx, time, px) {
    if (fx.by < 0) return;
    const s = match.players[fx.by];
    const p = s.pad;
    const life = Math.max(0, Math.min(1, (fx.dur - fx.t) / EASE, fx.t / 0.3));
    const bx = s.ux * (s.a - INSET), by = s.uy * (s.a - INSET);
    const size = 0.016;
    const gap = 0.02 + 0.006 * Math.sin(time * 4);
    ctx.strokeStyle = this.colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5 * px;
    ctx.globalAlpha = 0.85 * life;
    ctx.beginPath();
    for (let dir = -1; dir <= 1; dir += 2) {
      // tip of the chevron, beyond the paddle's end, pointing away from it
      const tip = p.s + dir * (p.hl + gap + size);
      const back = tip - dir * size;
      const tx = bx + s.tx * tip, ty = by + s.ty * tip;
      const kx = bx + s.tx * back, ky = by + s.ty * back;
      ctx.moveTo(kx + s.ux * size, ky + s.uy * size);
      ctx.lineTo(tx, ty);
      ctx.lineTo(kx - s.ux * size, ky - s.uy * size);
    }
    ctx.stroke();
  },
};
