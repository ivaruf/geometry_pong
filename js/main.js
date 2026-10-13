/*
 * main.js — the glue: the fixed-timestep loop, which match is on the board,
 * the Escape ladder, and the tablet-rotation fix.
 *
 * FOUR STATES
 *   attract  the start screen (and the Online lobby). Bots rally behind it
 *            at double speed on a polygon that gains a side each time one
 *            of them wins, and no sound plays: it is the argument for the
 *            game, not the game.
 *   play     a match. Fingers and keys steer (js/input.js).
 *   paused   the menu panel is open over a match. Locally that stops the
 *            match. Online it does not (hub §2): the panel shows its live
 *            face and the board and your paddle carry on behind it.
 *   over     somebody reached the target. The board keeps drawing the
 *            winner's ring; the card follows a beat later.
 *
 * ONLINE (DESIGN.md §6, js/net/). `net` is the session while one of its
 * matches is on the board. Then nothing here steps a sim: the board is the
 * session's shadow Match, fed by the host's frames, and each screen frame
 * moves this device's own paddle locally (shadow.advance) and sends where
 * it now is. Sounds and sparks come from the host's relayed events. The
 * board is turned once, at the start of the match, so this device's side is
 * at the bottom, and the tabletop's counter-rotation is not used.
 *
 * THE LOOP. 120 Hz fixed step (sim.js TICK) with an accumulator, frame dt
 * clamped to 0.1 s and at most 12 steps a frame (hub §10).
 *
 * KEEPING THE BOARD FIXED TO THE GLASS (DESIGN.md §4). A tablet lying flat
 * rotates its screen when bumped, which would move every side to a
 * different person. At the start of a match we note screen.orientation's
 * angle; from then on the board is counter-rotated by however far it has
 * turned. The angle is the content's rotation from the device's natural
 * orientation, and canvas rotation is clockwise-positive, hence the minus.
 * Untested on an iPad at the time of writing — the playtest checklist says
 * so.
 *
 * ESCAPE, in one place (hub §2), auto-repeat ignored:
 *   a text field has focus       only leave the field
 *   start screen, nothing open   the Back to arcade button, when shown
 *   Settings face open           its Back (checked before the rest)
 *   play                         open the menu (and pause, locally)
 *   Pause face open              close it, the match carries on
 *   over (card or not yet)       the card's secondary button: Main menu,
 *                                or online Back, to the room
 *   the Online card              its Back: one step (js/lobby.js)
 */

import { Match, TICK } from './sim.js';
import { createView, createRenderer } from './render.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { createLobby } from './lobby.js';
import { audio } from './audio.js';

const canvas = document.getElementById('view');
const view = createView(canvas);
const renderer = createRenderer(canvas, view);
const input = createInput(canvas, view);

let state = 'attract';
let match = null;
let settings = { sides: 4, target: 10 };
let baseAngle = 0;
let attractSides = 3;
let overTimer = 0;
let net = null; // the online session whose match is on the board

function orientAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

function setMatch(m) {
  match = m;
  view.radius = m.radius;
  view.resize();
}

function startAttract() {
  state = 'attract';
  net = null;
  clearTimeout(overTimer);
  input.setLive(false);
  audio.music(false);
  setMatch(new Match(attractSides, 3));
  match.powerLevel = 2; // the title shows them off whatever the slider says
  view.rot = 0;
}

function startMatch() {
  clearTimeout(overTimer);
  setMatch(new Match(settings.sides, settings.target));
  match.powerLevel = ui.powerLevel();
  input.reset(match);
  baseAngle = orientAngle();
  state = 'play';
  ui.hideCards();
  input.setLive(true);
  audio.music(true);
  acc = 0;
}

/* An online match on the board: the session's shadow, turned so this
 * device's side is at the bottom, and its paddle the only one we steer. */
function startOnline(session) {
  clearTimeout(overTimer);
  net = session;
  setMatch(session.shadow.match);
  view.rot = session.shadow.turn;
  input.reset(match, session.shadow.me);
  state = 'play';
  ui.hideCards();
  input.setLive(true);
  audio.music(true);
}

function pause() {
  if (state !== 'play') return;
  state = 'paused';
  if (net) {
    // The room's match carries on; only the panel opens (hub §2).
    ui.showPause({ live: true, canRestart: !!net.startMatch });
    return;
  }
  input.setLive(false);
  audio.music(false);
  ui.showPause();
}

function resume() {
  if (state !== 'paused') return;
  state = 'play';
  ui.hideCards();
  input.setLive(true);
  audio.music(true);
  acc = 0;
}

function mainMenu() {
  if (net) lobby.leave();
  startAttract();
  ui.showStart();
}

/* Online, the over card's way back: to the room, with everyone still in it.
 * A host takes the room with it; a guest goes alone and is pulled back in
 * when the host starts again. */
function backToRoom() {
  const s = net;
  if (s && s.toLobby) s.toLobby();
  startAttract();
  lobby.showRoom();
}

const ui = createUI({
  onPlay(sides, target) {
    settings = { sides, target };
    startMatch();
  },
  onOnline: () => lobby.open(),
  onResume: resume,
  onRestart() {
    if (!net) startMatch();
    else if (net.startMatch) net.startMatch(); // the host's alone; BEGIN does the rest
  },
  onMainMenu() {
    if (net && state === 'over') backToRoom();
    else mainMenu();
  },
  // The slider is live: a paused match picks the new level up on Resume.
  onPower(level) {
    if (state !== 'attract' && !net) match.powerLevel = level;
  },
  onMenu() {
    if (state === 'play') pause();
    else if (state === 'paused') resume();
    else if (ui.inSettings()) ui.settingsBack();
    else ui.showSettings();
  },
});

const lobby = createLobby({
  ui,
  rules: () => ui.choices(),
  onBegin: startOnline,
  // The host went back to the room (only a guest hears this).
  onLobby(session) {
    if (net === session) {
      startAttract();
      lobby.showRoom();
    }
  },
  // Sounds and sparks, relayed by the host by type and id (DESIGN.md §6).
  onEvents(events) {
    if (!net || !net.shadow || match !== net.shadow.match) return;
    for (const e of events) {
      net.shadow.event(e);
      renderer.spark(e);
      audio.event(e);
    }
  },
  // The room closed under us; the lobby says why.
  onClosed() {
    if (net) startAttract();
  },
});

// exit.js is deferred and from another repo: ask until it answers, briefly.
if (!ui.wireExit()) {
  let tries = 0;
  const timer = setInterval(() => {
    if (ui.wireExit() || ++tries > 40) clearInterval(timer);
  }, 150);
}

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.repeat) return;
  e.preventDefault();
  const field = document.activeElement;
  if (field && field.matches && field.matches('input[type="text"]')) {
    field.blur();
    return;
  }
  if (state === 'play') pause();
  else if (state === 'paused') resume();
  else if (ui.inSettings()) ui.settingsBack();
  else if (state === 'over') {
    if (net) backToRoom();
    else mainMenu();
  } else if (ui.current() === 'online') lobby.back();
  else if (ui.current() === 'start' && ui.exitShown()) ui.quit();
});

// A tab put away mid-rally pauses rather than playing on without anyone —
// locally. Online the room plays on, and so does the worker if we host.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && !net) pause();
});

addEventListener('resize', () => view.resize());

/* Somebody reached the target: the fanfare now, the card a beat later. */
function matchOver() {
  state = 'over';
  input.setLive(false);
  audio.win(); // fades the music out itself
  const best = Math.max(...match.players.filter((s) => s.player !== match.winner).map((s) => s.score));
  const session = net;
  const showOver = () => {
    if (state !== 'over' || net !== session) return;
    // Not over the Settings face if somebody opened it in the pause.
    if (ui.inSettings()) overTimer = setTimeout(showOver, 400);
    else ui.showOver(match.winner, match.target, best, { online: !!session, canAgain: !session || !!session.startMatch });
  };
  overTimer = setTimeout(showOver, 1600);
}

let last = performance.now();
let acc = 0;
let time = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;

  if (state === 'attract') {
    match.step(TICK, []);
    match.step(TICK, []);
    for (const e of match.events) renderer.spark(e);
    match.events.length = 0;
    if (match.winner >= 0) {
      attractSides = attractSides === 8 ? 2 : attractSides + 1;
      startAttract();
    }
  } else if (net) {
    // Online: nothing to step. Advance the shadow — our own paddle from our
    // own input, everyone else's from the frames — and say where ours is.
    const sh = net.shadow;
    if (sh) {
      const me = sh.me;
      const mine = me && (state === 'play' || state === 'paused') ? input.read()[me.player] : null;
      sh.advance(dt, mine, now);
      if (me) net.setLocalPos(me.pad.s);
      if (state !== 'over' && match.winner >= 0) matchOver();
    }
  } else if (state === 'play' || state === 'over') {
    view.rot = (-(orientAngle() - baseAngle) * Math.PI) / 180;
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 12) {
      match.step(TICK, state === 'play' ? input.read() : []);
      acc -= TICK;
      steps++;
    }
    if (steps === 12) acc = 0;
    for (const e of match.events) {
      renderer.spark(e);
      audio.event(e);
    }
    match.events.length = 0;
    if (state === 'play' && match.winner >= 0) matchOver();
  }

  renderer.draw(match, time, dt, {
    labels: state !== 'attract',
    upright: !!net,
    mine: net && net.shadow && net.shadow.me ? net.shadow.me.player : -1,
  });
  requestAnimationFrame(frame);
}

startAttract();
ui.showStart();
requestAnimationFrame(frame);
