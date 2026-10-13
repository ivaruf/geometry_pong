/*
 * lobby.js — the Online card: where a room is made or found.
 *
 * NeonFox's lobby (its js/net/lobby.js) in this game's clothes, and smaller:
 * no names (the board names people by colour, and the rim says "you"), no
 * picture keypad (a code is four letters in a text field). Three steps of one
 * card (index.html #online), one showing at a time:
 *
 *   choose   Create room / Join, over the rules a room made here will play
 *            by — the start screen's own rows, read when the room is made
 *   code     the code field and Join
 *   room     where a host and a guest end up in the same place: the code,
 *            big, the room's rules, and every seat — whose it is, in its
 *            player's colour. Play for the host; a guest is told it waits.
 *
 * BACK IS ONE STEP (hub §2): code -> choose, room -> leave the room ->
 * choose, choose -> the start screen. Escape is the same button (main.js).
 *
 * TWO LANGUAGES, LIVE. Every line this file writes is kept as a key and its
 * arguments and said again on `arcade:lang`; what the net code reports
 * arrives as keys too (js/i18n.js said()), never a sentence off the wire.
 */

import { t } from './i18n.js';
import { COLORS } from './sim.js';
import { hostSession } from './net/host.js';
import { joinSession } from './net/guest.js';

const $ = (id) => document.getElementById(id);

export function createLobby({ ui, rules, onBegin, onLobby, onEvents, onClosed }) {
  const card = $('online');
  const steps = { choose: $('online-choose'), code: $('online-code'), room: $('online-room') };
  const field = $('code-field');
  let step = 'choose';
  let session = null;
  let pending = 0; // bumped on every Back, so a late-arriving session is let go
  let status = null; // { key, args, warn }
  let unwatch = null;

  function setStatus(key, args = [], warn = false) {
    status = key ? { key, args, warn } : null;
    paintStatus();
  }
  function paintStatus() {
    const el = $('online-status');
    el.textContent = status ? t(status.key, ...status.args) : '';
    el.classList.toggle('warn', !!(status && status.warn));
  }
  const sayError = (e) => setStatus(e && e.key ? e.key : 'status.openFail', e && e.args ? e.args : [], true);

  const rulesText = (r) => t('online.rules', r.sides, r.target, t(`powerups.${r.power}`).toLowerCase());

  function paint() {
    for (const [k, el] of Object.entries(steps)) el.hidden = k !== step;
    const tag = $('online-tag');
    tag.textContent = t(step === 'code' ? 'online.joinTag' : step === 'room' ? 'online.roomTag' : 'online.tag');
    $('online-rules').textContent = rulesText(rules());
    if (step === 'room' && session) {
      $('room-code').textContent = session.code;
      $('room-rules').textContent = session.rules ? rulesText(session.rules) : '';
      $('room-start').hidden = session.kind !== 'host';
      paintSeats();
    }
    paintStatus();
  }

  function paintSeats() {
    const list = $('room-seats');
    list.textContent = '';
    if (!session) return;
    for (const r of session.roster) {
      const li = document.createElement('li');
      li.className = 'seat';
      const me = r.seat === session.seat;
      if (r.who === 'bot') li.classList.add('bot');
      if (me) li.classList.add('me');
      li.style.setProperty('--c', COLORS[r.seat] || '#ffffff');
      const who = me ? t('seat.you') : t(`seat.${r.who}`);
      li.textContent = `${t(`colour.${r.seat}`)} · ${who}`;
      list.appendChild(li);
    }
  }

  function go(next) {
    step = next;
    ui.showOnline();
    paint();
    if (step === 'code') field.focus({ preventScroll: true });
  }

  /* Wire a fresh session (host or guest) to this card and to main.js. */
  function adopt(s) {
    session = s;
    s.onRoster = () => step === 'room' && paint();
    s.onStatus = (key, ...args) => setStatus(key, args);
    s.onBegin = () => onBegin(s);
    s.onLobby = () => onLobby(s);
    s.onEvents = (events) => onEvents(events);
    s.onClosed = (why) => {
      if (session !== s) return;
      dropSession();
      onClosed();
      go('choose');
      setStatus(why || 'why.hostLeft', [], true);
    };
  }

  function dropSession() {
    unwatch?.();
    unwatch = null;
    session = null;
  }

  async function host() {
    const token = ++pending;
    setStatus('status.opening');
    for (const b of [$('online-host'), $('online-join')]) b.disabled = true;
    try {
      const s = await hostSession(rules());
      if (token !== pending) return s.leave();
      adopt(s);
      go('room');
      if (s.mode === 'tabs') setStatus('status.tabs', [], true);
      else if (s.mode === 'relay') setStatus('status.relay');
      else setStatus('status.broker');
      // The broker can drop a sleeping host's code; say so while it does.
      if (s.watch) {
        unwatch = s.watch((health) => {
          if (session !== s) return;
          if (health.reachable) setStatus('status.broker');
          else setStatus(health.note, health.args || [], true);
        });
      }
    } catch (e) {
      if (token === pending) sayError(e);
    } finally {
      for (const b of [$('online-host'), $('online-join')]) b.disabled = false;
    }
  }

  async function join() {
    const token = ++pending;
    setStatus('status.looking');
    $('code-go').disabled = true;
    try {
      const s = await joinSession({ code: field.value });
      if (token !== pending) return s.leave();
      adopt(s);
      go('room');
      setStatus(s.mode === 'tabs' ? 'status.tabs' : 'status.in', [], s.mode === 'tabs');
    } catch (e) {
      if (token === pending) sayError(e);
    } finally {
      $('code-go').disabled = false;
    }
  }

  function leave() {
    pending++;
    if (session) {
      const s = session;
      dropSession();
      s.leave();
    }
  }

  $('online-host').addEventListener('click', host);
  $('online-join').addEventListener('click', () => {
    setStatus(null);
    go('code');
  });
  steps.code.addEventListener('submit', (e) => {
    e.preventDefault();
    join();
  });
  $('room-start').addEventListener('click', () => session && session.startMatch && session.startMatch());
  $('online-back').addEventListener('click', back);

  /* One step back; from the first step, the start screen. */
  function back() {
    if (step === 'code') {
      pending++;
      setStatus(null);
      go('choose');
    } else if (step === 'room') {
      leave();
      setStatus(null);
      go('choose');
    } else {
      leave();
      setStatus(null);
      ui.showStart();
    }
  }

  document.addEventListener('arcade:lang', () => {
    if (!card.hidden) paint();
  });

  return {
    open() {
      setStatus(null);
      go('choose');
    },
    /* After a match, back to the room with everyone still in it. */
    showRoom() {
      if (!session) return go('choose');
      go('room');
    },
    back,
    leave,
    isOpen: () => !card.hidden,
    session: () => session,
  };
}
