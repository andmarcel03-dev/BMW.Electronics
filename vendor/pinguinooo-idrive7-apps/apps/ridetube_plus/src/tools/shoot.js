'use strict';
// Added 2026-11-27 in a local fork of RideTube: README.md, This fork.
/*
 * shoot.js - screenshots of the fork as the car's GPU renderer would compose them. Runs the built app (dist/jap_ridetube)
 * in the fork's stubbed head unit (kit/tools/hu-stub.js) against a fake jap-ridetube-d, walks a set of screens, and
 * draws the last frame of the renderer stream (MGU_RENDERD_FILE) in software: the placement's transform, the xf()
 * sections in screen px, clips, layers, pictures (thumbnails); the video as a gradient placeholder.
 *   python3 kit/tools/build.py jap_ridetube   # first (needs an oap-sdk/ folder; a placeholder will do, never loaded here)
 *   node tools/shoot.js . <outDir>             # 19 PNGs: Home, search, the watch page, full screen, the picture while driving,
 *                                              # audio only with Picture while driving off, offline, sign in, Read aloud
 *                                              # (a card's first press, the watch page, audio only), typing off driving
 * No renderer animations exist in RideTube, so this is also the animations-off render.
 */
const fs = require('fs'), net = require('net'), os = require('os'), path = require('path');
const fork = path.resolve(process.argv[2]), outDir = path.resolve(process.argv[3]);
const { Canvas } = require(path.join(fork, 'kit', 'runtime', 'canvas'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unpack = (v) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/* ---------- the stream ---------- */
function parse(buf) {
    const st = { place: null, atlases: new Map(), ramps: [], layers: new Map(), pics: new Map(), frame: null };
    const words = (p, n) => { const u = new Uint32Array(n); for (let k = 0; k < n; k++) u[k] = buf.readUInt32LE(p + 4 * k); return u; };
    for (let o = 0; o + 8 <= buf.length;) {
        const t = buf.readUInt32LE(o), len = buf.readUInt32LE(o + 4), p = o + 8;
        if (p + len > buf.length) break;
        if (t === 2 && len >= 28) st.place = { w: buf.readInt32LE(p + 8), h: buf.readInt32LE(p + 12), scale: buf.readFloatLE(p + 16), ox: buf.readFloatLE(p + 20), oy: buf.readFloatLE(p + 24) };
        else if (t === 4) { const aw = buf.readUInt32LE(p + 4), ah = buf.readUInt32LE(p + 8); st.atlases.set(buf.readUInt32LE(p), { atlasW: aw, atlasH: ah, alpha: buf.subarray(p + 12, p + 12 + aw * ah) }); }
        else if (t === 5) { const id = buf.readUInt32LE(p), n = buf.readUInt32LE(p + 4); st.ramps[id] = Array.from({ length: n }, (_, k) => unpack(buf.readUInt32LE(p + 8 + 4 * k))); }
        else if (t === 6) st.layers.set(buf.readUInt32LE(p), { words: words(p + 12, (len - 12) >> 2) });
        else if (t === 8 && len >= 4) st.layers.delete(buf.readUInt32LE(p));
        else if (t === 10 && len >= 12) { const w = buf.readUInt32LE(p + 4), h = buf.readUInt32LE(p + 8); if (len >= 12 + w * h * 4) st.pics.set(buf.readUInt32LE(p), { w, h, data: buf.subarray(p + 12, p + 12 + w * h * 4) }); }
        else if (t === 7) st.frame = words(p, len >> 2);
        o += 8 + len;
    }
    return st;
}

/* ---------- composing ---------- */
// rounded-rect signed distance (as canvas.js), for pictures and the video placeholder
function rr(px, py, x, y, w, h, r) {
    const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r), qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function fillShape(cv, x, y, w, h, r, colorAt) {
    r = Math.min(r, w / 2, h / 2);
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(cv.h, Math.ceil(y + h)); py++) {
        for (let px = Math.max(0, Math.floor(x)); px < Math.min(cv.w, Math.ceil(x + w)); px++) {
            const cov = Math.max(0, Math.min(1, 0.5 - rr(px + 0.5, py + 0.5, x, y, w, h, r)));
            if (cov > 0) cv._blend(px, py, colorAt(px - x, py - y), cov);
        }
    }
}
const picture = (cv, pic, x, y, w, h, r) => pic && fillShape(cv, x, y, w, h, r, (u, v) => {
    const sx = Math.min(pic.w - 1, (u / w * pic.w) | 0), sy = Math.min(pic.h - 1, (v / h * pic.h) | 0), i = (sy * pic.w + sx) * 4, d = pic.data;
    const a = d[i + 3] || 1;                                  // premultiplied -> straight
    return [Math.min(255, d[i] * 255 / a), Math.min(255, d[i + 1] * 255 / a), Math.min(255, d[i + 2] * 255 / a), d[i + 3]];
});
// the video: a dusk road scene stand-in (sky gradient, a road), so the shots show where the picture goes
const video = (cv, x, y, w, h, r) => fillShape(cv, x, y, w, h, r, (u, v) => {
    const k = v / h, horizon = 0.58;
    if (k < horizon) { const t = k / horizon; return [40 + 180 * t, 60 + 70 * t, 120 - 40 * t, 255]; }
    const t = (k - horizon) / (1 - horizon), half = 0.04 + 0.42 * t, cx = Math.abs(u / w - 0.5);
    if (cx < half) return Math.abs(cx) < 0.006 + 0.01 * t && ((v | 0) % 40) < 22 ? [235, 220, 150, 255] : [48, 50, 58, 255];
    return [30 + 20 * t, 70 + 30 * t, 40, 255];
});
function blitRect(base, src, c) {
    const x0 = Math.max(0, Math.floor(c[0])), y0 = Math.max(0, Math.floor(c[1])), x1 = Math.min(base.w, Math.ceil(c[0] + c[2])), y1 = Math.min(base.h, Math.ceil(c[1] + c[3]));
    const px = [0, 0, 0, 0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * src.w + x) * 4, a = src.d[i + 3];
        if (!a) continue;
        px[0] = src.d[i]; px[1] = src.d[i + 1]; px[2] = src.d[i + 2]; px[3] = a;
        base._blend(x, y, px, 1);
    }
}
function draw(u, base, S0, OX0, OY0, st) {
    const f = new Float32Array(u.buffer, u.byteOffset, u.length);
    let S = S0, OX = OX0, OY = OY0, alpha = 1, cv = base, clip = null;
    const X = (v) => v * S + OX, Y = (v) => v * S + OY, L = (v) => v * S;
    const col = (v) => { const a = unpack(v); if (alpha < 1) a[3] = Math.round(a[3] * alpha); return a; };
    const flush = () => { if (clip) { blitRect(base, cv, clip); cv = base; clip = null; } };
    let i = 0;
    while (i < u.length) {
        const op = u[i++];
        switch (op) {
        case 1: cv.clear(unpack(u[i])); i += 1; break;
        case 2: cv.fillRect(X(f[i]), Y(f[i + 1]), L(f[i + 2]), L(f[i + 3]), col(u[i + 4])); i += 5; break;
        case 3: case 6: {
            const card = op === 6, x = f[i], y = f[i + 1], w = f[i + 2], h = f[i + 3], r = card ? f[i + 4] : 0, k = u[i + (card ? 5 : 4)];
            i += card ? 6 : 5;
            const stops = [];
            for (let s = 0; s < k; s++) stops.push([f[i + s * 2], col(u[i + s * 2 + 1])]);
            i += k * 2;
            if (card) cv.card(X(x), Y(y), L(w), L(h), L(r), stops); else cv.gradientRect(X(x), Y(y), L(w), L(h), stops);
            break;
        }
        case 4: cv.roundRect(X(f[i]), Y(f[i + 1]), L(f[i + 2]), L(f[i + 3]), L(f[i + 4]), col(u[i + 5])); i += 6; break;
        case 5: cv.strokeRoundRect(X(f[i]), Y(f[i + 1]), L(f[i + 2]), L(f[i + 3]), L(f[i + 4]), L(f[i + 5]), col(u[i + 6])); i += 7; break;
        case 7: cv.rampRect(X(f[i]), Y(f[i + 1]), L(f[i + 2]), L(f[i + 3]), L(f[i + 4]), st.ramps[u[i + 5]] || [[255, 255, 255, 255]], X(f[i + 6]), L(f[i + 7])); i += 8; break;
        case 8: {
            const flags = u[i + 7], o = { round: !!(flags & 1) };
            if (flags & 2) { o.ramp = st.ramps[u[i + 8]]; o.rampFrom = f[i + 9]; o.rampTo = f[i + 10]; }
            cv.arc(X(f[i]), Y(f[i + 1]), L(f[i + 2]), L(f[i + 3]), f[i + 4], f[i + 5], col(u[i + 6]), o);
            i += 11; break;
        }
        case 9: cv.line(X(f[i]), Y(f[i + 1]), X(f[i + 2]), Y(f[i + 3]), L(f[i + 4]), col(u[i + 5])); i += 6; break;
        case 15: cv.quad([0, 2, 4, 6].map((k) => [X(f[i + k]), Y(f[i + k + 1])]), col(u[i + 8])); i += 9; break;
        case 10: {
            const k = u[i++];
            for (let t = 0; t < k; t++) { const b = i + t * 9; cv.triangle([[X(f[b]), Y(f[b + 1])], [X(f[b + 3]), Y(f[b + 4])], [X(f[b + 6]), Y(f[b + 7])]], col(u[b + 2])); }
            i += k * 9; break;
        }
        case 11: {
            const fo = st.atlases.get(u[i]), c = col(u[i + 1]), k = u[i + 2]; i += 3;
            if (fo) for (let g = 0; g < k; g++) {
                const b = i + g * 8, gw = f[b + 6] - f[b + 4], gh = f[b + 7] - f[b + 5];
                if (gw > 0 && gh > 0) cv._blit(fo, f[b + 4], f[b + 5], gw, gh, X(f[b]), Y(f[b + 1]), f[b + 2] / gw * S, c);
            }
            i += k * 8; break;
        }
        case 12: { const Lr = st.layers.get(u[i]); if (Lr) draw(Lr.words, cv, S, X(f[i + 1]), Y(f[i + 2]), st); i += 3; break; }
        case 18: picture(cv, st.pics.get(u[i + 5]), X(f[i]), Y(f[i + 1]), L(f[i + 2]), L(f[i + 3]), L(f[i + 4])); i += 6; break;
        case 19: video(cv, X(f[i]), Y(f[i + 1]), L(f[i + 2]), L(f[i + 3]), L(f[i + 4])); i += 6; break;
        case 13: flush(); clip = [X(f[i]), Y(f[i + 1]), L(f[i + 2]), L(f[i + 3])]; cv = new Canvas(base.w, base.h); i += 4; break;
        case 14: flush(); break;
        case 16: alpha = f[i]; i += 1; break;
        case 17: if (f[i] > 0) { S = f[i]; OX = f[i + 1]; OY = f[i + 2]; } else { S = S0; OX = OX0; OY = OY0; } i += 3; break;
        default: flush(); throw new Error('unknown op ' + op + ' at ' + (i - 1));
        }
    }
    flush();
}
function shot(file, name) {
    const st = parse(fs.readFileSync(file));
    if (!st.frame || !st.place) throw new Error('no frame yet');
    const cv = new Canvas(st.place.w, st.place.h).clear([0, 0, 0, 255]);
    draw(st.frame, cv, st.place.scale, st.place.ox, st.place.oy, st);
    fs.writeFileSync(path.join(outDir, name + '.png'), cv.png());
    console.log('shot', name, st.place.w + 'x' + st.place.h);
}

/* ---------- a fake jap-ridetube-d: answers thumbs with made-up pictures ---------- */
const hue = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function thumb(id) {
    const w = 320, h = 180, b = Buffer.alloc(w * h * 4), k = hue(id), c1 = [(k >> 3) & 255, (k >> 11) & 255, (k >> 19) & 255], c2 = [255 - c1[1], c1[2], 255 - c1[0]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = (x / w + y / h) / 2, i = (y * w + x) * 4, sun = Math.hypot(x - w * 0.7, y - h * 0.35) < 34;
        b[i] = sun ? 255 : c1[0] * (1 - t) + c2[0] * t; b[i + 1] = sun ? 220 : c1[1] * (1 - t) + c2[1] * t; b[i + 2] = sun ? 120 : c1[2] * (1 - t) + c2[2] * t; b[i + 3] = 255;
    }
    return { ev: 'thumb', id, w, h, rgba: b.toString('base64') };
}
function daemon(sock, related) {
    const d = { got: [], conn: null };
    d.server = net.createServer((c) => {
        d.conn = c; let buf = '';
        c.setEncoding('utf8');
        c.on('data', (x) => {
            buf += x; let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); d.got.push(m);
                if (m.cmd === 'thumb') d.send(thumb(m.id));
                if (m.cmd === 'related' && related[m.id]) d.send({ ev: 'related', id: m.id, items: related[m.id] });
            }
        });
        c.on('error', () => {});
    });
    d.send = (o) => d.conn && d.conn.write(JSON.stringify(o) + '\n');
    d.cmds = (cmd) => d.got.filter((m) => m.cmd === cmd);
    return new Promise((r) => d.server.listen(sock, () => r(d)));
}

/* ---------- the screens ---------- */
const V = (id, title, channel, views, age, s) => ({ id: (id + 'xxxxxxxxxxx').slice(0, 11), title, channel, duration_s: s || 600, meta: [views, age] });
const HOME = [
    V('g01x3m40i', 'BMW X3 M40i (G01) review: the sweet spot of the range', 'Carwow', '2.1M views', '3 years ago', 1194),
    V('lofi24', 'lofi hip hop radio - beats to relax/study to', 'Lofi Girl', '1.4M views', '2 weeks ago', 3600),
    V('ns2gt', 'Nordschleife hot lap in the rain, onboard', 'Misha Charoudin', '842K views', '5 months ago', 545),
    V('podtech', 'The future of in-car software, a long talk', 'Tech Talk Daily', '96K views', '1 day ago', 5410),
    V('cook15', 'Fifteen-minute dinners for a busy week', 'Joshua Weissman', '3.3M views', '1 year ago', 902),
    V('space4k', 'The James Webb telescope, explained in 4K', 'Kurzgesagt', '12M views', '2 years ago', 731),
];
const SHELF2 = [
    V('rally01', 'WRC Rally Finland highlights: the big jumps', 'WRC', '1.9M views', '4 months ago', 664),
    V('detail9', 'Full detail on a neglected X5, satisfying', 'Pan the Organizer', '5.6M views', '8 months ago', 1840),
    V('f1qual', 'Qualifying highlights, Monza', 'FORMULA 1', '7.2M views', '3 weeks ago', 489),
    V('ev100', 'How far does an EV really go on a highway?', 'Bjorn Nyland', '412K views', '6 days ago', 2305),
    V('synth80', '80s synthwave mix for night drives', 'Astro Radio', '9.8M views', '2 years ago', 7203),
    V('mech22', 'Changing the oil on a B58, step by step', 'Ricky Bobby Garage', '230K views', '1 year ago', 1288),
];
const RELATED = [
    V('rel001', 'X3 M40i vs Porsche Macan S: which one?', 'Throttle House', '1.2M views', '2 years ago', 1355),
    V('rel002', 'G01 X3 hidden features you did not know', 'BMW Tips', '640K views', '1 year ago', 742),
    V('rel003', 'B58 sound compilation, launch and fly-bys', 'CarSounds', '3.1M views', '4 years ago', 515),
];
const RESULTS = [
    V('res01', 'Best road trip songs, 3 hours of classics', 'Mix Daily', '28M views', '3 years ago', 10800),
    V('res02', 'Road trip through Norway in an EV', 'Lost LeBlanc', '2.2M views', '1 year ago', 1420),
    V('res03', 'Ultimate road trip packing list', 'Kara and Nate', '960K views', '2 years ago', 812),
    V('res04', 'Road trip hacks nobody tells you', 'Yes Theory', '4.4M views', '5 years ago', 1003),
];

(async () => {
    fs.mkdirSync(outDir, { recursive: true });
    const stage = path.join(fork, 'dist', 'jap_ridetube');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-shoot-'));
    const sock = path.join(dir, 'ctl.sock'), file = path.join(dir, 'stream.bin');
    const d = await daemon(sock, { [SHELF2[0].id]: RELATED });
    process.env.MGU_YT_SOCKET = sock;
    process.env.MGU_RENDERD_FILE = file;
    process.env.MGU_YT_VIDEO = path.join(dir, 'mgu-video-ridetube');
    const uplink = process.env.MGU_UPLINK_STATUS = path.join(dir, 'uplink.json');
    const quiet = { info() {}, warn() {}, error(m, e) { console.error('app error', m, e); } };
    const { headUnit } = require(path.join(fork, 'kit', 'tools', 'hu-stub'));
    const hu = headUnit(stage, { dataDir: dir, fresh: true, image: () => Promise.resolve(), log: quiet });
    const disp = hu.display;
    // the car: 0 km/h, the selector not told yet (the "no gear signal" screen with the setting off), then P
    let speedH = null, gearH = null;
    const car = { sinks: [{ sinkID: 1, name: 'Main', volume: 12, muteState: 'MS_UNMUTED' }] };
    hu.ctx.signals = {
        watch: async (i, n, h) => { if (h && h.statusCarSpeed2) { speedH = h.statusCarSpeed2; speedH({ speedVehicleCentreOfGravity: 0 }); } if (h && h.statusGearboxDrive) gearH = h; return {}; },
        proxy: async (i) => ({ i }), set: async () => {},
        call: async (p, m) => (m === 'getListMainSinks' ? { listMainSinks: car.sinks, amError: 'E_OK' } : Promise.reject(new Error('no ' + m))),
        on: async () => {},
    };
    const speed = (kmh) => speedH({ speedVehicleCentreOfGravity: Math.round(kmh * 64) });
    const gear = (g) => gearH.statusGearboxDrive({ statusActualStageDrive: g });
    hu.ctx.scroll = (dy) => disp.scrollPage(dy);
    hu.ctx.pointer = { move: (dx, dy) => disp.pointerMove(dx, dy), tap: () => disp.pointerTap() };
    hu.ctx.hideButton = (id, hide) => disp.hideButton(id, hide);
    hu.ctx.onPageFocus = (fn) => { disp.onPageFocus = fn; };
    hu.ctx.focus = (k) => disp.focusPage(k);
    hu.ctx.hmiLanguage = () => 'en_GB';
    const origLog = console.log; console.log = () => {};      // (the stub's ui logs every text it sets)
    hu.start();
    const until = async (fn, ms, what) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out: ' + what); await sleep(20); } };
    await until(() => d.cmds('hello').length, 4000, 'hello');
    d.send({ ev: 'hello', service: '0.6.7', caps: ['related', 'hist', 'health', 'loop', 'download'] });
    d.send({ ev: 'auth', state: 'signed_in' });
    await hu.ui.open('VIEW');
    disp.gpu.touch = true; disp._place();                    // a renderer that routes touch: the kit runs the screen
    const settle = async (ms) => { await sleep(ms || 400); await hu.loopFn(); await sleep(60); await hu.loopFn(); };
    const S = (name) => { console.log = origLog; shot(file, name); console.log = () => {}; };
    const keys = () => disp.pageTargets.map((t) => t.key);
    const tgt = (k) => disp.pageTargets.find((t) => (k instanceof RegExp ? k.test(t.key) : t.key === k));

    // Home: the bar with search, the chips, a grid of cards and a shelf
    hu.handlers.BTN_HOME(); await settle(200);
    d.send({ ev: 'feed', which: 'home', items: HOME, shelves: [{ title: 'Cars and driving', items: SHELF2 }] });
    d.send({ ev: 'feed', which: 'wl', items: SHELF2.slice(0, 3) });
    await settle(600); await settle(600);
    S('01-home');
    disp.focusPage(keys().find((k) => /^h:\d+:/.test(k))); await settle(400);
    S('02-home-controller-on-a-card');
    // search results
    hu.handlers.BTN_SEARCH && hu.ctx.settings.set('recent', ['road trip', 'bmw x3', 'lofi']);
    hu.handlers.BTN_S1(); await settle(200);
    const q = d.cmds('search').slice(-1)[0].q;
    d.send({ ev: 'results', q, items: RESULTS }); await settle(600); await settle(500);
    S('03-search-results');
    // the watch page: plays the first Home video, no gear told yet. Picture while driving on (the default): the picture
    hu.handlers.BTN_HOME(); await settle(300);
    fs.writeFileSync(process.env.MGU_YT_VIDEO, '');
    tgt(new RegExp(':' + SHELF2[0].id + '$')).run(); await settle(200);
    d.send({ ev: 'state', state: 'playing', id: SHELF2[0].id, title: SHELF2[0].title });
    d.send({ ev: 'time', elapsed: 1000, total: SHELF2[0].duration_s * 1000 });
    d.send({ ev: 'time', elapsed: 194000, total: SHELF2[0].duration_s * 1000 });   // (from the start: no resume notice pinning the controls)
    await settle(500); await settle(400);
    S('04-picture-no-gear-signal-yet');
    // Picture while driving off, still no gear told: the sound only, the screen says why
    hu.ctx.settings.set('picture_driving', false); await settle(500);
    S('05-setting-off-no-gear-signal-yet');
    hu.ctx.settings.set('picture_driving', true);
    // P at 0 km/h: the picture, the watch page with its controls shown
    gear(1); speed(0); await settle(500); await settle(400);
    S('06-watch-page');
    disp.onTap(1800, 700); await settle(400);                // a tap beside the controls: hidden
    S('07-watch-page-controls-hidden');
    disp.onPageFocus('ov:rw'); await settle(300);
    tgt('ov:full').run(); await settle(500);
    S('08-full-screen');
    // setting on: the red light (D at 0 km/h) and driving at 50 km/h keep the picture
    speed(0); gear(4); await settle(500);
    S('09-red-light-D-0kmh-picture');
    speed(50); await settle(400);
    S('10-driving-50kmh-picture');
    // setting off: driving and the red light play the sound only
    hu.ctx.settings.set('picture_driving', false); await settle(500);
    S('11-setting-off-driving-audio-only');
    speed(0); gear(4); await settle(500);
    S('12-setting-off-red-light-D-audio-only');
    hu.ctx.settings.set('picture_driving', true);
    speed(0); gear(1); await settle(400);
    tgt('ov:back') && tgt('ov:back').run(); await settle(300);   // full screen -> watch page
    tgt('ov:close') && tgt('ov:close').run(); await settle(300);
    d.send({ ev: 'state', state: 'idle' }); await settle(300);
    // no internet: the uplink says why; a page with cards shows a strip, an empty one the note
    fs.writeFileSync(uplink, JSON.stringify({ state: 'searching', error: 'Personal Hotspot is off' }));
    hu.handlers.BTN_HOME(); await settle(2300); await settle(300);
    S('13-offline-strip');
    hu.handlers.BTN_SUBS(); await settle(300);
    d.send({ ev: 'feed', which: 'subs', items: [], error: 'feed offline' }); await settle(500);
    S('14-offline-page');
    fs.unlinkSync(uplink); await settle(2300);
    // signed out: the sign-in card with the code
    d.send({ ev: 'auth', state: 'code', code: 'ABC-DEF', url: 'https://www.google.com/device' });
    hu.handlers.BTN_HOME(); await settle(400);
    const si = tgt(/:::signin$/); if (si) { si.run(); await settle(500); }
    S('15-sign-in');
    // the fork's Read aloud (service 0.5.80, cap say) switched on: a card's first press says its title, the note asks for a
    // second press; the watch page's speaker by the title (ringed while it speaks); audio only's Read aloud
    d.send({ ev: 'auth', state: 'signed_in' });
    d.send({ ev: 'hello', service: '0.5.80', caps: ['related', 'hist', 'health', 'loop', 'download', 'say'] });
    hu.ctx.settings.set('read_aloud', true);
    hu.handlers.BTN_HOME(); await settle(300);
    d.send({ ev: 'feed', which: 'home', items: HOME, shelves: [{ title: 'Cars and driving', items: SHELF2 }] });
    await settle(600); await settle(400);
    const v = SHELF2[1], card = keys().find((k) => k.endsWith(':' + v.id));   // (with shelves, Home shows them, not the flat list)
    disp.focusPage(card); await settle(300);
    tgt(card).run(); await settle(400);
    S('16-read-aloud-first-press');
    tgt(card).run(); await settle(200);                      // the second press plays it
    d.send({ ev: 'state', state: 'playing', id: v.id, title: v.title });
    d.send({ ev: 'time', elapsed: 61000, total: v.duration_s * 1000 });
    d.send({ ev: 'say', state: 'speaking' });
    await settle(500); await settle(400);
    S('17-watch-page-read-aloud-speaking');
    d.send({ ev: 'say', state: 'done' });
    hu.ctx.settings.set('picture_driving', false); speed(50); await settle(500); await settle(300);
    S('18-audio-only-read-aloud');
    // Typing while driving off, driving: the Search page's tile says why
    hu.ctx.settings.set('picture_driving', true); hu.ctx.settings.set('typing_driving', false);
    d.send({ ev: 'state', state: 'idle' }); hu.handlers.BTN_HOME(); await settle(300);
    tgt('rail:search').run(); await settle(400); await settle(300);
    S('19-typing-off-driving-search');
    console.log = origLog;
    d.server.close();
    process.exit(0);
})().catch((e) => { console.error('shoot failed', e); process.exit(1); });
