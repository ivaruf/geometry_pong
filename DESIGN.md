# Geometry Pong — design

Pong on a regular polygon. Two players play on the classic court; three play
on a triangle, four on a square, and so on up to an octagon. Every side is
somebody's goal and every goal has a paddle on it. **Nobody is ever knocked
out**: it is a race to a score. A ball through your side gives a point to
whoever touched it last, and your side **seals into a wall for a moment** —
so the whole table turns on you for one goal, not for five.

The slug is `geometry_pong`, settled 2026-10-12: the repo, the URL and every
storage key carry it. Designed 2026-10-11.

---

## 1. The arena

**A regular N-gon, N = 2 … 8**, inscribed in a circle of radius `R = 1` in sim
units, centred on the origin. Side `i` has an inward unit normal `nᵢ`, a
tangent `tᵢ` (pointing anticlockwise) and an offset, so a ball's distance to
the side is one dot product. Sides are numbered anticlockwise from the one at
the bottom of the host's screen.

**N = 2 is not a polygon**, so it is a special case on purpose: a rectangle
whose two short sides are goals and whose two long sides are walls — the
classic court, aspect about 4:3, goals at top and bottom so that, rotated to
your own view (§4), it is vertical Pong with you at the bottom. Internally it
is a 4-gon with two sides flagged `wall`, so the collision code has no N = 2
branch at all.

**A side is one of three things**: a player's goal (human or bot), a wall
(an empty seat the host chose not to fill with a bot), or **sealed** — a goal
that has just conceded and is a wall for a moment (§2). Walls are drawn as
solid dim edges so nobody mistakes them for an undefended goal.

**The shape is fixed for the whole match.** The number of sides is chosen
before it starts and never changes, because nobody leaves.

**Corners get bumpers.** A triangle's corners are 60° and a ball that enters
one can rattle between two walls faster than anything reads. Each corner has
a small round cap that deflects outward, and paddles stop short of it, so
there is always a sliver at the very corner that no paddle covers — a
deliberate, visible target for a well-angled shot.

### Ball physics

- **Fixed timestep**, 120 Hz sim, render interpolated (hub §10). Speed is
  capped so a ball moves less than its own radius in one step; no tunnelling,
  no swept collision code.
- **Paddle bounce is classic Pong**: where it hits decides where it goes. The
  hit offset `u ∈ [-1, 1]` along the paddle rotates the outgoing direction
  away from `nᵢ` by up to ±55°, plus a little "english" from the paddle's own
  velocity. Centre is a straight return; the edge is the sharp angle.
- **Speed ramps** 4 % a hit, capped, and resets on every serve.
- **Anti-stall**: no bounce may leave within 20° of a side's tangent (on an
  octagon a shallow ball can otherwise skim a wall for seconds), and if no
  paddle has touched a ball for 10 s it speeds up until one does.
- **Ball count scales with sides**: one ball for 2–3, two for 4–6, three for
  7–8. An octagon with one ball is seven people watching one rally.
- **The serve.** A ball that goes in is replaced from the centre, aimed at a
  random side that is not sealed, with a one-second telegraph arrow so nobody
  is served at before they can see it. The other balls play on — a goal does
  not stop the game for the people not involved in it.

## 2. Scoring

**First to the target wins.** The host picks it: 5, 10, 15 or 20 (default
10). There are no lives, no rounds and no eliminations — one continuous game
from the first serve to the winning goal, and everyone plays all of it.

**A goal is a point for the last paddle to touch that ball**, and nothing for
anyone else:

| ball goes through your side, last touched by… | result                 |
| --------------------------------------------- | ---------------------- |
| another player                                | +1 to them             |
| you (an own goal)                             | no point to anyone     |
| nobody (a serve nobody returned)              | no point to anyone     |

Nobody ever *loses* a point; conceding costs you only the point somebody else
gained. Because credit goes to the last toucher, **the ball wears that
player's colour** (§5): you can always see who a ball is about to score for,
and a ball you just returned is visibly yours to bank.

**Then your side seals.** For 2 s after a goal the side that conceded becomes
a wall: the paddle dims, a bright barrier draws across the gap, and anything
that hits it bounces off as from any wall. Two reasons, both about fairness:

- **No pile-on.** With two or three balls in play, a player who has just been
  beaten is often out of position, and without the seal a second ball can walk
  through the same gap a moment later. The seal makes a goal a single event.
- **It changes the board for a moment.** A sealed side is a bank shot for
  everyone else, so the two seconds after a goal are a little burst of new
  angles rather than dead time.

The seal starts at once, before the ball has finished leaving, so the ball
that scored and the barrier arrive together — that is the moment worth
dressing up (§5). A sealed side's paddle still moves, so the player can get
back in position before it opens.

**Ties are impossible** in a race: goals are resolved one tick at a time, so
two balls going in "at once" still score in an order, and the first to reach
the target wins.

## 3. Power-ups

**Gameplay only, earned in the match, gone when they expire**: the
in-fiction kind, like dam_break's budget, nothing to do with hub §7's
cosmetics. How many appear is the **Kaos / Chaos** slider on the start
screen: Av / Litt / Noe / Mye / Maks (Off / A bit / Some / Lots / Max).
**Av is plain Geometry Pong**, with no pickups at all.

A pickup appears in the middle of the field; **a ball that touches it
collects it for whoever hit that ball last**. Pickups are aimed at, not
driven to, and the personal ones fizzle when a fresh serve touches them. Each
is a pixel-art badge, and collecting one is a pixel explosion and a flash in
its colour, with its name on the collector's rim. Ten, one file each under
`js/powerups/` (ARCHITECTURE.md has the contract):

| power-up | nb | does | for |
| -------- | -- | ---- | --- |
| Slow | Sakte | every ball to ~half speed, 6 s | everyone |
| Split | Del | the ball becomes two; the extra vanishes on its first goal | everyone |
| Big ball | Stor ball | balls 1.8× bigger, 8 s | everyone |
| Rush | Fart | balls 1.4× faster, 6 s | everyone |
| Black hole | Sort hull | a well bends every ball's path, 7 s | everyone |
| Bumpers | Sprettballer | 3–5 round bumpers in the field, 10 s | everyone |
| Curve | Skru | balls swerve the way the paddle moved, 8 s | everyone |
| Wide | Bred | your paddle +50 %, 10 s | the collector |
| Shrink | Krymp | every other paddle −30 %, 8 s | the collector |
| Shield | Skjold | a barrier turns your next goal away, up to 12 s | the collector |

The field-wide ones are `global`: two players collecting one refresh it, never
double it. A pickup spawns nudged towards whoever is furthest behind, so the
trailing player has the easiest shot at it — the only catch-up mechanic.

The controls stay one axis: left and right, nothing else.

## 4. Who sits where, and which way is down

Four ways in, and the board's orientation is a different question in
each. Named plainly on the start screen (hub §2): **Solo / Alene**, **Two
players / To spillere** (one keyboard, like NeonFox), **Tabletop / Bordspill**
(one touch screen, many fingers), and **Online / På nett**.

**The controls are left and right, nothing else**: ← → for player one, A / D
for player two. Every rule below exists to keep "left" meaning left on the
screen in front of you.

### Online: the board turns — decided

Each device has one player, so each device draws the board **turned so its
own side is flat at the bottom** (the owner's call, 2026-10-13). The case for
it is the controls, not the look: on a fixed hexagon your side may be the
upper-right one, and on a fixed square it may be a vertical one, where left
and right mean nothing.

- Set once when the match starts, never moved during play. Rotation only,
  never a mirror, so an angle shot looks the same to the shooter as to
  everyone else. Keys and fingers are turned with it, so left is always left.
- The rim text, which faces each edge on a tabletop, stands upright on every
  screen online, because everyone reads their own screen from one side.
- Local modes (tabletop, keyboard, solo) are unchanged: their board is fixed.
- The host sits on side 0, which is already at the bottom, so its board does
  not turn at all.

### Two players, one keyboard

The board cannot turn for two people looking at one screen, so the board is
fixed and **the two humans are seated where left and right still make sense**:
player one (← →) on the bottom side, player two (A / D) on the side whose
normal points most nearly up — the top side on an even polygon, the upper-left
one on an odd one. The keys move the paddle screen-left and screen-right,
projected onto the side. No keyboard seat is ever steeper than 60°, which is
what the "most nearly up" rule guarantees for every N from 2 to 8. Every other
side is a bot or a wall.

A device could later bring both its players into an online room, as NeonFox
allows. That device would then use this fixed seating rather than turning the
board. Not built: online is one player per device.

### Tabletop: one tablet, many fingers

The board is fixed and the people move: tablet flat on the table, everybody
at their own edge. `proto/tabletop.html` exists to test exactly this (published
as a private artifact to open on the iPad). What it does, and what it found
worth deciding:

- **No lobby.** Put a finger on your edge and you are playing; lift it and a
  bot takes your side after 2 s. A side nobody touches is a bot all along.
  Somebody walking up to the table mid-game just puts a finger down.
- **The screen is split into wedges**, one per side, from the centre out. A
  finger is given to the wedge it lands in and **keeps that side until it
  lifts**, even if it slides into a neighbour's wedge — otherwise two people
  reaching for the same corner steal each other's paddle.
- **The middle controls nothing.** A touch inside half the arena's inradius
  is ignored, so pointing at the ball, or a kid reaching across the board,
  never moves a paddle.
- **Newest finger wins** within a side; lift it and the side falls back to the
  next finger still resting there, so a resting thumb is harmless.
- **The paddle follows the finger** (absolute, projected onto the side), at a
  capped speed so a second finger landing cannot teleport it.
- **Arena inset for fingers.** The polygon leaves a rim around it so a finger
  can sit outside the play field and not cover the ball it is trying to hit.
  Names and scores live in that rim, facing the person sitting there.
- **Palms** are rejected where the browser reports contact size (very large
  contacts ignored). The prototype draws every touch it sees, so whether
  Safari reports it is something to find out on the iPad, not to assume.

Three hazards that are the platform's, not the game's, and cannot be fixed in
code — the start of a tabletop game should say so once:

- **iPadOS multitasking gestures**: four or five fingers swiping or pinching
  switch apps, and a table of hands will trigger it. **Guided Access**
  (triple-click the side button) disables them and keeps the game in front.
- **Auto-rotate**: a tablet lying flat flips orientation when somebody
  bumps it, and everybody's side moves to a different person. The prototype
  counter-rotates the board from `screen.orientation.angle` so it stays fixed
  to the glass (untested sign; that is what the checkbox is for). The
  Control Centre rotation lock is the sure fix.
- **Safari's edge swipe** goes back a page. Running from the Home Screen or in
  fullscreen avoids it, which is one more reason for the fullscreen plate.

How many fit is a physical question: two to four is comfortable on an 11"
iPad, six is crowded, eight is a game for a big screen. The prototype allows
all of them so that is something to find out by trying.

## 5. Graphics

Canvas 2D and a DOM overlay (hub §2): this is a flat game and Babylon would
buy nothing. The look is **neon geometry on black** — every shape is a stroked
line with a glow, and the polygon is echoed everywhere.

- **Glow without `shadowBlur`.** Per-frame blur is the slow path on an old
  tablet. Glow sprites (a soft disc, a soft line cap) are pre-baked to
  offscreen canvases on resize and drawn with `globalCompositeOperation =
  'lighter'`, which is also what makes crossing light add up.
- **Each player owns a colour and a shape** — colour for the eye, a small
  glyph (circle, triangle, square, diamond, …) beside the name so the game
  still reads to a colour-blind player.
- **The ball takes the colour of its last hitter** and leaves a fading trail
  from a ring buffer; it heats towards white as it speeds up.
- **Hits**: a shockwave ring from the paddle, sparks along the normal, the
  side's edge flashes. Each side's hit sound is a different note of one
  pentatonic scale (one Sonic Pi cue at a `playbackRate` per side, hub §9),
  so a long rally on a hexagon plays a tune.
- **Goals**: the ball bursts in the scorer's colour as it crosses the line,
  the scorer's number on the rim ticks up with a pop, and the conceding side
  **seals** — a barrier in the scorer's colour slams across the gap from both
  corners at once and hums for its 2 s, then fades from the middle outward as
  the goal reopens, so everyone can see the exact moment it is live again.
  The one moment worth a short screen shake.
- **Close to winning**: a player one goal from the target gets a slow pulse
  along their edge, so the whole table knows who to stop.
- **Background**: faint concentric copies of the arena's own polygon,
  slowly counter-rotating, pulsing on the music's beat.
- **The title screen plays itself**: bots on a polygon that gains a side every
  few seconds, 2 → 8 and back, behind the wordmark. It is the argument for the
  game before anyone has read a word.
- **`prefers-reduced-motion`** turns off the shake and the background spin
  and halves the particles.

## 6. Multiplayer

**Built 2026-10-13** as described here; `docs/P2P.md` has what was measured,
the lanes, the frame and the trades. Hub §8, and **NeonFox is the reference
to copy**, because it is the newest
host-authoritative game here and its `js/net/` is already the fishtank shape
in plain ES modules: host-authoritative star, sim in a Web Worker, reliable
lane for roster and events, lossy lane for state frames, three-tier
signalling (`<meta name="signal-url">`, the PeerJS broker namespaced
`<slug>-v1-<code>`, `BroadcastChannel`). Copy it into this repo and trim it;
how shared hub code is kept in sync is still the open question of hub §7, so
do not invent a shared package for it.

Snapshots, not lockstep, for NeonFox's reason (its `docs/P2P.md`): the
bounce angle is a `cos`/`sin`, and V8 and Safari's JavaScriptCore disagree in
the last bit — and the expected room is a laptop and an iPad.

**Where Pong differs from NeonFox: your own paddle cannot wait for the host.**
A rider that turns 60 ms late feels fine; a paddle that moves 60 ms after your
thumb feels broken. So:

- **Your paddle is yours.** The guest moves its own paddle locally and draws
  it at once, and sends its *position* (not its input) every tick. The host
  accepts it clamped to the paddle's maximum speed since the last one, so a
  guest cannot teleport — validation per §8, it just validates a position
  instead of an axis.
- **Balls are extrapolated, not interpolated.** Between bounces a ball moves
  in a straight line, so the guest can draw it where it is *now* rather than
  where it was a frame ago. Bounces come from the host.
- **A small grace on hits.** The host counts a hit if the guest's paddle was
  covering the contact point at any reported position within the last ~100 ms.
  That forgives a fair amount of lag and is a trade worth writing down: on a
  bad connection the guest occasionally gets a save the host's own screen did
  not show.
- **Snapshots are tiny**: at most three balls, eight paddles, one pickup,
  the scores and which sides are sealed. A binary codec anyway, shared by both ends.
- **Sides are seats.** Joining takes a bot's side, mid-match included;
  leaving turns your side back into a bot, never a hole, so a dropped
  connection does not hand everyone a free goal. The host picks sides, first
  to and Kaos on its start screen; guests see the room's rules in the lobby.
- **Power-ups work online.** Pickups and effects ride in every frame, and the
  four whose overlays draw from their own state (the well, the bumpers, the
  curve's spin, the shield's break) pack it for the guest (ARCHITECTURE.md,
  "pack and unpack"). Sounds and sparks on a guest come from the host's
  events, relayed by type and id, never as words.
- **The menu does not pause online** (hub §2): the plate opens the panel and
  your paddle stays live behind it.
- Honest limits, as in fishtank and NeonFox: no TURN, so some pairs never
  connect; no host migration; the host can cheat.

**Bots** matter more here than in most games: they fill empty sides, take
over dropped players, and are the whole of Solo. Three levels — they read the
ball's predicted crossing point on their side and aim for it, with a reaction
delay and an aim error per level, and the top level aims its returns at the
weakest-looking side.

## 7. Settings

The host's, carried to every guest with the welcome (as NeonFox does):

| setting  | values                              | default            |
| -------- | ----------------------------------- | ------------------ |
| Sides    | Auto (one per player), 2 … 8        | Auto               |
| Empty sides | Bots / Walls                     | Bots               |
| Bots     | Easy / Normal / Hard                | Normal             |
| First to | 5 / 10 / 15 / 20                    | 10                 |
| Upgrades | On / Off                            | On                 |

The player's own, behind the three-bar plate with the volumes and language:
MUSIC, EFFECTS, Språk / Language.

## 8. The floor

None of this is optional and all of it is in hub `CLAUDE.md` §2–§4; listed so
the first build arrives with it rather than being swept later:

- Three plates top right, exact glyph paths; "Back to arcade" on the first
  screen and in the menu panel; the Escape ladder.
- Norwegian first, `arcade.lang.v1`, the shared glossary, canvas text
  repainted live.
- MUSIC and EFFECTS sliders, `<slug>.vol.music.v1` / `.vol.sfx.v1`.
- `touch-guard.js` and the three-layer CSS; the play surface `touch-action:
  none`.
- `screen.js` for fullscreen, never a blocklisted basename.
- Landscape-phone menus that do not scroll (maxgear's grid-area shape).
- `sw.js` cache-first, opt-in update, `cache: 'reload'`, slug-prefixed
  cleanup; manifest and `tools/make-icons.py` drawing the polygon procedurally.
- Sonic Pi for every sound; no runtime synthesis.

## 9. Shape of the code

Built so far (README has the file list): `js/sim.js` holds every rule with no
DOM, `js/render.js` draws, `js/input.js` turns fingers and keys into one input
per side, `js/ui.js` and `js/main.js` carry the hub's menus, corner and
Escape ladder. `tools/sim-smoke.mjs` plays every shape headless.

Built since: pickups and the ten power-ups (`js/powerups/`), the Sonic Pi
cues (`tools/audio/`), and Online — `js/net/` copied and trimmed from NeonFox,
`js/lobby.js` for the card. `ARCHITECTURE.md` is the lane contract (hub §12).

## 10. Open questions for the owner

1. ~~Turn the board online, or not~~ — turned (§4), decided 2026-10-13.
2. **How long the seal lasts.** 2 s is a guess; it wants a playtest with three
   balls on a hexagon, where it matters most.
3. **Own goals.** They score nothing today. The alternative is a point to the
   player who touched the ball before you, which rewards forcing a mistake but
   is invisible on the board.
