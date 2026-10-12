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

import { COLORS, GLYPHS, BALL_R, SERVE_DELAY } from './sim.js';
import { t } from './i18n.js';

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

  function spark(e) {
    const color = e.type === 'hit' ? COLORS[e.player]
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

    // Balls wear their last hitter's colour: who a goal will score for.
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

    for (const sp of sparks) {
      ctx.globalAlpha = Math.max(0, Math.min(1, sp.life * 1.6));
      ctx.fillStyle = sp.color;
      ctx.fillRect(sp.x - px * 1.5, sp.y - px * 1.5, px * 3, px * 3);
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
      ctx.fillText(label, 0.02, 0.004);
      if (m.target - s.score === 1 && m.winner < 0) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 5);
        ctx.fillText(t('rim.oneToGo'), 0.02, 0.045);
      }
      ctx.restore();
    }
  }

  return { draw, spark };
}
