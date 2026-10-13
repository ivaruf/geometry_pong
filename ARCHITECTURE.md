# Geometry Pong — architecture and lane contract

Who owns which file, and the contracts that let agents meet without reading
each other's code (hub CLAUDE.md §12). Change a contract here first, then in
the code. DESIGN.md says what the game is; this says how the pieces fit.

## Files and owners

| file | owner | what |
| ---- | ----- | ---- |
| `js/sim.js` | integrator | the rules: arena, balls, paddles, bots, score, pickups, effects; no DOM |
| `js/render.js` | integrator | draws a Match; calls each power-up's `glyph` and `draw` |
| `js/powerups/index.js` | integrator | the list of power-ups |
| `js/powerups/slow.js` | integrator | the reference power-up |
| `js/powerups/split.js`, `bigball.js`, `rush.js` | lane A | |
| `js/powerups/gravity.js`, `bumpers.js`, `curve.js` | lane B | |
| `js/powerups/wide.js`, `shrink.js`, `shield.js` | lane C | |
| `js/audio.js`, `tools/audio/**`, `audio/**` | sound lane | |
| everything else (`main.js`, `ui.js`, `input.js`, `i18n.js`, `index.html`, `css/`, `sw.js`, docs) | integrator | |

A lane that needs something from a file it does not own — a new sim hook, an
event the renderer should react to, a sound — **asks in its report** rather
than editing that file.

## Coordinates

Sim space, circumradius 1, origin at the centre, **y down**. Side `s` has
outward normal `(s.ux, s.uy)`, tangent `(s.tx, s.ty)`, distance `s.a` from
the centre, half length `s.half`. `match.players[i]` is player `i`'s side;
`s.player` is its index; `COLORS[i]` its colour. `match.inradius` is the
nearest side's distance from the centre. Time in seconds.

## Power-ups

A ball that touches a pickup collects it **for whoever hit that ball last**
(`fx.by`, or -1 when nobody has: a fresh serve). How many appear is
`match.powerLevel`, 0 (off: plain Geometry Pong) to 4 (chaos), from the
menu slider. The sim picks one at random by `weight` from every definition
not marked `ready: false`.

### The definition

Each file exports one object:

```js
export default {
  id: 'slow',                          // unique, = file name
  name: { nb: 'Sakte', en: 'Slow' },   // shown on the collector's rim; short
  colour: '#8fd3ff',                   // the pickup's ring and glyph
  duration: 6,                         // seconds; 0 = instant (collect only)
  weight: 1,                           // spawn weight relative to the others
  global: true,                        // optional: one effect whoever collects it

  collect(match, fx, ball) {},         // once, when picked up (optional)
  tick(match, fx, dt) {},              // every sim tick while it lasts (optional)
  end(match, fx) {},                   // once, when it runs out (optional)

  glyph(ctx, r, time, px) {},          // the icon inside the pickup ring
  draw(ctx, match, fx, time, px) {},   // an overlay while it lasts (optional)

  pack(match, fx) {},                  // online: what draw needs from fx.data, as numbers (optional)
  unpack(match, fx, nums) {},          // online, on a guest: rebuild fx.data from them (optional)
};
```

`fx` is `{ def, by, t, dur, data, x, y }`: `t` counts up to `dur`, `data` is
yours to keep state in, `x, y` is where it was picked up. Collecting a timed
power-up that is already running refreshes `t` to 0 instead of starting a
second one (`collect` is not called again) — when it is running **for the
same owner**, or, for a definition marked `global: true`, **for anyone**.
Mark every power-up that acts on the whole field (all balls, all paddles)
`global`, or two players collecting it multiply it.

An effect may write its own `fx.dur`: lower it to end early (Shield does,
once its charge is spent, leaving time for the break to play out), or raise
it. The sim ends the effect on the first tick where `fx.t >= fx.dur`.

**Colours taken** — pick a new one clear of these and of the eight player
colours: Slow `#8fd3ff`, Split `#5cffb0`, Big ball `#f5a3ff`, Rush
`#ffcf8a`, Wide `#4d7cff`, Shrink `#c6ff3d`, Shield `#bfefff`.

### What a power-up may touch

Everything goes through these; never special-case a power-up in `sim.js`.

- **Modifiers, rewritten every tick.** Before effects tick, the sim resets
  them to neutral; `tick` multiplies in its own. When an effect ends it simply
  stops writing, so `end` rarely has anything to undo.
  - `match.mods.ballSpeed` — how far every ball moves per tick
  - `match.mods.ballRadius` — every ball's radius, collisions included; read
    the live value with `match.ballR()`
  - `side.mods.hl` — that paddle's half length (clamped to 90 % of its side)
  - `side.mods.speed` — that paddle's top speed
- **Counters the sim spends.**
  - `side.shield` — goals that side can still turn away; the sim reflects
    the ball just behind the paddle line and decrements it, emitting
    `{ type: 'shield', side, x, y, nx, ny }`
  - `ball.extra` — a ball that vanishes on its first goal instead of being
    served again
- **Helpers.** `match.addBall(from, turn)` makes an `extra` copy of a ball,
  heading turned by `turn` radians. `match.random()` for anything random
  (never `Math.random()` in sim code: online will need the host's stream).
- **Balls directly**, in `tick`: `b.x, b.y, b.vx, b.vy` (velocity in
  units/s; `b.speed` is its nominal speed, which paddle hits ramp), skipping
  balls with `b.wait > 0` (waiting to be served) or `b.dead`. A power-up that
  bounces balls off something of its own (bumpers) does its own collision in
  `tick` and pushes `{ type: 'bump', x, y, colour }` to `match.events` for
  the sparks. Keep every ball inside the arena: never move one past a side.

### Drawing

`glyph` and `draw` are called by `render.js` with the canvas already in sim
space (y down, units of circumradius) and `'lighter'` compositing on.
`glyph` is translated to the pickup's centre; `r` is the glyph radius
(about 0.045). `px` is one CSS pixel in sim units — use it for line widths
(`2 * px`). Set your own `strokeStyle` / `fillStyle` / `lineWidth`;
`globalAlpha` arrives set to the pickup's fade and you should multiply into
it, not overwrite it, in `glyph`. No `shadowBlur`, no allocation per frame
beyond a path, and nothing that reads the DOM.

### Online: pack and unpack

Online (DESIGN.md §6) only the host runs the sim. A guest draws from a
*shadow* Match the snapshots overwrite: `fx.def`, `fx.by`, `fx.t`, `fx.dur`,
`fx.x`, `fx.y`, the balls, the paddles and `match.mods.ballRadius` all
arrive, so a `draw` that reads only those needs nothing more. **`fx.data`
does not travel by itself**, so a power-up whose `draw` reads `fx.data`
(Black hole's well, Bumpers' positions, Curve's per-ball spin, Shield's
break) provides the pair:

- `pack(match, fx)` on the host returns an array of plain numbers — at most
  40, each within ±32, sent at 1/1000 — holding exactly what `draw` reads.
- `unpack(match, fx, nums)` on a guest rebuilds `fx.data` from them, after
  the shadow's balls are in place, so per-ball state can be keyed by
  `match.balls[i]` in the same order the host packed it. It runs every
  snapshot (60 a second) and should not keep anything it would not rebuild.

A guest never calls `collect`, `tick` or `end`, so `unpack` is the only way
anything gets into a guest's `fx.data`. Without the pair the effect still
plays on the host's sim — it just draws nothing on a guest's screen.

### Rules of taste

- Readable by an eight-year-old from the glyph alone, in a fast game.
- Short: 4–10 s. Nothing that hides the ball, reverses controls, or moves
  the arena — those read as broken, not fun.
- Bots ignore pickups and must still play sensibly under every effect.
- `reduced motion` is the renderer's job; keep overlays calm anyway.

### Checks

`node --check` every file you touch, and `node tools/sim-smoke.mjs`, which
plays every shape with power-ups off and at level 4 and fails if a match
does not finish, a ball escapes or goes non-finite, or the ball count runs
away.
