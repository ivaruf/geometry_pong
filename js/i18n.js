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
 *   said(key, ...args)  an Error carrying its key, for the net code's failures
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
    'online': 'På nett',
    'online.tag': 'Én spiller per skjerm. Brettet snur seg, så din side alltid er nederst.',
    'online.rules': (sides, target, power) => `${sides} sider · først til ${target} · kaos: ${power}`,
    'online.host': 'Lag rom',
    'online.join': 'Bli med',
    'online.code': 'Kode',
    'online.roomTag': 'Les koden høyt. Sider ingen tar, spiller en robot.',
    'online.joinTag': 'Skriv koden fra den andre skjermen.',
    'online.guestWait': 'Venter på at verten starter.',
    'seat.you': 'deg',
    'seat.host': 'vert',
    'seat.guest': 'gjest',
    'seat.bot': 'robot',
    'live': 'Meny',
    'live.tag': 'Kampen går videre – du styrer fortsatt.',
    'rim.you': (n) => `deg · først til ${n}`,
    'rim.botOnline': 'robot',
    'status.opening': 'Lager et rom …',
    'status.broker': 'Rommet er åpent. Ikke la skjermen sovne.',
    'status.tabs': 'Fant ikke megleren på nett, så bare andre faner i denne nettleseren kan bli med.',
    'status.relay': 'Rommet går gjennom ditt eget relé.',
    'status.openFail': 'Fikk ikke laget et rom.',
    'status.looking': 'Leter etter rommet …',
    'status.in': 'Du er med.',
    'status.joined': (seat) => `${colourName(seat)} ble med.`,
    'status.left': (seat) => `${colourName(seat)} gikk – en robot tar over.`,
    'why.version': 'Den andre skjermen har en annen versjon av spillet. Last inn begge på nytt.',
    'why.full': 'Rommet er fullt.',
    'why.refused': 'Verten slapp ikke inn denne skjermen.',
    'why.hostLeft': 'Verten gikk, så rommet er stengt.',
    'err.notCode': 'Det er ikke en kode. Den har fire bokstaver.',
    'err.offline': 'Du er frakoblet, så den andre skjermen kan ikke finnes.',
    'err.brokerLoad': 'Klarte ikke å laste koden som finner andre spillere.',
    'err.brokerBroken': 'Koden som finner andre spillere virker ikke.',
    'err.timeout': 'Det tok for lang tid å finne hverandre.',
    'err.codeInUse': 'Den koden er allerede i bruk. Lag et nytt rom.',
    'err.matchFailed': (type) => `Fant ikke hverandre (${type}).`,
    'err.reopening': 'Åpner rommet igjen – koden virker kanskje ikke akkurat nå.',
    'err.codeTaken': 'Noe annet tok koden. Lag et nytt rom.',
    'err.trouble': (type) => `Trøbbel med å finne hverandre (${type}).`,
    'err.noGame': (code) => `Fant ikke noe rom med koden ${code}. Sjekk koden, og at skjermen til verten er våken.`,
    'err.noReach': (type) => `Fikk ikke kontakt med rommet (${type}).`,
    'err.noAnswer': 'Verten svarte ikke.',
    'err.rtcNoAnswer': 'Verten svarte aldri. Noen nettverk når rett og slett ikke hverandre.',
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
    'online': 'Online',
    'online.tag': 'One player per screen. The board turns so your side is always at the bottom.',
    'online.rules': (sides, target, power) => `${sides} sides · first to ${target} · chaos: ${power}`,
    'online.host': 'Create room',
    'online.join': 'Join',
    'online.code': 'Code',
    'online.roomTag': 'Read the code out loud. A robot plays any side nobody takes.',
    'online.joinTag': 'Type the code from the other screen.',
    'online.guestWait': 'Waiting for the host to start.',
    'seat.you': 'you',
    'seat.host': 'host',
    'seat.guest': 'guest',
    'seat.bot': 'robot',
    'live': 'Menu',
    'live.tag': 'The match carries on – you are still steering.',
    'rim.you': (n) => `you · first to ${n}`,
    'rim.botOnline': 'robot',
    'status.opening': 'Making a room…',
    'status.broker': 'The room is open. Keep this screen awake.',
    'status.tabs': 'Could not reach the matchmaker, so only other tabs in this browser can join.',
    'status.relay': 'The room goes through your own relay.',
    'status.openFail': 'Could not make a room.',
    'status.looking': 'Looking for the room…',
    'status.in': 'You are in.',
    'status.joined': (seat) => `${colourName(seat)} joined.`,
    'status.left': (seat) => `${colourName(seat)} left – a robot takes over.`,
    'why.version': 'The other screen has a different version of the game. Reload both.',
    'why.full': 'The room is full.',
    'why.refused': 'The host did not let this screen in.',
    'why.hostLeft': 'The host left, so the room is closed.',
    'err.notCode': 'That is not a code. It has four letters.',
    'err.offline': 'You are offline, so the other screen cannot be found.',
    'err.brokerLoad': 'Could not load the code that finds other players.',
    'err.brokerBroken': 'The code that finds other players does not work.',
    'err.timeout': 'Finding each other took too long.',
    'err.codeInUse': 'That code is already in use. Make a new room.',
    'err.matchFailed': (type) => `Could not find each other (${type}).`,
    'err.reopening': 'Reopening the room – the code may not work just now.',
    'err.codeTaken': 'Something else took the code. Make a new room.',
    'err.trouble': (type) => `Trouble finding each other (${type}).`,
    'err.noGame': (code) => `No room found with the code ${code}. Check the code, and that the host's screen is awake.`,
    'err.noReach': (type) => `Could not reach the room (${type}).`,
    'err.noAnswer': 'The host did not answer.',
    'err.rtcNoAnswer': 'The host never answered. Some networks simply cannot reach each other.',
  },
};

// A player's colour by seat, in the current language: online status lines
// name people by colour, which is how the board names them too.
const colourName = (seat) => t(`colour.${seat}`);

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

/*
 * An Error that remembers what it meant (NeonFox's said), so a failure raised
 * deep in the net code can be said again in the other language if the player
 * switches while it is still on screen. js/lobby.js reads .key and .args;
 * anything else that catches one still gets a readable .message.
 */
export function said(key, ...args) {
  const error = new Error(t(key, ...args));
  error.key = key;
  error.args = args;
  return error;
}
