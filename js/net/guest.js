/*
 * guest.js — the peer that does not simulate.
 *
 * NeonFox's guest (its js/net/guest.js), with the one change this game needs
 * (DESIGN.md §6): what goes up is not steering but the paddle's POSITION,
 * because the guest has already moved it and drawn it. The host follows that
 * position at no more than a finger's speed, so a guest cannot teleport.
 *
 * A guest holds exactly one connection, to the host. It draws through the
 * same shadow Match the host draws through (js/net/shadow.js), so there is
 * one path from a frame to a board on screen.
 *
 * POSITIONS go out on the lossy lane at most sixty times a second, every
 * one, changed or not: five bytes, and a lost packet heals itself on the
 * next. Each carries a sequence number so the host can drop one that arrives
 * after a newer one.
 *
 * A PING every two seconds on the reliable lane measures the round trip,
 * and half of it is how far ahead of the last frame the balls are drawn.
 */

import { MSG, NET_VERSION, KIND_FRAME, packPos, unpackFrame, cleanEvent, cleanRules } from './protocol.js';
import { createShadow } from './shadow.js';
import { joinRendezvous } from './rendezvous.js';
import { parseCode } from './codes.js';
import { said } from '../i18n.js';

/* The refusal codes a host sends (js/net/host.js refuse()), and the key each
 * is said with here. Language never travels; reasons do. */
const REFUSALS = { version: 'why.version', full: 'why.full' };
const SEND_EVERY = 15; // ms: about sixty positions a second, whatever the screen's rate

export async function joinSession({ code }) {
  const parsed = parseCode(code);
  if (!parsed) throw said('err.notCode');

  const session = {
    kind: 'guest',
    code: parsed,
    seat: -1,
    rules: null,
    roster: [],
    mode: '',
    why: null,
    started: false,
    shadow: null,
    trip: 0, // ms, the last measured round trip
    stats: { frames: 0, bytes: 0, since: performance.now() },
    onRoster: null,
    onStatus: null,
    onBegin: null,
    onLobby: null,
    onEvents: null,
    onClosed: null,
  };

  let version = 0;
  let seq = 0;
  let lastSent = 0;
  let closed = false;

  const joined = await joinRendezvous(parsed);
  session.mode = joined.mode;
  session.why = joined.why ?? null;
  const channel = joined.channel;

  const close = (why) => {
    if (closed) return;
    closed = true;
    clearInterval(pinger);
    session.started = false;
    session.onClosed?.(why);
  };

  /* WELCOME, ROSTER and BEGIN carry the same fields. */
  function takeRoster(value) {
    version = Number(value.v) & 0xff;
    session.shadow?.setVersion(version);
    if (Number.isInteger(value.you)) session.seat = value.you;
    session.rules = cleanRules(value.rules);
    session.roster = Array.isArray(value.roster)
      ? value.roster
          .filter((r) => r && Number.isInteger(r.seat))
          .map((r) => ({ seat: r.seat, who: ['host', 'guest', 'bot'].includes(r.who) ? r.who : 'bot' }))
      : [];
    session.onRoster?.(session.roster);
  }

  function begin() {
    const { sides, target } = session.rules;
    session.shadow = createShadow({ sides, target, mine: session.seat });
    session.shadow.setVersion(version);
    session.shadow.setTrip(session.trip / 1000);
    session.started = true;
    session.stats = { frames: 0, bytes: 0, since: performance.now() };
    session.onBegin?.();
  }

  channel.onClose = () => close('why.hostLeft');

  channel.onMessage = (value) => {
    if (value instanceof Uint8Array) {
      if (value[0] !== KIND_FRAME) return;
      session.stats.frames++;
      session.stats.bytes += value.length;
      session.shadow?.push(unpackFrame(value), performance.now());
      return;
    }
    if (!value || typeof value !== 'object') return;
    switch (value.t) {
      case MSG.WELCOME:
        takeRoster(value);
        session.onStatus?.('status.in');
        break;
      case MSG.ROSTER:
        takeRoster(value);
        break;
      case MSG.BEGIN:
        takeRoster(value);
        begin();
        break;
      case MSG.LOBBY:
        session.started = false;
        session.shadow = null;
        session.onLobby?.();
        break;
      case MSG.EVENTS:
        if (Array.isArray(value.e)) {
          const events = value.e.map(cleanEvent).filter(Boolean);
          if (events.length) session.onEvents?.(events);
        }
        break;
      case MSG.PONG: {
        const trip = performance.now() - Number(value.at);
        if (trip >= 0 && trip < 5000) {
          session.trip = trip;
          session.shadow?.setTrip(trip / 1000);
        }
        break;
      }
      case MSG.REFUSED:
        close(REFUSALS[value.why] ?? 'why.refused');
        break;
      case MSG.BYE:
        close('why.hostLeft');
        break;
      default:
        break;
    }
  };

  const ping = () => {
    if (channel.open) channel.send({ t: MSG.PING, at: performance.now() });
  };
  const pinger = setInterval(ping, 2000);

  /* This device's own paddle, as its shadow has already drawn it. */
  session.setLocalPos = (s) => {
    if (!session.started || !channel.open) return;
    const now = performance.now();
    if (now - lastSent < SEND_EVERY) return;
    lastSent = now;
    seq = (seq + 1) & 0xffff;
    channel.send(packPos(seq, s), true);
  };

  // Starting and restarting are the host's alone. main.js reads these being
  // absent as "this device does not get that button" (hub §2, canRestart).
  session.startMatch = null;
  session.toLobby = null;
  session.leave = () => {
    closed = true;
    clearInterval(pinger);
    try {
      channel.send({ t: MSG.BYE, why: 'left' });
    } catch {
      /* Already gone. */
    }
    // Give the goodbye a moment to leave before the connection does, so the
    // host turns the side into a bot at once rather than at its timeout.
    setTimeout(() => {
      channel.onClose = null;
      channel.close();
      joined.close?.();
    }, 150);
  };

  channel.send({ t: MSG.HELLO, v: NET_VERSION });
  ping();
  return session;
}
