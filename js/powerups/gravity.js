/*
 * gravity.js — BLACK HOLE: for seven seconds a swirling well sits where the
 * pickup was and every ball in play bends towards it, slingshotting past.
 * Global: one well whoever collects it, refreshed rather than doubled.
 *
 * BEND, NEVER ACCELERATE. A real gravity well would speed balls up as they
 * fall in and fling them out faster than any paddle could answer. Here the
 * pull only ever TURNS a ball's velocity — the part of the pull across its
 * path becomes a turning rate, and a rotation keeps |v| exactly — so a ball
 * leaves the well as fast as it came, just somewhere else. Paddle hits still
 * own a ball's speed.
 *
 * NO ORBITS. A constant-speed ball under a central pull can circle the well
 * indefinitely at the right distance. So each ball has an allowance of
 * 225° of net turning per flight, paddle to paddle; once spent, the well
 * lets go of it and it flies straight until a paddle (or a fresh serve)
 * gives it a new one. Wall bounces deliberately do not: on the two-player
 * court a ball could otherwise ping wall to wall through the well for the
 * whole effect. Speed is never touched, so nothing can stall either.
 *
 * A paddle hit is told from other bounces by the sim's own bookkeeping: the
 * ball's owner or nominal speed changed, or it was heading into its owner's
 * side and now heads out. No hook needed.
 *
 * Velocity only, never position: collisions stay the sim's, so no ball can
 * be pulled through a side.
 */

const DURATION = 7;
const EASE = 0.6; // seconds to ease the pull in and out
const PULL = 0.22; // strength: pull = PULL / (d² + SOFT²) units/s²
const SOFT = 0.12; // softening, so a ball through the middle is not flung
const MAX_TURN = 3.5; // rad/s, however close a ball passes
const ALLOWANCE = 1.25 * Math.PI; // net turning per flight before release
const REACH = 0.35; // the well sits no further out than this × inradius
const WELL_R = 0.2; // drawn size of the swirl

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
  id: 'gravity',
  name: { nb: 'Sort hull', en: 'Black hole' },
  colour: '#7a6bff',
  duration: DURATION,
  weight: 1,
  global: true,

  // The well goes where the pickup was, pulled in towards the middle: a
  // well hard against a side would bend balls into skimming along it.
  collect(match, fx) {
    const d = fx.data;
    const r = Math.hypot(fx.x, fx.y), max = match.inradius * REACH;
    const k = r > max ? max / r : 1;
    d.wx = fx.x * k;
    d.wy = fx.y * k;
    d.age = 0;
    d.balls = new WeakMap(); // ball -> { vx, vy, last, speed, turn }: as we last left it
  },

  tick(match, fx, dt) {
    const d = fx.data;
    // Ease in on our own clock: a refresh resets fx.t, and the pull should
    // not dip to nothing and come back when someone collects it again.
    d.age += dt;
    const k = Math.max(0, Math.min(1, d.age / EASE, (fx.dur - fx.t) / EASE));
    for (const b of match.balls) {
      if (b.dead) continue;
      if (b.wait > 0) { d.balls.delete(b); continue; }
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < 1e-6) continue;
      let st = d.balls.get(b);
      if (!st) { st = { vx: b.vx, vy: b.vy, last: b.last, speed: b.speed, turn: 0 }; d.balls.set(b, st); }
      else {
        // A paddle hit since our last tick: a new flight, a fresh allowance.
        const owner = b.last >= 0 ? match.players[b.last] : null;
        if (owner && (b.last !== st.last || b.speed !== st.speed
          || (st.vx * owner.ux + st.vy * owner.uy > 0 && b.vx * owner.ux + b.vy * owner.uy < 0))) st.turn = 0;
        st.last = b.last;
        st.speed = b.speed;
      }
      if (Math.abs(st.turn) < ALLOWANCE) {
        const rx = d.wx - b.x, ry = d.wy - b.y;
        const r = Math.hypot(rx, ry) || 1;
        const pull = (PULL * k) / (r * r + SOFT * SOFT);
        // sin of the angle from the heading to the well: only that share of
        // the pull turns the ball; the rest would only have sped it up.
        const across = (b.vx * ry - b.vy * rx) / (sp * r);
        const w = Math.max(-MAX_TURN, Math.min(MAX_TURN, (pull * across) / sp));
        const th = w * dt, c = Math.cos(th), s = Math.sin(th);
        const vx = b.vx * c - b.vy * s;
        b.vy = b.vx * s + b.vy * c;
        b.vx = vx;
        keepMoving(match, b);
        st.turn += th;
      }
      st.vx = b.vx;
      st.vy = b.vy;
    }
  },

  // A dot with three arms swirling into it.
  glyph(ctx, r, time, px) {
    ctx.strokeStyle = this.colour;
    ctx.fillStyle = this.colour;
    ctx.lineWidth = 2.5 * px;
    for (let arm = 0; arm < 3; arm++) {
      const base = -time * 2.5 + (arm * Math.PI * 2) / 3;
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        const a = base + f * 2.2, rr = r * (0.95 - f * 0.7);
        if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  },

  // While it lasts: the same swirl, big, at the well, with rings falling
  // inwards — the opposite of slow's ripples — so everyone sees where the
  // balls are being pulled and why.
  draw(ctx, match, fx, time, px) {
    const d = fx.data;
    const life = Math.max(0, Math.min(1, d.age / 0.3, (fx.dur - fx.t) / 0.6));
    ctx.translate(d.wx, d.wy);
    ctx.strokeStyle = this.colour;
    ctx.fillStyle = this.colour;
    ctx.lineWidth = 2 * px;
    for (let k = 0; k < 3; k++) {
      const p = 1 - ((time * 0.5 + k / 3) % 1);
      ctx.globalAlpha = 0.3 * (1 - p) * life;
      ctx.beginPath();
      ctx.arc(0, 0, WELL_R * 1.4 * p, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.55 * life;
    for (let arm = 0; arm < 4; arm++) {
      const base = -time * 1.6 + (arm * Math.PI) / 2;
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const f = i / 16;
        const a = base + f * 2.6, rr = WELL_R * (1 - f * 0.85) * life;
        if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.8 * life;
    ctx.beginPath();
    ctx.arc(0, 0, 0.018, 0, Math.PI * 2);
    ctx.fill();
  },

  // Online (ARCHITECTURE.md, "pack and unpack"): the well and its clock are
  // all draw needs. The per-ball allowances stay on the host, which steers.
  pack(match, fx) {
    return [fx.data.wx, fx.data.wy, fx.data.age];
  },
  unpack(match, fx, nums) {
    fx.data.wx = nums[0] || 0;
    fx.data.wy = nums[1] || 0;
    fx.data.age = nums[2] || 0;
  },
};
