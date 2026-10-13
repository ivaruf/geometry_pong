/*
 * codes.js — room codes made of pictures: NeonFox's, unchanged.
 *
 * A code is the one thing a player has to carry from one device to another,
 * and it is carried by whoever is worst at typing. So it is three pictures
 * tapped on a keypad of twelve, not letters in a text field: a kid taps it,
 * a parent pastes it into a chat, and nothing has to be translated between
 * the two. Read aloud it is three ordinary words. Hub CLAUDE.md §8 ("Room
 * codes are pictures") makes this the rule for every networked game; this
 * one first shipped with four typed letters, which is why the rule exists.
 *
 * The same twelve symbols as NeonFox, so a family that has joined one game
 * already knows the keypad of the other. The selection rule, the arithmetic
 * (12³ = 1,728 codes, deliberately small) and why they are emoji rather than
 * artwork are written down in neonfox/js/net/codes.js and not repeated here.
 */

export const SYMBOLS = Object.freeze(
  [
    { name: "fox", icon: "🦊" },
    { name: "duck", icon: "🦆" },
    { name: "bee", icon: "🐝" },
    { name: "car", icon: "🚗" },
    { name: "rocket", icon: "🚀" },
    { name: "pizza", icon: "🍕" },
    { name: "tree", icon: "🌲" },
    { name: "star", icon: "⭐" },
    { name: "moon", icon: "🌙" },
    { name: "key", icon: "🔑" },
    { name: "hat", icon: "🎩" },
    { name: "ball", icon: "⚽" },
  ].map(Object.freeze),
);

export const CODE_LENGTH = 3;

const byName = new Map(SYMBOLS.map((s) => [s.name, s]));
const byIcon = new Map(SYMBOLS.map((s) => [s.icon, s]));
const byPrefix = new Map(SYMBOLS.map((s) => [s.name.slice(0, 2), s]));

/* A fresh code. Math.random is right here: a room code is not simulation
 * state and nothing replays it (hub CLAUDE.md §10 — seed only what must
 * regenerate identically). */
export function newCode() {
  const pick = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)].name;
  return Array.from({ length: CODE_LENGTH }, pick).join("-");
}

/*
 * Accept what a human would plausibly write down. Dashes, spaces, commas and
 * the pictures themselves all separate; case is ignored; a name is matched on
 * its first two letters, so "roket", "rockets" and "rocket" are one symbol.
 * Returns the canonical dashed code, or "" if it is not a code — which the
 * caller must say out loud rather than sending a wrong id to the broker and
 * reporting "no game found" for what was really a typo.
 */
export function parseCode(text) {
  const raw = String(text ?? "").toLowerCase();
  const parts = [];
  // Pull the emoji out first: they are not letters, so the word split below
  // would drop them, and a pasted code is very often three pictures.
  for (const ch of raw) {
    const symbol = byIcon.get(ch);
    if (symbol) parts.push(symbol.name);
  }
  if (parts.length !== CODE_LENGTH) {
    parts.length = 0;
    for (const word of raw.split(/[^a-z]+/)) {
      if (!word) continue;
      const symbol = byName.get(word) ?? byPrefix.get(word.slice(0, 2));
      if (!symbol) return "";
      parts.push(symbol.name);
    }
  }
  return parts.length === CODE_LENGTH ? parts.join("-") : "";
}

/* The pictures for a code, for showing it back. Empty array if it is junk. */
export function codeIcons(code) {
  const parsed = parseCode(code);
  if (!parsed) return [];
  return parsed.split("-").map((name) => byName.get(name).icon);
}
