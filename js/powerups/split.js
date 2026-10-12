/*
 * split.js — SPLIT: the ball that touched the pickup becomes two, fanning
 * apart in a V from the spot where it was collected (DESIGN.md §3). The new
 * one is `extra` (match.addBall), so it vanishes on its first goal and the
 * match always comes back to its own ball count. Instant: nothing to tick,
 * nothing to undo.
 *
 * WHY ONLY THE COLLECTING BALL, not every ball on the field. On a hexagon or
 * an octagon there are already two or three balls in play; doubling all of
 * them at once is four to six balls appearing in one frame, which nobody at
 * the table can follow and which reads as the game glitching rather than
 * something somebody did. One ball becoming two is a moment you can see
 * happen and point at — and since pickups are aimed at (the ball goes to
 * whoever hit it last), it is also the one a player can mean to cause.
 *
 * THE CAP. Never more than ballCount(n) + 3 balls on the field, so a run of
 * splits at the chaos level cannot snowball. At the cap the pickup is still
 * spent (the sim has already taken it), it just splits nothing — the spark
 * burst still plays, which is honest: the field is full.
 */

const EXTRA_MAX = 3; // balls allowed above the match's own count
const FAN = 0.3; // radians each half turns away from the old heading (~17°)

export default {
  id: 'split',
  name: { nb: 'Del', en: 'Split' },
  colour: '#5cffb0', // mint: between the green and cyan players, paler than both
  duration: 0,
  weight: 1,

  collect(match, fx, ball) {
    // Every ball that is not `extra` is one of the match's own ballCount(n),
    // so counting extras is the cap — without importing sim.js, which
    // imports the list this file is in.
    let extras = 0;
    for (const b of match.balls) if (b.extra && !b.dead) extras++;
    if (extras >= EXTRA_MAX) return;
    // Turn the original one way and send the copy the other, so the pair
    // leaves symmetrically about the line the ball was already on — neither
    // half "keeps going" while the other veers off.
    match.addBall(ball, FAN);
    const c = Math.cos(-FAN), s = Math.sin(-FAN);
    const vx = ball.vx * c - ball.vy * s;
    ball.vy = ball.vx * s + ball.vy * c;
    ball.vx = vx;
  },

  // One dot breaking into two: a dot on a short stem, then two dots up the
  // arms of a Y, drifting apart and back so it reads as "becomes two".
  glyph(ctx, r, time, px) {
    const open = 0.75 + 0.25 * Math.sin(time * 3);
    const ax = r * 0.55 * open, ay = -r * 0.45;
    ctx.strokeStyle = this.colour;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.55);
    ctx.lineTo(0, r * 0.05);
    ctx.lineTo(-ax, ay);
    ctx.moveTo(0, r * 0.05);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.fillStyle = this.colour;
    ctx.beginPath();
    ctx.arc(-ax, ay, r * 0.28, 0, Math.PI * 2);
    ctx.moveTo(ax + r * 0.28, ay);
    ctx.arc(ax, ay, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    // the dot it came from, fainter: what was one
    ctx.globalAlpha *= 0.55;
    ctx.beginPath();
    ctx.arc(0, r * 0.62, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  },

  // No overlay: an instant power-up has no effect to draw, and the second
  // ball appearing out of the pickup's spark burst is the whole explanation.
};
