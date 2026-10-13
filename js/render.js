/*
 * render.js — draws a Match onto the canvas. Reads the sim, never writes it.
 *
 * THE LOOK (DESIGN.md §5): neon geometry on black. Every shape is a stroked
 * line drawn three times — wide and faint, medium, thin and bright — with
 * 'lighter' compositing, so crossing light adds up. No shadowBlur: that is
 * the slow path on an old tablet, and this already ran smooth on a very old
 * Android pad with six fingers down.
 *
 * THE VIEW. One transform at the top of the draw: centre, scale, and a
 * rotation. The rotation is the tabletop's "keep the board fixed to the
 * glass": main.js counter-rotates by however far the device has turned since
 * the match began, so a bumped tablet that flips orientation does not move
 * everybody's side to somebody else. view.toSim() undoes the same transform
 * for input.
 *
 * THE RIM. The arena is inset (RIM, in sim units) so a finger can rest
 * outside the play field without covering the ball, and each side's score
 * and name live in that rim, rotated to face the person sitting there.
 *
 * Sparks are this file's own: main.js feeds it the sim's events.
 */

import { COLORS, GLYPHS, SERVE_DELAY, PICKUP_R } from './sim.js';
import { t, getLang } from './i18n.js';
import { POWERUPS } from './powerups/index.js';

const DEF = Object.fromEntries(POWERUPS.map((d) => [d.id, d]));
const TOAST_TIME = 2.2;

/*
 * THE PIXEL LAYER. Power-ups get a look of their own on top of the neon: a
 * chunky pixel-art badge on the field, and pixel explosions when one is
 * collected, runs out, or does something (a shield turning a ball, a bumper
 * kicking one). Everything else in the game stays smooth light, so a square
 * pixel always means "a power-up did that".
 *
 * The badge is drawn into one shared offscreen canvas — rim, bevel, dark
 * core, a fine inner line, and the power-up's own glyph() with a slightly
 * heavier stroke — at exactly the size it lands on screen, device pixels and
 * all, so it is crisp. (It was once drawn at 20 px and blown up with
 * smoothing off; the owner found that too pixelated for the symbols, so the
 * pixels now belong to the sparkles and the explosions only.) The shared
 * frame is what makes ten glyphs from different hands read as one family.
 * One canvas, resized only when the screen is, reused for each pickup in
 * turn: nothing allocated.
 *
 * Explosion pixels snap to a grid of CELL CSS pixels, so they move in steps
 * the way an old arcade sprite does.
 */
const CELL = 4; // CSS pixels per explosion pixel

export const RIM = 0.32;

export function createView(canvas) {
  const view = {
    W: 0, H: 0, dpr: 1, scale: 1, cx: 0, cy: 0, rot: 0, radius: 1,
    resize() {
      view.dpr = Math.min(2, window.devicePixelRatio || 1);
      view.W = innerWidth;
      view.H = innerHeight;
      canvas.width = Math.round(view.W * view.dpr);
      canvas.height = Math.round(view.H * view.dpr);
      view.cx = view.W / 2;
      view.cy = view.H / 2;
      view.scale = Math.min(view.W, view.H) / 2 / (view.radius + RIM);
    },
    toSim(px, py) {
      const x = (px - view.cx) / view.scale, y = (py - view.cy) / view.scale;
      const c = Math.cos(-view.rot), s = Math.sin(-view.rot);
      return { x: x * c - y * s, y: x * s + y * c };
    },
  };
  return view;
}

export function createRenderer(canvas, view) {
  const ctx = canvas.getContext('2d');
  const sparks = [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let shake = 0;
  // The power-up's name, shown on the collector's rim line for a moment.
  const toasts = new Map(); // player index -> { text, colour, t }
  const pix = []; // explosion pixels { x, y, vx, vy, life, max, colour, size }
  const rings = []; // pixel shockwaves { x, y, r, vr, life, max, colour }
  let flash = null; // { colour, t } a moment of colour over the whole board
  const badge = document.createElement('canvas');
  const bctx = badge.getContext('2d');

  /* A pixel explosion: power ~0.4 for a bump, ~1.3 for a pickup. */
  function blast(x, y, colour, power, withFlash) {
    let count = Math.round(30 * power);
    if (reduced.matches) count = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.25 + Math.random() * 0.9) * power;
      const life = 0.35 + Math.random() * 0.5;
      pix.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life,
        colour: Math.random() < 0.25 ? '#ffffff' : colour,
        size: Math.random() < 0.3 * power ? 2 : 1,
      });
    }
    if (pix.length > 400) pix.splice(0, pix.length - 400);
    rings.push({ x, y, r: 0.02, vr: 0.75 * power + 0.2, life: 0.45, max: 0.45, colour });
    if (power > 1) rings.push({ x, y, r: 0.01, vr: 0.4 * power, life: 0.6, max: 0.6, colour: '#ffffff' });
    if (withFlash && !reduced.matches) flash = { colour, t: 0.18 };
  }

  function spark(e) {
    if (e.type === 'power') {
      const def = DEF[e.id];
      const colour = (def && def.colour) || '#ffffff';
      if (def && e.by >= 0) toasts.set(e.by, { text: def.name[getLang()] || def.name.en, colour, t: TOAST_TIME });
      blast(e.x, e.y, colour, 1.3, true);
      return;
    }
    if (e.type === 'powerEnd') {
      // A small puff where it was picked up: it is over.
      const def = DEF[e.id];
      if (e.x !== undefined) blast(e.x, e.y, (def && def.colour) || '#ffffff', 0.45, false);
      return;
    }
    if (e.type === 'shield') { blast(e.x, e.y, '#bfefff', 0.9, false); return; }
    if (e.type === 'bump') { blast(e.x, e.y, e.colour || '#ffffff', 0.4, false); return; }
    if (!e.nx && !e.ny) { burst(e.x, e.y, e.colour || '#ffffff', 8); return; }
    const color = e.type === 'shield' ? '#bfefff' : e.type === 'hit' ? COLORS[e.player]
      : e.type === 'goal' ? (e.scorer >= 0 ? COLORS[e.scorer] : '#ffffff')
      : e.sealBy >= 0 ? COLORS[e.sealBy] : '#9aa4c4';
    let count = e.type === 'goal' ? 30 : e.type === 'hit' ? 10 : 4;
    if (reduced.matches) count = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(e.ny, e.nx) + (Math.random() - 0.5) * 1.6;
      const v = 0.3 + Math.random() * 0.9;
      sparks.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, color });
    }
    if (sparks.length > 300) sparks.splice(0, sparks.length - 300);
    if (e.type === 'goal' && !reduced.matches) shake = 0.25;
  }

  // Sparks in every direction, for things that happen in the open field.
  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.2 + Math.random() * 0.7;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, color });
    }
    if (sparks.length > 300) sparks.splice(0, sparks.length - 300);
  }

  /*
   * One power-up's badge into the shared offscreen canvas: a pointy hexagon
   * with a two-pixel rim in its colour, a lit bevel on the upper-left edges,
   * a dark core with a faint tint, and its glyph on top. Drawn every frame
   * because glyphs animate; at 20×20 that costs next to nothing.
   */
  function drawBadge(def, colour, time, N) {
    if (badge.width !== N) badge.width = badge.height = N;
    const b = bctx, c = N / 2;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.globalAlpha = 1;
    b.clearRect(0, 0, N, N);
    const hex = (r) => {
      b.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 3;
        if (k) b.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
        else b.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      }
      b.closePath();
    };
    const R = N / 2 - 1;
    const rim = Math.max(2, N * 0.09);
    hex(R);
    b.fillStyle = colour;
    b.fill();
    // The bevel: the three upper-left edges a step lighter.
    b.save();
    b.beginPath();
    b.moveTo(0, 0); b.lineTo(N, 0); b.lineTo(0, N); b.closePath();
    b.clip();
    hex(R);
    b.fillStyle = 'rgba(255,255,255,0.55)';
    b.fill();
    b.restore();
    hex(R - rim);
    b.fillStyle = '#0a0c16';
    b.fill();
    b.globalAlpha = 0.2;
    b.fillStyle = colour;
    b.fill();
    // A fine line just inside the rim: the clean edge of the core.
    hex(R - rim * 1.8);
    b.globalAlpha = 0.45;
    b.strokeStyle = colour;
    b.lineWidth = Math.max(1, N * 0.025);
    b.stroke();
    b.globalAlpha = 1;
    if (def.glyph) {
      b.translate(c, c);
      b.lineCap = 'round';
      b.lineJoin = 'round';
      // px is one CSS pixel in badge pixels, a little over, so every
      // glyph's strokes come out bolder than its own author drew them.
      def.glyph(b, N * 0.24, time, (N / 20) * 0.72);
    }
  }

  function line(x1, y1, x2, y2, color, width, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function glowLine(x1, y1, x2, y2, color, w, alpha = 1) {
    line(x1, y1, x2, y2, color, w * 4, 0.12 * alpha);
    line(x1, y1, x2, y2, color, w * 2, 0.25 * alpha);
    line(x1, y1, x2, y2, color, w, alpha);
  }

  function glyph(kind, x, y, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = r * 0.28;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    const poly = (k, rot) => {
      for (let i = 0; i <= k; i++) {
        const a = rot + (i * 2 * Math.PI) / k;
        if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
    };
    if (kind === 'circle') ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    else if (kind === 'ring') {
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      ctx.moveTo(x + r * 0.35, y);
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
    } else if (kind === 'tri') poly(3, -Math.PI / 2);
    else if (kind === 'square') poly(4, Math.PI / 4);
    else if (kind === 'diamond') poly(4, 0);
    else if (kind === 'hex') poly(6, 0);
    else if (kind === 'plus') {
      ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
    } else if (kind === 'star') {
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
        if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
    }
    ctx.stroke();
  }

  /*
   * opts.labels: draw the rim labels (scores, "robot", winner) — off in the
   * attract mode behind the title, where they would be noise.
   */
  function draw(m, time, dt, opts) {
    const { W, H, dpr, scale, cx, cy } = view;
    const px = 1 / scale;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i];
      sp.life -= dt; sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vx *= 0.96; sp.vy *= 0.96;
      if (sp.life <= 0) sparks.splice(i, 1);
    }
    shake = Math.max(0, shake - dt);
    for (let i = pix.length - 1; i >= 0; i--) {
      const p = pix[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
      if (p.life <= 0) pix.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt; r.r += r.vr * dt;
      if (r.life <= 0) rings.splice(i, 1);
    }
    if (flash && (flash.t -= dt) <= 0) flash = null;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#06070c';
    ctx.fillRect(0, 0, W, H);
    const jx = shake ? (Math.random() - 0.5) * shake * 16 : 0;
    const jy = shake ? (Math.random() - 0.5) * shake * 16 : 0;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (cx + jx), dpr * (cy + jy));
    ctx.rotate(view.rot);
    ctx.lineCap = 'round';

    // Backdrop: echoes of the arena's own shape, drifting.
    for (let k = 1; k <= 3; k++) {
      const sc = 1 + k * 0.28;
      const rot = reduced.matches ? 0 : time * 0.03 * (k % 2 ? 1 : -1);
      ctx.save();
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      ctx.globalAlpha = 0.07 / k;
      ctx.strokeStyle = '#5a6aa8';
      ctx.lineWidth = px / sc;
      ctx.beginPath();
      m.sides.forEach((s, i) => {
        const v = m.corners(s);
        if (i) ctx.lineTo(v[0], v[1]);
        else ctx.moveTo(v[0], v[1]);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalCompositeOperation = 'lighter';

    for (const s of m.sides) {
      const v = m.corners(s);
      if (s.type === 'wall') {
        line(v[0], v[1], v[2], v[3], '#3a4260', 6 * px, 1);
        continue;
      }
      const col = COLORS[s.player];
      line(v[0], v[1], v[2], v[3], col, 2 * px, 0.35 + s.flash * 0.4);
      // The seal: a barrier in the scorer's colour, opening from the middle
      // in its last third of a second so the moment it is live is visible.
      if (s.seal > 0) {
        const a = Math.min(1, s.seal * 2);
        const open = Math.max(0, 1 - s.seal / 0.35);
        const mx = s.ux * s.a, my = s.uy * s.a;
        const sc = s.sealBy >= 0 ? COLORS[s.sealBy] : '#ffffff';
        for (const dir of [-1, 1]) {
          glowLine(
            mx + s.tx * s.half * dir * open, my + s.ty * s.half * dir * open,
            mx + s.tx * s.half * dir, my + s.ty * s.half * dir,
            sc, 4 * px, a,
          );
        }
      }
      const p = s.pad, inset = 0.018;
      const bx = s.ux * (s.a - inset), by = s.uy * (s.a - inset);
      glowLine(
        bx + s.tx * (p.s - p.hl), by + s.ty * (p.s - p.hl),
        bx + s.tx * (p.s + p.hl), by + s.ty * (p.s + p.hl),
        col, 6 * px, s.seal > 0 ? 0.35 : 1,
      );
    }

    // Serve telegraphs.
    if (m.winner < 0) {
      for (const b of m.balls) {
        if (b.wait <= 0 || b.wait > SERVE_DELAY) continue;
        const len = 0.22 * (1 - b.wait / SERVE_DELAY) + 0.05;
        line(0, 0, b.dx * len, b.dy * len, '#ffffff', 2 * px, 0.6);
      }
    }

    // Pickups: crisp badges (see THE PIXEL LAYER above) that bob in whole
    // explosion pixels, with three sparkle pixels circling. They fade in, and
    // blink through their last two seconds.
    const cell = CELL * px;
    const snap = (v) => Math.round(v / cell) * cell;
    for (const p of m.pickups) {
      const def = p.def;
      const colour = def.colour || '#ffffff';
      const fade = Math.min(1, p.age / 0.3);
      const left = p.life - p.age;
      const blink = left < 2 ? (Math.cos(time * 14) > -0.3 ? 1 : 0.25) : 1;
      const size = PICKUP_R * 2.3;
      const bob = snap(Math.sin(time * 3 + p.x * 9) * cell * 1.5);
      // Drawn at its on-screen size in device pixels, so it lands 1:1.
      drawBadge(def, colour, time, Math.max(16, Math.round(size * view.scale * view.dpr)));
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = fade * blink;
      ctx.drawImage(badge, snap(p.x - size / 2), snap(p.y - size / 2) + bob, size, size);
      ctx.restore();
      ctx.fillStyle = colour;
      for (let k = 0; k < 3; k++) {
        const a = time * 2.2 + (k * Math.PI * 2) / 3;
        ctx.globalAlpha = (0.5 + 0.5 * Math.sin(time * 9 + k * 2)) * fade * blink;
        ctx.fillRect(snap(p.x + Math.cos(a) * size * 0.66), snap(p.y + Math.sin(a) * size * 0.66) + bob, cell, cell);
      }
    }

    // Effects that show while they last (ripples, wells, bumpers…).
    for (const fx of m.effects) {
      if (!fx.def.draw) continue;
      ctx.save();
      ctx.globalAlpha = 1;
      fx.def.draw(ctx, m, fx, time, px);
      ctx.restore();
    }

    // Balls wear their last hitter's colour: who a goal will score for.
    const BALL_R = m.ballR();
    for (const b of m.balls) {
      if (b.wait > 0) continue;
      const col = b.last >= 0 ? COLORS[b.last] : '#ffffff';
      const n = b.trail.length;
      for (let i = 2; i < n; i += 2) {
        line(b.trail[i - 2], b.trail[i - 1], b.trail[i], b.trail[i + 1], col, BALL_R * 1.6 * (i / n), 0.25 * (i / n));
      }
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const [k, toast] of toasts) {
      toast.t -= dt;
      if (toast.t <= 0) toasts.delete(k);
    }

    for (const sp of sparks) {
      ctx.globalAlpha = Math.max(0, Math.min(1, sp.life * 1.6));
      ctx.fillStyle = sp.color;
      ctx.fillRect(sp.x - px * 1.5, sp.y - px * 1.5, px * 3, px * 3);
    }

    // The pixel layer's explosions: shockwave rings laid down a pixel at a
    // time, then the pixels themselves, white for their first instant.
    for (const r of rings) {
      const n = Math.max(12, Math.min(160, Math.ceil((Math.PI * 2 * r.r) / cell)));
      ctx.globalAlpha = 0.85 * (r.life / r.max);
      ctx.fillStyle = r.colour;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.fillRect(snap(r.x + Math.cos(a) * r.r), snap(r.y + Math.sin(a) * r.r), cell, cell);
      }
    }
    for (const p of pix) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.4);
      ctx.fillStyle = p.max - p.life < 0.06 ? '#ffffff' : p.colour;
      const sz = cell * p.size;
      ctx.fillRect(snap(p.x) - (p.size - 1) * cell * 0.5, snap(p.y) - (p.size - 1) * cell * 0.5, sz, sz);
    }
    if (flash) {
      ctx.globalAlpha = 0.14 * (flash.t / 0.18);
      ctx.fillStyle = flash.colour;
      ctx.beginPath();
      ctx.arc(0, 0, m.radius + 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    if (opts.labels) drawLabels(m, time);

    if (m.winner >= 0 && opts.labels) {
      ctx.globalCompositeOperation = 'lighter';
      const col = COLORS[m.winner];
      const r = 0.18 + 0.03 * Math.sin(time * 4);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col;
      ctx.lineWidth = 6 * px;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      glyph(GLYPHS[m.winner], 0, 0, 0.08, col);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // Each side's score, glyph and a line of words, facing that side's seat.
  function drawLabels(m, time) {
    const font = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    for (const s of m.players) {
      const col = COLORS[s.player];
      const lx = s.ux * (s.a + RIM * 0.42), ly = s.uy * (s.a + RIM * 0.42);
      ctx.save();
      ctx.translate(lx, ly);
      // Text "up" must point at the centre for the person sitting outside.
      ctx.rotate(Math.atan2(s.uy, s.ux) - Math.PI / 2);
      ctx.globalAlpha = 1;
      glyph(GLYPHS[s.player], -0.11, 0, 0.026, col);
      ctx.fillStyle = col;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `700 0.085px ${font}`;
      ctx.fillText(String(s.score), -0.065, 0.004);
      ctx.font = `600 0.03px ${font}`;
      let label;
      if (m.winner === s.player) {
        label = t('rim.winner');
        ctx.globalAlpha = 1;
      } else if (s.human) {
        label = t('rim.firstTo', m.target);
        ctx.globalAlpha = 0.75;
      } else {
        label = t('rim.bot');
        ctx.globalAlpha = 0.45 + 0.3 * Math.sin(time * 3);
      }
      const toast = toasts.get(s.player);
      if (toast && m.winner < 0) {
        label = toast.text;
        ctx.fillStyle = toast.colour;
        ctx.font = `800 0.036px ${font}`;
        ctx.globalAlpha = Math.min(1, toast.t / 0.4);
      }
      ctx.fillText(label, 0.02, 0.004);
      ctx.fillStyle = col;
      ctx.font = `600 0.03px ${font}`;
      if (m.target - s.score === 1 && m.winner < 0) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 5);
        ctx.fillText(t('rim.oneToGo'), 0.02, 0.045);
      }
      ctx.restore();
    }
  }

  return { draw, spark };
}
