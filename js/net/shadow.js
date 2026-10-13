/*
 * shadow.js — a Match fed from the wire instead of from physics.
 *
 * NeonFox's ShadowWorld idea (its js/net/shadow.js), taken one step further:
 * the shadow here is not Match-shaped, it IS a Match — js/sim.js's own class,
 * constructed for the room's number of sides and then never stepped. Its
 * balls, paddles, seals, scores, pickups and effects are overwritten by every
 * frame, so js/render.js and every power-up's draw() read it exactly as they
 * read a local match. There is no second renderer and no "online mode" in any
 * draw code; the only online branches in the drawing are the board's turn and
 * which way the rim text faces.
 *
 * THE HOST USES ONE TOO. Its real Match is in the worker, so it draws the
 * same packed frames it broadcasts and sees what its guests see, down to the
 * quantisation (1/16000 of a unit).
 *
 * THREE THINGS ARE NOT SIMPLY COPIED, and they are where Pong differs from
 * NeonFox (DESIGN.md §6):
 *
 *   YOUR OWN PADDLE never waits for the host. advance() steers it here, with
 *   the sim's own steer() and this device's input, and frames never touch its
 *   position. Its length still comes from the host, so Wide and Shrink land.
 *
 *   BALLS ARE EXTRAPOLATED, not interpolated. A ball between bounces moves in
 *   a straight line, so it is drawn where it is now — the frame's position
 *   carried forward by the time since the frame arrived plus half the
 *   measured round trip — rather than where it was a frame ago. On the way it
 *   bounces off walls and sealed sides, which are certain, and stops at an
 *   open goal line, which is not: whether a paddle returns it is the host's
 *   call, so the ball waits at the line for the answer rather than being
 *   guessed through and snapped back. Power-ups that bend paths (Black hole,
 *   Curve, Bumpers) are not predicted; their next frame corrects it. When a
 *   frame disagrees with where a ball was being drawn, the difference is
 *   kept as an offset that fades over 80 ms, so a correction is a quick
 *   glide and not a jump — unless it is a big one (a serve), which snaps.
 *
 *   OTHER PADDLES glide towards each frame's position over ~30 ms, because
 *   frames arrive at a network's rhythm and not the screen's.
 */

import { Match } from '../sim.js';

const MAX_LEAD = 0.15; // seconds a ball may be carried past its last frame
const BLEND = 0.08; // seconds a correction takes to fade
const SNAP = 0.25; // a correction bigger than this is a jump, not a glide
const PAD_GLIDE = 0.03;
const SUB = 1 / 120;
const TRAIL = 16; // floats: eight points, about 0.13 s at 60 frames a second
const PICKUP_LIFE = 14; // sim.js; the frame carries age, not life

/* The board's turn that puts side s flat at the bottom of the screen
 * (DESIGN.md §4): its outward normal, which points away from the centre,
 * turned to point down. Rotation only, never a mirror. */
export function turnFor(s) {
  return Math.PI / 2 - Math.atan2(s.uy, s.ux);
}

export function createShadow({ sides, target, mine }) {
  const match = new Match(sides, target);
  match.balls = [];
  match.pickups = [];
  match.effects = [];
  const me = mine >= 0 && mine < match.players.length ? match.players[mine] : null;
  let version = -1;
  let lastFrame = -1;
  let pending = null; // the newest frame not yet applied
  let arrived = 0; // performance.now() when it came
  let halfTrip = 0; // seconds, from the measured round trip
  let fresh = true; // nothing applied yet: the first frame snaps everything

  function newBall() {
    const b = match.newBall();
    b.bx = 0; b.by = 0; b.bvx = 0; b.bvy = 0; b.ox = 0; b.oy = 0; b.at = 0;
    return b;
  }

  /*
   * Carry ball b forward `lead` seconds from its frame, into out.x/out.y.
   * Walls and sealed sides bounce it; an open goal stops it at the line.
   */
  const proj = { x: 0, y: 0 };
  function project(b, lead) {
    let x = b.bx, y = b.by;
    let vx = b.bvx * match.mods.ballSpeed, vy = b.bvy * match.mods.ballSpeed;
    const R = match.ballR();
    let t = Math.min(MAX_LEAD, Math.max(0, lead));
    while (t > 1e-6) {
      const h = Math.min(SUB, t);
      t -= h;
      x += vx * h;
      y += vy * h;
      let stop = false;
      for (const s of match.sides) {
        const dist = s.a - (x * s.ux + y * s.uy);
        const vu = vx * s.ux + vy * s.uy;
        if (dist >= R || vu <= 0) continue;
        if (s.type === 'wall' || s.seal > 0) {
          vx -= 2 * vu * s.ux; vy -= 2 * vu * s.uy;
          x -= s.ux * (R - dist); y -= s.uy * (R - dist);
        } else if (dist + vu * h >= R - 1e-9) {
          // It was in front of the line a substep ago: wait there.
          x -= s.ux * (R - dist); y -= s.uy * (R - dist);
          stop = true;
        }
      }
      if (stop) break;
    }
    proj.x = x;
    proj.y = y;
    return proj;
  }

  function apply(f, now) {
    match.winner = f.winner;
    match.mods.ballSpeed = f.ballSpeed;
    match.mods.ballRadius = f.ballRadius;
    for (let i = 0; i < match.players.length; i++) {
      const s = match.players[i], p = f.players[i];
      if (!p) continue;
      s.pad.hl = p.hl;
      s.mods.hl = s.pad.hlBase > 0 ? p.hl / s.pad.hlBase : 1;
      s.net = p.s;
      if (s !== me && fresh) s.pad.s = s.pad.prev = p.s;
      s.seal = p.seal;
      s.sealBy = p.sealBy;
      s.score = p.score;
      s.human = s === me || p.human;
      s.shield = p.shield;
    }

    const lead = halfTrip;
    while (match.balls.length > f.balls.length) match.balls.pop();
    for (let i = 0; i < f.balls.length; i++) {
      const fb = f.balls[i];
      let b = match.balls[i];
      const had = !!b && b.wait <= 0;
      const oldX = b ? b.x : 0, oldY = b ? b.y : 0;
      if (!b) b = match.balls[i] = newBall();
      b.last = fb.last;
      b.extra = fb.extra;
      b.at = now;
      if (fb.waiting) {
        b.wait = fb.wait;
        b.dx = fb.vx; b.dy = fb.vy;
        b.x = b.y = b.vx = b.vy = 0;
        b.bx = b.by = b.bvx = b.bvy = 0;
        b.ox = b.oy = 0;
        b.trail.length = 0;
        continue;
      }
      b.wait = 0;
      b.bx = fb.x; b.by = fb.y; b.bvx = fb.vx; b.bvy = fb.vy;
      b.vx = fb.vx; b.vy = fb.vy;
      const p = project(b, lead);
      const ox = oldX - p.x, oy = oldY - p.y; // where it was drawn, against where it is now
      if (had && !fresh && Math.hypot(ox, oy) < SNAP) { b.ox = ox; b.oy = oy; }
      else { b.ox = 0; b.oy = 0; b.trail.length = 0; }
      b.x = p.x + b.ox;
      b.y = p.y + b.oy;
    }

    // Pickups and effects, reusing last frame's objects where they line up.
    match.pickups.length = f.pickups.length;
    for (let i = 0; i < f.pickups.length; i++) {
      const fp = f.pickups[i];
      const p = match.pickups[i] || (match.pickups[i] = { def: null, x: 0, y: 0, age: 0, life: PICKUP_LIFE });
      p.def = fp.def; p.x = fp.x; p.y = fp.y; p.age = fp.age; p.life = PICKUP_LIFE;
    }
    const before = match.effects;
    match.effects = f.effects.map((ff, i) => {
      const old = before[i];
      const fx = old && old.def === ff.def ? old : { def: ff.def, by: -1, t: 0, dur: 0, data: {}, x: 0, y: 0 };
      fx.by = ff.by; fx.t = ff.t; fx.dur = ff.dur; fx.x = ff.x; fx.y = ff.y;
      if (fx.def.unpack) {
        try {
          fx.def.unpack(match, fx, ff.nums);
        } catch {
          fx.data = {}; // its draw will find nothing and draw nothing
        }
      }
      return fx;
    });
    fresh = false;
  }

  return {
    match,
    me,
    turn: me ? turnFor(me) : 0,

    /* A new roster version: frames for any other are dropped. */
    setVersion(v) {
      version = v & 0xff;
    },
    /* Half the round trip, in seconds: how far ahead "now" is from a frame. */
    setTrip(seconds) {
      if (Number.isFinite(seconds)) halfTrip = Math.max(0, Math.min(MAX_LEAD, seconds / 2));
    },

    /* A decoded frame off the lossy lane: newest wins, stale is dropped. */
    push(f, now) {
      if (!f || f.version !== version || f.frameNo <= lastFrame) return;
      if (f.players.length !== match.players.length) return;
      lastFrame = f.frameNo;
      pending = f;
      arrived = now;
    },

    /* A new match on the same session: every frame from here is news. */
    rewind() {
      lastFrame = -1;
      pending = null;
      fresh = true;
    },

    /* What the sim reported, as far as the board itself is concerned. */
    event(e) {
      if (e.type === 'hit' && match.players[e.player]) match.players[e.player].flash = 1;
      if (e.type === 'goal' && match.players[e.scorer]) match.players[e.scorer].flash = 1;
    },

    /*
     * Once a screen frame. `input` is this device's own paddle input in the
     * sim's terms (js/input.js), or null to hold it where it is.
     */
    advance(dt, input, now) {
      if (pending) {
        apply(pending, arrived);
        pending = null;
      }
      if (me) match.steer(me, dt, input || { target: me.pad.s });
      const glide = 1 - Math.exp(-dt / PAD_GLIDE);
      for (const s of match.sides) {
        s.flash = Math.max(0, s.flash - dt * 3);
        if (s.seal > 0) s.seal = Math.max(0, s.seal - dt);
        if (s.type !== 'goal' || s === me || s.net === undefined) continue;
        s.pad.prev = s.pad.s;
        s.pad.s += (s.net - s.pad.s) * glide;
      }
      const fade = Math.exp(-dt / BLEND);
      for (const b of match.balls) {
        if (b.wait > 0) {
          b.wait = Math.max(0.001, b.wait - dt); // the serve is the host's to make
          continue;
        }
        b.ox *= fade;
        b.oy *= fade;
        const p = project(b, (now - b.at) / 1000 + halfTrip);
        b.x = p.x + b.ox;
        b.y = p.y + b.oy;
        b.trail.push(b.x, b.y);
        if (b.trail.length > TRAIL) b.trail.splice(0, 2);
      }
      for (const fx of match.effects) fx.t = Math.min(fx.dur, fx.t + dt);
      for (const p of match.pickups) p.age = Math.min(p.life, p.age + dt);
    },
  };
}

