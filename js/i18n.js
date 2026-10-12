/*
 * i18n.js — which language Geometry Pong speaks, and every word it says.
 *
 * The hub's contract (CLAUDE.md §2, "Two languages, Norwegian first"):
 * bokmål and English, Norwegian by default whatever the browser prefers, one
 * choice for the whole arcade stored as `arcade.lang.v1`, switched live from
 * the menu panel. The same shape as minimaze/js/i18n.js.
 *
 *   t(key, ...args)     the current language, else English, else the key
 *                       itself (warning once per missing key)
 *   getLang()           "nb" | "en"
 *   setLang(lang)       validate, store, set <html lang>, repaint, then
 *                       dispatch `arcade:lang` on document
 *   paintStatic(root)   [data-i18n] -> textContent,
 *                       [data-i18n-label] -> aria-label and title,
 *                       [data-i18n-aria] -> aria-label only
 *
 * Canvas text (the rim labels) calls t() every frame, so it follows a switch
 * on the next frame with nothing to repaint. js/update.js and js/screen.js
 * import nothing and keep their own few words; so does the crash bar.
 */

const KEY = 'arcade.lang.v1';

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'nb' || saved === 'en') return saved;
  } catch {
    // No storage: the default stands.
  }
  return 'nb';
}

let lang = initial();
document.documentElement.lang = lang;

export const getLang = () => lang;

const STRINGS = {
  nb: {
    'board.label': 'Spillebrettet',
    'start.tag': 'Pong med flere sider.',
    'start.how': 'Legg en finger på kanten foran deg, eller bruk ← → og A D. Sider ingen spiller på, tar en robot. Kaos er hvor mange ekstrakrefter ballen kan fange – av gir vanlig pong.',
    'sides': 'Sider',
    'firstTo': 'Først til',
    'play': 'Spill',
    'menu': 'Meny',
    'settings': 'Innstillinger',
    'paused': 'Pause',
    'pause.tag': 'Ballene venter der de var.',
    'resume': 'Fortsett',
    'restart': 'Start på nytt',
    'mainMenu': 'Hovedmeny',
    'playAgain': 'Spill igjen',
    'back': 'Tilbake',
    'music': 'Musikk',
    'sfx': 'Effekter',
    'powerups': 'Kaos',
    'powerups.0': 'Av',
    'powerups.1': 'Litt',
    'powerups.2': 'Noe',
    'powerups.3': 'Mye',
    'powerups.4': 'Maks',
    'sound.hint': 'Hver side har sin egen tone – en lang ballveksling spiller en melodi.',
    'mute': 'Lyd av',
    'unmute': 'Lyd på',
    'language': 'Språk',
    'exit.arcade': 'Tilbake til arkaden',
    'exit.close': 'Lukk',
    'exit.refused': 'Lukk vinduet selv',
    'over.wins': (colour) => `${colour} vant!`,
    'over.score': (a, b) => `${a} mot ${b}`,
    'rim.bot': 'robot · legg en finger her',
    'rim.firstTo': (n) => `først til ${n}`,
    'rim.oneToGo': 'ett mål igjen',
    'rim.winner': 'VINNER',
    'colour.0': 'Blå',
    'colour.1': 'Rosa',
    'colour.2': 'Gul',
    'colour.3': 'Grønn',
    'colour.4': 'Oransje',
    'colour.5': 'Lilla',
    'colour.6': 'Rød',
    'colour.7': 'Hvit',
  },
  en: {
    'board.label': 'The playing field',
    'start.tag': 'Pong with more sides.',
    'start.how': 'Put a finger on the edge in front of you, or use ← → and A D. A robot plays any side nobody takes. Chaos is how many power-ups the ball can catch – off is plain pong.',
    'sides': 'Sides',
    'firstTo': 'First to',
    'play': 'Play',
    'menu': 'Menu',
    'settings': 'Settings',
    'paused': 'Paused',
    'pause.tag': 'The balls wait where they were.',
    'resume': 'Resume',
    'restart': 'Restart',
    'mainMenu': 'Main menu',
    'playAgain': 'Play again',
    'back': 'Back',
    'music': 'Music',
    'sfx': 'Effects',
    'powerups': 'Chaos',
    'powerups.0': 'Off',
    'powerups.1': 'A bit',
    'powerups.2': 'Some',
    'powerups.3': 'Lots',
    'powerups.4': 'Max',
    'sound.hint': 'Every side has its own note – a long rally plays a tune.',
    'mute': 'Mute',
    'unmute': 'Unmute',
    'language': 'Language',
    'exit.arcade': 'Back to arcade',
    'exit.close': 'Close',
    'exit.refused': 'Close this window yourself',
    'over.wins': (colour) => `${colour} wins!`,
    'over.score': (a, b) => `${a} to ${b}`,
    'rim.bot': 'robot · put a finger here',
    'rim.firstTo': (n) => `first to ${n}`,
    'rim.oneToGo': 'one to go',
    'rim.winner': 'WINNER',
    'colour.0': 'Blue',
    'colour.1': 'Pink',
    'colour.2': 'Yellow',
    'colour.3': 'Green',
    'colour.4': 'Orange',
    'colour.5': 'Purple',
    'colour.6': 'Red',
    'colour.7': 'White',
  },
};

const warned = new Set();

export function t(key, ...args) {
  let v = STRINGS[lang][key];
  if (v === undefined) v = STRINGS.en[key];
  if (v === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`Geometry Pong: no words for "${key}"`);
    }
    return key;
  }
  return typeof v === 'function' ? v(...args) : v;
}

export function paintStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) {
    const s = t(el.dataset.i18nLabel);
    el.setAttribute('aria-label', s);
    el.title = s;
  }
  // aria-label alone, for the canvas: a tooltip over the whole board would
  // follow every finger around it.
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const b of root.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}

export function setLang(next) {
  if (next !== 'nb' && next !== 'en') return;
  lang = next;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Not remembered; this visit still switches.
  }
  paintStatic();
  document.dispatchEvent(new CustomEvent('arcade:lang', { detail: lang }));
}
