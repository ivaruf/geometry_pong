/*
 * sim.js — THE GAME: the polygon, the balls, the paddles, the bots and the
 * score. Plain numbers, no DOM, no canvas, no clock of its own, so it can
 * run in a host's Web Worker the day Online arrives (DESIGN.md §6) and under
 * node for a headless smoke test.
 *
 * SPACE. The polygon's circumradius is 1, the origin is its centre and y
 * points DOWN, the screen's convention, so a side's outward normal maps
 * straight onto the canvas with no flip anywhere. Side i of an N-gon has its
 * outward normal at pi/2 + 2*pi*i/N, so side 0 is at the bottom. Each side
 * carries its outward normal u, its tangent t (u turned +90°), its distance
 * a from the centre and its half length, so a ball's distance to it is one
 * dot product.
 *
 * N = 2 IS NOT A POLYGON, so it is a rectangle: two goals (bottom, top) and
 * two walls. The collision code never asks what N is; it only asks whether a
 * side is a wall.
 *
 * WHO STEERS is decided outside: step() is handed one input per player,
 *   null            a bot plays this side
 *   { target: s }   a finger: go to tangent position s, fast
 *   { axis: -1..1 } a key pair: move that way at keyboard speed
 *   { target: s, remote: true }
 *                   an online guest's own paddle position (DESIGN.md §6),
 *                   followed at finger speed, which is the clamp: a guest
 *                   cannot move further per tick than a finger could
 * so the sim never knows about pointers, keys or a release grace.
 *
 * THE REMOTE GRACE. A guest's paddle reaches the host a network trip after
 * the guest put it there, so a remote side gets two allowances when a ball
 * arrives: the hit counts if the paddle covers the ball at ANY position it
 * reported in the last GRACE seconds, and the hit window runs on until just
 * before the ball would score (LATE_HIT radii behind the line, not half of
 * one), which leaves room for a position that is still on its way. The
 * price, written down in docs/P2P.md: on a bad connection a guest sometimes
 * gets a save the host's own screen did not show.
 *
 * WHAT HAPPENED is reported as events, drained by main.js for sound and
 * sparks: { type: 'hit' | 'wall' | 'goal' | 'shield' | 'power' | 'powerEnd'
 * | 'bump', ... }. The sim draws nothing.
 *
 * POWER-UPS (ARCHITECTURE.md, "Power-ups"). The pickups on the field, their
 * spawning, and the list of active effects live here; what each power-up
 * DOES lives in its own file under js/powerups/, which this file calls
 * through the contract below and never special-cases. How many appear is
 * this.powerLevel, 0 (none: plain Geometry Pong) to 4, set from the menu
 * slider and live mid-match. Every tick the modifiers below are reset to
 * neutral and each active effect writes its own into them, so an effect
 * that ends simply stops writing and nothing has to be undone:
 *   this.mods.ballSpeed    multiplies how far every ball moves per tick
 *   this.mods.ballRadius   multiplies every ball's radius (collisions too)
 *   side.mods.hl           multiplies that paddle's half length
 *   side.mods.speed        multiplies that paddle's top speed
 * plus two counters an effect may set and the sim spends: side.shield (goals
 * a side can still turn away) and ball.extra (a ball that vanishes on its
 * first goal instead of being served again).
 */

import { POWERUPS } from './powerups/index.js';

export const COLORS = ['#3be8ff', '#ff4fd8', '#ffd23f', '#7dff6a', '#ff8a3d', '#a98bff', '#ff5266', '#e8f6ff'];
export const GLYPHS = ['circle', 'tri', 'square', 'diamond', 'hex', 'plus', 'star', 'ring'];

export const TICK = 1 / 120; // a ball at full speed moves less than its radius per tick
export const BALL_R = 0.026;
export const SEAL_TIME = 2; // seconds a side stays a wall after it concedes
export const SERVE_DELAY = 0.9; // the telegraph arrow shows for this long
const SPEED_START = 0.7;
const SPEED_MAX = 1.9;
const SPEED_UP = 1.04; // per paddle hit
const MAX_ANGLE = 0.96; // ~55°, the sharpest return off a paddle's end
const MIN_LEAVE = Math.sin((20 * Math.PI) / 180); // no bounce leaves flatter than 20° to a side
const FINGER_SPEED = 4;
const KEY_SPEED = 1.6;
const BOT_SPEED = 1.15;
const GRACE = 0.1; // seconds of a remote paddle's reported positions that still count
const LATE_HIT = 2.5; // radii behind its line a remote paddle may still return a ball
const RECENT = 16; // ring of remote positions: 0.1 s is 12 ticks at 120 Hz

// Power-up level 0..4: seconds between spawns, and how many may wait on the
// field at once. Level 0 is no power-ups at all.
const SPAWN_EVERY = [Infinity, 22, 14, 9, 5];
const SPAWN_MAX = [0, 1, 1, 2, 3];
export const PICKUP_R = 0.075;
const PICKUP_LIFE = 14; // seconds a pickup waits before it fades

function side(ux, uy, a, half, type) {
  return {
    ux, uy, tx: -uy, ty: ux, a, half, type,
    player: -1,
    pad: { s: 0, prev: 0, target: 0, hl: Math.min(0.14, half * 0.32), hlBase: Math.min(0.14, half * 0.32) },
    mods: { hl: 1, speed: 1 },
    shield: 0,
    seal: 0,
    sealBy: -1, // who scored the goal that sealed it; -1 nobody
    flash: 0,
    score: 0,
    botErr: 0,
    human: false,
    // An online guest's side (THE REMOTE GRACE): its recent reported
    // positions as a ring of (time, s) pairs, allocated once.
    remote: false,
    recent: new Float64Array(RECENT * 2).fill(-1e9),
    recentAt: 0,
  };
}

export function ballCount(n) {
  return n <= 3 ? 1 : n <= 6 ? 2 : 3;
}

export class Match {
  constructor(n, target, random = Math.random) {
    this.n = n;
    this.target = target;
    this.random = random;
    this.sides = [];
    this.winner = -1;
    this.events = [];
    this.powerLevel = 0;
    this.pickups = []; // { def, x, y, age, life }
    this.effects = []; // { def, by, t, dur, data }
    this.spawnIn = 6;
    this.mods = { ballSpeed: 1, ballRadius: 1 };
    this.time = 0;
    if (n === 2) {
      const hw = 0.62, hh = 0.86;
      this.sides.push(side(0, 1, hh, hw, 'goal'));
      this.sides.push(side(1, 0, hw, hh, 'wall'));
      this.sides.push(side(0, -1, hh, hw, 'goal'));
      this.sides.push(side(-1, 0, hw, hh, 'wall'));
      this.radius = Math.hypot(hw, hh);
    } else {
      const a = Math.cos(Math.PI / n), half = Math.sin(Math.PI / n);
      for (let i = 0; i < n; i++) {
        const th = Math.PI / 2 + (2 * Math.PI * i) / n;
        this.sides.push(side(Math.cos(th), Math.sin(th), a, half, 'goal'));
      }
      this.radius = 1;
    }
    this.players = this.sides.filter((s) => s.type === 'goal');
    this.players.forEach((s, i) => (s.player = i));
    this.inradius = Math.min(...this.sides.map((s) => s.a));
    this.balls = [];
    for (let i = 0; i < ballCount(n); i++) {
      const b = this.newBall();
      this.serve(b, 1 + i * 1.4);
      this.balls.push(b);
    }
  }

  newBall() {
    return { x: 0, y: 0, vx: 0, vy: 0, dx: 0, dy: 1, speed: SPEED_START, last: -1, wait: 0, trail: [], extra: false, dead: false };
  }

  /*
   * A second ball from an existing one, for power-ups: same place, same
   * speed and owner, heading turned by `turn` radians. It is `extra`, so it
   * vanishes on its first goal rather than being served again — the number
   * of balls in a match always comes back to ballCount(n).
   */
  addBall(from, turn) {
    const b = this.newBall();
    const c = Math.cos(turn), s = Math.sin(turn);
    b.x = from.x; b.y = from.y;
    b.vx = from.vx * c - from.vy * s;
    b.vy = from.vx * s + from.vy * c;
    b.speed = from.speed; b.last = from.last; b.extra = true;
    this.balls.push(b);
    return b;
  }

  /* The current ball radius, power-ups included. */
  ballR() {
    return BALL_R * this.mods.ballRadius;
  }

  /* The two corners of a side, for drawing. */
  corners(s) {
    const mx = s.ux * s.a, my = s.uy * s.a;
    return [mx - s.tx * s.half, my - s.ty * s.half, mx + s.tx * s.half, my + s.ty * s.half];
  }

  /*
   * The keyboard seats (DESIGN.md §4): player one at the bottom, player two
   * on the side whose normal points most nearly up — the top on an even
   * polygon, the upper-left on an odd one — so left and right still mean
   * left and right on the screen. Never steeper than 60° for any N.
   */
  keySeats() {
    let top = null, bestY = 1;
    for (const s of this.players) if (s.uy < bestY) { bestY = s.uy; top = s; }
    return [this.players[0], top !== this.players[0] ? top : null];
  }

  serve(b, delay) {
    b.x = 0; b.y = 0; b.vx = 0; b.vy = 0;
    b.speed = SPEED_START; b.last = -1; b.wait = delay; b.trail.length = 0;
    const open = this.players.filter((s) => s.seal <= 0);
    const pool = open.length ? open : this.players;
    const to = pool[Math.floor(this.random() * pool.length)];
    const ang = Math.atan2(to.uy, to.ux) + (this.random() - 0.5) * 0.7;
    b.dx = Math.cos(ang); b.dy = Math.sin(ang);
  }

  step(dt, inputs) {
    this.time += dt;
    this.tickEffects(dt);
    for (const s of this.sides) {
      if (s.seal > 0) s.seal = Math.max(0, s.seal - dt);
      s.flash = Math.max(0, s.flash - dt * 3);
      if (s.type === 'goal') this.steer(s, dt, inputs[s.player] || null);
    }
    if (this.winner >= 0) return;
    const bdt = dt * this.mods.ballSpeed;
    for (let i = 0; i < this.balls.length; i++) this.moveBall(this.balls[i], bdt);
    if (this.balls.some((b) => b.dead)) this.balls = this.balls.filter((b) => !b.dead);
    this.tickPickups(dt);
  }

  // ---- power-ups ----------------------------------------------------------

  /* Reset every modifier to neutral, then let each live effect write its own. */
  tickEffects(dt) {
    this.mods.ballSpeed = 1;
    this.mods.ballRadius = 1;
    for (const s of this.sides) { s.mods.hl = 1; s.mods.speed = 1; }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.t += dt;
      if (fx.t >= fx.dur) {
        this.effects.splice(i, 1);
        if (fx.def.end) fx.def.end(this, fx);
        this.events.push({ type: 'powerEnd', id: fx.def.id, by: fx.by, x: fx.x, y: fx.y });
        continue;
      }
      if (fx.def.tick) fx.def.tick(this, fx, dt);
    }
  }

  tickPickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.age += dt;
      if (p.age >= p.life) { this.pickups.splice(i, 1); continue; }
      const r = PICKUP_R + this.ballR();
      for (const b of this.balls) {
        if (b.wait > 0 || b.dead) continue;
        if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 > r * r) continue;
        this.pickups.splice(i, 1);
        this.collect(p, b);
        break;
      }
    }
    const level = Math.max(0, Math.min(4, this.powerLevel | 0));
    if (level === 0) return;
    this.spawnIn = Math.min(this.spawnIn - dt, SPAWN_EVERY[level]);
    if (this.spawnIn > 0) return;
    this.spawnIn = SPAWN_EVERY[level] * (0.75 + this.random() * 0.5);
    if (this.pickups.length < SPAWN_MAX[level]) this.spawn();
  }

  /*
   * A new pickup somewhere in the middle of the field, clear of the serve
   * point, the other pickups, and nudged a little towards whoever is
   * furthest behind (DESIGN.md §3, the quiet catch-up).
   */
  spawn() {
    const ready = POWERUPS.filter((d) => d.ready !== false);
    if (!ready.length) return;
    let total = 0;
    for (const d of ready) total += d.weight || 1;
    let pick = this.random() * total, def = ready[0];
    for (const d of ready) { pick -= d.weight || 1; if (pick <= 0) { def = d; break; } }
    let low = this.players[0];
    for (const s of this.players) if (s.score < low.score) low = s;
    const reach = this.inradius * 0.55;
    for (let tries = 0; tries < 12; tries++) {
      const ang = this.random() * Math.PI * 2;
      const rad = 0.18 + this.random() * (reach - 0.18);
      const x = Math.cos(ang) * rad + low.ux * 0.12;
      const y = Math.sin(ang) * rad + low.uy * 0.12;
      if (this.pickups.some((p) => Math.hypot(p.x - x, p.y - y) < PICKUP_R * 3)) continue;
      this.pickups.push({ def, x, y, age: 0, life: PICKUP_LIFE });
      return;
    }
  }

  /*
   * A ball touched a pickup. It belongs to whoever hit that ball last (-1:
   * nobody; a power-up that needs an owner checks fx.by and does nothing).
   * A timed power-up already running — for anyone if it is `global`, for the
   * same owner if not — is refreshed rather than stacked.
   */
  collect(p, ball) {
    const def = p.def;
    const by = ball.last;
    this.events.push({ type: 'power', id: def.id, by, x: p.x, y: p.y });
    const dur = def.duration || 0;
    if (dur > 0) {
      // A global power-up is one effect whoever collects it; a personal one
      // is one per owner. Either way a repeat refreshes rather than stacks.
      const live = this.effects.find((f) => f.def === def && (def.global || f.by === by));
      if (live) { live.t = 0; return; }
    }
    const fx = { def, by, t: 0, dur, data: {}, x: p.x, y: p.y };
    if (def.collect) def.collect(this, fx, ball);
    if (dur > 0) this.effects.push(fx);
  }

  steer(s, dt, input) {
    const pad = s.pad;
    pad.hl = Math.min(s.half * 0.9, pad.hlBase * s.mods.hl);
    const range = Math.max(0, s.half - pad.hl - 0.02);
    let speed = BOT_SPEED;
    s.human = !!input;
    s.remote = !!(input && input.remote);
    if (input && input.target !== undefined) {
      pad.target = input.target;
      speed = FINGER_SPEED;
      if (s.remote) {
        s.recent[s.recentAt * 2] = this.time;
        s.recent[s.recentAt * 2 + 1] = Math.max(-range, Math.min(range, input.target));
        s.recentAt = (s.recentAt + 1) % RECENT;
      }
    } else if (input && input.axis !== undefined) {
      pad.target = pad.s + input.axis * 0.5;
      speed = KEY_SPEED;
    } else {
      // A bot aims where the soonest incoming ball will cross its line,
      // plus an error rerolled on every paddle hit anywhere.
      let best = Infinity, aim = 0;
      for (const b of this.balls) {
        if (b.wait > 0) continue;
        const vu = b.vx * s.ux + b.vy * s.uy;
        if (vu < 0.05) continue;
        const t = (s.a - (b.x * s.ux + b.y * s.uy)) / vu;
        if (t < best) { best = t; aim = (b.x + b.vx * t) * s.tx + (b.y + b.vy * t) * s.ty; }
      }
      pad.target = best < Infinity ? aim + s.botErr : 0;
    }
    pad.target = Math.max(-range, Math.min(range, pad.target));
    pad.prev = pad.s;
    const d = pad.target - pad.s, stepLen = speed * s.mods.speed * dt;
    pad.s += Math.abs(d) <= stepLen ? d : Math.sign(d) * stepLen;
  }

  moveBall(b, dt) {
    if (b.wait > 0) {
      b.wait -= dt;
      if (b.wait <= 0) { b.vx = b.dx * b.speed; b.vy = b.dy * b.speed; }
      return;
    }
    if (b.dead) return;
    const R = this.ballR();
    b.x += b.vx * dt; b.y += b.vy * dt;
    for (const s of this.sides) {
      const dist = s.a - (b.x * s.ux + b.y * s.uy);
      const vu = b.vx * s.ux + b.vy * s.uy;
      // The paddle only counts while the ball is still in front of the line;
      // once it is half a radius past, it is going in. A remote side has
      // until just before the goal (THE REMOTE GRACE in the header).
      if (s.type === 'goal' && s.seal <= 0 && vu > 0 && dist < R && dist > -R * (s.remote ? LATE_HIT : 0.5)) {
        const sc = b.x * s.tx + b.y * s.ty;
        const at = this.cover(s, sc, R);
        if (at !== null) {
          const pad = s.pad;
          const off = Math.max(-1, Math.min(1, (sc - at) / pad.hl));
          const english = ((pad.s - pad.prev) / dt) * 0.08;
          const ang = Math.max(-1.1, Math.min(1.1, off * MAX_ANGLE + english));
          b.speed = Math.min(SPEED_MAX, b.speed * SPEED_UP);
          const dx = -s.ux * Math.cos(ang) + s.tx * Math.sin(ang);
          const dy = -s.uy * Math.cos(ang) + s.ty * Math.sin(ang);
          b.vx = dx * b.speed; b.vy = dy * b.speed;
          b.x -= s.ux * (R - dist); b.y -= s.uy * (R - dist);
          b.last = s.player;
          s.flash = 1;
          for (const o of this.players) o.botErr = this.botError(o.pad.hl);
          this.events.push({ type: 'hit', player: s.player, x: b.x, y: b.y, nx: -s.ux, ny: -s.uy });
          continue;
        }
      }
      // A shield turns the ball back just behind the paddle line, once.
      if (s.type === 'goal' && s.seal <= 0 && s.shield > 0 && vu > 0 && dist < -R) {
        b.vx -= 2 * vu * s.ux; b.vy -= 2 * vu * s.uy;
        b.x -= s.ux * (-R - dist); b.y -= s.uy * (-R - dist);
        this.antiStall(b, s);
        s.shield--;
        this.events.push({ type: 'shield', side: s.player, x: b.x, y: b.y, nx: -s.ux, ny: -s.uy });
        continue;
      }
      if (s.type === 'goal' && s.seal <= 0 && dist < -R * 3) { this.goal(s, b); return; }
      if (dist >= R || vu <= 0) continue;
      if (s.type === 'wall' || s.seal > 0) {
        b.vx -= 2 * vu * s.ux; b.vy -= 2 * vu * s.uy;
        this.antiStall(b, s);
        this.events.push({ type: 'wall', x: b.x, y: b.y, nx: -s.ux, ny: -s.uy, sealBy: s.seal > 0 ? s.sealBy : -1 });
      }
    }
    b.trail.push(b.x, b.y);
    if (b.trail.length > 28) b.trail.splice(0, 2);
  }

  /*
   * Where along side s the paddle stood that covers a ball at tangent
   * position sc, or null if none did: the paddle as it is now, and for a
   * remote side any position it reported in the last GRACE seconds, the
   * nearest to the ball winning so the bounce angle is the fairest one.
   */
  cover(s, sc, R) {
    const reach = s.pad.hl + R;
    if (Math.abs(sc - s.pad.s) <= reach) return s.pad.s;
    if (!s.remote) return null;
    let best = null, bestD = reach;
    for (let i = 0; i < RECENT; i++) {
      if (this.time - s.recent[i * 2] > GRACE) continue;
      const d = Math.abs(sc - s.recent[i * 2 + 1]);
      if (d <= bestD) { bestD = d; best = s.recent[i * 2 + 1]; }
    }
    return best;
  }

  /*
   * Where a bot will be wrong on its next return: usually a little off
   * centre, which only changes the angle, and one time in eight far enough
   * off to miss outright. Without the clear misses two bots on the 2-sided
   * court rally forever, which hangs the attract mode on that shape.
   */
  botError(hl) {
    if (this.random() < 0.125) return (this.random() < 0.5 ? -1 : 1) * hl * (1.35 + this.random() * 0.5);
    return (this.random() - 0.5) * hl * 1.4;
  }

  antiStall(b, s) {
    const inward = -(b.vx * s.ux + b.vy * s.uy);
    if (inward >= MIN_LEAVE * b.speed) return;
    const along = Math.sign(b.vx * s.tx + b.vy * s.ty) || 1;
    const c = Math.sqrt(1 - MIN_LEAVE * MIN_LEAVE);
    b.vx = (s.tx * along * c - s.ux * MIN_LEAVE) * b.speed;
    b.vy = (s.ty * along * c - s.uy * MIN_LEAVE) * b.speed;
  }

  /*
   * A goal (DESIGN.md §2): a point to the last paddle that touched the ball,
   * unless that was the side it went through or nobody; then the side seals
   * for SEAL_TIME so no second ball walks through the same gap.
   */
  goal(s, b) {
    const scorer = b.last >= 0 && b.last !== s.player ? this.players[b.last] : null;
    if (scorer) {
      scorer.score++;
      scorer.flash = 1;
      if (scorer.score >= this.target) this.winner = scorer.player;
    }
    s.seal = SEAL_TIME;
    s.sealBy = scorer ? scorer.player : -1;
    this.events.push({ type: 'goal', side: s.player, scorer: scorer ? scorer.player : -1, x: b.x, y: b.y, nx: -s.ux, ny: -s.uy });
    if (b.extra) b.dead = true;
    else this.serve(b, SERVE_DELAY);
  }

  /* Which side a point (sim space) belongs to, for touch: its wedge. */
  sideAt(x, y) {
    if (Math.hypot(x, y) < this.inradius * 0.5) return null; // the middle controls nothing
    if (this.n === 2) return y > 0 ? this.sides[0] : this.sides[2];
    let best = null, bestD = -Infinity;
    for (const s of this.sides) {
      const d = (x * s.ux + y * s.uy) / s.a;
      if (d > bestD) { bestD = d; best = s; }
    }
    return best && best.type === 'goal' ? best : null;
  }
}
