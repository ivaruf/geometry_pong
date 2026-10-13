/*
 * protocol.js — what goes on the wire, and what is allowed in off it.
 *
 * Copied from NeonFox's js/net/protocol.js and cut to this game. Two lanes,
 * and the split is the whole design (hub CLAUDE.md §8):
 *
 *   reliable + ordered   joins, the roster, BEGIN, the sim's events (hits,
 *                        goals, pickups: sounds and sparks), pings. Each is a
 *                        discrete thing that happened once.
 *   unreliable, 0 retx   the host's state frame and the guest's paddle
 *                        position. Both are superseded sixty times a second,
 *                        so a late one is worthless and a retransmit only
 *                        buys latency.
 *
 * Nothing discrete ever goes on the lossy lane. If you can lose it without
 * noticing, it is binary and fast; if you cannot, it is JSON and reliable.
 *
 * THE STATE FRAME IS THE WHOLE BOARD, every time. Pong has nothing that only
 * grows (NeonFox's trails) and nothing big (fishtank's tank): at most eight
 * paddles, a handful of balls, a few pickups and live effects. So there is no
 * delta and no catch-up message — a guest that joins mid-match is whole on
 * the first frame it decodes. Sizes are measured in docs/P2P.md.
 *
 * The frame number is a counter the host's worker owns for the life of a
 * session, never the sim's own clock — NeonFox's lesson: a queue that drops
 * anything not newer stalls at the first reset of a counter that resets. The
 * roster version (one byte) changes with every seat change and every match
 * start, so a frame packed for the last match, or for a different number of
 * sides, is dropped instead of being decoded into the wrong board.
 *
 * LANGUAGE NEVER TRAVELS (hub §2). Refusals carry a reason code, events carry
 * a type and numbers, power-ups an id; each device says them in its own
 * language.
 */

import { POWERUPS } from '../powerups/index.js';

// 1 since 2026-10-13, the first online build.
export const NET_VERSION = 1;

/* Reliable lane, JSON. The host is authoritative for every one of these. */
export const MSG = Object.freeze({
  HELLO: 'HELLO', // guest -> host: my build
  WELCOME: 'WELCOME', // host -> guest: your seat, the room's rules, the roster
  REFUSED: 'REFUSED', // host -> guest: full, or a different build
  ROSTER: 'ROSTER', // host -> guest: who sits where changed
  BEGIN: 'BEGIN', // host -> guest: a match starts (also a rematch)
  LOBBY: 'LOBBY', // host -> guest: the host went back to the room
  EVENTS: 'EVENTS', // host -> guest: what the sim reported, for sound and sparks
  PING: 'PING', // guest -> host, echoed back as PONG: the round trip
  PONG: 'PONG',
  BYE: 'BYE', // either way: I am leaving, and why (a code)
});

/* Lossy lane, binary: the first byte says which. */
export const KIND_FRAME = 1;
export const KIND_POS = 2;

const POS = 16000; // positions and paddle lengths: ±2.05 units at 1/16000
const VEL = 8000; // velocities: ±4.1 units/s; the top speed is 1.9
const TIME = 1000; // effect and pickup clocks at a millisecond, up to 65 s
const NUM = 1000; // a power-up's packed numbers: ±32.7 at 1/1000
const MAX_NUMS = 40;

const clampI16 = (v) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);
const clampU16 = (v) => (v > 65535 ? 65535 : v < 0 ? 0 : v);
const clampU8 = (v) => (v > 255 ? 255 : v < 0 ? 0 : v);
const i16 = (v, scale) => clampI16(Math.round((Number.isFinite(v) ? v : 0) * scale));
const u16 = (v, scale) => clampU16(Math.round((Number.isFinite(v) ? v : 0) * scale));
const u8 = (v, scale) => clampU8(Math.round((Number.isFinite(v) ? v : 0) * scale));

const DEF_INDEX = new Map(POWERUPS.map((d, i) => [d, i]));

/* ---------------------------------------------------------------- frame --- */

/*
 * Everything a guest draws, nothing it could steer with. Layout:
 *
 *   header   10  kind, roster version, frame u32, winner+1, ballSpeed and
 *                ballRadius at 1/100, player count
 *   player    9  paddle s and half length, seal (1/100 s), sealBy, score,
 *                flags (human, shield count)
 *   balls     1 + 12 each: x, y, vx, vy — or, while waiting to be served,
 *                the serve direction in vx, vy — last hitter, flags, wait
 *   pickups   1 + 7 each: power-up index, x, y, age
 *   effects   1 + 11 each + 2 a packed number: index, owner, t, dur, x, y,
 *                and the power-up's own pack() (ARCHITECTURE.md)
 */
export function packFrame(match, frameNo, version) {
  let size = 10 + match.players.length * 9 + 3 + match.balls.length * 12 + match.pickups.length * 7;
  const packed = match.effects.map((fx) => {
    let nums = [];
    if (fx.def.pack) {
      try {
        nums = fx.def.pack(match, fx) || [];
      } catch {
        nums = [];
      }
    }
    return nums.slice(0, MAX_NUMS);
  });
  for (const nums of packed) size += 11 + nums.length * 2;
  const bytes = new Uint8Array(size);
  const v = new DataView(bytes.buffer);
  v.setUint8(0, KIND_FRAME);
  v.setUint8(1, version & 0xff);
  v.setUint32(2, frameNo >>> 0);
  v.setUint8(6, match.winner + 1);
  v.setUint8(7, u8(match.mods.ballSpeed, 100));
  v.setUint8(8, u8(match.mods.ballRadius, 100));
  v.setUint8(9, match.players.length);
  let o = 10;
  for (const s of match.players) {
    v.setInt16(o, i16(s.pad.s, POS));
    v.setInt16(o + 2, i16(s.pad.hl, POS));
    v.setUint8(o + 4, u8(s.seal, 100));
    v.setInt8(o + 5, s.sealBy);
    v.setUint8(o + 6, clampU8(s.score));
    v.setUint8(o + 7, (s.human ? 1 : 0) | (Math.min(7, Math.max(0, s.shield | 0)) << 1));
    v.setUint8(o + 8, 0); // spare, so a player is a round nine bytes
    o += 9;
  }
  v.setUint8(o++, match.balls.length);
  for (const b of match.balls) {
    const waiting = b.wait > 0;
    v.setInt16(o, i16(b.x, POS));
    v.setInt16(o + 2, i16(b.y, POS));
    v.setInt16(o + 4, i16(waiting ? b.dx : b.vx, VEL));
    v.setInt16(o + 6, i16(waiting ? b.dy : b.vy, VEL));
    v.setInt8(o + 8, b.last);
    v.setUint8(o + 9, (waiting ? 1 : 0) | (b.extra ? 2 : 0));
    v.setUint16(o + 10, u16(Math.max(0, b.wait), TIME));
    o += 12;
  }
  v.setUint8(o++, match.pickups.length);
  for (const p of match.pickups) {
    v.setUint8(o, DEF_INDEX.get(p.def) ?? 255);
    v.setInt16(o + 1, i16(p.x, POS));
    v.setInt16(o + 3, i16(p.y, POS));
    v.setUint16(o + 5, u16(p.age, TIME));
    o += 7;
  }
  v.setUint8(o++, match.effects.length);
  match.effects.forEach((fx, i) => {
    const nums = packed[i];
    v.setUint8(o, DEF_INDEX.get(fx.def) ?? 255);
    v.setInt8(o + 1, fx.by);
    v.setUint16(o + 2, u16(fx.t, TIME));
    v.setUint16(o + 4, u16(fx.dur, TIME));
    v.setInt16(o + 6, i16(fx.x, POS));
    v.setInt16(o + 8, i16(fx.y, POS));
    v.setUint8(o + 10, nums.length);
    o += 11;
    for (const n of nums) {
      v.setInt16(o, i16(n, NUM));
      o += 2;
    }
  });
  return bytes;
}

/*
 * The other end. Returns null for anything that does not parse — a short
 * frame, an index past the end of a list — rather than a half-decoded board.
 * Power-up indices are looked up here, so a guest only ever holds real
 * definitions.
 */
export function unpackFrame(bytes) {
  try {
    if (bytes.length < 10 || bytes[0] !== KIND_FRAME) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frame = {
      version: v.getUint8(1),
      frameNo: v.getUint32(2),
      winner: v.getUint8(6) - 1,
      ballSpeed: v.getUint8(7) / 100,
      ballRadius: v.getUint8(8) / 100,
      players: [],
      balls: [],
      pickups: [],
      effects: [],
    };
    const n = v.getUint8(9);
    let o = 10;
    for (let i = 0; i < n; i++) {
      const flags = v.getUint8(o + 7);
      frame.players.push({
        s: v.getInt16(o) / POS,
        hl: v.getInt16(o + 2) / POS,
        seal: v.getUint8(o + 4) / 100,
        sealBy: v.getInt8(o + 5),
        score: v.getUint8(o + 6),
        human: (flags & 1) !== 0,
        shield: flags >> 1,
      });
      o += 9;
    }
    const nb = v.getUint8(o++);
    for (let i = 0; i < nb; i++) {
      const flags = v.getUint8(o + 9);
      frame.balls.push({
        x: v.getInt16(o) / POS,
        y: v.getInt16(o + 2) / POS,
        vx: v.getInt16(o + 4) / VEL,
        vy: v.getInt16(o + 6) / VEL,
        last: v.getInt8(o + 8),
        waiting: (flags & 1) !== 0,
        extra: (flags & 2) !== 0,
        wait: v.getUint16(o + 10) / TIME,
      });
      o += 12;
    }
    const np = v.getUint8(o++);
    for (let i = 0; i < np; i++) {
      const def = POWERUPS[v.getUint8(o)];
      if (def) frame.pickups.push({ def, x: v.getInt16(o + 1) / POS, y: v.getInt16(o + 3) / POS, age: v.getUint16(o + 5) / TIME });
      o += 7;
    }
    const nf = v.getUint8(o++);
    for (let i = 0; i < nf; i++) {
      const def = POWERUPS[v.getUint8(o)];
      const fx = {
        def,
        by: v.getInt8(o + 1),
        t: v.getUint16(o + 2) / TIME,
        dur: v.getUint16(o + 4) / TIME,
        x: v.getInt16(o + 6) / POS,
        y: v.getInt16(o + 8) / POS,
        nums: [],
      };
      const k = v.getUint8(o + 10);
      o += 11;
      for (let j = 0; j < k; j++) {
        fx.nums.push(v.getInt16(o) / NUM);
        o += 2;
      }
      if (def) frame.effects.push(fx);
    }
    return frame;
  } catch {
    return null; // ran off the end: a truncated or foreign frame
  }
}

/* ------------------------------------------------------------- position --- */

/*
 * A guest's own paddle, where it has already drawn it (DESIGN.md §6). The
 * sequence number is there because the lossy lane is also unordered: a
 * position that arrives after a newer one must not drag the paddle back.
 */
export function packPos(seq, s) {
  const bytes = new Uint8Array(5);
  const v = new DataView(bytes.buffer);
  v.setUint8(0, KIND_POS);
  v.setUint16(1, seq & 0xffff);
  v.setInt16(3, i16(s, POS));
  return bytes;
}

export function unpackPos(bytes) {
  if (bytes.length < 5 || bytes[0] !== KIND_POS) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { seq: v.getUint16(1), s: v.getInt16(3) / POS };
}

/* Is sequence a newer than b, across the 16-bit wrap? */
export const newer = (a, b) => ((a - b) & 0xffff) !== 0 && ((a - b) & 0xffff) < 0x8000;

/* ----------------------------------------------------------- validation --- */

/*
 * A guest says exactly one thing that reaches the sim: where its own paddle
 * is. It arrives as a number off a wire and is distrusted: non-finite becomes
 * nothing at all (the paddle holds), and anything else is clamped to the
 * side's travel here and then followed at no more than a finger's speed by
 * the sim (js/sim.js steer), which is the "clamped to the paddle's maximum
 * speed since the last one" of DESIGN.md §6. There is no field in which a
 * guest could claim a ball, a score or a seat.
 */
export function cleanPos(s, range) {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(-range, Math.min(range, n));
}

/*
 * The sim's events, as the host relays them for sound and sparks. A guest
 * only passes on the types it knows, with finite numbers, so a malformed one
 * cannot reach the renderer. The host is trusted to be the host; this is
 * about old builds and bugs, not about cheating.
 */
const EVENT_TYPES = new Set(['hit', 'wall', 'goal', 'shield', 'power', 'powerEnd', 'bump']);
const POWER_IDS = new Set(POWERUPS.map((d) => d.id));
export function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !EVENT_TYPES.has(e.type)) return null;
  const out = { type: e.type };
  for (const k of ['player', 'side', 'scorer', 'by', 'sealBy', 'x', 'y', 'nx', 'ny']) {
    if (k in e) {
      const n = Number(e[k]);
      if (!Number.isFinite(n)) return null;
      out[k] = n;
    }
  }
  if (e.id !== undefined) {
    if (!POWER_IDS.has(e.id)) return null;
    out.id = e.id;
  }
  if (e.type === 'bump' && typeof e.colour === 'string' && /^#[0-9a-f]{6}$/i.test(e.colour)) out.colour = e.colour;
  return out;
}

/* The room's rules, as a guest is told them: clamped, since they came over a wire. */
export function cleanRules(r) {
  const int = (x, lo, hi, d) => {
    const n = Math.floor(Number(x));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  return {
    sides: int(r && r.sides, 2, 8, 4),
    target: int(r && r.target, 1, 99, 10),
    power: int(r && r.power, 0, 4, 0),
  };
}
