// Turns the WAV takes from the hub's render.rb into geometry_pong's shipped
// audio/*.m4a. The .rb pieces beside this file are the source of truth; the
// .m4a files are outputs, so re-render rather than edit them.
//
// HOW TO RE-RENDER (needs real CoreAudio, so not from inside a sandbox):
//
//   cd geometry_pong
//   SP="/Applications/Sonic Pi.app/Contents/Resources/app/server/native/ruby/bin/ruby"
//   SONIC_PI_PIECES=tools/audio "$SP" ../tools/audio/render.rb /tmp/gp-wav \
//     hit=2 wall=1.5 goal=3 win=6 power=2 powerend=2 shield=2 bump=1.5 music-match=70
//   node tools/audio/encode.mjs /tmp/gp-wav
//
// The seconds after each name are how long render.rb records; a cue's take is
// trimmed afterwards, so they only need to outlast the sound. The music needs
// its marker beat plus two full loops plus a little tail (0.5 + 64 + ...).
//
// WHY TWO PATHS
//   Cues layer — a hit, a wall tick and a goal can land in one second — so
//   their relative loudness is the balance authored with `amp:` in the
//   pieces. They go through the hub's tools/audio/encode-oneshots.mjs, which
//   trims, applies ONE gain to the whole set and encodes mono. Music is the
//   opposite: it is per-file normalised and kept stereo, the way fishtank's
//   tools/audio/encode.mjs does it, and its level against the cues is set at
//   runtime (MUSIC_TRIM in js/audio.js), not baked in here.
//
// THE LOOP
//   music-match.rb opens with a marker tick, waits LEAD seconds, then plays
//   its LOOP-second loop twice. We keep exactly the second pass: it already
//   carries the first pass's reverb and echo tails, so when it wraps back to
//   its own start the tails are there and the seam does not gap.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, statSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(here, "../..");
const HUB_ONESHOTS = path.resolve(GAME, "../tools/audio/encode-oneshots.mjs");

// The per-game configuration: which takes are cues and how the music loops.
const CUES = ["hit", "wall", "goal", "win", "power", "powerend", "shield", "bump"];
// 64 beats at 120 bpm; the marker tick is one beat (0.5 s) before the loop.
const MUSIC = { "music-match": { loop: 32, lead: 0.5, bitrate: "128k", peakDb: -1 } };

const [wavDir, outDir = path.join(GAME, "audio")] = process.argv.slice(2);
if (!wavDir) {
  console.error("Usage: node tools/audio/encode.mjs WAV_DIR [OUT_DIR]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

function ffmpeg(args) {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
  return run.stderr;
}

// --- cues: hand a directory holding only the cue takes to the hub tool ---
const cueDir = mkdtempSync(path.join(tmpdir(), "gp-cues-"));
for (const name of CUES) {
  const src = path.resolve(wavDir, `${name}.wav`);
  statSync(src); // fail loudly on a missing take rather than ship a short set
  symlinkSync(src, path.join(cueDir, `${name}.wav`));
}
const cues = spawnSync("node", [HUB_ONESHOTS, cueDir, outDir], { encoding: "utf8", stdio: "inherit" });
rmSync(cueDir, { recursive: true, force: true });
if (cues.status !== 0) process.exit(cues.status ?? 1);

// --- music: cut the second pass and normalise it on its own ---
for (const [name, spec] of Object.entries(MUSIC)) {
  const input = path.join(wavDir, `${name}.wav`);
  const log = ffmpeg(["-i", input, "-af", "silencedetect=n=-45dB:d=0.02,volumedetect", "-f", "null", "-"]);
  const silences = [...log.matchAll(/silence_(start|end): ([\d.]+)/g)].map((m) => [m[1], +m[2]]);
  const dur = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const duration = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  // Onset of the marker tick: the end of the silence the take opens with.
  let onset = 0;
  if (silences[0]?.[0] === "start" && silences[0][1] < 0.01 && silences[1]?.[0] === "end") onset = silences[1][1];
  const start = onset + spec.lead + spec.loop;
  const end = start + spec.loop;
  if (end > duration + 0.01) throw new Error(`${name}: take too short for two loops (${duration}s)`);
  // Measure the peak of the part we keep, not of the whole take.
  const cut = `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`;
  const peakLog = ffmpeg(["-i", input, "-af", `${cut},volumedetect`, "-f", "null", "-"]);
  const peak = +(peakLog.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
  const gain = (spec.peakDb - peak).toFixed(2);
  const output = path.join(outDir, `${name}.m4a`);
  ffmpeg([
    "-i", input,
    "-af", `${cut},afade=t=in:st=0:d=0.006,afade=t=out:st=${spec.loop - 0.006}:d=0.006,volume=${gain}dB`,
    "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", spec.bitrate, "-movflags", "+faststart",
    output,
  ]);
  console.log(`${name.padEnd(12)} loop ${spec.loop}s from ${start.toFixed(3)}s, peak ${peak} dB, ${gain} dB gain`);
}

let total = 0;
for (const f of readdirSync(outDir)) if (f.endsWith(".m4a")) total += statSync(path.join(outDir, f)).size;
console.log(`\nshipped audio: ${(total / 1024).toFixed(0)} KB in ${outDir}`);
