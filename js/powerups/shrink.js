/*
 * shrink.js — SHRINK: every OTHER player's paddle loses 30 % for eight
 * seconds, easing in and out so nobody's paddle is snatched from under a
 * ball they were already lined up for (DESIGN.md §3).
 *
 * Owned: it works for whoever hit the ball last (fx.by). A fresh serve that
 * touches it (fx.by < 0) wastes it, as DESIGN.md §3 says — "everyone but
 * nobody" is everyone, and shrinking every paddle at once is just a smaller
 * game for eight seconds with no one to thank for it. It fizzles at once.
 *
 * Two players can each have a SHRINK running; then each shrinks the other
 * (and any third party twice), which is what you would expect.
 *
 * Touches the sim only through side.mods.hl, written every tick while it
 * lives, so when it ends there is nothing to undo.
 */

const DURATION = 8;
const CUT = 0.3; // -30 %
const EASE = 0.6; // seconds to ease in and out
const INSET = 0.018; // where render.js draws the paddle, inside its line

export default {
  id: 'shrink',
  name: { nb: 'Krymp', en: 'Shrink' },
  // Chartreuse: between the yellow and green players, but sharper and
  // more acid than either, and the inward chevrons carry it regardless.
  colour: '#c6ff3d',
  duration: DURATION,
  weight: 1,

  collect(match, fx) {
    if (fx.by < 0) fx.dur = 0;
  },

  tick(match, fx) {
    if (fx.by < 0) return;
    const edge = Math.max(0, Math.min(1, Math.min(fx.t, fx.dur - fx.t, EASE) / EASE));
    const k = 1 - CUT * edge;
    for (const s of match.players) if (s.player !== fx.by) s.mods.hl *= k;
  },

  // Two arrowheads pointing in at a short bar: ▸ ▬ ◂, "smaller".
  glyph(ctx, r, time, px) {
    const squeeze = 0.08 * Math.sin(time * 3);
    ctx.fillStyle = this.colour;
    ctx.strokeStyle = this.colour;
    ctx.lineCap = 'round';
    ctx.lineWidth = 4 * px;
    ctx.beginPath();
    ctx.moveTo(-r * 0.18, 0);
    ctx.lineTo(r * 0.18, 0);
    ctx.stroke();
    ctx.beginPath();
    for (let dir = -1; dir <= 1; dir += 2) {
      const tip = dir * r * (0.42 - squeeze);
      const base = dir * r * (0.95 - squeeze);
      ctx.moveTo(base, -r * 0.38);
      ctx.lineTo(tip, 0);
      ctx.lineTo(base, r * 0.38);
      ctx.closePath();
    }
    ctx.fill();
  },

  // While it lasts: an inward chevron at each end of every shrunken paddle,
  // pressing on it, so it is plain which paddles got small.
  draw(ctx, match, fx, time, px) {
    if (fx.by < 0) return;
    const life = Math.max(0, Math.min(1, (fx.dur - fx.t) / EASE, fx.t / 0.3));
    const size = 0.014;
    const gap = 0.012 + 0.005 * Math.sin(time * 4);
    ctx.strokeStyle = this.colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5 * px;
    ctx.globalAlpha = 0.8 * life;
    ctx.beginPath();
    for (const s of match.players) {
      if (s.player === fx.by) continue;
      const p = s.pad;
      const bx = s.ux * (s.a - INSET), by = s.uy * (s.a - INSET);
      for (let dir = -1; dir <= 1; dir += 2) {
        // tip just off the paddle's end, the open side further out
        const tip = p.s + dir * (p.hl + gap);
        const back = tip + dir * size;
        const tx = bx + s.tx * tip, ty = by + s.ty * tip;
        const kx = bx + s.tx * back, ky = by + s.ty * back;
        ctx.moveTo(kx + s.ux * size, ky + s.uy * size);
        ctx.lineTo(tx, ty);
        ctx.lineTo(kx - s.ux * size, ky - s.uy * size);
      }
    }
    ctx.stroke();
  },
};
