/*
 * codes.js — room codes: four letters.
 *
 * A code is the one thing a player has to carry from one device to another,
 * usually out loud across a room. NeonFox and fishtank use pictures, which
 * suit a keypad of twelve emoji; this game's lobby has a plain text field
 * (the owner's spec), and a text field wants something you can type on any
 * keyboard in either language. So: four capital letters, read out as
 * letters.
 *
 * The alphabet drops I, O and Q, which read as 1, 0 and O on a small screen
 * or said quickly, and has no Æ, Ø or Å, which an English keyboard cannot
 * type. 23 letters, four slots: 279,841 codes. Only rooms open at this
 * moment can collide, and the broker reports a taken code rather than
 * letting two rooms share one (js/net/rendezvous.js).
 */

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export const CODE_LENGTH = 4;

/* A fresh code. Math.random is right: a code is not simulation state and
 * nothing replays it (hub CLAUDE.md §10). */
export function newCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return code;
}

/*
 * What a human plausibly typed: any case, spaces or dashes between letters,
 * and the three left-out letters read as what they were mistaken for — an O
 * or a 0 is nobody's typo for a letter that does not exist, so it is not
 * guessed at; it makes the code invalid and the lobby says so. Returns the
 * canonical code, or "" if it is not one.
 */
export function parseCode(text) {
  const raw = String(text ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
  if (raw.length !== CODE_LENGTH) return '';
  for (const ch of raw) if (!LETTERS.includes(ch)) return '';
  return raw;
}
