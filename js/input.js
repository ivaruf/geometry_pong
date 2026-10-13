/*
 * input.js — fingers and keys become one input per side (see sim.js: null
 * for a bot, { target } for a finger, { axis } for a key pair).
 *
 * FINGERS (DESIGN.md §4, the tabletop). A finger is given to the side whose
 * wedge it lands in and KEEPS that side until it lifts, even if it slides
 * into a neighbour's wedge, so two people reaching for one corner cannot
 * steal each other's paddle. The newest finger on a side wins; lift it and
 * the side falls back to another finger still resting there. Touches near
 * the middle control nothing, so pointing at the ball moves no paddle.
 * Lift every finger and the paddle holds where it was for RELEASE_GRACE,
 * then a bot takes over. There is no lobby: a finger down is a player.
 *
 * PALMS. A touch the browser reports as very large is ignored, where it
 * reports contact size at all.
 *
 * KEYS. ← → steer the bottom side, A D the side keySeats() picks for player
 * two. Either pair, held, overrides a bot exactly as a finger does, and the
 * grace applies to keys too, so a player who lets go for a breath does not
 * flicker into a bot.
 *
 * Only pointerdowns on the canvas count, so the DOM corner and the cards,
 * which sit above it, never steer anything.
 *
 * ONLINE (DESIGN.md §4, §6) a device has exactly one side, set with
 * reset(match, side): every finger anywhere on the board steers it (there is
 * nobody else at this screen to steal it from, and the middle need not be
 * dead), and BOTH key pairs steer it, left meaning left on the screen as the
 * board has been turned — the side's tangent is put through view.rot before
 * its sign is read. read() still returns one input per player, with null
 * for every side that is not this device's.
 */

const RELEASE_GRACE = 2000; // ms
const PALM_PX = 60;
const KEY_CODES = ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'];

export function createInput(canvas, view) {
  const pointers = new Map(); // id -> { x, y, side }
  const keys = new Set();
  let match = null;
  let live = false; // only while a run is being played
  // per player index: { pointerId, releasedAt, hold }
  let seats = [];
  let only = null; // online: the one side this device steers

  function reset(m, side = null) {
    match = m;
    only = side;
    pointers.clear();
    keys.clear();
    seats = m.players.map(() => ({ pointerId: null, releasedAt: -1e9, hold: 0 }));
  }

  function setLive(on) {
    live = on;
    if (!on) {
      // A pause lifts every finger; a held key would otherwise stick.
      keys.clear();
      for (const [id] of pointers) release(id);
    }
  }

  function release(id) {
    const rec = pointers.get(id);
    pointers.delete(id);
    if (!rec || !rec.side) return;
    const seat = seats[rec.side.player];
    if (!seat || seat.pointerId !== id) return;
    let next = null;
    for (const [pid, r] of pointers) if (r.side === rec.side) next = pid;
    seat.pointerId = next;
    if (next === null) seat.releasedAt = performance.now();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!live || !match) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    const p = view.toSim(e.clientX, e.clientY);
    const rec = { x: p.x, y: p.y, side: null, kind: 'dead' };
    if (e.pointerType === 'touch' && Math.max(e.width || 0, e.height || 0) > PALM_PX) rec.kind = 'palm';
    else {
      const s = only || match.sideAt(p.x, p.y);
      if (s) {
        rec.side = s;
        rec.kind = 'own';
        seats[s.player].pointerId = e.pointerId;
      }
    }
    pointers.set(e.pointerId, rec);
  });
  canvas.addEventListener('pointermove', (e) => {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    const p = view.toSim(e.clientX, e.clientY);
    rec.x = p.x;
    rec.y = p.y;
  });
  canvas.addEventListener('pointerup', (e) => release(e.pointerId));
  canvas.addEventListener('pointercancel', (e) => release(e.pointerId));

  addEventListener('keydown', (e) => {
    if (!live || !KEY_CODES.includes(e.code)) return;
    // A focused field keeps its arrows. Online a focused button does not:
    // the menu panel does not pause there (hub §2), so its buttons may hold
    // focus while the paddle must still answer the keys.
    if (e.target && e.target.closest && e.target.closest(only ? 'input, textarea' : 'input, button, textarea')) return;
    keys.add(e.code);
    e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function keyAxis(s, left, right) {
    const ax = (keys.has(right) ? 1 : 0) - (keys.has(left) ? 1 : 0);
    if (!keys.has(left) && !keys.has(right)) return null;
    // Screen-left is -x, and a side's tangent may point either way along x.
    // Online the board is turned, so the tangent is turned with it first.
    const tx = only ? s.tx * Math.cos(view.rot) - s.ty * Math.sin(view.rot) : s.tx;
    return ax * (Math.sign(tx) || 1);
  }

  /* One input per player for this tick. */
  function read() {
    const now = performance.now();
    const [p1, p2] = match.keySeats();
    return match.players.map((s, i) => {
      const seat = seats[i];
      const rec = seat.pointerId != null ? pointers.get(seat.pointerId) : null;
      if (rec) {
        seat.hold = rec.x * s.tx + rec.y * s.ty;
        seat.releasedAt = now;
        return { target: seat.hold };
      }
      let axis = null;
      if (only) {
        if (s !== only) return null;
        axis = keyAxis(s, 'ArrowLeft', 'ArrowRight');
        if (axis === null) axis = keyAxis(s, 'KeyA', 'KeyD');
      } else if (s === p1) axis = keyAxis(s, 'ArrowLeft', 'ArrowRight');
      else if (s === p2) axis = keyAxis(s, 'KeyA', 'KeyD');
      if (axis !== null) {
        seat.hold = s.pad.s;
        seat.releasedAt = now;
        return { axis };
      }
      if (now - seat.releasedAt < RELEASE_GRACE) return { target: seat.hold };
      return null;
    });
  }

  return { reset, setLive, read };
}
