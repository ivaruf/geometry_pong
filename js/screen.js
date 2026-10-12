/*
 * screen.js — the fullscreen plate, outermost in the corner (#corner).
 *
 * SELF-CONTAINED: imports nothing, exports nothing, loaded as its own module
 * so a game that fails to boot still keeps the button that makes it bigger.
 * NOT NAMED fullscreen.js — a default uBlock list bans that basename across
 * github.io, and one blocked file is a blank game (hub CLAUDE.md §2).
 *
 * Shown only once a working request/exit pair answers: iPhone Safari has no
 * element fullscreen, and a button that does nothing is worse than none. The
 * label and aria-pressed are repainted from fullscreenchange, because Escape
 * and the browser's own chrome leave fullscreen without touching the button,
 * and CSS swaps the glyph off the same aria-pressed so the two cannot drift.
 *
 * NO ORIENTATION LOCK. The tabletop wants the board fixed to the glass, and
 * main.js does that itself by counter-rotating (js/render.js); a lock would
 * only work in fullscreen and only on some browsers.
 */

const button = document.getElementById('screen-toggle');
const root = document.documentElement;

/*
 * Every spelling a browser has shipped. Old Android Chrome and the stock
 * browser only know the capital-S webkit pair (RequestFullScreen /
 * CancelFullScreen), which the unprefixed check alone would miss — and a
 * slow old tablet is exactly the device this game is played on.
 */
const request =
  root.requestFullscreen || root.webkitRequestFullscreen || root.webkitRequestFullScreen || root.mozRequestFullScreen || null;
const exit =
  document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen || document.mozCancelFullScreen || null;

function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.webkitCurrentFullScreenElement ||
    document.mozFullScreenElement
  );
}

/* Its own two words per language: this file imports nothing, js/i18n.js included. */
const WORDS = {
  nb: ['Fullskjerm', 'Avslutt fullskjerm'],
  en: ['Fullscreen', 'Exit fullscreen'],
};

function paint() {
  const active = isFullscreen();
  const words = WORDS[document.documentElement.lang] || WORDS.nb;
  const label = active ? words[1] : words[0];
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', label);
  button.title = label;
}

if (button && request && exit) {
  button.hidden = false;
  paint();
  button.addEventListener('click', () => {
    // Either call may return a promise that a permissions policy or a
    // declined prompt rejects; fullscreenchange reports what really
    // happened, so the rejection is swallowed rather than reaching the
    // crash bar.
    try {
      const result = isFullscreen() ? exit.call(document) : request.call(root);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // An old engine that throws instead: nothing changed, nothing to say.
    }
  });
  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
  document.addEventListener('mozfullscreenchange', paint);
  // js/i18n.js announces a language switch; repaint the label in the new one.
  document.addEventListener('arcade:lang', paint);
}
