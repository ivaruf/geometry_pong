/*
 * curve.js — CURVE (skru): for eight seconds every ball bends in flight like
 * a free kick. Which way is set by the paddle that last hit it: swipe right
 * as you hit and the ball bends right, swipe left and it bends left. A
 * paddle that was standing still, or a fresh serve, just alternates.
 * Global: one effect whoever collects it, refreshed rather than doubled.
 *
 * HOW. Velocity is rotated a little every tick — never scaled — so speed is
 * untouched. The turning rate is CURL × speed, which makes the bend a fixed
 * arc of radius 1/CURL whatever the ball's speed, so a fast ball curves as
 * visibly as a slow one, and a slowed one does not curl up on itself.
 *
 * WHAT WOULD GO WRONG, and why it doesn't:
 *   - A circle of radius 1/CURL fits inside the arena, so a ball could loop
 *     forever without touching anything. Each flight (paddle to paddle) has
 *     an allowance of ALLOWANCE radians of bend; after that it flies straight.
 *   - A ball bending into a side meets it flat, the sim's anti-stall sends
 *     it off at 20°, and if it kept bending the same way it would curve
 *     straight back in: a stone skipping along the side. So any bounce that
 *     is not a paddle hit — wall, seal, shield, bumper — mirrors the bend,
 *     as a real mirror would, and the ball curls away from what it hit.
 *     Together with the allowance, no ball can skim a side for long.
 *
 * Paddle hits are told from other bounces by the sim's own bookkeeping: the
 * ball's owner or nominal speed changed, or it was heading into its owner's
 * side and now heads out. No hook needed.
 */

const DURATION = 8;
const EASE = 0.5;
const CURL = 1.8; // radians of turn per unit of path: an arc of radius ~0.56
const ALLOWANCE = 1.4; // radians (~80°) of bend per flight
const BOUNCE = Math.cos(0.1); // a heading change bigger than this per tick is a bounce, not us

/*
 * The sim's anti-stall only judges a bounce against the side it bounced
 * off. On the two-player court that leaves a hole our deflections could
 * find: a ball turned to run straight across, wall to wall, parallel to
 * both goals, would bounce at a perfect 90° for ever. So after we turn a
 * ball, it must still travel at least 20° along every wall — towards a goal.
 * Polygons have no walls and never pay for this.
 */
const MIN_ALONG = Math.sin((20 * Math.PI) / 180);
function keepMoving(match, b) {
  for (const s of match.sides) {
    if (s.type !== 'wall') continue;
    const sp = Math.hypot(b.vx, b.vy);
    const along = b.vx * s.tx + b.vy * s.ty;
    if (Math.abs(along) >= MIN_ALONG * sp) continue;
    const at = (Math.sign(along) || 1) * MIN_ALONG * sp;
    const across = (Math.sign(b.vx * s.ux + b.vy * s.uy) || -1) * Math.sqrt(sp * sp - at * at);
    b.vx = s.tx * at + s.ux * across;
    b.vy = s.ty * at + s.uy * across;
  }
}

export default {
  id: 'curve',
  name: { nb: 'Skru', en: 'Curve' },
  colour: '#3dffc5',
  duration: DURATION,
  weight: 1,
  global: true,

  collect(match, fx) {
    fx.data.balls = new WeakMap(); // ball -> { vx, vy, last, speed, sign, turn }
    fx.data.alt = 1;
    fx.data.age = 0;
  },

  tick(match, fx, dt) {
    const d = fx.data;
    d.age += dt; // own clock: a refresh resets fx.t, and should not dip the bend
    const k = Math.max(0, Math.min(1, d.age / EASE, (fx.dur - fx.t) / EASE));
    for (const b of match.balls) {
      if (b.dead) continue;
      if (b.wait > 0) { d.balls.delete(b); continue; }
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < 1e-6) continue;
      let st = d.balls.get(b);
      if (!st) {
        d.alt = -d.alt;
        st = { vx: b.vx, vy: b.vy, last: b.last, speed: b.speed, sign: d.alt, turn: 0 };
        d.balls.set(b, st);
      } else {
        const owner = b.last >= 0 ? match.players[b.last] : null;
        const hit = owner && (b.last !== st.last || b.speed !== st.speed
          || (st.vx * owner.ux + st.vy * owner.uy > 0 && b.vx * owner.ux + b.vy * owner.uy < 0));
        if (hit) {
          // Bend the way the paddle was moving as it struck.
          const mv = owner.pad.s - owner.pad.prev;
          if (Math.abs(mv) > 1e-5) {
            const mx = owner.tx * Math.sign(mv), my = owner.ty * Math.sign(mv);
            st.sign = b.vx * my - b.vy * mx >= 0 ? 1 : -1;
          } else {
            d.alt = -d.alt;
            st.sign = d.alt;
          }
          st.turn = 0;
        } else if (st.vx * b.vx + st.vy * b.vy < BOUNCE * sp * Math.hypot(st.vx, st.vy)) {
          st.sign = -st.sign; // a mirror reverses the spin
        }
        st.last = b.last;
        st.speed = b.speed;
      }
      if (st.turn < ALLOWANCE) {
        const th = st.sign * CURL * sp * k * dt;
        const c = Math.cos(th), s = Math.sin(th);
        const vx = b.vx * c - b.vy * s;
        b.vy = b.vx * s + b.vy * c;
        b.vx = vx;
        keepMoving(match, b);
        st.turn += Math.abs(th);
      }
      st.vx = b.vx;
      st.vy = b.vy;
    }
  },

  // A ball and its banana path: an arc ending in an arrowhead.
  glyph(ctx, r, time, px) {
    ctx.strokeStyle = this.colour;
    ctx.fillStyle = this.colour;
    ctx.lineWidth = 2.5 * px;
    const cx = r * 0.9, cy = r * 0.9, rr = r * 1.4;
    const a0 = Math.PI * 1.02, a1 = Math.PI * 1.48;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, a0, a1);
    ctx.stroke();
    // the arrowhead, along the arc's tangent at its end
    const ex = cx + Math.cos(a1) * rr, ey = cy + Math.sin(a1) * rr;
    const tx = -Math.sin(a1), ty = Math.cos(a1); // direction of travel
    const h = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(ex + tx * h * 0.6, ey + ty * h * 0.6);
    ctx.lineTo(ex - tx * h * 0.5 - ty * h * 0.6, ey - ty * h * 0.5 + tx * h * 0.6);
    ctx.lineTo(ex - tx * h * 0.5 + ty * h * 0.6, ey - ty * h * 0.5 - tx * h * 0.6);
    ctx.closePath();
    ctx.fill();
    // the ball at the start, with a little bob so it reads as moving
    const sx = cx + Math.cos(a0) * rr, sy = cy + Math.sin(a0) * rr;
    ctx.beginPath();
    ctx.arc(sx, sy + Math.sin(time * 4) * r * 0.05, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  },

  // While it lasts: a spinning hook of light around each curving ball,
  // turning the way that ball bends, and gone once its bend is spent — so
  // you can see which balls are still going to swerve.
  draw(ctx, match, fx, time, px) {
    const d = fx.data;
    const life = Math.max(0, Math.min(1, d.age / 0.3, (fx.dur - fx.t) / 0.6));
    const R = match.ballR() * 2.2;
    ctx.strokeStyle = this.colour;
    ctx.lineWidth = 2 * px;
    for (const b of match.balls) {
      if (b.wait > 0 || b.dead) continue;
      const st = d.balls.get(b);
      if (!st || st.turn >= ALLOWANCE) continue;
      ctx.globalAlpha = 0.7 * life * (1 - st.turn / ALLOWANCE * 0.6);
      const a = time * 7 * st.sign;
      ctx.beginPath();
      ctx.arc(b.x, b.y, R, a, a + 2.2);
      ctx.stroke();
    }
  },
};
