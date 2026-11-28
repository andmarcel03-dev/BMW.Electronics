'use strict';
// Modified 2026-11-27 in a local fork of RideTube (Picture while driving, a setting, on by default; YouTube-style look; no-internet note): README.md, This fork.
// kit/runtime/parked.js: strict mode counts no speed, and a speed older than STALE_MS, as moving; park mode (the
// fork's picture rule with Picture while driving off) needs the selector in P as well, a speed of 0 and fresh signals.
//   node kit/tools/test_parked.js
const assert = require('assert');
const path = require('path');
const P = require(path.join(__dirname, '..', 'runtime', 'parked.js'));
const { watch, STALE_MS, STALE_PARK_MS } = P;

let cb = null, t = 0;
const ctx = { signals: { watch: (iface, inst, h) => { cb = h.statusCarSpeed2; return Promise.resolve({}); } } };
const strict = watch(ctx, null, { strict: true, now: () => t });
assert.strictEqual(strict.moving(), true, 'strict: no speed yet = moving');
cb({ speedVehicleCentreOfGravity: 0 });
assert.strictEqual(strict.moving(), false, 'parked');
t += STALE_MS + 1;
assert.strictEqual(strict.moving(), true, 'strict: stale reading = moving');
cb({ speedVehicleCentreOfGravity: 0 });
assert.strictEqual(strict.moving(), false, 'fresh again');
cb({ speedVehicleCentreOfGravity: 64 * 10 });
assert.strictEqual(strict.moving(), true, '10 km/h = moving');
const lax = watch(ctx, null, { now: () => t });
assert.strictEqual(lax.moving(), false, 'not strict: no speed = parked');
cb({ speedVehicleCentreOfGravity: 0 }); t += STALE_MS * 3;
assert.strictEqual(lax.moving(), false, 'not strict: quiet after standing = parked');
console.log('parked: OK');

// ---- park mode: the picture only in P, at 0 km/h, with both signals fresh ----
const SEL = 'de.bmw.infrastructure.VehicleInformation';
function car() {
    const c = { h: {}, sub: { available: true }, logs: [] };
    c.ctx = { signals: { watch: (iface, inst, h) => {
        Object.assign(c.h, h);
        return Promise.resolve(iface === SEL ? c.sub : {});
    } } };
    c.log = { info: (m) => c.logs.push(m), warn: (m) => c.logs.push(m) };
    c.speed = (kmh) => c.h.statusCarSpeed2({ speedVehicleCentreOfGravity: Math.round(kmh * 64) });
    c.stage = (s) => c.h.statusGearboxDrive({ statusActualStageDrive: s });
    c.sel = (s) => c.h.DataPowerTrain2({ statusGearSelectionDrive: s });
    return c;
}
const tick = () => new Promise((r) => setImmediate(r));
(async () => {
    t = 1000;
    let c = car();
    let p = watch(c.ctx, c.log, { park: true, now: () => t });
    await tick();
    assert.strictEqual(p.moving(), true, 'nothing read yet: audio only');
    c.speed(0);
    assert.strictEqual(p.moving(), true, 'standing still, no selector reading since the start: audio only');
    assert.strictEqual(p.state().seen, false, 'no selector value seen yet');
    c.stage(1);
    assert.strictEqual(p.moving(), false, 'P (wire 1) at 0 km/h: the picture');
    assert.deepStrictEqual(p.state(), { gear: 'P', speed: 0, stale: false, seen: true });
    // the red light: D at 0 km/h
    c.stage(4);
    assert.strictEqual(p.moving(), true, 'D at 0 km/h (a red light): audio only');
    c.stage('R');
    assert.strictEqual(p.moving(), true, 'R at 0 km/h: audio only');
    c.stage(3);
    assert.strictEqual(p.moving(), true, 'N at 0 km/h: audio only');
    c.stage('P');
    assert.strictEqual(p.moving(), false, 'P by name: the picture');
    // any speed above zero, the smallest step the car sends (1/64 km/h)
    c.speed(1 / 64);
    assert.strictEqual(p.moving(), true, 'P but 0.016 km/h: audio only');
    // the car moved: the P that came before it no longer counts, even back at 0 with no new selector event
    c.speed(30); c.speed(0);
    assert.strictEqual(p.moving(), true, 'stopped again with no new P (a missed P -> D): audio only');
    assert.strictEqual(p.state().gear, null, 'the selector forgotten after moving');
    // a P that comes while the car still creeps (2 km/h): audio only until the speed reads 0
    c.speed(2); c.stage(1);
    assert.strictEqual(p.moving(), true, 'P while still rolling at 2 km/h: audio only');
    c.speed(0);
    assert.strictEqual(p.moving(), false, 'that P, then 0 km/h: the picture');
    c.stage(1);
    assert.strictEqual(p.moving(), false, 'a new P: the picture again');
    // the speed signal lost: older than STALE_PARK_MS
    t += STALE_PARK_MS - 1;
    assert.strictEqual(p.moving(), false, 'a reading just inside the window still counts');
    t += 2;
    assert.strictEqual(p.moving(), true, 'speed signal gone quiet: audio only');
    assert.strictEqual(p.state().stale, true);
    c.speed(0);
    assert.strictEqual(p.moving(), false, 'a fresh 0 km/h, still P: the picture');
    // the selector's provider lost: it answered, then went away
    p.moving();                                       // (seen available)
    c.sub.available = false;
    assert.strictEqual(p.moving(), true, 'selector provider lost: audio only');
    c.sub.available = true;
    assert.strictEqual(p.moving(), true, 'back, but nothing said since: still audio only');
    c.stage(1);
    assert.strictEqual(p.moving(), false, 'a P after it came back: the picture');
    assert.ok(c.logs.some((m) => /selector lost/.test(m)), 'the loss is logged');
    // the invalid speed (65535) is no reading: the window runs out
    c.h.statusCarSpeed2({ speedVehicleCentreOfGravity: 65535 });
    t += STALE_PARK_MS + 1;
    assert.strictEqual(p.moving(), true, 'only invalid speeds since: audio only');
    console.log('parked (park): P only, red light, moved, lost speed, lost selector: OK');

    // the second field, DataPowerTrain2.statusGearSelectionDrive (N 1, R 2, P 3, NP 4, gears 5..13)
    t = 50000;
    c = car(); p = watch(c.ctx, c.log, { park: true, now: () => t }); await tick();
    c.speed(0);
    c.sel(3);
    assert.strictEqual(p.moving(), false, 'selection P (3): the picture');
    c.sel(4);
    assert.strictEqual(p.moving(), true, 'NP (N or P, not told apart) alone: audio only');
    c.stage(1);
    assert.strictEqual(p.moving(), false, 'NP with the stage P: the picture (no field says otherwise)');
    c.sel(5);
    assert.strictEqual(p.moving(), true, 'stage P but selection gear 1 (D): they disagree, audio only');
    c.sel('_2');
    assert.strictEqual(p.moving(), true, 'selection _2 (a gear) by name: audio only');
    c.sel('P');
    assert.strictEqual(p.moving(), false, 'selection P by name, stage P: the picture');
    c.stage(0); c.sel(15);
    assert.strictEqual(p.moving(), true, 'unknown values in both: audio only');
    c.stage('SNA'); c.sel('INITIALISIERUNG');
    assert.strictEqual(p.moving(), true, 'names it does not know: audio only');
    c.stage(undefined);
    assert.strictEqual(p.moving(), true, 'no value: audio only');
    console.log('parked (park): both selector fields, NP, disagreement, unknown values: OK');

    // the selector interface failed to subscribe (the car lacks it): never the picture
    t = 90000;
    c = car(); c.sub = { available: false, error: 'no SOME/IP config for ' + SEL };
    p = watch(c.ctx, c.log, { park: true, now: () => t }); await tick();
    c.speed(0); c.stage(1);
    assert.strictEqual(p.moving(), true, 'selector subscription failed: audio only');
    // a binding that never reports availability (available stays false from the start): the events still count
    t = 95000;
    c = car(); c.sub = { available: false };
    p = watch(c.ctx, c.log, { park: true, now: () => t }); await tick();
    c.speed(0); c.stage(1);
    assert.strictEqual(p.moving(), false, 'no availability reports at all: the selector events alone decide');
    // park mode is strict even when not asked: no speed means moving
    c = car(); p = watch(c.ctx, c.log, { park: true, strict: false, now: () => t }); await tick();
    c.stage(1);
    assert.strictEqual(p.moving(), true, 'park: no speed reading counts as moving, strict or not');
    // the decoders on their own
    assert.deepStrictEqual([1, 2, 3, 4, 'P', 'D', 0, 9, null].map((s) => P.stageOf({ statusActualStageDrive: s })), ['P', 'R', 'N', 'D', 'P', 'D', null, null, null]);
    assert.deepStrictEqual([1, 2, 3, 4, 5, 13, 14, 'NP', '_9', 'X'].map((s) => P.selectionOf({ statusGearSelectionDrive: s })), ['N', 'R', 'P', 'NP', 'D', 'D', null, 'NP', 'D', null]);
    assert.strictEqual(P.stageOf(undefined), null);
    console.log('parked (park): failed subscription, no availability reports, decoders: OK');
})().catch((e) => { console.error(e); process.exit(1); });
