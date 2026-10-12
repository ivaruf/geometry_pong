/*
 * bumpers.js — BUMPERS: for ten seconds three to five round neon bumpers
 * pop up in the field, pinball style, and every ball bounces off them.
 * Global: one set whoever collects it, refreshed rather than doubled.
 *
 * WHERE THEY GO. Picked once, on collect, by rejection sampling with the
 * match's own random stream, and kept clear of:
 *   - the centre, where every serve starts — a serve into a bumper would
 *     bounce straight back at the server's own neighbour before anyone
 *     could react;
 *   - every side, by a gap wide enough for the biggest ball to pass, so a
 *     ball can never be pinned between a bumper and a wall, and a ball
 *     pushed out of a bumper is still well inside the arena;
 *   - each other, the balls in play, and the pickups waiting on the field,
 *     so nothing is hidden underneath one.
 * Fewer than asked for is fine on a small shape; the triangle fits three.
 *
 * COLLISION is our own (ARCHITECTURE.md): a ball inside a bumper's ring and
 * moving towards its centre is mirrored about the normal — speed kept — and
 * set back on the rim, with a 'bump' event for the sparks. Approaching-only,
 * so a ball still inside a ring that grew around it simply drives out.
 *
 * They grow in with a little overshoot and shrink out, and the collision
 * radius follows the drawing, so what you see is what bounces.
 */

const DURATION = 10;
const R = 0.06; // bumper radius at full size
const CENTRE_CLEAR = 0.16; // gap from the serve point to a bumper's rim
const SIDE_CLEAR = 0.15; // gap from any side to a bumper's rim
const APART = 0.12; // gap between two bumpers' rims
const BALL_CLEAR = 0.1;
const PICKUP_R = 0.075; // sim.js PICKUP_R; not imported, sim.js imports us
const GROW = 0.35; // seconds to grow in and to shrink out
const FLASH = 0.25; // seconds a struck bumper glows

/* 0 → 1 with a small overshoot: the pop of a bumper arriving. */
function popIn(f) {
  if (f >= 1) return 1;
  const c = 1.7, g = f - 1;
  return 1 + (c + 1) * g * g * g + c * g * g;
}

/* How big the set is right now, 0..~1.1. */
function scale(fx) {
  const out = Math.max(0, Math.min(1, (fx.dur - fx.t) / GROW));
  return popIn(Math.min(1, fx.data.age / GROW)) * out * out * (3 - 2 * out);
}

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
  id: 'bumpers',
  name: { nb: 'Sprettballer', en: 'Bumpers' },
  colour: '#ff8fa3', // salmon: lighter than the red player, clear of Shrink's lime
  duration: DURATION,
  weight: 1,
  global: true,

  collect(match, fx) {
    const want = match.inradius < 0.6 ? 3 : match.inradius < 0.85 ? 4 : 5;
    const list = [];
    for (let tries = 0; tries < 120 && list.length < want; tries++) {
      const x = (match.random() * 2 - 1) * match.radius;
      const y = (match.random() * 2 - 1) * match.radius;
      if (Math.hypot(x, y) < R + CENTRE_CLEAR) continue;
      if (match.sides.some((s) => s.a - (x * s.ux + y * s.uy) < R + SIDE_CLEAR)) continue;
      if (list.some((o) => Math.hypot(o.x - x, o.y - y) < 2 * R + APART)) continue;
      if (match.balls.some((b) => b.wait <= 0 && Math.hypot(b.x - x, b.y - y) < R + BALL_CLEAR)) continue;
      if (match.pickups.some((p) => Math.hypot(p.x - x, p.y - y) < R + PICKUP_R + 0.03)) continue;
      list.push({ x, y, hit: -1 });
    }
    fx.data.bumpers = list;
    fx.data.age = 0;
  },

  tick(match, fx, dt) {
    const d = fx.data;
    // Our own clock for the grow-in: a refresh resets fx.t, and the set
    // should stay put rather than pop out and in again.
    d.age += dt;
    const k = scale(fx);
    if (k <= 0) return;
    const BR = match.ballR();
    for (const b of match.balls) {
      if (b.wait > 0 || b.dead) continue;
      for (const p of d.bumpers) {
        const rr = R * k + BR;
        const dx = b.x - p.x, dy = b.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const dist = Math.sqrt(d2), nx = dx / dist, ny = dy / dist;
        const vn = b.vx * nx + b.vy * ny;
        if (vn >= 0) continue; // already leaving
        b.vx -= 2 * vn * nx;
        b.vy -= 2 * vn * ny;
        keepMoving(match, b);
        b.x = p.x + nx * rr;
        b.y = p.y + ny * rr;
        p.hit = d.age;
        match.events.push({ type: 'bump', x: p.x + nx * R * k, y: p.y + ny * R * k, colour: this.colour });
      }
    }
  },

  // Three bumpers, the top one lit up as if just struck.
  glyph(ctx, r, time, px) {
    ctx.strokeStyle = this.colour;
    ctx.fillStyle = this.colour;
    ctx.lineWidth = 2.5 * px;
    const a0 = ctx.globalAlpha;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      const x = Math.cos(a) * r * 0.5, y = Math.sin(a) * r * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      if (i === 0) {
        ctx.globalAlpha = a0 * (0.35 + 0.35 * Math.max(0, Math.sin(time * 5)));
        ctx.fill();
        ctx.globalAlpha = a0;
      }
    }
  },

  // A thick neon ring with a core, flaring when a ball strikes it.
  draw(ctx, match, fx, time, px) {
    const d = fx.data;
    const k = scale(fx);
    if (k <= 0) return;
    ctx.strokeStyle = this.colour;
    ctx.fillStyle = this.colour;
    for (const p of d.bumpers) {
      const flash = p.hit >= 0 ? Math.max(0, 1 - (d.age - p.hit) / FLASH) : 0;
      const r = R * k * (1 + 0.15 * flash);
      ctx.globalAlpha = 0.12 + 0.35 * flash;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = (3 + 2 * flash) * px;
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};
