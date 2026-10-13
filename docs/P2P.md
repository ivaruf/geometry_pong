# Peer to peer

Online Geometry Pong: one player per screen, one host running the match,
everybody else connected straight to it. A static site with no game server.

The shape is NeonFox's (its `docs/P2P.md`), which is fishtank's, which is hub
`CLAUDE.md` §8: host-authoritative star, two data channels, the simulation in
a Web Worker, three tiers of signalling. `js/net/` was copied from NeonFox and
cut down, not shared with it — how hub code is kept in sync across repos is
still hub §7's open question. What is this game's own, and the interesting
part of this document, is that **a paddle cannot wait for the host**.

Numbers below were measured, and the section says by what. Where something
was not measured, it says that instead.

## Why snapshots, not lockstep

NeonFox measured it: `Math.cos`, `sin`, `atan2` and `hypot` disagree in the
last bit between V8 and Safari's JavaScriptCore, and every bounce here is a
`cos`/`sin` of the hit offset. The room this game expects is a laptop and an
iPad, which is exactly that pair. One ULP of drift is a ball that one device
sees clip a paddle's end and another sees miss. So the host runs the only
Match and sends what it looks like.

## What is authoritative

The host, for everything that decides the game: every ball, every bounce,
every goal, every score, the pickups and the power-ups' effects, the bots,
the winner. Its Match runs in `js/net/host-worker.js` at the sim's own 120 Hz.

A guest is authoritative for exactly one thing, and only provisionally: where
**its own paddle** is. See the next section.

The room's rules — sides, first to, Kaos — are the host's start-screen rows at
the moment it pressed Create room. They travel to each guest as three numbers
(never words, so each screen says them in its own language) and are printed in
the lobby.

## Your paddle is yours

A rider in NeonFox that turns 60 ms late feels fine. A paddle that moves 60 ms
after your thumb feels broken. So (DESIGN.md §6):

- **The guest moves its own paddle locally** — the sim's own `steer()`, run on
  the guest's shadow board with its own fingers and keys — and draws it at
  once. Frames from the host never move it; they only set its length, so Wide
  and Shrink still land.
- **It sends its position, not its input**, at most 60 times a second, every
  one, changed or not: five bytes on the lossy lane with a 16-bit sequence
  number, because that lane is unordered too and an old position must not drag
  the paddle back.
- **The host clamps it.** The position is cleaned (non-finite is dropped, the
  value is clamped to the side) and then *followed* by the sim at a finger's
  top speed, so a guest that claims to be at the far end is there no sooner
  than a finger could have taken it. That is the "clamped to the paddle's
  maximum speed since the last one" of the design, done per tick by the sim
  rather than by arithmetic on timestamps a guest could lie about.
- **The host forgives a little lag** (`js/sim.js`, THE REMOTE GRACE): a remote
  side's hit counts if the ball is covered by the paddle as it is now *or at
  any position it reported in the last 0.1 s*, and the window in which a
  remote paddle may return a ball runs on to 2.5 ball radii behind the line
  (a local paddle's is half a radius), just short of the goal at 3. The
  second allowance is the one that matters: the guest's latest position is
  always a network trip old when it arrives, and without room behind the line
  a save the guest made on its own screen would land after the ball had gone.

**The trade, written down as the design asked:** on a bad connection a guest
sometimes gets a save the host's own screen did not show — the ball visibly
crosses the host's drawing of that paddle and comes back. The grace is small
on purpose (0.1 s, and a few radii), so it forgives lag rather than inventing
saves, and it only ever helps the guest, never costs anyone a goal they would
otherwise have had. The host's own paddle, which reaches the sim through a
`postMessage` and not a network, gets no grace.

**Not measured:** how often the grace decides a hit in real play. It wants a
playtest on two real devices; the checklist below asks for it.

## Balls are extrapolated

Between bounces a ball moves in a straight line, so a guest can draw it where
it is *now*, not where it was when the frame left. `js/net/shadow.js` carries
each ball forward from its frame by the time since the frame arrived plus half
the measured round trip (a PING every two seconds on the reliable lane),
capped at 0.15 s. On the way it bounces off walls and sealed sides, which are
certain, and **stops at an open goal line**, which is not: whether a paddle
returns it is the host's call, so the ball waits at the line for the answer
rather than being guessed through and snapped back. Power-ups that bend paths
(Black hole, Curve, Bumpers) are not predicted; the next frame corrects them.

A frame that disagrees with where a ball was being drawn does not make it
jump: the difference becomes an offset that fades over 80 ms. A difference
bigger than a quarter of a unit (a serve, a ball split in two) snaps.

Other players' paddles glide toward each frame's position over about 30 ms,
because frames arrive at the network's rhythm, not the screen's.

**The host renders the same way.** Its real Match is in the worker, so its
page draws the frames it broadcasts through the same shadow, and sees what its
guests see down to the quantisation.

## The two lanes

| lane                     | carries                                                 |
| ------------------------ | ------------------------------------------------------- |
| `game` ordered, reliable | HELLO, WELCOME, ROSTER, BEGIN, LOBBY, EVENTS, PING, BYE |
| `fast` unordered, 0 retx | the state frame (host → guest), the paddle (guest → host) |

`send(value, fast)` takes the lane as an argument (NeonFox's rule). **Sounds
and sparks on a guest come from EVENTS**: the sim's own event objects — a
type, numbers, and a power-up's id — relayed in the batch they happened in.
No sentence ever travels; a goal is `{ type: 'goal', side, scorer, … }` and
each screen says and plays it in its own way. A guest passes on only the
event types it knows, with finite numbers (`protocol.js cleanEvent`).

## The state frame: the whole board, every time

Pong has nothing that only grows (NeonFox's trails) and nothing large
(fishtank's tank), so there is no delta and no catch-up: a guest that joins
mid-match is whole on the first frame it decodes. A frame is a 10-byte header,
9 bytes a player, 12 a ball, 7 a pickup, and 11 an effect plus 2 for each of
the numbers its power-up packs (ARCHITECTURE.md, "pack and unpack").
Positions are at 1/16000 of a unit, velocities at 1/8000.

The sim ticks at 120 Hz and a frame goes out every second tick, 60 a second:
screens refresh at 60 and balls are extrapolated between frames anyway, so the
other 60 would double the traffic for nothing anyone can see.

Measured by `node tools/net-smoke.mjs`, which plays three simulated minutes of
bots on every shape, packs every frame as the worker does, decodes it as a
guest does and checks the guest's shadow against the host's board (one run;
Kaos Max is random, so its numbers move a little between runs):

| sides | Kaos Off, per frame | Kaos Max, mean | Kaos Max, largest |
| ----- | ------------------- | -------------- | ----------------- |
| 2     | 43 B                | 73 B           | 133 B             |
| 4     | 73 B                | 101 B          | 145 B             |
| 6     | 91 B                | 118 B          | 152 B             |
| 8     | 121 B               | 152 B          | 204 B             |

Across several runs the largest frame seen was 221 bytes, against a 16 KB
interoperable data-channel limit. At 60 frames a second that is **21–73
kbit/s of payload to each guest**, plus 1–3 kbit/s of EVENTS on the reliable
lane. Seven guests on an octagon cost the host about 0.5 Mbit/s up. These are
payload bytes: SCTP, DTLS and UDP add a few dozen bytes to every packet, which
at 60 packets a second is roughly as much again for the small frames and was
not measured.

The frame number is a counter the worker owns for the whole session and never
resets, not the sim's clock — NeonFox's lesson: a queue that drops anything not
newer stalls at the first counter reset. Each frame also carries a one-byte
roster version, bumped by every join, every leave and every match start; a
guest drops frames packed for any other, so a frame from the last match (or
for a different number of sides) is never decoded into this one.

## Who sits where

Sides are seats. The host is player 0, the bottom side, so its own board never
turns. Every other side is a bot until a guest takes it, handed out spread
round the table (the first guest on a square sits opposite the host).
**Joining mid-match takes a bot's side; leaving turns it back into a bot** at
once — never a hole, so a dropped connection does not hand everyone a free
goal. A full room (every side a person) refuses with a reason code.

Each device turns its board once, when the match starts, so its own side lies
flat at the bottom: rotation only, never a mirror, so an angle shot looks the
same to the shooter as to everyone else. Keys and fingers are turned with it,
and the rim text stands upright on the screen instead of facing each edge.

## The menu does not pause

Online the match belongs to the room (hub §2), so the three-bar plate opens
the menu's live face — "Meny" / "Menu", a line saying the match carries on —
and the paddle keeps answering keys and fingers behind it. A guest's panel has
no Restart, and its match-over card no Play again: starting is the host's, and
a button that does nothing is worse than none. A tab put in the background
does not pause either; the host's worker keeps the match running.

## Signalling

Three tiers, tried in order: a `<meta name="signal-url">` relay, then the
public PeerJS broker with codes namespaced `geometry_pong-v1-<code>`, then
`BroadcastChannel` for tabs in one browser. PeerJS carries signalling only,
for NeonFox's reason: its data connection cannot be given `maxRetransmits: 0`,
so every tier negotiates the same `RTCPeerConnection` with the same two lanes.

`peerjs@1.5.5` is pinned with an SRI hash and **`vendor/peerjs.js` is
committed behind it**, byte-identical to the CDN file
(`sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu`,
re-checked with `openssl dgst -sha384 -binary`). Its tag is marked
`data-handled` so the crash bar leaves a blocked CDN alone.

One change from NeonFox's copy: when the broker *script* loads but the broker
*itself* cannot be reached, a guest now falls back to the tabs tier the way
the host already did, instead of failing. Without it, the two-tab test below
could host but never join.

**A public broker is a real trade**: a third party with no promises, which
sees room codes and connection metadata and never game data. If it is down,
no new rooms open; rooms already connected are untouched, because it carries
no game traffic. It drops a peer whose heartbeat stops — a locked screen is
enough — so the host reclaims its code on `disconnected` and on a five-second
beat, and the lobby says when the code is not reachable rather than assuming.

Room codes are three pictures out of NeonFox's twelve (1,728 codes),
tapped on a keypad and said out loud as words — "pizza, pizza, moon" — so a
child joins without typing anything (hub §8, "Room codes are pictures"). The
first build used four typed letters; that was a mistake against the hub's
practice and was replaced before anyone played it. On the wire a code is the
names joined by dashes, `pizza-pizza-moon`, which is also the broker id's
tail: `geometry_pong-v1-pizza-pizza-moon`.

## What a guest may say

Four things, all distrusted: its build (a different one is refused), its
paddle's position (cleaned, clamped, followed at finger speed), a ping, and
goodbye. The seat a position moves is the one the host gave that connection,
looked up host-side, never one the guest names. There is no field in which a
guest could claim a ball, a score or a seat.

## What we accept

- **No TURN.** Roughly one connection in ten will not establish (fishtank's
  and NeonFox's estimate, not measured here). The join failure says some
  networks cannot reach each other rather than blaming the code.
- **No host migration.** When the host leaves, every guest is told the room is
  closed and goes back to the lobby.
- **The host can cheat**, because the host is authoritative. For "my kid wants
  to show his friends", that is fine.
- **The remote grace** above: a guest's occasional save the host did not see.
- **Same-network play still needs the internet** to find each other.
- **One player per device** in this version. A device bringing two keyboard
  players into a room (DESIGN.md §4) is not built.

## Verified, and how

- `node tools/net-smoke.mjs` — the codec round trip and shadow on every shape,
  Kaos Off and Max; the frame sizes above.
- `node tools/sim-smoke.mjs` — the sim after the grace went in: every shape
  still plays to a winner. It plays bots only, so it does not exercise a
  remote seat.
- Two tabs of headless Chrome on one fresh profile, with every host but
  localhost made unresolvable so the CDN and the broker both fail and the tabs
  tier is what connects: the host made a room, the guest joined by code and was
  seated opposite, the match started, the guest's board was turned with its
  side at the bottom and its paddle answered its keys, both boards showed the
  same match, the guest's menu showed the live face without Restart, and when
  the guest left the host's status said a robot took over. A second run had
  the guest join a match already in progress. No console errors besides the
  blocked lookups the test caused on purpose.
- **Not verified:** the broker tier between two real devices, Safari, touch on
  a turned board, and how the extrapolation and the grace feel at real
  latency. The playtest checklist in the report covers them.

## Files

```
js/net/protocol.js     message types, the frame and position codecs, every validator
js/net/codes.js        four-letter room codes
js/net/webrtc.js       RTCPeerConnection, the two lanes, two signalling transports
js/net/rendezvous.js   the three tiers, and PeerJS as a signalling pipe
js/net/host-worker.js  the Match, off the page
js/net/host.js         seats, roster, validation, fan-out
js/net/guest.js        position out, frames and events in, the ping
js/net/shadow.js       a Match fed from the wire; your paddle, extrapolated balls
js/lobby.js            the Online card
tools/net-smoke.mjs    the codec, headless, and the measurements above
```
