/*
 * audio.js — the two buses, the mute, the composed cues and the match loop.
 *
 * Every sound is a Sonic Pi piece in tools/audio/*.rb, rendered by the hub's
 * render.rb and cut by tools/audio/encode.mjs into audio/*.m4a (hub §9; the
 * header of encode.mjs says how to re-render). This file only loads and plays
 * them:
 *
 *   hit          one note, G4, played at a playbackRate per side so every side
 *                is a different note of G major pentatonic and a rally plays
 *                a tune (DESIGN.md §5). One file, eight notes.
 *   wall         a soft tick for a wall or a sealed side.
 *   goal         a bright run and a shimmer; the music ducks under it.
 *   win          the fanfare; it also fades the music out.
 *   music-match  a 32 s loop on the MUSIC bus while a match is running.
 *
 * The graph is   source → per-cue gain → sfxBus ┐
 *                source → track gain → duck → musicBus ┴→ master → out
 * Everything but the BufferSource is built once, so a cue allocates only the
 * one node WebAudio insists on per playback (a source cannot be restarted).
 *
 * Levels and mute persist under the hub's names (§2 "Two volumes", §6):
 * `<slug>.vol.music.v1`, `<slug>.vol.sfx.v1`, `<slug>.mute.v1`, every access
 * in try/catch, anything but a finite number in 0–1 ignored. The slider sets
 * the bus gain itself; mute is master gain, so unmuting gives the mix back.
 *
 * The AudioContext is created lazily on the first gesture and resumed then
 * (iOS will not start one otherwise). Files load at that moment; a cue asked
 * for before its file has decoded, or whose file failed, is simply silent —
 * failures are a console.warn, never a rejection the crash bar would see.
 */

const SLUG = 'geometry_pong'; // settled 2026-10-12; these keys can never be renamed (hub §6)
const KEYS = { music: `${SLUG}.vol.music.v1`, sfx: `${SLUG}.vol.sfx.v1` };
const MUTE_KEY = `${SLUG}.mute.v1`;
// Resolved against this module, so the files are found wherever the page is.
const BASE = new URL('../audio/', import.meta.url);

// G major pentatonic in semitones above the hit cue's G4: G A B D E G A B.
const NOTES = [0, 2, 4, 7, 9, 12, 14, 16];
const RATES = NOTES.map((n) => Math.pow(2, n / 12));

// Per-cue trims over the authored balance. encode-oneshots keeps the relative
// loudness set by `amp:` in the pieces, so these stay near 1 on purpose.
const CUES = { hit: 0.9, wall: 1, goal: 1, win: 1 };
const MUSIC = { file: 'music-match', loop: 32 };
// The loop is normalised on its own to -1 dBFS; this sits it under the cues
// so the rally's notes are the melody and the music is the floor beneath.
const MUSIC_TRIM = 0.42;
const DUCK = 0.5; // the music under a goal or the fanfare, as a fraction
const FADE_IN = 1.2;
const FADE_OUT = 0.8;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const v = raw == null ? NaN : Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch {
    /* the default stands */
  }
  return fallback;
}

function save(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* not kept; this visit still has it */
  }
}

const levels = { music: load(KEYS.music, 0.7), sfx: load(KEYS.sfx, 0.8) };
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === 'true';
} catch {
  /* audible */
}

let ctx = null, master = null, sfxBus = null, musicBus = null, duck = null;
const cueGain = {}; // name → GainNode, built once
const buffers = {}; // name → AudioBuffer once decoded, null if it failed
const loading = {}; // name → Promise<AudioBuffer|null>, never rejects

let wanted = false; // the game asked for music
let previewing = false; // a MUSIC slider drag is auditioning it
let previewTimer = 0;
let track = null; // { source, gain } of the loop that is playing, if any
let lastAudition = 0;
let lastWall = 0;
let auditionNote = 0;

/* Callback and promise forms both, for older Safari's decodeAudioData. */
function decode(data) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

function fetchBuffer(name) {
  if (!loading[name]) {
    loading[name] = fetch(new URL(`${name}.m4a`, BASE))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(decode)
      .then((b) => (buffers[name] = b))
      .catch((err) => {
        // Missing sound is a quieter game, not a broken one.
        console.warn(`audio: "${name}" unavailable`, err);
        return (buffers[name] = null);
      });
  }
  return loading[name];
}

function ensure() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    ctx = new AC();
    master = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    duck = ctx.createGain();
    duck.connect(musicBus);
    sfxBus.connect(master);
    musicBus.connect(master);
    master.connect(ctx.destination);
    for (const name in CUES) {
      cueGain[name] = ctx.createGain();
      cueGain[name].gain.value = CUES[name];
      cueGain[name].connect(sfxBus);
    }
    apply();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    ctx = null;
    return false;
  }
  for (const name in CUES) fetchBuffer(name);
  fetchBuffer(MUSIC.file);
  if (wanted) startMusic();
  return true;
}

function apply() {
  if (!ctx) return;
  master.gain.value = muted ? 0 : 1;
  sfxBus.gain.value = levels.sfx;
  musicBus.gain.value = levels.music;
}

/* Glide a param rather than jump it, so a drag or a mute never clicks. */
function glide(param, value) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, 0.03);
}

// The first touch, click or key anywhere unlocks audio. touchend and click
// are there for older iOS, which only unlocks inside those.
for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
  addEventListener(type, () => ensure(), { capture: true, passive: true });
}

function play(name, rate = 1) {
  if (!ctx || muted) return;
  const buffer = buffers[name];
  if (!buffer) return; // not decoded yet, or failed: silence
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(cueGain[name]);
    src.start();
  } catch {
    /* a cue that cannot play is skipped */
  }
}

/* Dip the music under a moment that matters, then let it come back. */
function duckMusic(hold) {
  if (!track) return;
  const g = duck.gain, now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(DUCK, now + 0.04);
  g.setValueAtTime(DUCK, now + hold);
  g.linearRampToValueAtTime(1, now + hold + 0.6);
}

// Some decoders keep the AAC encoder's priming silence at the front of the
// buffer; loop from the first real sample so the seam does not gap (hub §9).
function firstSound(buffer) {
  const data = buffer.getChannelData(0);
  const limit = Math.min(data.length, buffer.sampleRate * 0.2);
  for (let i = 0; i < limit; i++) if (Math.abs(data[i]) > 1e-4) return i / buffer.sampleRate;
  return 0;
}

function startMusic() {
  if (!ctx || track) return;
  const buffer = buffers[MUSIC.file];
  if (buffer === undefined) {
    // Still loading: try again once it lands, if it is still wanted then.
    fetchBuffer(MUSIC.file).then(() => {
      if ((wanted || previewing) && buffers[MUSIC.file]) startMusic();
    });
    return;
  }
  if (!buffer) return;
  try {
    const start = firstSound(buffer);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = Math.min(buffer.duration, start + MUSIC.loop);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(MUSIC_TRIM, now + FADE_IN);
    source.connect(gain);
    gain.connect(duck);
    source.start(now, start);
    track = { source, gain };
  } catch {
    track = null;
  }
}

function stopMusic(seconds = FADE_OUT) {
  if (!track) return;
  const { source, gain } = track;
  track = null;
  try {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + seconds);
    source.stop(now + seconds + 0.05);
  } catch {
    /* already stopped */
  }
}

export const audio = {
  isMuted: () => muted,
  setMuted(m) {
    muted = !!m;
    save(MUTE_KEY, muted);
    if (ctx) glide(master.gain, muted ? 0 : 1);
  },
  level: (bus) => levels[bus],
  /* A slider moved: store it, lift the mute, and let it be heard. */
  setLevel(bus, v) {
    if (!(bus in levels) || !Number.isFinite(v)) return;
    levels[bus] = Math.min(1, Math.max(0, v));
    save(KEYS[bus], levels[bus]);
    if (muted) this.setMuted(false);
    if (!ensure()) return;
    glide(bus === 'sfx' ? sfxBus.gain : musicBus.gain, levels[bus]);
    if (bus === 'sfx') {
      // Throttled on the audio clock, not the sim's, which is held while the
      // menu is open (hub §2). Each audition walks up the scale, so a drag
      // plays the same little tune a rally does.
      if (ctx.currentTime - lastAudition > 0.12) {
        lastAudition = ctx.currentTime;
        play('hit', RATES[auditionNote++ % RATES.length]);
      }
    } else {
      // MUSIC: the loop is usually stopped while the menu is open, so a drag
      // brings it in and lets it fade a moment after the drag ends.
      previewing = true;
      startMusic();
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        previewing = false;
        if (!wanted) stopMusic();
      }, 1500);
    }
  },
  /* The match loop: true when a match starts or resumes, false otherwise. */
  music(on) {
    wanted = !!on;
    if (wanted) startMusic();
    else if (!previewing) stopMusic();
  },
  /* The fanfare for match over; it takes the music out with it. */
  win() {
    wanted = false;
    if (!previewing) stopMusic(0.4);
    play('win');
  },
  /* The sim's events, as sound. */
  event(e) {
    if (!ctx || muted) return;
    if (e.type === 'hit') play('hit', RATES[e.player % RATES.length]);
    else if (e.type === 'goal') {
      play('goal');
      duckMusic(0.5);
    } else if (e.type === 'wall') {
      // Several balls on one wall in a tick are one tick to the ear.
      if (ctx.currentTime - lastWall < 0.03) return;
      lastWall = ctx.currentTime;
      play('wall');
    }
  },
};
