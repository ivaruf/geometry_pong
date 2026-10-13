/*
 * ui.js — the cards over the board, the corner's menu and sound plates, and
 * the way back to the arcade. Decides what is showing and what the words
 * say; main.js decides when.
 *
 *   start  the wordmark, the setup rows (sides, first to, and Kaos: how
 *          many power-ups, Off to Max, which is plain pong at Off), Play, the
 *          update button, and the way back to the arcade last
 *   menu   the one panel behind the three-bar plate. In a match it is the
 *          Pause face (Resume, Restart, Main menu); anywhere else it is the
 *          Settings face (no Resume, a Back). Both carry MUSIC and EFFECTS,
 *          the language row and the way back to the arcade, last. Local play
 *          only for now, so the menu always pauses (hub §2).
 *   over   who won, the score, Play again / Main menu
 *   online the lobby card; js/lobby.js fills it, this file only shows it
 *
 * ONLINE THE MENU DOES NOT PAUSE (hub §2): the match belongs to the whole
 * room. showPause({ live: true }) gives the panel its live face — "Menu",
 * a line saying the match carries on, Resume to close it — and the board
 * and the paddle stay live behind it, as NeonFox's `live` branch does.
 * `canRestart` is false for a guest, whose Restart would be a button that
 * does nothing (starting is the host's alone); the over card's Play again
 * likewise. Online the over card's way back is "Back", to the room.
 *
 * Menu words are the hub's shared glossary (§2); the game's own voice is its
 * look — neon on black — and the rim lines on the board.
 *
 * THE SETUP ROWS are segmented buttons, one size each (hub §2, equal rule),
 * remembered for the visit only: a tabletop is a different crowd each time.
 *
 * THE ARCADE DOOR is wired by wireExit(), which main.js retries because
 * exit.js is a deferred classic script from another repo that may be late or
 * missing. Shown only when there is somewhere to go, worded through verb().
 */

import { audio } from './audio.js';
import { t, setLang, paintStatic } from './i18n.js';
import { COLORS } from './sim.js';

const $ = (id) => document.getElementById(id);

export function createUI({ onPlay, onOnline, onResume, onRestart, onMainMenu, onMenu, onPower }) {
  const cards = { start: $('start'), menu: $('menu'), over: $('over'), online: $('online') };
  let face = 'pause';
  let settingsFrom = 'start'; // the card the Settings face's Back returns to
  const choice = { sides: 4, target: 10 };

  function show(name) {
    for (const [k, el] of Object.entries(cards)) el.hidden = k !== name;
    // Focus the card's main action, so Enter does the obvious thing and no
    // focus ring lands on a setup button the player never touched.
    const el = name && cards[name];
    const first = el && (el.querySelector('.go:not([hidden]):not([disabled])') || el.querySelector('button:not([hidden])'));
    if (first) first.focus({ preventScroll: true });
  }

  function current() {
    for (const [k, el] of Object.entries(cards)) if (!el.hidden) return k;
    return null;
  }

  // ---- setup rows ----
  function seg(id, values, key) {
    const el = $(id);
    for (const v of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      b.id = `${id}-${v}`;
      b.textContent = String(v);
      b.setAttribute('aria-pressed', String(v === choice[key]));
      b.addEventListener('click', () => {
        choice[key] = v;
        for (const x of el.children) x.setAttribute('aria-pressed', String(x === b));
      });
      el.appendChild(b);
    }
  }
  seg('sides', [2, 3, 4, 5, 6, 7, 8], 'sides');
  seg('target', [5, 10, 15, 20], 'target');

  $('play').addEventListener('click', () => onPlay(choice.sides, choice.target));
  $('online-btn').addEventListener('click', onOnline);
  $('menu-resume').addEventListener('click', onResume);
  $('menu-restart').addEventListener('click', onRestart);
  $('menu-main').addEventListener('click', onMainMenu);
  $('menu-back').addEventListener('click', () => show(settingsFrom));
  $('over-again').addEventListener('click', onRestart);
  $('over-main').addEventListener('click', onMainMenu);
  $('menu-btn').addEventListener('click', onMenu);

  // face: 'pause' (a stopped local match), 'live' (an online match that
  // carries on) or 'settings' (outside a match).
  function setFace(next, canRestart = true) {
    face = next;
    const inMatch = face !== 'settings';
    const title = $('menu-title');
    title.dataset.i18n = face === 'live' ? 'live' : inMatch ? 'paused' : 'settings';
    title.textContent = t(title.dataset.i18n);
    const tag = $('menu-tag');
    tag.dataset.i18n = face === 'live' ? 'live.tag' : 'pause.tag';
    tag.textContent = t(tag.dataset.i18n);
    tag.hidden = !inMatch;
    $('menu-resume').hidden = !inMatch;
    $('menu-restart').hidden = !inMatch || !canRestart;
    $('menu-main').hidden = !inMatch;
    $('menu-back').hidden = inMatch;
  }

  // ---- sound: the corner's live mute and the panel's two levels ----
  const soundBtn = $('sound-btn');
  function paintMute() {
    const m = audio.isMuted();
    const label = t(m ? 'unmute' : 'mute');
    soundBtn.setAttribute('aria-pressed', String(m));
    soundBtn.setAttribute('aria-label', label);
    soundBtn.title = label;
  }
  soundBtn.addEventListener('click', () => {
    audio.setMuted(!audio.isMuted());
    paintMute();
  });
  for (const bus of ['music', 'sfx']) {
    const input = $(`vol-${bus}`);
    const out = $(`vol-${bus}-out`);
    const v = Math.round(audio.level(bus) * 100);
    input.value = String(v);
    out.value = String(v);
    input.addEventListener('input', () => {
      out.value = input.value;
      audio.setLevel(bus, Number(input.value) / 100);
      paintMute();
    });
  }
  paintMute();

  // ---- Kaos: how many power-ups, 0 (off) to 4, set before a match ----
  // Its own key (hub §6), every access in try/catch, anything but an integer
  // 0–4 ignored on load. main.js hears changes through onPower.
  const POWER_KEY = 'geometry_pong.powerups.v1';
  let powerLevel = 2;
  try {
    const v = Number(localStorage.getItem(POWER_KEY));
    if (localStorage.getItem(POWER_KEY) !== null && Number.isInteger(v) && v >= 0 && v <= 4) powerLevel = v;
  } catch {
    /* the default stands */
  }
  const powerInput = $('powerups');
  const powerOut = $('powerups-out');
  function paintPower() {
    powerInput.value = String(powerLevel);
    powerOut.value = t(`powerups.${powerLevel}`);
    powerInput.setAttribute('aria-valuetext', powerOut.value);
  }
  powerInput.addEventListener('input', () => {
    powerLevel = Number(powerInput.value);
    try {
      localStorage.setItem(POWER_KEY, String(powerLevel));
    } catch {
      /* not kept; this visit still has it */
    }
    paintPower();
    onPower(powerLevel);
  });
  paintPower();

  // ---- match over ----
  let overArgs = null;
  function paintOver() {
    if (!overArgs) return;
    const { winner, score, best, online, canAgain } = overArgs;
    $('over-again').hidden = !canAgain;
    const main = $('over-main');
    main.dataset.i18n = online ? 'back' : 'mainMenu';
    main.textContent = t(main.dataset.i18n);
    $('over-title').textContent = t('over.wins', t(`colour.${winner}`));
    $('over-score').textContent = t('over.score', score, best);
    cards.over.style.setProperty('--c', COLORS[winner]);
  }

  // ---- language ----
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  }
  document.addEventListener('arcade:lang', () => {
    paintMute();
    paintPower();
    paintOver();
    paintExit();
  });
  paintStatic();

  // ---- the way back to the arcade ----
  const exitBtns = [$('start-exit'), $('menu-exit')];
  let exitApi = null;
  let exitRefused = false;

  function paintExit() {
    if (!exitApi) return;
    let label;
    try {
      label = exitRefused ? t('exit.refused') : exitApi.verb({ arcade: t('exit.arcade'), app: t('exit.close') });
    } catch {
      label = t('exit.arcade');
    }
    for (const b of exitBtns) b.querySelector('.exit-label').textContent = label;
  }

  function quit() {
    if (!exitApi || exitRefused) return;
    Promise.resolve(exitApi.quit())
      .then((how) => {
        if (how !== 'refused') return;
        exitRefused = true;
        for (const b of exitBtns) b.disabled = true;
        paintExit();
      })
      .catch(() => {});
  }
  for (const b of exitBtns) b.addEventListener('click', quit);

  let exitWired = false;
  function wireExit() {
    if (exitWired) return true;
    const exit = window.ArcadeExit;
    if (!exit) return false;
    exitWired = true;
    let shown = false;
    try {
      shown = exit.framed() || exit.standalone();
    } catch {
      shown = false;
    }
    if (!shown) return true;
    exitApi = exit;
    for (const b of exitBtns) b.hidden = false;
    paintExit();
    return true;
  }

  return {
    powerLevel: () => powerLevel,
    wireExit,
    current,
    quit,
    exitShown: () => exitApi != null && !exitRefused,
    showStart: () => show('start'),
    hideCards: () => show(null),
    showPause({ live = false, canRestart = true } = {}) {
      setFace(live ? 'live' : 'pause', canRestart);
      show('menu');
    },
    showOnline: () => show('online'),
    choices: () => ({ sides: choice.sides, target: choice.target, power: powerLevel }),
    showSettings() {
      settingsFrom = current(); // may be null: over a board with no card
      setFace('settings');
      show('menu');
    },
    inSettings: () => !cards.menu.hidden && face === 'settings',
    settingsBack: () => show(settingsFrom),
    paused: () => !cards.menu.hidden && face !== 'settings',
    showOver(winner, score, best, { online = false, canAgain = true } = {}) {
      overArgs = { winner, score, best, online, canAgain };
      paintOver();
      show('over');
    },
  };
}
