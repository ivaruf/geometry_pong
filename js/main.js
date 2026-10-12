/*
 * main.js — the glue: the fixed-timestep loop, which match is on the board,
 * the Escape ladder, and the tablet-rotation fix.
 *
 * FOUR STATES
 *   attract  the start screen. Bots rally behind it at double speed on a
 *            polygon that gains a side each time one of them wins, and no
 *            sound plays: it is the argument for the game, not the game.
 *   play     a match. Fingers and keys steer (js/input.js).
 *   paused   the menu panel is open over a match. Local play only for now,
 *            so the menu always pauses (hub §2).
 *   over     somebody reached the target. The board keeps drawing the
 *            winner's ring; the card follows a beat later.
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
 *   start screen, nothing open   the Back to arcade button, when shown
 *   Settings face open           its Back (checked before the rest)
 *   play                         open the menu (and pause)
 *   Pause face open              close it, the match carries on
 *   over (card or not yet)       the card's secondary button: Main menu
 */

import { Match, TICK } from './sim.js';
import { createView, createRenderer } from './render.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
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

function pause() {
  if (state !== 'play') return;
  state = 'paused';
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
  startAttract();
  ui.showStart();
}

const ui = createUI({
  onPlay(sides, target) {
    settings = { sides, target };
    startMatch();
  },
  onResume: resume,
  onRestart: startMatch,
  onMainMenu: mainMenu,
  // The slider is live: a paused match picks the new level up on Resume.
  onPower(level) {
    if (state !== 'attract') match.powerLevel = level;
  },
  onMenu() {
    if (state === 'play') pause();
    else if (state === 'paused') resume();
    else if (ui.inSettings()) ui.settingsBack();
    else ui.showSettings();
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
  if (state === 'play') pause();
  else if (state === 'paused') resume();
  else if (ui.inSettings()) ui.settingsBack();
  else if (state === 'over') mainMenu();
  else if (ui.current() === 'start' && ui.exitShown()) ui.quit();
});

// A tab put away mid-rally pauses rather than playing on without anyone.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pause();
});

addEventListener('resize', () => view.resize());

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
    if (state === 'play' && match.winner >= 0) {
      state = 'over';
      input.setLive(false);
      audio.win(); // fades the music out itself
      const best = Math.max(...match.players.filter((s) => s.player !== match.winner).map((s) => s.score));
      const showOver = () => {
        if (state !== 'over') return;
        // Not over the Settings face if somebody opened it in the pause.
        if (ui.inSettings()) overTimer = setTimeout(showOver, 400);
        else ui.showOver(match.winner, match.target, best);
      };
      overTimer = setTimeout(showOver, 1600);
    }
  }

  renderer.draw(match, time, dt, { labels: state !== 'attract' });
  requestAnimationFrame(frame);
}

startAttract();
ui.showStart();
requestAnimationFrame(frame);
