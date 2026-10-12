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
 * so the sim never knows about pointers, keys or a release grace.
 *
 * WHAT HAPPENED is reported as events, drained by main.js for sound and
 * sparks: { type: 'hit' | 'wall' | 'goal', ... }. The sim draws nothing.
 */

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

function side(ux, uy, a, half, type) {
  return {
    ux, uy, tx: -uy, ty: ux, a, half, type,
    player: -1,
    pad: { s: 0, prev: 0, target: 0, hl: Math.min(0.14, half * 0.32) },
    seal: 0,
    sealBy: -1, // who scored the goal that sealed it; -1 nobody
    flash: 0,
    score: 0,
    botErr: 0,
    human: false,
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
      const b = { x: 0, y: 0, vx: 0, vy: 0, dx: 0, dy: 1, speed: SPEED_START, last: -1, wait: 0, trail: [] };
      this.serve(b, 1 + i * 1.4);
      this.balls.push(b);
    }
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
    for (const s of this.sides) {
      if (s.seal > 0) s.seal = Math.max(0, s.seal - dt);
      s.flash = Math.max(0, s.flash - dt * 3);
      if (s.type === 'goal') this.steer(s, dt, inputs[s.player] || null);
    }
    if (this.winner >= 0) return;
    for (const b of this.balls) this.moveBall(b, dt);
  }

  steer(s, dt, input) {
    const pad = s.pad;
    const range = s.half - pad.hl - 0.02;
    let speed = BOT_SPEED;
    s.human = !!input;
    if (input && input.target !== undefined) {
      pad.target = input.target;
      speed = FINGER_SPEED;
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
    const d = pad.target - pad.s, stepLen = speed * dt;
    pad.s += Math.abs(d) <= stepLen ? d : Math.sign(d) * stepLen;
  }

  moveBall(b, dt) {
    if (b.wait > 0) {
      b.wait -= dt;
      if (b.wait <= 0) { b.vx = b.dx * b.speed; b.vy = b.dy * b.speed; }
      return;
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    for (const s of this.sides) {
      const dist = s.a - (b.x * s.ux + b.y * s.uy);
      const vu = b.vx * s.ux + b.vy * s.uy;
      if (s.type === 'goal' && s.seal <= 0 && dist < -BALL_R * 3) { this.goal(s, b); return; }
      if (dist >= BALL_R || vu <= 0) continue;
      if (s.type === 'wall' || s.seal > 0) {
        b.vx -= 2 * vu * s.ux; b.vy -= 2 * vu * s.uy;
        this.antiStall(b, s);
        this.events.push({ type: 'wall', x: b.x, y: b.y, nx: -s.ux, ny: -s.uy, sealBy: s.seal > 0 ? s.sealBy : -1 });
        continue;
      }
      const sc = b.x * s.tx + b.y * s.ty, pad = s.pad;
      // The paddle only counts while the ball is still in front of the line;
      // once it is half a radius past, it is going in.
      if (dist > -BALL_R * 0.5 && Math.abs(sc - pad.s) <= pad.hl + BALL_R) {
        const off = Math.max(-1, Math.min(1, (sc - pad.s) / pad.hl));
        const english = ((pad.s - pad.prev) / dt) * 0.08;
        const ang = Math.max(-1.1, Math.min(1.1, off * MAX_ANGLE + english));
        b.speed = Math.min(SPEED_MAX, b.speed * SPEED_UP);
        const dx = -s.ux * Math.cos(ang) + s.tx * Math.sin(ang);
        const dy = -s.uy * Math.cos(ang) + s.ty * Math.sin(ang);
        b.vx = dx * b.speed; b.vy = dy * b.speed;
        b.x -= s.ux * (BALL_R - dist); b.y -= s.uy * (BALL_R - dist);
        b.last = s.player;
        s.flash = 1;
        for (const o of this.players) o.botErr = this.botError(o.pad.hl);
        this.events.push({ type: 'hit', player: s.player, x: b.x, y: b.y, nx: -s.ux, ny: -s.uy });
      }
    }
    b.trail.push(b.x, b.y);
    if (b.trail.length > 28) b.trail.splice(0, 2);
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
    this.serve(b, SERVE_DELAY);
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
