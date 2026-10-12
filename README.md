# Geometry Pong

Pong on a polygon. Two players play on the classic court, three on a
triangle, and so on up to an octagon. Every side is somebody's goal. A ball
through your side gives a point to whoever touched it last, and your side
seals into a wall for two seconds. First to the target wins.

Play it round one tablet with a finger on each edge, on one keyboard
(← → and A D), or alone against the bots, which take any side nobody is
playing. The Kaos slider adds power-ups, from none to a lot. Online play over WebRTC is designed (DESIGN.md §6) and not built.

## Running it

Serve the hub directory and open `/geometry_pong/`:

```sh
cd ~/projects/games && python3 -m http.server 7777
```

ES modules over HTTP; `file://` is not supported. Served on its own, the
arcade's `../arcade/exit.js` 404s and the "Back to arcade" button stays
hidden, which is expected.

## Layout

```
index.html            page shell: canvas, the cards, the corner, crash bar
css/style.css         the cards and the corner
js/sim.js             THE GAME: polygon, balls, paddles, bots, score, pickups; no DOM
js/powerups/          one file per power-up, and index.js listing them (ARCHITECTURE.md)
js/render.js          draws a Match on the canvas; the view transform
js/input.js           fingers and keys -> one input per side
js/ui.js              start screen, menu panel, match over, the arcade door
js/main.js            loop, states, Escape, the rotation fix
js/audio.js           buses, mute, the cues and the match music
audio/                shipped .m4a renders (hit, wall, goal, win, music-match)
js/i18n.js            bokmål and English
js/screen.js          the fullscreen plate (self-contained)
js/update.js          service worker registration and UPDATE READY (self-contained)
js/touch-guard.js     no text selection or long-press menu (classic script)
sw.js                 opt-in-update precache
tools/make-icons.py   the icon set; the script is the source, not the PNGs
tools/sim-smoke.mjs   bots play a match on every shape, headless
tools/audio/          Sonic Pi pieces (.rb) and encode.mjs; the pieces are the source
```

## Checks

```sh
node tools/sim-smoke.mjs     # every N from 2 to 8 plays to 5 and finishes
python3 tools/make-icons.py  # after changing the motif
```

## Not settled

- **Online** is in DESIGN.md and not built.
