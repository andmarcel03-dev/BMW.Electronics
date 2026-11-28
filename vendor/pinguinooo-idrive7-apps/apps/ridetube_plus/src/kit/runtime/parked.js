'use strict';
// Modified 2026-11-27 in a local fork of RideTube (Picture while driving, a setting, on by default; YouTube-style look; no-internet note): README.md, This fork.
/**
 * parked.js - "parked only" for games and anything else that mustn't run while driving.
 *
 *   const parked = require('./kit/parked').watch(ctx, log);
 *   parked.moving()   // true while the car drives (above MAX_KMH)
 *   parked.speed()    // km/h last read, or null (no speed: a VM / bench)
 *
 * Needs "de.bmw.infotainment.vehicle.Vehicle2": { "statusCarSpeed2": "rs" } in app.json "signals".
 * Every game has a setting "parkedOnly" (bool, on by default) and checks it with moving().
 *
 * Speed from Vehicle2.statusCarSpeed2, also re-read every 2 s: a car standing still may not
 * notify a speed that doesn't change. When the signal goes quiet, the last speed it read counts:
 * quiet after standing = parked (counting quiet as moving blocked a parked car in Doom 1.4.0),
 * quiet after driving = moving (the safe side) until a speed is read again. Without any real speed
 * (a VM or a bench: none, or "invalid" 65535) the car counts as parked, unless opts.strict:
 * then no speed counts as moving (video: a failed subscription must not show it while driving), and so does a
 * speed read more than STALE_MS ago (the signal and the 2 s re-read both gone quiet).
 *
 * opts.park (the fork's picture rule with Picture while driving off, stricter than strict): parked means the selector is in P too, so a car
 * standing in D at a red light is driving (NY VAT 375(24); NHTSA counts every state "unless the vehicle is in
 * Park"). Needs "de.bmw.infrastructure.VehicleInformation": { "statusGearboxDrive": "s", "DataPowerTrain2": "s" }.
 * Both fields are notified on change only, so P must have come since the app started. Parked needs all of:
 *   - a P from either field (stage statusActualStageDrive P = 1, R = 2, N = 3, D = 4; selection
 *     statusGearSelectionDrive N = 1, R = 2, P = 3, NP = 4, gears 5..13; names or wire numbers), and no R, N or D
 *     in the other one (NP, "N or P", and no value are no opinion);
 *   - the car not moved since that P came: any speed above 0 forgets both fields, so a P -> D the app missed
 *     can't keep the picture at the next stop;
 *   - the selector's provider not lost (it answered once, then went away: both fields forgotten);
 *   - a speed of exactly 0 read at most STALE_PARK_MS ago.
 * Anything else, an unknown value included, is moving: the sound plays on, no picture.
 */
// STALE_PARK_MS: the kit re-reads the speed every 2 s and a read may take up to 3 s (signals.js), so a shorter window
// would drop the picture on one slow read; P itself holds the car, the window only covers both signals going quiet
const MAX_KMH = 3, STALE_MS = 5000, STALE_PARK_MS = 5000;
const SELECTOR = 'de.bmw.infrastructure.VehicleInformation';

// statusGearboxDrive.statusActualStageDrive -> 'P' | 'R' | 'N' | 'D', else null (unknown)
const STAGES = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };
function stageOf(v) { const s = v && v.statusActualStageDrive; return (s !== undefined && s !== null && STAGES[s]) || null; }
// DataPowerTrain2.statusGearSelectionDrive -> 'P' | 'R' | 'N' | 'D' | 'NP', else null
function selectionOf(v) {
    const x = v && v.statusGearSelectionDrive;
    const n = typeof x === 'number' ? x : { N: 1, R: 2, P: 3, NP: 4 }[x] || (/^_\d$/.test(String(x)) ? 4 + Number(String(x).slice(1)) : 0);
    return n === 1 ? 'N' : n === 2 ? 'R' : n === 3 ? 'P' : n === 4 ? 'NP' : n >= 5 && n <= 13 ? 'D' : null;
}
// in P by the two fields: a P in one, nothing against it in the other
const opinion = (g) => g === 'P' || g === 'R' || g === 'N' || g === 'D';
const inP = (stage, sel) => (stage === 'P' || sel === 'P') && [stage, sel].every((g) => g === 'P' || !opinion(g));

function watch(ctx, log, opts) {
    const park = !!(opts && opts.park), strict = park || !!(opts && opts.strict), now = (opts && opts.now) || Date.now;
    const staleMs = park ? STALE_PARK_MS : STALE_MS;
    let speed = null, at = 0, stage = null, sel = null, sub = null, answered = false, logged = 0, seen = false;
    const forget = () => { stage = null; sel = null; };
    const note = (what, raw, g) => { if (g) seen = true; if (log && logged < 40) { logged++; log.info('parked check: ' + what + ' ' + JSON.stringify(raw) + ' -> ' + (g || 'unknown')); } };
    ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
        statusCarSpeed2: (v) => {
            const k = v && v.speedVehicleCentreOfGravity;
            if (typeof k === 'number' && k !== 65535) { speed = k * 0.015625; at = now(); if (park && speed > 0) forget(); }
        },
    }, log, { pollMs: 2000 }).then((s) => log && log.info('parked check: speed ' + (s.error ? 'error: ' + s.error : 'subscribed')));
    if (park) {
        Promise.resolve(ctx.signals.watch(SELECTOR, '1', {
            statusGearboxDrive: (v) => { stage = stageOf(v); note('stage', v && v.statusActualStageDrive, stage); },
            DataPowerTrain2: (v) => { sel = selectionOf(v); note('selection', v && v.statusGearSelectionDrive, sel); },
        }, log)).then((s) => { sub = s; if (log) log.info('parked check: selector ' + (s && s.error ? 'error: ' + s.error : 'subscribed')); },
            (e) => { if (log) log.warn('parked check: selector: ' + e); });
    }
    // the selector's provider answered once and is gone now: what it said no longer counts
    function lost() {
        const a = sub && sub.available;
        if (a === true) answered = true;
        else if (answered && a === false) { answered = false; forget(); if (log) log.warn('parked check: selector lost'); }
        return !!(sub && sub.error);
    }
    function moving() {
        if (speed === null || (strict && now() - at > staleMs)) return strict;
        if (!park) return speed > MAX_KMH;
        if (lost()) return true;
        return speed > 0 || !inP(stage, sel);
    }
    return {
        moving,
        speed: () => speed,
        // what the picture rule saw (main.js says why there is no picture): gear 'P'..'D' | 'NP' | null; seen: any
        // selector value since the start (none: the car sends no gear to apps, or not yet)
        state: () => ({ gear: park ? (inP(stage, sel) ? 'P' : stage || sel) : null, speed, stale: speed === null || now() - at > staleMs, seen }),
    };
}

module.exports = { watch, MAX_KMH, STALE_MS, STALE_PARK_MS, stageOf, selectionOf, inP };
