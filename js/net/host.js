/*
 * host.js — the authoritative peer.
 *
 * NeonFox's host (its js/net/host.js), cut to this game. One player runs the
 * simulation, in a Web Worker, and everybody else sends their own paddle and
 * draws what comes back: a host-authoritative star, never a mesh (hub
 * CLAUDE.md §8). Snapshots and not lockstep, for NeonFox's measured reason —
 * Math.cos and Math.sin differ in the last bit between Chrome and Safari, and
 * a bounce angle is a cos — and this game's expected room is a laptop and an
 * iPad (DESIGN.md §6).
 *
 * SIDES ARE SEATS. The host sits on player 0, which is the bottom side
 * already, so its board does not turn. Every other side is a bot until a
 * guest takes it, and goes back to being a bot the moment that guest leaves
 * — never a hole, so a dropped connection does not hand everyone a free goal.
 * A guest may join while a match is running: it takes a bot's side, and the
 * next frame it decodes is the whole board, because the frame always is.
 * Seats are handed out spread round the table rather than in a row, so the
 * first guest on a hexagon sits opposite the host.
 *
 * WHAT THIS FILE DOES NOT KNOW. WebRTC: it talks to "channels" (send(value,
 * fast), onMessage, onClose), which is what makes the two-tab
 * BroadcastChannel path a real test of this code.
 */

import { MSG, NET_VERSION, KIND_POS, unpackPos, unpackFrame, cleanPos, newer } from './protocol.js';
import { createShadow } from './shadow.js';
import { hostRendezvous } from './rendezvous.js';
import { newCode } from './codes.js';
import { Match } from '../sim.js';

/* Seats in the order they are handed out: each next one as far round the
 * table from those already taken as it can be. */
function spreadOrder(count) {
  const taken = [0];
  while (taken.length < count) {
    let best = -1, bestD = -1;
    for (let i = 0; i < count; i++) {
      if (taken.includes(i)) continue;
      let d = Infinity;
      for (const j of taken) d = Math.min(d, Math.abs(i - j), count - Math.abs(i - j));
      if (d > bestD) { bestD = d; best = i; }
    }
    taken.push(best);
  }
  return taken;
}

export async function hostSession({ sides, target, power }) {
  const code = newCode();
  // A Match only to read the shape off: how many seats, how long each side.
  const probe = new Match(sides, target);
  const order = spreadOrder(probe.players.length);
  const seats = probe.players.map((s, i) => ({ who: i === 0 ? 'host' : 'bot', half: s.half }));

  const session = {
    kind: 'host',
    code,
    seat: 0,
    rules: { sides, target, power },
    roster: [],
    mode: '',
    why: null,
    watch: null,
    started: false,
    shadow: null,
    stats: { frames: 0, bytes: 0, largest: 0, eventMsgs: 0, eventBytes: 0, since: performance.now() },
    /* main.js and js/lobby.js set these. */
    onRoster: null,
    onStatus: null, // (key, ...args): said on this device, in its language
    onBegin: null,
    onEvents: null,
    onClosed: null,
  };

  const peers = new Map(); // transport id -> { channel, hello, seat, lastSeq }
  let version = 1;
  let worker = null;
  let rendezvous = null;
  let lastLocal = null;

  const say = (key, ...args) => session.onStatus?.(key, ...args);

  /* ------------------------------------------------------------ roster --- */

  const rosterList = () => seats.map((s, i) => ({ seat: i, who: s.who }));

  function bump() {
    version = (version + 1) & 0xff || 1;
    session.shadow?.setVersion(version);
    worker?.postMessage({ type: 'VERSION', version });
  }

  function rosterMessage(t, peer) {
    return { t, v: version, you: peer.seat, rules: session.rules, roster: session.roster, started: session.started };
  }

  function publishRoster() {
    session.roster = rosterList();
    for (const peer of peers.values()) if (peer.hello) peer.channel.send(rosterMessage(MSG.ROSTER, peer));
    session.onRoster?.(session.roster);
  }

  /* ------------------------------------------------------------- peers --- */

  function onPeer(key, channel) {
    const peer = { key, channel, hello: false, seat: -1, lastSeq: null };
    peers.set(key, peer);
    channel.onClose = () => dropPeer(key);
    channel.onMessage = (value) => receive(peer, value);
  }

  function dropPeer(key) {
    const peer = peers.get(key);
    if (!peer) return;
    peers.delete(key);
    if (peer.seat < 0) return;
    // A bot takes the side, at once and mid-rally if need be.
    seats[peer.seat].who = 'bot';
    worker?.postMessage({ type: 'INPUT', seat: peer.seat, s: null });
    bump();
    publishRoster();
    say('status.left', peer.seat);
  }

  /* `why` is a reason CODE, never a sentence: the guest says it in its own
   * language (js/net/guest.js). */
  function refuse(peer, why) {
    peer.channel.send({ t: MSG.REFUSED, why });
    setTimeout(() => peer.channel.close(), 250); // let the message actually go
  }

  /*
   * Every byte a guest sends arrives here. A guest can say four things — its
   * build, its paddle's position, a ping, and goodbye — and only the
   * position reaches the sim, cleaned (protocol.js cleanPos) and then
   * followed at no more than a finger's speed (sim.js steer). There is no
   * field in which a guest could claim a ball, a score or someone else's
   * seat: the seat a position moves is the one this peer was given, looked up
   * here, not one it names.
   */
  function receive(peer, value) {
    if (value instanceof Uint8Array) {
      if (value[0] !== KIND_POS || peer.seat < 0) return;
      const p = unpackPos(value);
      if (!p) return;
      // The lossy lane is unordered too: an old position must not win.
      if (peer.lastSeq !== null && !newer(p.seq, peer.lastSeq)) return;
      peer.lastSeq = p.seq;
      const s = cleanPos(p.s, seats[peer.seat].half);
      if (s !== null && session.started) worker?.postMessage({ type: 'INPUT', seat: peer.seat, s, remote: true });
      return;
    }
    if (!value || typeof value !== 'object') return;
    switch (value.t) {
      case MSG.HELLO: {
        if (peer.hello) return; // one hello per peer; the rest is noise
        if (value.v !== NET_VERSION) return refuse(peer, 'version');
        const seat = order.find((i) => seats[i].who === 'bot');
        if (seat === undefined) return refuse(peer, 'full');
        peer.hello = true;
        peer.seat = seat;
        seats[seat].who = 'guest';
        bump();
        session.roster = rosterList();
        peer.channel.send(rosterMessage(MSG.WELCOME, peer));
        // Mid-match, straight in: the next frame is the whole board.
        if (session.started) peer.channel.send(rosterMessage(MSG.BEGIN, peer));
        publishRoster();
        say('status.joined', seat);
        return;
      }
      case MSG.PING:
        if (Number.isFinite(value.at)) peer.channel.send({ t: MSG.PONG, at: value.at });
        return;
      case MSG.BYE:
        dropPeer(peer.key);
        return;
      default:
        return;
    }
  }

  function broadcast(value, fast) {
    for (const peer of peers.values()) if (peer.hello) peer.channel.send(value, fast);
  }

  /* ------------------------------------------------------------ worker --- */

  function bootWorker() {
    worker = new Worker(new URL('./host-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type !== 'FRAME' || !session.started) return;
      const now = performance.now();
      // Reliable first: the events of a frame belong with it, and a guest
      // that hears a goal a frame early has lost nothing.
      if (data.events.length) {
        const message = { t: MSG.EVENTS, e: data.events };
        broadcast(message, false);
        session.stats.eventMsgs++;
        session.stats.eventBytes += JSON.stringify(message).length;
        session.onEvents?.(data.events);
      }
      broadcast(data.bytes, true);
      session.stats.frames++;
      session.stats.bytes += data.bytes.length;
      session.stats.largest = Math.max(session.stats.largest, data.bytes.length);
      session.shadow?.push(unpackFrame(data.bytes), now);
    };
  }

  /* ----------------------------------------------------------- session --- */

  /* This device's own paddle, as its shadow has already drawn it. */
  session.setLocalPos = (s) => {
    if (!worker || !session.started || s === lastLocal) return;
    lastLocal = s;
    worker.postMessage({ type: 'INPUT', seat: 0, s, remote: false });
  };

  /* A match, first or again: everything the old one owned was in the
   * worker, so a new Match there is the whole of a rematch. The roster, the
   * connections and the code all survive. */
  session.startMatch = () => {
    session.started = true;
    lastLocal = null;
    bump();
    session.shadow = createShadow({ sides, target, mine: 0 });
    session.shadow.setVersion(version);
    if (!worker) bootWorker();
    worker.postMessage({ type: 'SETUP', sides, target, power, version });
    for (const peer of peers.values()) if (peer.hello) peer.channel.send(rosterMessage(MSG.BEGIN, peer));
    session.stats = { frames: 0, bytes: 0, largest: 0, eventMsgs: 0, eventBytes: 0, since: performance.now() };
    session.onBegin?.();
  };

  /* Back to the room with everyone still in it. */
  session.toLobby = () => {
    if (!session.started) return;
    session.started = false;
    session.shadow = null;
    worker?.postMessage({ type: 'STOP' });
    broadcast({ t: MSG.LOBBY }, false);
  };

  // A reason code, like refuse(): "hostLeft" is the only one sent today.
  session.leave = (why = 'hostLeft') => {
    broadcast({ t: MSG.BYE, why }, false);
    for (const peer of peers.values()) {
      peer.channel.onClose = null;
      peer.channel.close();
    }
    peers.clear();
    worker?.postMessage({ type: 'STOP' });
    worker?.terminate();
    worker = null;
    rendezvous?.close();
    rendezvous = null;
    session.started = false;
    session.shadow = null;
  };

  /* ------------------------------------------------------------- start --- */

  session.roster = rosterList();
  rendezvous = await hostRendezvous(code, onPeer);
  session.mode = rendezvous.mode;
  session.why = rendezvous.why ?? null;
  session.watch = rendezvous.watch ?? null;
  return session;
}
