/*
 * powerups/index.js — every power-up the game knows, in one list.
 *
 * Each lives in its own file and exports one definition (the contract is in
 * ARCHITECTURE.md, "Power-ups"). sim.js spawns from this list, weighted, and
 * skips any definition marked `ready: false`, so a file can sit here as a
 * stub until its owner finishes it. Adding a power-up is a new file and one
 * line below; nothing else in the game names them.
 */

import slow from './slow.js';
import split from './split.js';
import bigball from './bigball.js';
import rush from './rush.js';
import gravity from './gravity.js';
import bumpers from './bumpers.js';
import curve from './curve.js';
import wide from './wide.js';
import shrink from './shrink.js';
import shield from './shield.js';

export const POWERUPS = [slow, split, bigball, rush, gravity, bumpers, curve, wide, shrink, shield];
