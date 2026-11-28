'use strict';
// Modified 2026-11-27 in a local fork of RideTube (Picture and Typing while driving, Read aloud; YouTube-style look; no-internet note): README.md, This fork.
/**
 * RideTube - search and play videos through the car daemon jap-ridetube-d (ytd.js, a root service), which
 * fetches them on the car itself, plays the sound through BMW's own media player (the car's audio source)
 * and decodes the picture (ytdec) into
 * /dev/shm/mgu-video-ridetube, which the renderer (mgu-render) draws in this app's layer (op 19).
 *
 * Screens (the fork's look: YouTube's own dark UI drawn from scratch, #0F0F0F, white and grey text, a red accent;
 * no YouTube artwork, the mark is a plain red play triangle and the word YouTube in the kit's font):
 *   VIEW  (first) drawn page. Browsing: up top a bar (the mark, a search box, the account) and a row of chips (Home,
 *         Subscriptions, Watch later, Playlists, History, Library, Now playing; the page shown light), under them rows
 *         of cards: a 16:9 thumb (its length in a badge), the channel's round initial, the title in up to two lines,
 *         "channel · 125K views · 1 day ago". The question pages (logs, clock, What's new) have no bar.
 *           home     shelves, each titled, turned sideways on their own: Continue watching, the account's
 *                    Home shelves (daemon `feed` shelves; an older daemon: its flat list as a grid), Watch later
 *           subs     the account's Subscriptions shelves (or the flat list as a grid)
 *           wl       a grid, four a row: Watch later
 *           results  the Search page (search.js): Type a search (Typing while driving, else in P), Menu (the HMI menu), the recent
 *                    searches, Clear; then the last search's results, a grid
 *           pl       the account's playlists, a grid (the first video's picture, the video count); one opens as
 *           list     its videos, a grid (the controller pushed left at the rail: back to Playlists)
 *           library  (cap download) Continue watching and On this car: the downloads, played with no network
 *           Not signed in, on a feed page: the sign-in card, a QR code for google.com/device and the code to
 *           enter there (the daemon's TV device sign-in: it keeps the account, the app never sees a token).
 *           The page scrolls (a finger, the controller turned on the page); the controller pushed or turned onto
 *           a tile brings it into view (ctx.onPageFocus), the arrows at a shelf's edges turn it for a finger.
 *           Thumbs are asked only for the tiles drawn, and drawn from a pool of 56 picture ids.
 *           player   where the kit runs the screen: the watch page first (the video in a 16:9 box, its controls over
 *                    it, the title and the channel under it, the actions and Up next on the right; Full screen goes
 *                    to the view below), or full screen: the video over the whole screen (no header, no bar), under
 *                    the overlay: back to the watch page and the title / channel (top), -10 s, play / pause,
 *                    +10 s (held: previous / next video) (middle), the progress bar with the times (bottom). A tap or the controller shows
 *                    it; it hides 4 s later while the picture plays (a tap beside the controls hides it at once);
 *                    preparing, paused, driving or no picture: it stays, with the "Preparing... N %" ring.
 *                    The controller pushed left goes back to the list (the HMI's BACK key closes the screen).
 *                    Where the HMI runs the screen: the video in a box under the header, over the HMI's bar.
 *         bar: none where the kit runs the screen (the rail and the overlay have its jobs; a "Playing" rail entry
 *         while something plays), so the pages reach the screen's bottom. Where the HMI runs the screen: all five
 *         (Play/Pause, -10 s, +10 s, the list / Now playing, Search), and the header has the page tabs (G.frame).
 *   MAIN  HMI menu (the Search page's Menu): the HMI's speller, Now playing, Results, Home, Subscriptions, Watch later, Playlists, recent
 *         searches / suggestions, then Sign in / Sign out (pressed twice), Send logs to the developer.
 *   logs  (a VIEW page) Send logs to the developer: from the menu or the player's error screen. Asks first (Send /
 *         Cancel; where the HMI runs the screen, the menu entry pressed again sends), then "Sending...", then the
 *         code the service's log relay answered (to quote in a GitHub issue) or why it was not sent.
 *   clock (a VIEW page) the wrong-clock warning: the service skips the certificate dates while the head unit's clock is
 *         wrong (hello's clock). Shown once an app session, the first time a page is drawn, until OK (or any page).
 *         The menu's info line keeps a short "Wrong clock" while it lasts.
 *
 * The picture: the "Picture while driving" setting (on by default) shows it in every gear and at any speed. Off, the picture
 * only in P (kit parked.js, park mode: the selector in P, 0 km/h, both signals fresh; an unknown or lost signal counts as
 * driving); anything else then turns the picture off (daemon `video off`, renderer DROP_VIDEO), the sound plays on; in P
 * again, it comes back. Typing (the HMI's keyboard: a search, a channel) follows "Typing while driving" the same way: on by
 * default, every gear; off, only in P. Read aloud (off by default; the fork's service 0.5.80, cap say): a video tile's first
 * press has the service say its title (the video playing paused for it and resumed after), the second plays it; the watch
 * page and podcast mode get a Read aloud button for the title playing. Nothing is ever said unasked. The app stays ACTIVE
 * while hidden as long as sound plays (ctx.background), because closing the socket stops playback.
 * Never exits: every handler logs its errors.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const QR = require('./kit/qr');
const { t: translate, plural, dict, getLanguage, setLanguage, languages, BAKED } = require('./kit/i18n');

function message(key, values) {
    return translate(key).replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
}
// a sentence the catalog has as a whole, else the English one (never translate()'s word-by-word mix of the two)
function whole(key, values) {
    const s = Object.prototype.hasOwnProperty.call(dict, key) ? translate(key) : key;
    return values ? s.replace(/\{(\w+)\}/g, (_, name) => String(values[name])) : s;
}
// "{count} video" / "{count} videos" for n: the catalog's plural row (one form per plural rule: Russian has three),
// else the English form as before (through tr: translate, or whole for a page that never mixes)
function count(n, one, other, tr) {
    const s = Object.prototype.hasOwnProperty.call(dict, one + '|' + other) ? plural(n, one, other) : (tr || translate)(n === 1 ? one : other);
    return s.replace(/\{count\}/g, String(n));
}
const { setImage } = require('./kit/record');
const { HMI } = require('./kit/display');
const Parked = require('./kit/parked');
const { Touchpad, TouchMode, MODE: PAD_MODE } = require('./kit/touchpad');
const { Ctl, Model, clock, SOCKET, FEEDS, SHELF_MAX, followStoreProxy, PICTURE, TYPING, READ, migrateSettings, drivingGate } = require('./yt');
const { spell } = require('./speller');

const W = 1600, H = 520;
const BOX = { x: 12, y: 38, w: 1576, h: 432 };          // the video, in the page's visible part (y 38..520)
const VID = 1, VPATH = process.env.MGU_YT_VIDEO || '/dev/shm/mgu-video-ridetube';     // (env: tests)
const POOL0 = 8, POOL = 56;                               // picture ids POOL0.. for the thumbs drawn (a pool, by video)
let TOP = 38;                                            // the page shows from here down (the kit: y 38..520 + extra; fill: 12, inset())
const RAIL0 = 12, TILE_X = 28;                           // the page's left edge and the first card's left (no rail: a bar on top)
const HEAD = 122;                                        // the YouTube bar and its chips, over the browsing pages (cv.own)
let RX = 0, FILL = false, RAIL_W = RAIL0, X0 = TILE_X;                 // inset() moves both right of the HMI's back arrow column
let TW = 320, TH = 180, PITCH = 348;                     // tiles: 16:9 thumbs, four a row, the fifth peeking (inset())
const PER_ROW = 4;
let TILE_H = TH + 98;
const HEAD_H = 50, SHELF_GAP = 30, GRID_GAP = 22;   // a tile with its text; a shelf's title row
const VOL_MS = 2000;                                     // the volume pill shows this long after a change
// shortcut: the car's top volume is not known yet (the first ones are logged); the bar grows past it - set it when measured
const VOL_MAX = 40;
const OVERLAY_MS = 4000;                                 // the player's controls hide this long after a tap (playing)
const SEARCH_MS = 8000;                                  // a search with no answer by then is an error on screen
const SUGGEST = ['Music', 'News', 'Cars', 'Podcasts', 'Comedy', 'Trailers'];
const SLOTS = ['BTN_S1', 'BTN_S2', 'BTN_S3', 'BTN_S4', 'BTN_S5', 'BTN_S6'];
const TABS = ['home', 'subs', 'wl', 'pl'];
const NAMES = { home: 'Home', subs: 'Subscriptions', wl: 'Watch later', pl: 'Playlists', list: 'Playlist', results: 'Results', hist: 'History', health: 'Health check', remote: 'Phone remote', library: 'Library' };
const FEED_MS = 15000;                                   // a feed with no answer by then is an error on screen
const SIGNIN_URL = 'https://www.google.com/device';
const APP_VERSION = String(mgu.SPEC.version).split('-')[0];   // (a localized build's "0.3.12-zh.cn.4": the release's)
// hello's lang and region (YouTube's hl and gl) follow the car's iDrive language setting ("de_DE" -> de, DE;
// "en_GB" -> en, GB): the country always, the language on Auto; a language picked by hand is that language.
// No car setting (an emulator, an SDK without it): the display language alone, no region.
const carLocale = (hmi) => { const m = /^([a-z]{2})[_-]([A-Z]{2})/.exec(String(hmi || '')); return m ? { lang: m[1], region: m[2] === 'UK' ? 'GB' : m[2] } : null; };
const helloLang = (lang, hmi, auto) => {
    const car = carLocale(hmi), l = String(lang).split('-')[0];
    return car ? { lang: auto ? car.lang : l, region: car.region } : { lang: l };
};
const CLOCK_MSG = 'The head unit\'s clock is wrong (it says {date}). RideTube is skipping the certificate date check so videos still play. While the clock is wrong, the security of the app and of your car can be compromised. Set the car\'s date and time to fix it.';
const LOGS_MS = 45000;                                   // a log report with no answer by then failed (the service gives up at 31 s)
const LOGS_ERR = { closed: 'Log reporting is closed for now', busy: 'Too many reports right now - try again later',
    offline: 'No connection - try again later', failed: 'Sending failed - try again later', old: 'Sending logs needs a newer jap-ridetube-d tool on the car' };

process.on('uncaughtException', (e) => { try { mgu.log.error('uncaught', e); } catch (x) { /* nothing left to log with */ } });

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        // What's new (news.js): read before anything is saved, so a first install is told from an update
        const news = require('./news'), newsAt = news.due(settings.get('seen_series'), fs.existsSync(settings.file), APP_VERSION);
        let newsDue = newsAt.show, newsFrom = 'home';
        if (settings.get('seen_series') !== newsAt.seen) settings.set('seen_series', newsAt.seen);
        // the Language setting: a catalog the package has, else Auto: the car's HMI language when there is a catalog
        // for it (ru_RU, zh_CN, fr_FR, nl_NL...), else the package's own (English; a zh-CN build's Chinese)
        const pickLanguage = () => {
            const want = settings.get('language') || 'auto', have = languages();
            if (want !== 'auto') return have.indexOf(want) >= 0 ? want : BAKED;
            const hmi = String((ctx.hmiLanguage && ctx.hmiLanguage()) || ''), tag = /^zh_CN/.test(hmi) ? 'zh-CN' : /^[a-z]{2}(?=[_-]|$)/.test(hmi) ? hmi.slice(0, 2) : null;
            return tag && have.indexOf(tag) >= 0 ? tag : BAKED;
        };
        setLanguage(pickLanguage());
        const hello = () => Object.assign({ app: APP_VERSION }, helloLang(getLanguage(), ctx.hmiLanguage && ctx.hmiLanguage(),
            (settings.get('language') || 'auto') === 'auto'));
        let helloSent = JSON.stringify(hello());
        // the picture: Picture while driving on (the default), always; off, only parked: P, 0 km/h, fresh signals (kit
        // parked.js), anything else sound only. The saved setting is made true or false first (yt.js migrateSettings)
        const parked = Parked.watch(ctx, log, { park: true });
        const moves = migrateSettings((k) => settings.get(k));
        moves.forEach((w) => settings.set(w[0], w[1]));
        if (moves.length) log.info('settings migrated: ' + JSON.stringify(moves));
        const pictureDriving = () => settings.get(PICTURE) !== false;
        const noVideo = drivingGate(parked, pictureDriving);   // (asks parked.moving() in both modes: yt.js)
        // Typing while driving (the HMI's keyboard: a search, a channel), on by default; off, only in P (the same parked rule)
        const typingDriving = () => settings.get(TYPING) !== false;
        const noTyping = drivingGate(parked, typingDriving);
        log.info('picture while driving: ' + (pictureDriving() ? 'on' : 'off (the picture only in P)'));
        log.info('typing while driving: ' + (typingDriving() ? 'on' : 'off (typing only in P)'));
        // Read aloud (off by default): a video tile's first press says its title (pressVideo)
        const readAloud = () => settings.get(READ) === true;
        log.info('read aloud: ' + (readAloud() ? 'on' : 'off'));

        /* ---------- the daemon ---------- */
        const ctl = new Ctl(process.env.MGU_YT_SOCKET || SOCKET, log);
        const model = new Model((o) => ctl.send(o), JSON.parse(helloSent));
        // yt-dlp updates (the daemon fetches the newest yt-dlp release itself): the setting, told on connect and on a change
        model.ytdlpAuto = settings.get('ytdlp_auto') !== false;
        const proxySwitch = followStoreProxy(settings, model);   // the MGU Store's proxy for RideTube too (the address is the Store's)
        model.autoDl = Number(settings.get('auto_download')) || 0;   // (0.6.0) new Subscriptions videos kept on the car, on Wi-Fi
        settings.onChange((key, value) => { if (key === 'ytdlp_auto') model.setYtdlpAuto(value !== false); proxySwitch(key, value); if (key === 'auto_download') model.setAutoDl(value); });
        let mode = 'home', browse = 'home', dirty = true;   // browse: the list the player goes back to
        let fullView = false;     // the player: the watch page (false) or the video over the whole screen (Full screen)
        // the page's loop (ctx.loop, end of run): input that comes through signals, not the kit, kicks it
        let viewLoop = null;
        const kick = () => { if (viewLoop) viewLoop.kick(); };
        const changed = () => { dirty = true; if (ctx.background) ctx.background('playing', model.active()); labels(); };
        const isFeed = (m) => FEEDS.indexOf(m) >= 0;
        // a feed tab (or Playlists): signed in, (re)load it; signed out, ask for a sign-in code (the daemon says the one
        // shown again). A new device flow starts only from here (show), the account button or the page's "tap" - never on its own
        const openFeed = () => {
            if (!isFeed(mode) && mode !== 'pl') return;
            if (model.auth.state !== 'signed_in') { model.authStart(); return; }
            if (mode === 'pl') { model.loadPlaylists(); return; }
            model.feed(mode);
            if (mode === 'home') model.feed('wl');
            if (mode === 'subs') model.loadChannels();                    // Home's last shelf (one request at a time: idempotent)
        };
        const backKey = {};                              // page -> the tile the controller was on when it was left
        let clockSeen = false, clockFrom = 'home';   // the wrong-clock warning: shown once this app session, left from there
        function show(m) {
            if (mode === 'clock' && m !== 'clock') clockSeen = true;
            if (m !== mode) { dirty = true; if (laid.mode === mode && laid.where[focusKey]) backKey[mode] = focusKey; }   // (a tile of this page)
            mode = m;
            if (m !== 'player' && m !== 'logs' && m !== 'clock' && m !== 'news' && m !== 'signin') browse = m; else if (m === 'player') wake();
            openFeed(); sync(); labels();
        }
        function goBack(m) {
            if (m !== 'player') fullView = false;
            show(m);
            if (backKey[m] && ctx.focus) ctx.focus(backKey[m]);
        }
        let remote = null;   // the phone remote page (cap remote; below, with the other pages)
        ctl.on('up', () => { model.setConnected(true); changed(); });
        ctl.on('down', () => { model.setConnected(false); if (remote) remote.down(); changed(); });
        ctl.on('msg', (m) => {
            model.onMsg(m);
            if (m.ev === 'hello') model.loop(repeatOn());   // Repeat holds per connection on the service: said again on each hello
            if (remote) remote.onMsg(m);
            if (m.ev === 'error') log.warn('jap-ridetube-d: ' + m.msg);
            if (m.ev === 'say' && (m.state === 'busy' || m.state === 'error')) flash(translate(m.state === 'busy' ? 'Read aloud is busy, try again' : 'Read aloud failed'));
            if (m.ev === 'state') log.info('jap-ridetube-d: ' + m.state + (m.id ? ' ' + m.id : ''));
            if (m.ev === 'auth') { log.info('jap-ridetube-d: account ' + m.state); if (m.state === 'signed_in') { if (mode === 'signin') show('home'); openFeed(); } }
            changed();
        });
        ctl.connect();

        /* ---------- the internet: the Store's uplink (no cellular of its own: a phone hotspot over the Store's Wi-Fi) ---------- */
        // mgu-uplink's /run/mgu-uplink/status.json (0644, there while the uplink runs): state "online" or why not (searching,
        // connecting, trust-needed, busy, error) and its error text ("Personal Hotspot is off"). Unreadable or absent (an
        // uplink that writes none): unknown, and the service's own offline errors speak instead. Back online: the page
        // shown loads again.
        const UPLINK = process.env.MGU_UPLINK_STATUS || '/run/mgu-uplink/status.json';
        let uplink = { known: false, online: true, state: null, error: null };
        function readUplink() {
            fs.readFile(UPLINK, 'utf8', (e, txt) => {
                try {
                    let next = { known: false, online: true, state: null, error: null };
                    if (!e) {
                        const j = JSON.parse(txt);
                        next = { known: true, online: j.state === 'online', state: String(j.state || ''), error: typeof j.error === 'string' && j.error ? j.error.slice(0, 120) : null };
                    }
                    const was = uplink;
                    uplink = next;
                    if (was.known !== next.known || was.online !== next.online || was.error !== next.error) {
                        log.info('internet: ' + (!next.known ? 'unknown (' + (e ? e.code || e.message : '?') + ')' : next.online ? 'online' : 'offline, uplink ' + next.state + (next.error ? ': ' + next.error : '')));
                        if (next.online && was.known && !was.online) openFeed();     // back: the page shown loads again
                        dirty = true; kick();
                    }
                } catch (x) { log.warn('uplink status: ' + x.message); }
            });
        }
        readUplink();
        setInterval(() => { try { readUplink(); } catch (e) { log.error('uplink', e); } }, 2000);
        const netDown = () => uplink.known && !uplink.online;
        const net1 = () => translate('No internet: connect the phone hotspot');
        const net2 = () => translate('Turn on your phone\'s hotspot, then join it in the MGU Store: Settings, Wi-Fi');

        /* ---------- hidden channels (a channel page's Hide), members-only videos (a setting) ---------- */
        const HIDDEN = path.join(ctx.dataDir, 'hidden.json');
        let hidden = [];
        try { hidden = JSON.parse(fs.readFileSync(HIDDEN, 'utf8')).filter((s) => typeof s === 'string'); } catch (e) { /* none yet */ }
        function toggleHidden(name) {
            hidden = hidden.indexOf(name) >= 0 ? hidden.filter((x) => x !== name) : hidden.concat(name);
            try { fs.writeFileSync(HIDDEN, JSON.stringify(hidden)); } catch (e) { log.warn('hidden: ' + e.message); }
            dirty = true;
        }
        // what Home, Subscriptions, Watch later and Search show (a channel's own page shows all)
        const shown = (items) => noShorts(items).filter((r) => hidden.indexOf(r.channel) < 0 && !(r.members && !settings.get('members')));
        // Shorts (tiles the service marks short): only with the Show Shorts setting, a channel's own page too
        const noShorts = (items) => (settings.get('shorts') ? items : items.filter((r) => !r.short));

        /* ---------- searches: the Search page (search.js) and the HMI menu: recent first, then suggestions ---------- */
        // a short note over the page's foot for 4 s (a live tile pressed, typing pressed while driving)
        let note = null;
        const flash = (text) => { note = { text, until: Date.now() + 4000 }; dirty = true; };
        let toResults = false;                       // a search just run: its results brought into view when they come
        const page = require('./search')({ settings, legacy: path.join(ctx.dataDir, 'recent.json'), model, t: translate, whole, message,
            moving: () => noTyping(), type: () => typeSearch(true), run: (q) => search(q), menu: () => ui.open('MAIN'), flash,
            changed: () => { showSlots(); dirty = true; }, glyphs: () => ({ KEYS, ALL, X: (cv, x, y, c) => xGlyph(cv, x, y, 22, c) }), net1: () => net1(), net2: () => net2() });
        let suggestions = SUGGEST.map(translate);
        const slots = () => { const recent = page.list(); return recent.concat(suggestions.filter((s) => recent.indexOf(s) < 0)).slice(0, SLOTS.length); };
        const showSlots = () => slots().forEach((s, i) => ui.text(SLOTS[i], s, 0, 'Text', { literal: true }));
        // quiet: a phone remote's search, shown in the app without bringing it to the front
        function search(q, quiet) {
            q = String(q || '').trim();
            if (!q) return false;
            page.add(q);
            showSlots();
            model.search(q);               // (not sent: the results screen says why)
            toResults = true;
            show('results');
            if (!quiet) ui.open('VIEW');
            return true;
        }
        // the HMI's speller (Typing while driving on, or in P: the parked rule, whatever Picture while driving says): from
        // the menu (an error or why not in its info line), or the Search page (left without a search: back on the page)
        function typeSearch(fromPage) {
            if (noTyping()) {
                if (fromPage) flash(translate('Typing works only in P (Park)'));
                else ui.text('MAIN_INFO', translate('Typing works only in P (Park)'), 0, 'Text', { literal: true });
                return Promise.resolve();
            }
            return spell(ctx.app, translate('Search videos'))
                .then((t) => { if (!search(t) && fromPage) ui.open('VIEW'); })
                .catch((e) => {
                    const why = translate('The keyboard did not open: ') + (e.message || e);
                    log.warn('speller: ' + (e.message || e));
                    if (fromPage) { flash(why); ui.open('VIEW'); } else ui.text('MAIN_INFO', why, 0, 'Text', { literal: true });
                });
        }
        ui.onClick('BTN_SEARCH', () => typeSearch(false));
        SLOTS.forEach((b, i) => ui.onClick(b, () => search(slots()[i])));
        ui.onClick('BTN_NOW', () => { show('player'); ui.open('VIEW'); });
        ui.onClick('BTN_CLOSE', () => { closeVideo(); info(); });
        ui.onClick('BTN_RESULTS', () => { show('results'); ui.open('VIEW'); });
        [['BTN_HOME', 'home'], ['BTN_SUBS', 'subs'], ['BTN_WL', 'wl'], ['BTN_PL', 'pl']].forEach(([b, m]) => ui.onClick(b, () => { show(m); ui.open('VIEW'); }));
        // 0.4.0 services (caps; labels() hides the entries otherwise): History; the health check, run on each press
        ui.onClick('BTN_HIST', () => { if (model.can('hist')) { show('hist'); ui.open('VIEW'); } });
        ui.onClick('BTN_LIB', () => { if (model.can('download')) { show('library'); ui.open('VIEW'); } });
        ui.onClick('BTN_HEALTH', () => { if (model.can('health')) { model.runHealth(); show('health'); ui.open('VIEW'); } });
        // 0.4.3 (cap remote): the phone remote page; pressed again there where the HMI runs the screen (no button drawn): on / off
        ui.onClick('BTN_REMOTE', () => {
            if (!model.can('remote') || !remote) return;
            const hmiScreen = !(ctx.display && ctx.display.own && ctx.display.own());
            if (hmiScreen && mode === 'remote') remote.toggle(); else remote.refresh();
            show('remote');
            ui.open('VIEW');
        });
        // Send logs to the developer: the logs page asks first; pressed again there (the HMI's own screen has no Send button), sends
        let logsFrom = 'home';
        function openLogs() {
            const hmiScreen = !(ctx.display && ctx.display.own && ctx.display.own());   // (no Send button drawn there)
            if (hmiScreen && mode === 'logs' && model.logs && model.logs.state === 'confirm') { model.sendLogs(APP_VERSION); return; }
            if (mode !== 'logs') logsFrom = mode;
            model.askLogs();
            show('logs');
        }
        ui.onClick('BTN_LOGS', () => { openLogs(); ui.open('VIEW'); });
        // Sign in: the Home tab shows how (after a failed try, asks again). Sign out: pressed twice within 5 s
        let signOutArmed = null;
        ui.onClick('BTN_ACCOUNT', () => {
            if (model.auth.state !== 'signed_in') { show(offlineSecs().length ? 'signin' : 'home'); model.authStart(true); ui.open('VIEW'); return; }
            if (!signOutArmed) { signOutArmed = setTimeout(() => { signOutArmed = null; labels(); }, 5000); labels(); return; }
            clearTimeout(signOutArmed); signOutArmed = null;
            model.signOut();
            labels();
        });
        showSlots();

        function info() {
            let s;
            if (!model.connected) s = translate('The RideTube service (jap-ridetube-d) is not running');
            else if (model.searchError) s = translate('Search: ') + whole(model.searchError);
            else if (model.error) s = translate('Error: ') + whole(model.error);
            else if (model.active()) s = (model.state === 'preparing' ? message('Preparing {percent} %: ', { percent: Math.round(model.pct) }) : model.state === 'paused' ? translate('Paused: ') : translate('Playing: ')) + model.title;
            else s = translate('Search, or pick a recent search below');
            if (model.connected && model.clock) s = whole('Wrong clock ({date}): security reduced', { date: model.clock }) + ' · ' + s;
            ui.text('MAIN_INFO', s, 0, 'Text', { literal: true });
        }
        info();
        setInterval(() => { try { model.checkSearch(Date.now(), SEARCH_MS); model.checkFeeds(Date.now(), FEED_MS); model.checkLogs(Date.now(), LOGS_MS); if (ui.isVisible('MAIN')) info(); } catch (e) { log.error('info', e); } }, 1000);

        /* ---------- playing ---------- */
        // the decoder's picture size. Full-screen layout: the whole screen, for the full view (ytdec fits, or
        // fills when that crops at most 15 %; the fill setting, on by default, always crops); the player draws the same frame
        // smaller (op 19 fits it into vbox, below). The daemon has no rect change, so the size is the full view's
        // from the start. Else the box in screen pixels.
        function rect() {
            const pl = ctx.display && ctx.display.place, s = (pl && pl.scale) || 1;
            const even = (v, max) => Math.min(max, Math.max(16, Math.round(v / 2) * 2));
            if (pl && pl.full) return even(pl.w, 2048) + 'x' + even(pl.h, 2048);
            return even(BOX.w * s, 1920) + 'x' + even(BOX.h * s, 720);
        }
        // where op 19 draws: x, y, w, h fitted to the aspect of the rect the video was played with (ytdec keeps it for the
        // whole play, a layout change too). The service (0.5.6, noUpscale) sends the picture alone at the video's size, no
        // bars, which the renderer fits in here: the place the bars put it (an older service's frame fills this exactly)
        let playRect = null;
        function vbox(x, y, w, h) {
            const r = (playRect || rect()).split('x'), a = r[0] / r[1];
            return w / h > a ? [x + (w - h * a) / 2, y, h * a, h] : [x, y + (h - w / a) / 2, w, w / a];
        }
        // it: the tile tapped (its title and channel show while the video is prepared)
        // list: the shelf, or the whole grid, it was picked from; the videos after it play next when one ends (autoplay)
        const QUALITIES = ['auto', '720', '480', '360'];   // app.json's Video quality values, in the button's order
        // queue: the list's videos after the one playing (next first); prevs: those before it (the nearest last)
        let queue = [], prevs = [], nextAt = 0;
        const playable = (r) => r && !r.act && !r.live && /^[\w-]{11}$/.test(r.id);
        // a live stream (live:true): the service can't play it yet, so it is not asked; a short note on the page says so
        // stay: play it without showing the player (a steering-wheel skip while browsing, the sound playing on)
        function play(id, it, list, stay) {
            if (it && it.live) { flash(whole("Live videos can't be played yet")); return; }
            if (!stay) show('player');
            if (list) {
                const i = list.findIndex((r) => r.id === id);
                queue = list.slice(i + 1).filter(playable);
                prevs = list.slice(0, Math.max(0, i)).filter(playable);
            }
            nextAt = 0;
            if (model.id === id && model.active()) return;
            playRect = rect();
            model.play(id, playRect, settings.get('fill') !== false, it, { quality: settings.get('quality'), skip: sbSkip(), noUpscale: true });
        }
        // Read aloud (setting, off by default; the fork's service 0.5.80, cap say): a video tile's first press has the service
        // say its title and asks for a second press, which plays it (within 12 s, on the same tile); another tile says its own.
        // Off, or a service without it: a press plays at once (that service: a note, once). Nothing is said unasked
        let sayArmed = null, sayOld = false;   // {id, until}: the tile whose title was just said
        function pressVideo(r, playIt) {
            if (!readAloud()) { playIt(); return; }
            if (!model.can('say')) {
                if (!sayOld) { sayOld = true; flash(translate('Read aloud needs RideTube service 0.5.80')); }
                playIt();
                return;
            }
            if (sayArmed && sayArmed.id === r.id && Date.now() < sayArmed.until) { sayArmed = null; note = null; playIt(); return; }   // (its note done)
            sayArmed = { id: r.id, until: Date.now() + 12000 };
            model.speak(r.title, getLanguage());
            flash(translate('Press again to play'));
        }
        // the watch page's and podcast mode's Read aloud: the title playing said, or (pressed while it speaks) stopped
        const sayTitle = () => { if (model.speaking) model.hush(); else model.speak(model.title, getLanguage()); };
        const canSay = () => readAloud() && model.can('say') && !!model.id;
        // a speaker and two waves
        const speakerGlyph = (cv, x, y, c) => {
            cv.fillRect(x - 12, y - 5, 6, 10, c);
            cv.quad([[x - 6, y - 5], [x + 2, y - 11], [x + 2, y + 11], [x - 6, y + 5]], c);
            cv.polyline([[x + 6, y - 5], [x + 9, y], [x + 6, y + 5]], 2.5, c);
            cv.polyline([[x + 10, y - 9], [x + 15, y], [x + 10, y + 9]], 2.5, c);
        };
        // the one playing, as a list item (what Previous and Next step over)
        const current = () => model.item(model.id) || { id: model.id, title: model.title, channel: model.channel };
        // Next / Previous in the list the video came from: the steering wheel (steer, below), the podcast view's Next,
        // autoplay. Previous: back to the start when more than 3 s in or
        // nothing is before it (as music players do), else the video before it
        // watch-next (cap related): the first video YouTube lists after the one playing worth playing (not itself, not
        // one just played, not a Short unless they show); undefined while that list is on its way (asked here once)
        function relatedNext() {
            const r = model.related;
            if (!model.can('related') || !model.id) return null;
            if (!r || r.id !== model.id) return model.loadRelated(model.id) ? undefined : null;
            if (r.loading) return undefined;
            return r.items.find((x) => playable(x) && x.id !== model.id && !prevs.some((p) => p.id === x.id) && (!x.short || settings.get('shorts'))) || null;
        }
        // a next waiting for that list {id, stay, until}: played when it comes (also hidden: the wheel works then),
        // dropped once another video plays, it was closed, or after 20 s
        let relWait = null;
        model.onRelated = () => {
            const w = relWait;
            relWait = null;
            if (w && w.id === model.id && Date.now() < w.until && (model.active() || model.state === 'ended')) { skipNext(w.stay, true); changed(); }
        };
        // related: with the list done, the first related video (a steering-wheel tap, autoplay)
        function skipNext(stay, related) {
            if (!queue.length && related) {
                const r = relatedNext();
                if (r === undefined) { relWait = { id: model.id, stay, until: Date.now() + 20000 }; return true; }
                if (r) queue.push(r);
            }
            if (!queue.length) return false;
            if (model.id) prevs.push(current());
            const r = queue.shift();
            play(r.id, r, null, stay);
            return true;
        }
        function skipPrev(stay) {
            if (!model.id) return false;
            if (model.elapsed > 3000 || !prevs.length) {
                if (model.state === 'playing' || model.state === 'paused') model.skip(-model.elapsed);
                else play(model.id, current(), null, stay);                  // ended or failed: from the start again
                return true;
            }
            queue.unshift(current());
            const r = prevs.pop();
            play(r.id, r, null, stay);
            return true;
        }
        // Close: the video ends here and now (the daemon stops the sound, gives the speakers back and ends the decoder),
        // nothing plays next, and the list it came from shows again
        function closeVideo() {
            if (!model.active() && model.state !== 'ended' && model.state !== 'error') return;
            queue = []; prevs = []; nextAt = 0;
            model.stop();
            goBack(browse);
        }
        /* ---------- Repeat (a setting, toggled in the player and the menu): the service loops the video ---------- */
        // at the video's end it plays again from 0 with nothing torn down: no `ended`, no Up next, no new lookup or audio
        // fetch, only a stream's video window from 0 (service 0.5.8, cap loop; an older one: no Repeat shown)
        const repeatOn = () => settings.get('repeat') === true;
        const canRepeat = () => model.can('loop');
        function toggleRepeat() { settings.set('repeat', !repeatOn()); model.loop(repeatOn()); dirty = true; labels(); }
        // two arrows chasing round: the Repeat control's glyph (k: its size)
        const repeatGlyph = (cv, x, y, c, k) => {
            k = k || 1;
            cv.strokeRoundRect(x - 20 * k, y - 12 * k, 40 * k, 24 * k, 9 * k, Math.max(2, 3.5 * k), c);
            cv.quad([[x + 2 * k, y - 20 * k], [x + 12 * k, y - 12 * k], [x + 2 * k, y - 4 * k], [x + 2 * k, y - 20 * k]], c);
            cv.quad([[x - 2 * k, y + 4 * k], [x - 12 * k, y + 12 * k], [x - 2 * k, y + 20 * k], [x - 2 * k, y + 4 * k]], c);
        };
        // an X: the Close control's glyph
        const xGlyph = (cv, x, y, r, c) => { cv.line(x - r, y - r, x + r, y + r, 6, c); cv.line(x - r, y + r, x + r, y - r, 6, c); };
        // from render: ended with a next one -> 5 s to see what comes, then it plays (back to the list cancels)
        // the list done: the first related video instead (watch-next)
        function autoNext() {
            const up = model.state === 'ended' && mode === 'player' ? queue[0] || relatedNext() : null;
            if (!up) { nextAt = 0; return null; }
            if (!nextAt) { nextAt = Date.now() + 5000; wake(); }
            if (Date.now() < nextAt) return up;
            skipNext(false, true);
            return null;
        }
        let lastPlay = null, lastList = null, lastAcct = null, lastCaps = null, lastRepeat = null;
        function labels() {
            const caps = [model.can('hist'), model.can('health'), model.can('remote'), model.can('download'), canRepeat()];
            if (String(caps) !== lastCaps && ui.visible) { lastCaps = String(caps); ui.visible('BTN_HIST', caps[0]); ui.visible('BTN_HEALTH', caps[1]); ui.visible('BTN_REMOTE', caps[2]); ui.visible('BTN_LIB', caps[3]); ui.visible('BTN_REPEAT', caps[4]); }
            const p = model.state === 'playing' ? 'Pause' : 'Play';
            if (p !== lastPlay) { lastPlay = p; ui.text('BTN_PLAY', translate(p)); }
            const rp = repeatOn() ? 'Repeat on' : 'Repeat off';
            if (rp !== lastRepeat) { lastRepeat = rp; ui.text('BTN_REPEAT', translate(rp)); }
            const l = mode === 'player' ? NAMES[browse] : model.active() ? 'Now playing' : 'Player';
            if (l !== lastList) { lastList = l; ui.text('BTN_LIST', translate(l)); }
            const a = model.auth.state !== 'signed_in' ? 'Sign in' : signOutArmed ? 'Press again to sign out' : 'Sign out';
            if (a !== lastAcct) { lastAcct = a; ui.text('BTN_ACCOUNT', translate(a)); }
        }
        ui.onClick('BTN_PLAY', () => model.toggle());
        ui.onClick('BTN_REPEAT', toggleRepeat);
        ui.onClick('BTN_RW', () => model.skip(-10000));
        ui.onClick('BTN_FF', () => model.skip(10000));
        ui.onClick('BTN_LIST', () => show(mode === 'player' ? browse : 'player'));
        if (ctx.onTab) ctx.onTab((i) => { if (TABS[i]) show(TABS[i]); });
        ui.onClick('BTN_FIND', () => ui.open('MAIN'));
        // where the kit runs the screen: no bar at all (the rail and the player's overlay do its jobs), so the
        // pages reach the screen's bottom; the HMI's own screen keeps all five
        if (ctx.hideButton) ['BTN_PLAY', 'BTN_RW', 'BTN_FF', 'BTN_LIST', 'BTN_FIND'].forEach((b) => ctx.hideButton(b, true));
        labels();

        /* ---------- the player's overlay (where the kit runs the screen): shown on a tap or the controller ---------- */
        // the knob turned on the progress bar: 10 s a detent, one seek once it rests 350 ms (the bar moves at once)
        let pend = 0, pendT = null;
        function turnSeek(d) {
            if (model.state !== 'playing' && model.state !== 'paused') return;
            pend += d * 10000; wake();
            clearTimeout(pendT);
            pendT = setTimeout(() => { const ms = pend; pend = 0; model.skip(ms); dirty = true; }, 350);
        }
        // a finger on the progress bar (where the kit runs the screen): pressed or dragged, the bar, the time and a
        // bubble follow it; one seek where it lets go. seekBar: where the last frame drew the bar (overlay px, its
        // touch band, the overlay's scale); scrub: {ms, bar} while a finger holds it
        let seekBar = null, scrub = null;
        const barMs = (b, sx) => Math.round(Math.max(0, Math.min(1, (sx / b.s - b.x0) / b.w)) * model.total);
        // a double tap on the picture's left or right third: -10 s / +10 s, each further quick tap 10 s more (one seek
        // once they stop, as the knob). A single tap still shows or hides the controls, a tap on a control is the
        // control's. picArea: the video player's last frame {SW, s, ctls: the controls shown (overlay px)};
        // taps: the last tap counted {dir, t, x, y, n, ctls: the controls shown at the first}; tapFx: the hint drawn
        let picArea = null, taps = null, tapFx = null, tapHeld = false, downAt = null;
        const TAP_MS = 400;
        const live = () => model.state === 'playing' || model.state === 'paused';
        const third = (a, x) => (x < a.SW * 0.35 ? -1 : x > a.SW * 0.65 ? 1 : 0);
        const onCtl = (ctls, x, y) => ctls.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
        function tapDown(sx, sy) {
            const a = picArea, now = Date.now();
            downAt = { sx, sy, t: now };
            if (!a || mode !== 'player' || !live() || !taps || now - taps.t > TAP_MS) return false;
            const x = sx / a.s, y = sy / a.s, dir = third(a, x);
            // the first tap's side, near it, and not on a control that was there then (one it showed doesn't count)
            if (dir !== taps.dir || Math.abs(x - taps.x) > 240 || Math.abs(y - taps.y) > 240 || onCtl(taps.ctls, x, y)) return false;
            Object.assign(taps, { t: now, x, y, n: taps.n + 1 });
            turnSeek(dir);
            tapFx = { dir, n: taps.n, until: now + 900 };
            tapHeld = true;
            wake();
            return true;
        }
        // a tap the page got (short, not moved): counted when it was on the picture's left or right third, off the controls
        function tapUp(sx, sy) {
            const a = picArea, d = downAt, now = Date.now();
            downAt = null; taps = null;
            if (!a || !d || mode !== 'player' || !live() || now - d.t > 300 || Math.abs(sx - d.sx) > 30 || Math.abs(sy - d.sy) > 30) return;
            const x = sx / a.s, y = sy / a.s, dir = third(a, x);
            if (dir && !onCtl(a.ctls, x, y)) taps = { dir, t: now, x, y, n: 0, ctls: a.ctls };
        }
        if (ctx.onTouch) ctx.onTouch((phase, sx, sy) => {
            if (phase === 1) {
                scrub = null; tapHeld = false;
                const b = seekBar, x = b ? sx / b.s : 0, y = b ? sy / b.s : 0;
                const onBar = b && mode === 'player' && model.total > 0 && live() && x >= b.x0 - 24 && x <= b.x0 + b.w + 24 && y >= b.y0 && y <= b.y1;
                if (!onBar) return tapDown(sx, sy);
                taps = null;
                clearTimeout(pendT); pend = 0;                     // (a knob seek not sent yet: the finger wins)
                scrub = { ms: barMs(b, sx), bar: b };
                wake();
                return true;
            }
            if (tapHeld) { if (phase === 3) tapHeld = false; return true; }
            if (!scrub) { if (phase === 3) tapUp(sx, sy); return false; }
            scrub.ms = barMs(scrub.bar, sx);
            if (phase === 3) { const ms = scrub.ms; scrub = null; model.skip(ms - model.elapsed); }
            wake();
            return true;
        });
        const shownAt = () => (scrub ? scrub.ms : Math.max(0, Math.min(model.total > 0 ? model.total : Infinity, model.elapsed + pend)));
        // while a finger holds the bar: the time it would go to (and its chapter) in a bubble over the scrubber
        function scrubBubble(cv, fx, y) {
            if (!scrub) return;
            const ex = model.extras && model.extras.id === model.id ? model.extras : null;
            let ch = null;
            if (ex) ex.chapters.forEach((k) => { if (k[0] <= scrub.ms) ch = k[1]; });
            const t = clock(scrub.ms) + (ch ? '  ·  ' + ch : ''), tw = Math.min(520, cv.textWidth(t, 26, LITB) + 36);
            const bx = Math.max(16, Math.min(fx - tw / 2, (cv.place ? cv.place.w / cv.place.scale : W) - tw - 16));
            cv.roundRect(bx, y - 62, tw, 46, 12, '#000000e0');
            cv.text(fit(cv, t, 26, tw - 36, LITB), bx + 18, y - 30, 26, '#ffffff', LITB);
        }
        // preparing: its percentage, or the network lost and the daemon trying again
        const prepText = () => (model.retry ? message('No connection - trying again ({count})...', { count: model.retry }) : message('Preparing... {percent} %', { percent: Math.round(model.pct || 0) }));
        // a failed play: Try again (the same video, the queue kept)
        const again = () => { if (model.id) play(model.id, model.item(model.id)); };
        /* ---------- SponsorBlock: per category Skip, a Skip button (ask) or Off (Settings) ---------- */
        const SB = [['sponsor', 'sponsor'], ['selfpromo', 'self-promotion'], ['interaction', 'subscribe reminder'], ['intro', 'intro'], ['outro', 'end cards'], ['music_offtopic', 'non-music part']];
        const sbMode = (cat) => settings.get('sb_' + cat) || 'off';
        const sbSkip = () => SB.map((c) => c[0]).filter((c) => sbMode(c) === 'skip');
        const sbName = (cat) => (SB.find((c) => c[0] === cat) || [0, 'segment'])[1];
        const sbSegs = (ex) => ex.segments.filter((g) => sbMode(g[2]) !== 'off');
        const sbColor = (g) => (sbMode(g[2]) === 'ask' ? '#ffd400' : '#00d400');
        // the segment the clock is in whose category asks: its Skip button shows (and the overlay stays)
        function askSeg() {
            const ex = model.extras && model.extras.id === model.id ? model.extras : null, t = shownAt();
            if (!ex || (model.state !== 'playing' && model.state !== 'paused')) return null;
            return ex.segments.find((g) => sbMode(g[2]) === 'ask' && t >= g[0] && t < g[1] - 1000) || null;
        }
        const sbJump = (g) => () => model.skip(g[1] - shownAt());
        // two buttons for 10 s after a play the service resumed: "Resumed at 12:34" (keep it, the notice goes) and
        // "Start over" (back to the start). Drawn by the player and podcast mode where the kit runs the screen; true when drawn
        function resumePill(cv, x, y, h, size, tg, run) {
            const r = model.resumedNow(Date.now());
            if (!r) return false;
            const pill = (tt, key, fn) => {
                const w = cv.textWidth(tt, size, LITB) + h, f = focusKey === key;
                cv.roundRect(x, y, w, h, h / 2, f ? '#ffffff' : '#3a3a3ae6');
                cv.text(tt, x + h / 2, y + Math.round(h / 2 + size * 0.36), size, f ? '#0f0f0f' : '#ffffff', LITB);
                tg(x, y, w, h, run(fn), key, h / 2);
                x += w + Math.round(h / 3);
            };
            pill(whole('Resumed at {time}', { time: clock(r.ms) }), 'ov:resume', () => { model.resumed = null; });
            pill(whole('Start over'), 'ov:startover', () => model.startOver());
            return true;
        }

        /* ---------- the steering wheel's next / previous ---------- */
        // The car's media player never sees them while an app plays (no forwarded button reaches it), so the app reads
        // the steering wheel's skip rocker itself: SteeringWheelPushButton.statusSearchSwitch1, 1 = down / skip left
        // (previous), 2 = up / skip right (next), 0 = released, 3 = no signal (ignored); names or numbers. As a music
        // player: a tap (let go within HOLD_MS) skips to the next / previous video when it is let go; held, it seeks,
        // 10 s a step every HOLD_STEP_MS, 30 s a step after HOLD_FAST steps, the bar moving with it and one seek once
        // it is let go (turnSeek, as the knob on the bar). Only while RideTube's sound is on (playing, preparing), or its
        // page shows (paused, finished): a press while the radio plays stays the radio's. A car without the interface
        // installs RideTube without it (app.json _optional).
        const ROCKER = { 1: 'prev', 2: 'next', SUCHLAUF_ABWAERTS_MENUE_SKIP_LINKS: 'prev', SUCHLAUF_AUFWAERTS_MENUE_SKIP_RECHTS: 'next' };
        const HOLD_MS = 600, HOLD_STEP_MS = 300, HOLD_FAST = 10;
        let rocker = null, held = null;                           // held: {dir, steps, wait, rep} while pressed (ours)
        const steerable = () => !!model.id && (model.state === 'playing' || model.state === 'preparing'
            || ((model.state === 'paused' || model.state === 'ended') && ui.isVisible('VIEW')));
        function holdStep() {
            if (!held) return;
            held.steps++;
            turnSeek((held.dir === 'next' ? 1 : -1) * (held.steps > HOLD_FAST ? 3 : 1));
        }
        // a tap of next, first match wins: inside an asked SponsorBlock segment, skip it; the next video in the list;
        // the list done, the next chapter; else the first related video (watch-next)
        function wheelNext(stay) {
            const seg = askSeg();
            if (seg) { sbJump(seg)(); return; }
            if (queue.length) { skipNext(stay); return; }
            const ex = live() && model.extras && model.extras.id === model.id ? model.extras : null;
            const ch = ex ? ex.chapters.find((k) => k[0] > model.elapsed + 1000) : null;
            if (ch) { model.skip(ch[0] - model.elapsed); return; }
            skipNext(stay, true);
        }
        function steer(v) {
            const raw = v && typeof v === 'object' ? v.operationPushButtonAudioAutomaticTuningSteeringWheel : v;
            if (raw === 3 || raw === 'SIGNAL_UNBEFUELLT') return;   // no signal: nothing changes (a hold goes on)
            const dir = ROCKER[raw] || null;
            if (dir === rocker) return;                           // the same again
            rocker = dir;
            kick();
            const was = held;
            held = null;
            if (was) {                                            // let go (or turned the other way)
                clearTimeout(was.wait); clearInterval(was.rep);
                if (!was.steps) {                                 // a tap: skip
                    log.info('steering wheel: ' + was.dir);
                    const stay = mode !== 'player';
                    if (was.dir === 'next') wheelNext(stay); else skipPrev(stay);
                    changed();
                }
            }
            if (!dir || !steerable()) return;
            const h = held = { dir, steps: 0, wait: null, rep: null };
            h.wait = setTimeout(() => { if (held !== h) return; log.info('steering wheel: seek ' + dir); holdStep(); h.rep = setInterval(holdStep, HOLD_STEP_MS); }, HOLD_MS);
        }
        Promise.resolve(ctx.signals.watch('de.bmw.infotainment.controlelements.SteeringWheelPushButton', '1', { statusSearchSwitch1: steer }, log))
            .catch((e) => log.warn('steering wheel: ' + e));

        /* ---------- the controller's touchpad: two fingers scroll the page, as on an iPhone (kit/touchpad.js) ---------- */
        // the pad sends fingers only in touch mode: on while our page shows where the kit runs the screen, off after
        const padWanted = () => ui.isVisible('VIEW') && (!ui.hasFocus || ui.hasFocus('VIEW')) && !!(last && last.own);   // (last: the frame drawn last)
        // two fingers scroll, one finger moves the pointer, a tap presses what it is on
        const pad = new Touchpad((dy) => { if (ctx.scroll && ctx.scroll(dy)) dirty = true; },
            (dx, dy) => { if (ctx.pointer) ctx.pointer.move(dx, dy); }, () => { if (ctx.pointer) ctx.pointer.tap(); });
        const touchMode = ctx.signals.proxy && ctx.signals.set ? new TouchMode(ctx.signals, log) : null;
        Promise.resolve(ctx.signals.watch('de.bmw.infotainment.ControllerElements', '1', {
            ZBETouchFrontSide: (v) => {
                if (!padWanted()) { pad.reset(); return; }
                if (v && v.statusSystemModeFrontSide !== PAD_MODE && touchMode) touchMode.lost();
                pad.feed(v);
            },
        }, log)).catch((e) => log.warn('touchpad: ' + e));
        if (touchMode) {
            setInterval(() => { try { touchMode.want(padWanted()); } catch (e) { log.error('touch mode', e); } }, 500);
            if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => touchMode.want(false));
        }

        /* ---------- the volume: the car's audio manager tells each change; a pill over the page shows it 2 s ---------- */
        // vol: {v, dir (+1 up, -1 down, 0), muted, until}; sinkVol: the last volume of each sink (its first change has a direction too)
        let vol = null, volMax = VOL_MAX, volLogs = 0;
        const sinkVol = {}, sinkMute = {};
        function volShow(sink, v, muted) {
            const was = sinkVol[sink];
            if (typeof v === 'number') { sinkVol[sink] = v; volMax = Math.max(volMax, v); }
            const cur = sinkVol[sink];
            if (typeof cur !== 'number') return;
            if (volLogs < 20) { volLogs++; log.info('volume: sink ' + sink + ' ' + cur + (muted ? ' muted' : '') + ' (was ' + was + ')'); }
            vol = { v: cur, dir: typeof v === 'number' && typeof was === 'number' ? Math.sign(v - was) : 0, muted: !!muted, until: Date.now() + VOL_MS };
            dirty = true; kick();
        }
        Promise.resolve().then(() => ctx.signals.proxy('org.genivi.am.commandinterface.CommandControl', '1')).then((p) => {
            ctx.signals.call(p, 'getListMainSinks', {}).then((r) => {
                const l = (r && r.listMainSinks) || [];
                log.info('volume: sinks ' + l.map((k) => k.sinkID + ' ' + JSON.stringify(k.name) + ' ' + k.volume + ' ' + k.muteState).join(', '));
                l.forEach((k) => { if (typeof k.volume === 'number') sinkVol[k.sinkID] = k.volume; });
            }, (e) => log.warn('volume: sinks ' + e));
            ctx.signals.on(p, 'volumeChanged', (m) => { if (m) volShow(m.sinkID, m.volume, sinkMute[m.sinkID]); }, log);
            ctx.signals.on(p, 'sinkMuteStateChanged', (m) => {
                if (!m) return;
                sinkMute[m.sinkID] = m.muteState === 'MS_MUTED' || m.muteState === 1;
                volShow(m.sinkID, undefined, sinkMute[m.sinkID]);
            }, log);
        }).catch((e) => log.warn('volume: ' + e));
        // the pill: a speaker, the level as a bar and a number, an arrow up or down; top middle of the screen
        function drawVolume(cv) {
            if (!vol || Date.now() > vol.until) return;
            const full = !!(cv.own && cv.place && cv.place.full && mode === 'player');
            if (full) cv.xf(1, 0, 0); else cv.xf();
            const ww = full ? cv.place.w : W, w = 460, h = 84, x = ww / 2 - w / 2, y = full ? 28 : 14, my = y + h / 2;
            cv.roundRect(x, y, w, h, h / 2, '#1f1f1ff2');
            const sx = x + 50;
            cv.fillRect(sx - 18, my - 9, 11, 18, '#ffffff');
            cv.quad([[sx - 8, my - 9], [sx + 7, my - 22], [sx + 7, my + 22], [sx - 8, my + 9]], '#ffffff');
            if (vol.muted) {
                cv.polyline([[sx + 16, my - 10], [sx + 34, my + 10]], 4, C.red);
                cv.polyline([[sx + 34, my - 10], [sx + 16, my + 10]], 4, C.red);
            } else {
                cv.arc(sx + 8, my, 14, 18, 40, 140, '#ffffff');
                if (vol.v > volMax / 2) cv.arc(sx + 8, my, 24, 28, 40, 140, '#ffffff');
            }
            const bx = x + 110, bw = 230, k = vol.muted ? 0 : Math.max(0, Math.min(1, vol.v / volMax));
            cv.roundRect(bx, my - 6, bw, 12, 6, '#ffffff38');
            if (k > 0) cv.roundRect(bx, my - 6, Math.max(12, bw * k), 12, 6, C.red);
            const nx = x + w - 70;
            cv.text(vol.muted ? '-' : String(vol.v), nx, my + 12, 34, '#ffffff', { literal: true, font: 'bold', align: 'center' });
            if (vol.dir) {
                const ax = x + w - 28, d = vol.dir > 0 ? -1 : 1;   // up: the point at the top
                cv.quad([[ax - 11, my - 7 * d], [ax + 11, my - 7 * d], [ax, my + 10 * d], [ax - 11, my - 7 * d]], vol.dir > 0 ? '#7ddc8a' : '#ffb35c');
            }
            cv.xf();
        }

        /* ---------- the 12 V battery while parked: a warning 5 points above the setting's level, paused below it ---------- */
        let soc = null, socWarned = false;
        Promise.resolve(ctx.signals.watch('de.bmw.infotainment.vehicle.CDS', '1', {
            statusBattery2: (v) => { const k = v && v.conditionBatteryChargingCondition; if (typeof k === 'number' && k > 0 && k <= 100) soc = k; },
        }, log, { pollMs: 10000 })).catch((e) => log.warn('battery: ' + e));
        function batteryGuard() {
            const lim = Number(settings.get('battery'));
            if (!lim || soc === null) return;
            if (soc >= lim + 5) socWarned = false;
            if (parked.moving() || model.state !== 'playing') return;          // driving charges it
            if (soc < lim) {
                model.toggle();
                model.toast = { text: message('12 V battery at {soc} % - paused. Start the car to keep watching', { soc }), until: Date.now() + 15000, warn: true };
            } else if (soc < lim + 5 && !socWarned) {
                socWarned = true;
                model.toast = { text: message('12 V battery at {soc} % - it pauses at {limit} %', { soc, limit: lim }), until: Date.now() + 8000, warn: true };
            } else return;
            wake(); changed();
        }
        setInterval(() => { try { batteryGuard(); } catch (e) { log.error('battery', e); } }, 1000);
        let ovUntil = 0, qrUntil = 0, qrAt = 0;   // qrUntil: the On phone QR card shows until then; qrAt: the time it links to
        function wake() { ovUntil = Date.now() + OVERLAY_MS; dirty = true; kick(); }
        // the overlay's -10 s / +10 s (#18): a tap (finger or controller press) seeks 10 s; held SKIP_HOLD_MS the
        // button turns into previous / next video, and letting go takes it. skipHold: {dir, armed, t} while held
        let skipHold = null;
        const SKIP_HOLD_MS = 600;
        const skipHeld = (dir) => !!skipHold && skipHold.dir === dir && skipHold.armed;
        const skipBtn = (dir) => (down, on) => {
            if (down) {
                clearTimeout(skipHold && skipHold.t);
                const h = skipHold = { dir, armed: false, t: null };
                h.t = setTimeout(() => { if (skipHold === h) { h.armed = true; wake(); } }, SKIP_HOLD_MS);
                wake(); return;
            }
            const h = skipHold;
            skipHold = null;
            if (!h || h.dir !== dir) return;
            clearTimeout(h.t);
            if (on !== false) {
                if (!h.armed) model.skip(dir * 10000);
                else if (dir < 0) skipPrev(false);
                else skipNext(false, true);
            }
            wake();
        };
        // it stays while there is no moving picture to look at
        const pinned = () => model.state !== 'playing' || !videoShown || noVideo() || !!askSeg() || !!scrub || !!model.resumedNow(Date.now());
        const overlay = () => pinned() || Date.now() < ovUntil || Date.now() < qrUntil;
        // a tap beside the controls (no target): hides them
        if (ctx.onTap) ctx.onTap(() => { if (mode === 'player' && !pinned() && overlay()) { ovUntil = 0; dirty = true; } });
        // the controller pushed left in the player: back to the list it came from; pushed left at a channel's
        // edge (the rail): back to Subscriptions (a playlist's: to Playlists). Both put the controller back on the tile it left from
        if (ctx.onBack) ctx.onBack((edge) => {
            if (mode === 'player') { if (fullView && model.active() && !noVideo()) { fullView = false; wake(); } else goBack(browse); return true; }
            if (mode === 'channel' && edge) { goBack(chanFrom); return true; }
            if (mode === 'list' && edge) { goBack('pl'); return true; }
            // the question pages: as their Cancel (logs) or OK (the clock warning)
            if (mode === 'logs') { if (!model.logs || model.logs.state !== 'sending') { model.dropLogs(); goBack(logsFrom); } return true; }   // (sending: stays for the code)
            if (mode === 'clock') { goBack(clockFrom); return true; }
            if (mode === 'news') { goBack(newsFrom); return true; }
            if (mode === 'signin') { goBack('home'); return true; }
            return false;
        });

        /* ---------- video gate: on screen and the picture allowed (noVideo); else off (sound plays on) ---------- */
        let ino = null, videoShown = false;
        const gpu = () => (ctx.display && ctx.display.gpu && ctx.display.gpu.native ? ctx.display.gpu : null);
        function sync() {
            const shown = ui.isVisible('VIEW') && (!ui.hasFocus || ui.hasFocus('VIEW'));
            const want = mode === 'player' && shown && !noVideo();
            model.setWantVideo(want);
            // the file ytdec writes; a new one (ytdec restarted) is named to the renderer again
            let cur = null;
            if (want && (model.state === 'playing' || model.state === 'paused')) {
                try { const st = fs.statSync(VPATH); cur = st.isFile() ? st.ino : null; } catch (e) { cur = null; }
            }
            const g = gpu();
            if (g) {
                if (!cur || cur !== ino) g.dropVideo(VID);
                if (cur) g.video(VID, VPATH);
            }
            ino = cur;
            const on = !!(cur && g);
            if (on !== videoShown) { videoShown = on; dirty = true; }
        }
        setInterval(() => { try { sync(); } catch (e) { log.error('sync', e); } }, 250);
        ui.onVisible((name, v) => { if (name === 'VIEW') { sync(); dirty = true; } });
        if (ui.onFocus) ui.onFocus(() => sync());
        if (ctx.onLayout) ctx.onLayout(() => { dirty = true; });

        /* ---------- drawing ---------- */
        const fit = (cv, s, size, w, opts) => {
            s = String(s || '');
            if (cv.textWidth(s, size, opts) <= w) return s;
            let lo = 0, hi = s.length;
            while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cv.textWidth(s.slice(0, m) + '…', size, opts) <= w) lo = m; else hi = m - 1; }
            return s.slice(0, lo).replace(/\s+$/, '') + '…';     // (no trimEnd on the unit's Node 8)
        };
        const LIT = { literal: true }, LITB = { literal: true, font: 'bold' };
        // YouTube's dark theme: the page #0F0F0F, raised parts #272727, text #F1F1F1 / #AAAAAA, the red accent, the blue focus
        const C = { bg: '#0f0f0f', card: '#272727', ph: '#272727', text: '#f1f1f1', dim: '#aaaaaa', red: '#ff0000', blue: '#3ea6ff', amber: '#ffd36b', line: '#3f3f3f' };
        const browsing = () => mode !== 'player';

        // thumbs: a pool of picture ids by video, least recently drawn reused (the renderer holds 64 pictures an app)
        const pool = new Map(), free = Array.from({ length: POOL }, (_, i) => POOL0 + i);
        let frameNo = 0;
        function slot(id, th) {
            let e = pool.get(id);
            if (!e) {
                let pid = free.pop();
                if (pid === undefined) {
                    let old = null;
                    pool.forEach((x, k) => { if (x.t < frameNo && (!old || x.t < pool.get(old).t)) old = k; });
                    if (!old) return null;                 // all drawn in this frame already
                    pid = pool.get(old).pid; pool.delete(old);
                }
                pool.set(id, e = { pid, th: null, t: 0 });
            }
            if (e.th !== th) { e.th = th; setImage(e.pid, th.w, th.h, th.buf); }
            e.t = frameNo;
            return e.pid;
        }

        // a title in at most two lines of TXW px (the second one ellipsised), cached by title and width
        const wraps = new Map();
        const AV = 46;                                    // a card's text starts right of the channel's round initial
        function wrap(cv, s, width) {
            const TXW = width || TW - AV, wk = TXW + '|' + s;
            let v = wraps.get(wk);
            if (v) return v;
            const words = s.split(/\s+/).filter(Boolean);
            let l1 = '', i = 0;
            for (; i < words.length; i++) { const t = l1 ? l1 + ' ' + words[i] : words[i]; if (cv.textWidth(t, 24, LITB) > TXW) break; l1 = t; }
            let rest = words.slice(i).join(' ');
            if (!l1 && rest) {                           // one word wider than the tile: cut it
                let n = rest.length;
                while (n > 1 && cv.textWidth(rest.slice(0, n), 24, LITB) > TXW) n--;
                l1 = rest.slice(0, n); rest = rest.slice(n);
            }
            v = rest ? [l1, fit(cv, rest, 24, TXW, LITB)] : [l1];
            if (wraps.size > 400) wraps.clear();
            wraps.set(wk, v);
            return v;
        }
        if (ctx.onLayout) ctx.onLayout(() => wraps.clear());          // (text widths follow the scale)

        // a play triangle pointing right, centred on cx, cy, s px tall
        const tri = (cv, cx, cy, s, c) => cv.quad([[cx - s * 0.38, cy - s / 2], [cx + s * 0.5, cy], [cx - s * 0.38, cy + s / 2], [cx - s * 0.38, cy - s / 2]], c);
        // Try again: a circle arrow (cv.arc's ring, its head at the top)
        const retryGlyph = (cv, cx, cy, r, c) => { cv.arc(cx, cy, r - 5, r, 40, 340, c); cv.quad([[cx - 4, cy - r - 9], [cx + 10, cy - r + 2], [cx - 4, cy - r + 12], [cx - 4, cy - r - 9]], c); };
        // the fork's mark: a plain red play triangle (not YouTube's logo artwork), centred on cx, cy, w wide
        const logo = (cv, cx, cy, w) => tri(cv, cx + w * 0.06, cy, w * 0.62, C.red);
        // the mark and the word YouTube in the kit's bold face, from x on the baseline y (h: the word's size); returns the width
        function brand(cv, x, y, h) {
            tri(cv, x + h * 0.42, y - h * 0.36, h * 0.86, C.red);
            return h * 1.05 + cv.text('YouTube', x + h * 1.05, y, h, '#ffffff', { literal: true, font: 'bold' });
        }
        // a channel's round initial, its colour from its name (the service sends no channel pictures)
        const HUES = ['#c62828', '#ad1457', '#6a1b9a', '#283593', '#1565c0', '#00838f', '#2e7d32', '#9e9d24', '#ef6c00', '#4e342e'];
        function initial(cv, name, cx, cy, r) {
            name = String(name || '');
            let h = 0;
            for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
            cv.circle(cx, cy, r, HUES[h % HUES.length]);
            const ini = (Array.from(name).find((ch) => /[0-9]/.test(ch) || ch.toLowerCase() !== ch.toUpperCase()) || name.charAt(0) || '?').toUpperCase();   // (Node 8: no \p{L})
            cv.text(ini, cx, cy + r * 0.36, Math.round(r * 1.05), '#ffffff', { literal: true, font: 'bold', align: 'center' });
        }
        // no internet: the Wi-Fi fan struck through (the offline page and its strip)
        const noNet = (cv, cx, cy, k, c) => {
            [34, 22, 10].forEach((r) => cv.arc(cx, cy + 14 * k, (r - 4) * k, r * k, 300, 420, c));
            cv.circle(cx, cy + 14 * k, 4 * k, c);
            cv.line(cx - 26 * k, cy - 24 * k, cx + 26 * k, cy + 28 * k, 4.5 * k, C.red);
        };

        // a playlist: three lines and a play mark (the rail's icon, a playlist tile's count)
        const listGlyph = (cv, x, y, s, c) => {
            const k = s / 36;
            [0, 1, 2].forEach((i) => cv.roundRect(x - 18 * k, y + (i * 10 - 15) * k, (i === 2 ? 15 : 27) * k, 4 * k, 2 * k, c));
            tri(cv, x + 9 * k, y + 8 * k, 16 * k, c);
        };
        // the HMI's home glyph (drawn where the HMI's own home is, over the full-screen video)
        const HOME = (cv, x, y, c, bg) => {
            cv.quad([[x, y - 18], [x + 19, y - 1], [x - 19, y - 1], [x, y - 18]], c);
            cv.fillRect(x - 13, y - 3, 26, 19, c); cv.fillRect(x - 4, y + 6, 8, 10, bg);
        };
        // pages of later packages: mode -> draw(cv), dispatched by render
        const PAGES = {};
        // the chips under the bar: [mode, name, cap]; History and Library when the service has the cap, Now playing
        // while something plays (where the kit runs the screen)
        const CHIPS = [['home', 'Home'], ['subs', 'Subscriptions'], ['wl', 'Watch later'], ['pl', 'Playlists'], ['hist', 'History', 'hist'], ['library', 'Library', 'download']];
        const railSel = () => (mode === 'results' ? 'search' : mode === 'channel' ? 'subs' : mode === 'list' ? 'pl' : mode === 'signin' ? 'home' : mode);   // the chip lit
        // the question pages draw no bar: their own layout starts at the top
        const headed = () => browsing() && mode !== 'logs' && mode !== 'clock' && mode !== 'news';
        /*
         * The bar (YouTube's top bar, drawn anew): the mark and YouTube, a search box (Search: the Search page; on it, a
         * press types, in P only), the account (signed out: Sign in; else the HMI menu with Sign out, Settings, logs);
         * under it the chips. Keys rail:<mode> (the order the knob turns: search, the chips, the account).
         */
        function drawHead(cv) {
            const sel = railSel(), x0 = X0;
            cv.fillRect(0, 0, W, HEAD, C.bg);
            const bw = brand(cv, x0, 46, 32);
            // the search box: a dark field with a grey edge, the magnifier in its right end, the last search or "Search"
            const sx = x0 + Math.max(bw + 70, 260), sw = Math.min(700, W - sx - 130), sy = 10, sh = 50, onSearch = sel === 'search';
            cv.roundRect(sx, sy, sw, sh, sh / 2, onSearch ? '#3f3f3f' : C.line);
            cv.roundRect(sx + 2, sy + 2, sw - 74, sh - 4, sh / 2 - 2, '#121212');
            cv.roundRect(sx + sw - 72, sy + 2, 70, sh - 4, sh / 2 - 2, '#222222');
            const mx = sx + sw - 38, my = sy + sh / 2;
            cv.arc(mx - 4, my - 4, 8, 11, 0, 360, C.text); cv.line(mx + 4, my + 4, mx + 12, my + 12, 3.5, C.text);
            const q = mode === 'results' && model.q ? model.q : translate('Search');
            cv.text(fit(cv, q, 24, sw - 120, LIT), sx + 28, sy + 34, 24, mode === 'results' && model.q ? C.text : '#888888', LIT);
            if (cv.own) cv.target(sx, sy, sw, sh, () => (mode === 'results' ? typeSearch(true) : show('results')), 'rail:search', sh / 2);
            // the account: a person in a circle (signed in: filled)
            const ax = W - 50, ay = sy + sh / 2, signedIn = model.auth.state === 'signed_in';
            cv.circle(ax, ay, 24, signedIn ? '#7e57c2' : C.card);
            cv.circle(ax, ay - 6, 8, '#ffffff'); cv.arc(ax, ay + 18, 9, 17, 270, 450, '#ffffff');
            // the chips: light for the page shown, dark otherwise
            const chips = CHIPS.filter((c) => !c[2] || model.can(c[2])).concat(cv.own && model.active() ? [['player', 'Now playing']] : []);
            let cx = x0;
            const cy = 70, chh = 44;
            chips.forEach(([m, name]) => {
                const label = translate(name), on = m === sel, play = m === 'player';
                const tw = cv.textWidth(label, 22, on ? LITB : LIT), w = tw + 36 + (play ? 30 : 0);
                if (cx + w > W - 16) return;                        // (no room: a narrow screen)
                cv.roundRect(cx, cy, w, chh, 10, on ? C.text : C.card);
                if (play) [10, 18, 13].forEach((h, k) => cv.roundRect(cx + 16 + k * 8, cy + 30 - h, 5, h, 2, C.red));
                cv.text(label, cx + 18 + (play ? 30 : 0), cy + 30, 22, on ? C.bg : C.text, on ? LITB : LIT);
                if (cv.own) cv.target(cx, cy, w, chh, () => show(m), 'rail:' + m, 10);
                cx += w + 12;
            });
            if (cv.own) cv.target(ax - 30, ay - 30, 60, 60, () => {
                if (!signedIn) { show(offlineSecs().length ? 'signin' : 'home'); model.authStart(true); } else ui.open('MAIN');
            }, 'rail:account', 30);
        }

        // the tile the controller or the touchpad's pointer is on: a lighter card in a white frame, seen at a glance
        const focusCard = (cv, x, y) => { cv.roundRect(x - 10, y - 10, TW + 20, TILE_H + 16, 18, C.card); cv.strokeRoundRect(x - 10, y - 10, TW + 20, TILE_H + 16, 18, 4, '#ffffff'); };
        /* a tile: the 16:9 thumb, its length, two lines of title, the channel and the tile's meta (views, age) */
        function drawTile(cv, r, x, y, key) {
            const cur = r.id === model.id && model.active();
            if (key === focusKey) focusCard(cv, x, y);
            const th = model.thumbs[r.id];
            if (!th) model.wantThumb(r.id);
            const pid = th && cv.place ? slot(r.id, th) : null;
            if (pid) cv.picture(pid, x, y, TW, TH, 12);
            else { cv.roundRect(x, y, TW, TH, 12, C.ph); cv.circle(x + TW / 2, y + TH / 2, 30, '#ffffff10'); tri(cv, x + TW / 2 + 2, y + TH / 2, 24, '#ffffff38'); }
            const p = model.pos[r.id];   // watched (here, else on the account): a bar along the thumbnail's foot
            const frac = p ? (p.done ? 1 : Math.min(1, p.ms / p.total)) : r.watched_pct > 0 ? r.watched_pct / 100 : 0;
            if (frac > 0) {
                const pw = Math.max(8, Math.round(TW * frac));
                cv.fillRect(x, y + TH - 5, TW, 5, '#ffffff55');
                cv.fillRect(x, y + TH - 5, pw, 5, C.red);
            }
            if (r.live) {
                const lt = translate('LIVE'), lw = cv.textWidth(lt, 20, LITB) + 16;
                cv.roundRect(x + TW - 8 - lw, y + TH - 36, lw, 28, 6, '#cc0000');     // YouTube's live red
                cv.text(lt, x + TW - 16, y + TH - 15, 20, '#ffffff', { literal: true, font: 'bold', align: 'right' });
            }
            if (r.duration_s > 0) {
                const d = clock(r.duration_s * 1000), dw = cv.textWidth(d, 20, LITB) + 14;
                cv.roundRect(x + TW - 8 - dw, y + TH - 36, dw, 28, 4, '#000000cc');
                cv.text(d, x + TW - 15, y + TH - 15, 20, '#ffffff', { literal: true, font: 'bold', align: 'right' });
            }
            if (cur) {
                cv.strokeRoundRect(x - 2, y - 2, TW + 4, TH + 4, 14, 3, C.red);
                const pw = cv.textWidth(translate('NOW PLAYING'), 16, { literal: true, font: 'bold', spacing: 1 }) + 20;
                cv.roundRect(x + 10, y + 10, pw, 28, 6, C.red);
                cv.text(translate('NOW PLAYING'), x + 20, y + 30, 16, '#ffffff', { literal: true, font: 'bold', spacing: 1 });
            }
            if (r.channel) initial(cv, r.channel, x + 18, y + TH + 30, 18);
            const lines = wrap(cv, String(r.title || r.id)), tx = x + AV;
            lines.forEach((l, k) => cv.text(l, tx, y + TH + 32 + k * 30, 24, C.text, LITB));
            const my = y + TH + 32 + lines.length * 30 - 2;
            const meta = [r.channel].concat(Array.isArray(r.meta) ? r.meta : []).filter((m) => typeof m === 'string' && m).join(' · ');
            if (r.ready === false) cv.text(fit(cv, dlText(r), 20, TW - AV, LITB), tx, my, 20, r.error ? '#ff8a80' : '#ffd27a', LITB);   // a download not on the car yet
            else if (meta) cv.text(fit(cv, meta, 20, TW - AV, LIT), tx, my, 20, C.dim, LIT);
        }
        // a download's state, as its tile and the player's button say it
        const dlText = (r) => (r.error === 'not enough space' ? translate('Not enough space') : r.error ? translate('Download failed')
            : r.pct > 0 ? message('Downloading {percent} %', { percent: r.pct }) : translate('Downloading...'));
        // Continue watching and On this car: what plays signed out, offline (cap download for the second)
        const offlineSecs = () => (model.resume.length ? [{ title: translate('Continue watching'), items: model.resume }] : [])
            .concat(model.library.length ? [{ title: translate('On this car'), items: model.library.slice(0, SHELF_MAX) }] : []);
        PAGES.library = (cv) => {
            if (!model.connected) return say(cv, OFF, OFF2);
            const n = model.downloaded().length, secs = (model.library.length ? [{ title: translate('On this car'), sub: count(n, '{count} video', '{count} videos'), items: model.library, grid: true }] : [])
                .concat(model.resume.length ? [{ title: translate('Continue watching'), items: model.resume }] : []);
            if (!secs.length) return say(cv, translate('Nothing on this car yet'), translate('Download a video in the player to watch it with no internet'));
            drawPage(cv, secs);
        };
        PAGES.signin = (cv) => (model.connected ? drawSignIn(cv) : say(cv, OFF, OFF2));

        /* a playlist: its first video's picture (two edges behind it: a stack), the video count, its name, its meta */
        function drawPlTile(cv, r, x, y, key) {
            if (key === focusKey) focusCard(cv, x, y);
            cv.roundRect(x + 28, y - 8, TW - 56, 12, 6, '#ffffff26');
            cv.roundRect(x + 14, y - 4, TW - 28, 12, 6, '#ffffff4d');
            const th = r.thumb ? model.thumbs[r.thumb] : null;
            if (r.thumb && !th) model.wantThumb(r.thumb);
            const pid = th && cv.place ? slot(r.thumb, th) : null;
            if (pid) cv.picture(pid, x, y, TW, TH, 12);
            else { cv.roundRect(x, y, TW, TH, 12, C.ph); listGlyph(cv, x + TW / 2, y + TH / 2, 60, '#ffffff38'); }
            const n = r.count === null || r.count === undefined ? translate('Playlist') : r.count === 0 ? translate('No videos') : count(r.count, '{count} video', '{count} videos');
            const nw = cv.textWidth(n, 20, LITB) + 52;
            cv.roundRect(x + TW - 8 - nw, y + TH - 36, nw, 28, 6, '#000000cc');
            listGlyph(cv, x + TW - nw + 12, y + TH - 22, 18, '#ffffff');
            cv.text(n, x + TW - 16, y + TH - 15, 20, '#ffffff', { literal: true, font: 'bold', align: 'right' });
            const lines = wrap(cv, String(r.title || r.id), TW);
            lines.forEach((l, k) => cv.text(l, x, y + TH + 32 + k * 30, 24, C.text, LITB));
            const meta = (Array.isArray(r.meta) ? r.meta : []).join(' · ');
            if (meta) cv.text(fit(cv, meta, 20, TW, LIT), x, y + TH + 32 + lines.length * 30 - 2, 20, C.dim, LIT);
        }

        /* a channel: a round mark with its initial, its name, its @handle; or an action (r.act: Search channels, All) */
        function drawChan(cv, r, x, y, key) {
            if (key === focusKey) focusCard(cv, x, y);
            const cx = x + TW / 2, cy = y + TH / 2, name = String(r.title || r.id);
            if (r.act) {
                cv.roundRect(x, y, TW, TH, 12, C.ph);
                r.glyph(cv, cx, cy, '#ffffff');
            } else initial(cv, name, cx, cy, 78);
            cv.text(fit(cv, name, 24, TW, LITB), cx, y + TH + 36, 24, C.text, { literal: true, font: 'bold', align: 'center' });
            if (r.sub || r.handle) cv.text(fit(cv, r.sub || r.handle, 20, TW, LIT), cx, y + TH + 66, 20, C.dim, { literal: true, align: 'center' });
        }
        const KEYS = (cv, cx, cy, c) => {                 // a keyboard
            cv.strokeRoundRect(cx - 46, cy - 30, 92, 60, 10, 4, c);
            for (let k = 0; k < 5; k++) { cv.roundRect(cx - 34 + k * 15, cy - 18, 9, 9, 2, c); cv.roundRect(cx - 34 + k * 15, cy - 3, 9, 9, 2, c); }
            cv.roundRect(cx - 24, cy + 12, 48, 8, 3, c);
        };
        const BLOCK = (cv, cx, cy, c) => { cv.arc(cx, cy, 30, 36, 0, 360, c); cv.line(cx - 22, cy + 22, cx + 22, cy - 22, 6, c); };   // hide
        const SHOW = (cv, cx, cy, c) => { cv.arc(cx, cy, 30, 36, 0, 360, c); cv.polyline([[cx - 15, cy], [cx - 4, cy + 12], [cx + 16, cy - 12]], 6, c); };
        const ALL = (cv, cx, cy, c) => { [-20, 0, 20].forEach((d) => cv.roundRect(cx - 34, cy + d - 4, 68, 8, 4, c)); };
        // the channels, filtered by chanQ (the keyboard: one letter = names starting with it, else names holding it)
        let chanQ = '';
        function findChannel() {
            if (noTyping()) { flash(translate('Typing works only in P (Park)')); return; }   // (the same rule as a search)
            spell(ctx.app, translate('Find a channel')).then((t) => {
                if (t === null || t === undefined) { ui.open('VIEW'); return; }
                chanQ = String(t).trim(); vs('subs').sy = 0; vs('subs').off = {}; dirty = true;
                show('subs'); ui.open('VIEW');
            }).catch((e) => log.error('speller', e));
        }
        let chanFrom = 'subs';
        function openChannel(c) { if (mode !== 'channel') chanFrom = mode; model.openChannel(c.id, c.title); show('channel'); vs('channel').sy = 0; vs('channel').off = {}; }
        function chanSections() {
            const ch = model.chans;
            if (!ch || (!ch.items.length && ch.loading)) return [{ title: translate('Channels'), sub: translate('Loading...'), items: [], chan: true }];
            if (!ch.items.length) return ch.error ? [{ title: translate('Channels'), sub: whole(ch.error), items: [], chan: true }] : [];
            const find = { id: '::find', title: chanQ ? translate('Search again') : translate('Search channels'), sub: translate('A letter, or a word'), act: findChannel, glyph: KEYS };
            if (!chanQ) return [{ title: translate('Channels'), sub: count(ch.items.length, '{count} subscriptions, A-Z', '{count} subscriptions, A-Z'), items: [find].concat(ch.items), chan: true }];
            const hits = model.findChannels(chanQ);
            const all = { id: '::all', title: translate('All channels'), sub: count(ch.items.length, '{count} subscriptions', '{count} subscriptions'), act: () => { chanQ = ''; vs('subs').off = {}; dirty = true; }, glyph: ALL };
            return [{ title: message(chanQ.length === 1 ? 'Channels starting with “{query}”' : 'Channels matching “{query}”', { query: chanQ }),
                sub: hits.length ? count(hits.length, '{count} channel', '{count} channels') : translate('none'), items: [find, all].concat(hits), chan: true, grid: true }];
        }
        function drawChannel(cv) {
            const c = model.chan;
            if (!model.connected) return say(cv, OFF, OFF2);
            if (!c) return say(cv, translate('Pick a channel in Subscriptions'));
            if (!c.items.length && (c.error === 'feed offline' || netDown())) return sayOffline(cv);
            if (!c.items.length) return say(cv, c.loading ? message('Loading {name}...', { name: c.title || translate('the channel') }) : whole(c.error) || translate('No videos on this channel'), c.title || null);
            const hid = hidden.indexOf(c.title) >= 0;
            const tog = { id: '::hide', title: hid ? translate('Show this channel') : translate('Hide this channel'), sub: hid ? translate('Hidden from Home, Subscriptions, Search') : translate('From Home, Subscriptions and Search'),
                act: () => toggleHidden(c.title), glyph: hid ? SHOW : BLOCK };
            drawPage(cv, (c.shelves && c.shelves.length ? c.shelves : [{ title: translate('Videos'), items: c.items, grid: true }])
                .map((s, i) => (i === 0 ? Object.assign({}, s, { title: c.title + (s.title ? ' · ' + s.title : ''), items: [tog].concat(noShorts(s.items)) }) : Object.assign({}, s, { items: noShorts(s.items) })))
                .filter((s, i) => i === 0 || s.items.length));   // (a Shorts shelf, Shorts not shown: gone)
        }

        // a shelf's arrow for touch: shifts it by four tiles. Its target goes before the tiles' (a tap on it is not
        // the tile under it), the drawing after them (returned: drawn by the caller once the tiles are)
        function chevron(cv, cx, cy, dir, run, key) {
            cv.target(cx - 32, cy - 32, 64, 64, run, key, 32);
            return () => {
                cv.circle(cx, cy, 32, '#00000099'); cv.circle(cx, cy, 29, key === focusKey ? '#ffffff' : '#303030');
                cv.polyline([[cx - 5 * dir, cy - 11], [cx + 6 * dir, cy], [cx - 5 * dir, cy + 11]], 4.5, key === focusKey ? '#0f0f0f' : '#ffffff');
            };
        }

        /*
         * A browsing page: rows of tiles, each a shelf (its own sideways offset, a title) or a grid's row of four.
         * sections [{ title, items, grid }]. Scrolls up and down (a finger, the controller); targets for the tiles
         * shown and one more past each edge of a shelf, on every row, drawn or not (the knob turns through all of
         * them, whatever the page's scroll; onPageFocus brings the one it is on into view). Keys: <mode letter>:<row>:<video id>.
         */
        const view = {};                                  // mode -> { sy, off: { row: first tile shown } }
        const vs = (m) => view[m] || (view[m] = { sy: 0, max: 0, off: {} });
        let laid = { mode: null, rows: [], viewH: 0, where: {} }, focusKey = null, dwell = null;
        function layout(sections) {
            const rows = [];
            let y = 10;
            sections.forEach((sc) => {
                const chunks = sc.grid ? [] : [sc.items];
                if (sc.grid) for (let i = 0; i < sc.items.length; i += PER_ROW) chunks.push(sc.items.slice(i, i + PER_ROW));
                chunks.forEach((items, k) => {
                    const title = k === 0 ? sc.title : null, h = (title ? HEAD_H : 0) + TILE_H + (sc.grid && k < chunks.length - 1 ? GRID_GAP : SHELF_GAP);
                    // all: what a tile played goes on with (autoplay): a grid's whole list, not its row of four
                    rows.push({ title, sub: k === 0 ? sc.sub : null, items, all: sc.items, y, h, hs: !sc.grid && items.length > PER_ROW, chan: !!sc.chan, pl: !!sc.pl });
                    y += h;
                });
            });
            return { rows, h: y };
        }
        function drawPage(cv, sections) {
            const st = vs(mode), bottom = H + (cv.own ? cv.extra : 0), viewH = bottom - TOP, L = layout(sections);
            st.max = Math.max(0, L.h - viewH);
            st.sy = Math.max(0, Math.min(st.max, st.sy));
            const where = {}, letter = mode[0];
            const ys = L.rows.map((r) => TOP + r.y - st.sy);
            const vis = L.rows.map((r, i) => ys[i] + r.h > TOP && ys[i] < bottom);
            const after = [];
            cv.clip(RAIL_W, TOP, W - RAIL_W, bottom - TOP);
            L.rows.forEach((row, ri) => {
                const y = ys[ri], shown = vis[ri], n = row.items.length, ty = y + (row.title ? HEAD_H : 0);
                if (row.title && shown) {
                    const tw = cv.text(fit(cv, row.title, 28, 1100, LITB), X0, y + 34, 28, C.text, LITB);
                    if (row.sub) cv.text(row.sub, X0 + tw + 18, y + 34, 22, C.dim, LIT);
                }
                const max = row.hs ? n - PER_ROW : 0, off = Math.max(0, Math.min(max, st.off[ri] || 0));
                st.off[ri] = off;
                // touch: arrows where tiles are hidden (recorded first: a tap on one is not the tile under it)
                if (cv.own && shown && row.hs) {
                    if (off > 0) after.push(chevron(cv, X0 + 4, ty + TH / 2, -1, () => { st.off[ri] = Math.max(0, off - PER_ROW); dirty = true; }, letter + ':' + ri + ':<'));
                    if (off < max) {
                        if (!FILL) after.push(() => { for (let k = 0; k < 6; k++) cv.fillRect(W - 108 + k * 16, ty - 10, 16, TILE_H + 16, [15, 15, 15, Math.round(255 * (0.3 + k * 0.14))]); });
                        after.push(chevron(cv, W - 48, ty + TH / 2, 1, () => { st.off[ri] = Math.min(max, off + PER_ROW); dirty = true; }, letter + ':' + ri + ':>'));
                    }
                }
                // every tile a target (the knob enters a row at its first tile, whatever its offset), the ones in view drawn
                for (let i = 0; i < n; i++) {
                    const r = row.items[i], x = X0 + (i - off) * PITCH, key = letter + ':' + ri + ':' + r.id;
                    if (shown && i >= off - 1 && i <= off + PER_ROW && x + TW > RAIL_W && x < W) (row.chan || r.act ? drawChan : row.pl ? drawPlTile : drawTile)(cv, r, x, ty, key);
                    const run = r.act ? () => r.act() : row.chan ? () => openChannel(r) : row.pl ? () => openPlaylist(r) : () => pressVideo(r, () => play(r.id, r, row.all));
                    if (cv.own) { cv.target(x - 10, ty - 10, TW + 20, TILE_H + 16, run, key, 18); where[key] = { ri, i }; }
                }
            });
            after.forEach((fn) => fn());
            cv.noclip();
            laid = { mode, rows: L.rows, viewH, where };
            // a finger drags the page; the knob goes tile to tile (onPageFocus scrolls), no page-wide scroll place
            if (cv.own && st.max > 0) cv.scroll = { tiles: true };
        }
        // the controller on a tile: its shelf turned and the page scrolled so that it shows whole
        if (ctx.onPageFocus) ctx.onPageFocus((key, how) => {
            if (key !== focusKey) dirty = true;
            focusKey = key;
            // resting ~1 s on a video: the daemon looks its streams up now, so a press plays ~2.5 s sooner
            clearTimeout(dwell);
            const vid = /^[a-z]+:\d+:([A-Za-z0-9_-]{11})$/.exec(key || '');
            const lw = laid.mode === mode && laid.where[key], lr = lw && laid.rows[lw.ri].items[lw.i];
            if (vid && !(lr && lr.live)) dwell = setTimeout(() => { if (focusKey === key) model.prefetch(vid[1]); }, 1000);
            if (key && key.indexOf('ov:') === 0) { wake(); return; }      // the controller in the player: its overlay
            if (how === 'pointer') return;                                 // the pointer picks what shows: the page stays put
            const w = key && laid.mode === mode && laid.where[key];
            if (!w) return;
            const st = vs(mode), row = laid.rows[w.ri];
            if (row.hs) {
                const off = st.off[w.ri] || 0;
                if (w.i < off) st.off[w.ri] = w.i; else if (w.i > off + PER_ROW - 1) st.off[w.ri] = w.i - PER_ROW + 1;
            }
            const top = row.y - 8, bot = row.y + row.h;
            if (top < st.sy) st.sy = Math.max(0, top); else if (bot > st.sy + laid.viewH) st.sy = Math.min(st.max, bot - laid.viewH);
            dirty = true;
        });
        if (ctx.onScroll) ctx.onScroll((dy) => {
            if (!browsing()) return false;
            const st = vs(mode), y = Math.max(0, Math.min(st.max, st.sy + dy)), moved = y !== st.sy;
            st.sy = y;
            if (moved) dirty = true;
            return moved;
        });

        // a message in the middle of the page (RideTube's mark over it), a grey line under it
        let MID = (RAIL_W + W) / 2;
        // "fill" draws the page from the screen's left edge, under the HMI's back arrow column (x 0..84), whose
        // taps stay the HMI's (they close the app): the rail, the tiles and the pages start right of it
        function inset(cv) {
            const pl = cv.place;
            // taps start at touchX (the kit: 0 where the renderers give fill apps the back column, else HMI.left)
            const fill = !!(pl && pl.scale && pl.ox === 0 && pl.oy === 0), tx = pl && pl.touchX !== undefined ? pl.touchX : HMI.left;
            RX = pl && pl.scale ? Math.max(0, Math.ceil((tx - pl.ox) / pl.scale) + 4 - 16) : 0;   // (16: the page's targets' left)
            FILL = fill || RX > 0; RAIL_W = RAIL0 + RX; X0 = TILE_X + RX; MID = (RAIL_W + W) / 2;
            // fill: the whole screen is the app's, so the page starts near the top (under the bar where it shows) and
            // four cards and the fifth's edge fill the width; otherwise four tiles and the fifth peeking
            if (fill && !RX) { TOP = 12; TW = 360; TH = 202; PITCH = 386; } else if (RX) { TOP = 12; TW = 346; TH = 194; PITCH = 372; } else { TOP = 38; TW = 320; TH = 180; PITCH = 348; }
            if (cv.own && headed()) TOP = HEAD + 8;
            TILE_H = TH + 98;
        }
        // glyph: drawn over it instead of the mark (the no-internet fan)
        function say(cv, msg, sub, glyph) {
            const cy = Math.round((TOP + H + (cv.own ? cv.extra : 0)) / 2) - 16, cx = browsing() ? MID : W / 2;
            if (browsing()) (glyph || ((c, x, y) => logo(c, x, y, 76)))(cv, MID, cy - 90);
            cv.text(fit(cv, msg, 34, 1360, LIT), cx, cy, 34, '#ffffff', { literal: true, align: 'center' });
            if (sub) cv.text(fit(cv, sub, 24, 1360, LIT), cx, cy + 46, 24, C.dim, { literal: true, align: 'center' });
            return cy;
        }
        const netGlyph = (c, x, y) => noNet(c, x, y, 1.6, C.text);
        let offlineSaid = false;                        // this frame's page said it (no strip under it then)
        const sayOffline = (cv) => { offlineSaid = true; return say(cv, net1(), uplink.error || net2(), netGlyph); };
        let OFF = translate('The RideTube service (jap-ridetube-d) is not running');
        let OFF2 = translate('Install the RideTube service (jap-ridetube-d) from the MGU Store');
        PAGES.health = require('./health')({ model, say, fit, t: whole, message: whole, count, C, focus: () => focusKey, edge: () => (FILL ? RX === 0 : null), get X0() { return X0; }, get TOP() { return TOP; }, H, W, get OFF() { return OFF; }, get OFF2() { return OFF2; } });
        remote = require('./remote')({ model, send: (o) => ctl.send(o), changed, lang: getLanguage, say, fit, t: whole, message: whole, C, QR, focus: () => focusKey, get X0() { return X0; }, get TOP() { return TOP; }, H, W, get OFF() { return OFF; }, get OFF2() { return OFF2; } });
        PAGES.remote = remote.draw;
        // a phone action, as a tap: a search shows its results, a video plays (the picture only as the video gate allows)
        remote.onDo = (a) => { if (a.do === 'search') search(a.q, true); else play(a.id); changed(); };
        // the Search page (search.js): its row of tiles, then the results. A search just run, answered: the results
        // scrolled up under the row's foot, and the controller (when in use) onto the first one
        function drawResults(cv) {
            if (!model.connected) return say(cv, OFF, OFF2);
            const jump = toResults && !model.searching && model.results.length > 0;
            if (!model.searching) toResults = false;
            if (jump) vs('results').sy = HEAD_H + TILE_H + SHELF_GAP + 2;    // (row 1's top: layout's y 10 + row 0 - 8)
            drawPage(cv, page.sections(shown));
            const first = jump && focusKey && Object.keys(laid.where).find((k) => /^r:1:/.test(k));
            if (first && ctx.focus) setImmediate(() => ctx.focus(first));
        }
        function drawFeed(cv, which) {
            const f = model.feeds[which], a = model.auth.state;
            if (!model.connected) return say(cv, OFF, OFF2);
            if (a === 'unsupported') return say(cv, translate('Signing in needs a newer jap-ridetube-d tool on the car'));
            const off = which === 'home' ? offlineSecs() : [];
            if (a !== 'signed_in' && off.length) {   // signed out: what plays without the account, then how to sign in
                const signin = { id: '::signin', title: translate('Sign in'), sub: translate('Your Home, Subscriptions, Watch later and playlists, on the car'),
                    glyph: (c2, x, y) => logo(c2, x, y, 96), act: () => { show('signin'); model.authStart(true); } };
                return drawPage(cv, [Object.assign({}, off[0], { items: [signin].concat(off[0].items) })].concat(off.slice(1)));   // first, as Search's own tiles
            }
            if (a !== 'signed_in') return drawSignIn(cv);
            if (off.length && f && !f.items.length && f.error) return drawPage(cv, off);   // no internet: what is on the car
            const chans = which === 'subs' && model.chans && model.chans.items.length;   // the channels show without the videos
            if ((!f || !f.items.length) && !chans) {
                if ((f && f.error === 'feed offline') || netDown()) return sayOffline(cv);
                return say(cv, !f || f.loading ? message('Loading {name}...', { name: translate(NAMES[which]) })
                    : f.error ? translate(NAMES[which]) + ': ' + whole(f.error) : which === 'wl' ? translate('Nothing in Watch later') : translate('No videos here yet'), which === 'wl' && f && !f.loading && !f.error ? translate('Videos you save for later show here') : null);
            }
            let secs;
            if (which === 'home') {
                const wl = model.feeds.wl;
                secs = offlineSecs()
                    .concat(f.shelves || [{ title: translate('Recommended'), items: f.items, grid: true }])
                    .concat(wl && wl.items.length ? [{ title: translate('Watch later'), items: wl.items.slice(0, SHELF_MAX) }] : []);
            } else secs = !f ? [] : f.shelves && which !== 'wl' ? f.shelves : [{ title: translate(NAMES[which]), sub: count(f.items.length, '{count} videos', '{count} videos') + (f.loading ? ' · ' + translate('Loading...') : ''), items: f.items, grid: true }];
            if (which === 'subs') secs = chanSections().concat(chanQ || !f || !f.items.length ? [] : secs);
            drawPage(cv, secs.map((sc) => (sc.chan ? sc : Object.assign({}, sc, { items: shown(sc.items) }))).filter((sc) => sc.chan || sc.items.length));
        }
        // the account's playlists, a grid; one opens as its videos (the Playlists page stays lit on the rail)
        function openPlaylist(p) { model.openPlaylist(p.id, p.title); show('list'); vs('list').sy = 0; vs('list').off = {}; }
        function drawPlaylists(cv) {
            const p = model.pls, a = model.auth.state;
            if (!model.connected) return say(cv, OFF, OFF2);
            if (a === 'unsupported') return say(cv, translate('Signing in needs a newer jap-ridetube-d tool on the car'));
            if (a !== 'signed_in') return drawSignIn(cv);
            if (!p || !p.items.length) {
                if (p && p.error === 'unknown cmd playlists') return say(cv, translate('Playlists need a newer jap-ridetube-d tool on the car'), translate('Update the RideTube service in the MGU Store'));
                if ((p && p.error === 'feed offline') || netDown()) return sayOffline(cv);
                return say(cv, !p || p.loading ? message('Loading {name}...', { name: translate('Playlists') }) : p.error ? translate('Playlists') + ': ' + whole(p.error) : translate('No playlists yet'),
                    p && !p.loading && !p.error ? translate('Playlists you make or save on YouTube show here') : null);
            }
            drawPage(cv, [{ title: translate('Playlists'), sub: count(p.items.length, '{count} playlist', '{count} playlists'), items: p.items, grid: true, pl: true }]);
        }
        function drawPlaylist(cv) {
            const p = model.plist;
            if (!model.connected) return say(cv, OFF, OFF2);
            if (!p) return say(cv, translate('Pick a playlist in Playlists'));
            if (!p.items.length && (p.error === 'feed offline' || netDown())) return sayOffline(cv);
            if (!p.items.length) return say(cv, p.loading ? message('Loading {name}...', { name: p.title || translate('the playlist') }) : p.error === 'unknown cmd playlists' ? translate('Playlists need a newer jap-ridetube-d tool on the car') : whole(p.error) || translate('This playlist is empty'), p.title || null);
            // as Watch later: members-only videos (the setting off) and hidden channels left out, and said so
            const vids = shown(p.items), off = p.items.length - vids.length;
            if (!vids.length) return say(cv, message('Nothing to show in {name}', { name: p.title || translate('this playlist') }), count(off, '{count} video hidden: members-only (Settings) or a hidden channel', '{count} videos hidden: members-only (Settings) or a hidden channel'));
            drawPage(cv, [{ title: p.title || translate('Playlist'), sub: count(vids.length, '{count} video', '{count} videos') + (off ? ' · ' + count(off, '{count} hidden', '{count} hidden') : '') + (p.loading ? ' · ' + translate('Loading...') : ''), items: vids, grid: true }]);
        }
        // not signed in: a QR code for the sign-in page, the code to enter there in big letters, on a card
        function drawSignIn(cv) {
            const a = model.auth;
            // a code expired or refused, or signed out: a new one only when asked (a tap, or Sign in in the menu)
            if (a.state === 'error' || a.state === 'signed_out') {
                const sy = say(cv, a.state === 'error' ? message('Sign-in is not available ({error}) - tap to try again', { error: a.msg || translate('error') })
                    : cv.own ? translate('Tap here to get a sign-in code') : translate('Sign in (menu) to get a sign-in code'),
                translate('Your Home, Subscriptions, Watch later and playlists, on the car'));
                if (cv.own) cv.target(MID - 520, sy - 140, 1040, 200, () => model.authStart(true), 'signin', 16);
                return;
            }
            if (a.state !== 'code' || !a.code) return say(cv, translate('Getting a sign-in code...'));
            let url = /^https:\/\//.test(a.url || '') ? a.url : SIGNIN_URL, q;
            try { q = QR.encode(url); } catch (e) { url = SIGNIN_URL; q = QR.encode(url); }   // longer than a version 4 code holds
            const code = { literal: true, font: 'bold', spacing: 6 }, cwid = cv.textWidth(a.code, 54, code), hint = translate('Scan the code, or go to ') + url.replace(/^https:\/\/(www\.)?/, '');
            const side = (q.length + 8) * 8, textW = Math.max(cwid + 56, cv.textWidth(hint, 26, LIT), 88 + cv.textWidth(translate('Sign in'), 44, LITB), 560);
            const cw = Math.min(1400, 44 + side + 80 + textW + 64), ch = 444, cx = Math.round(MID - cw / 2), cy = TOP + Math.max(14, Math.round((H + (cv.own ? cv.extra : 0) - TOP - ch) / 2)), dy = cy - 58;
            cv.roundRect(cx, cy, cw, ch, 24, C.card);
            const qx = cx + 44, qy = cy + Math.round((ch - side) / 2);
            cv.roundRect(qx - 6, qy - 6, side + 12, side + 12, 18, '#ffffff');
            QR.draw(cv, url, qx, qy, 8);
            const tx = qx + side + 80;
            logo(cv, tx + 34, 128 + dy, 68);
            cv.text(translate('Sign in'), tx + 88, 144 + dy, 44, '#ffffff', LITB);
            cv.text(translate('Enter this code on your phone'), tx, 214 + dy, 30, C.dim, LIT);
            cv.roundRect(tx, 238 + dy, cwid + 56, 96, 16, C.bg);
            cv.text(a.code, tx + 28, 308 + dy, 54, '#ffffff', code);
            cv.text(hint, tx, 392 + dy, 26, C.dim, LIT);
            cv.text(translate('The account stays on the car; this app never sees a password'), tx, 440 + dy, 20, '#717171', LIT);
        }
        // Send logs to the developer: the question (Send / Cancel), Sending..., the code, or why not
        function drawLogs(cv) {
            if (!model.connected) return say(cv, OFF, OFF2);
            const l = model.logs || { state: 'confirm' };
            const btn = (x, label, key, fn, accent) => {
                const w = 300, h = 76, y = 400;
                cv.roundRect(x - w / 2, y, w, h, 38, key === focusKey ? '#ffffff' : accent ? C.red : C.card);
                cv.text(whole(label), x, y + 49, 30, key === focusKey ? '#0f0f0f' : '#ffffff', { literal: true, font: 'bold', align: 'center' });
                if (cv.own) cv.target(x - w / 2, y, w, h, () => { fn(); dirty = true; }, key, 38);
            };
            const send = () => model.sendLogs(APP_VERSION), back = () => { model.dropLogs(); goBack(logsFrom); };
            if (l.state === 'sending') return say(cv, whole('Sending...'));
            if (l.state === 'sent') {
                say(cv, whole('Sent. Add this code to your GitHub issue:'));
                cv.text(l.code, MID, 360, 54, '#ffffff', { literal: true, font: 'bold', spacing: 6, align: 'center' });
                if (cv.own) btn(MID, 'Close', 'logs:close', back);
                return undefined;
            }
            if (l.state === 'error') say(cv, whole(LOGS_ERR[l.msg] || LOGS_ERR.failed));
            else say(cv, whole('Send RideTube\'s recent logs to the developer?'), whole('Account details and the videos you watched are removed first.'));
            if (!cv.own) return cv.text(whole('To send them, press Send logs to the developer in the menu again'), MID, 390, 24, C.dim, { literal: true, align: 'center' });
            btn(MID - 180, l.state === 'error' ? 'Try again' : 'Send', 'logs:send', send, true);
            btn(MID + 180, 'Cancel', 'logs:cancel', back);
            return undefined;
        }
        // lines of at most maxW: breaks at spaces, and between Chinese characters (Chinese has no spaces)
        function paragraph(cv, text, size, maxW) {
            const ls = [];
            for (const tok of String(text).match(/[\u3000-\u9fff\uff00-\uffef]|[^\s\u3000-\u9fff\uff00-\uffef]+|\s+/g) || []) {
                const t = ls.length ? ls[ls.length - 1] + tok : tok;
                if (ls.length && cv.textWidth(t.replace(/\s+$/, ''), size, LIT) <= maxW) ls[ls.length - 1] = t;
                else if (!/^\s+$/.test(tok)) ls.push(tok);
            }
            return ls.map((l) => l.trim());
        }
        // the wrong-clock warning: drawn as the logs page; OK (or any other page) goes back to where it showed over
        function drawClock(cv) {
            const lines = paragraph(cv, whole(CLOCK_MSG, { date: model.clock || '?' }), 28, 1240);
            cv.text(whole('Security warning'), MID, 104, 34, C.amber, { literal: true, font: 'bold', align: 'center' });
            lines.slice(0, 6).forEach((l, i) => cv.text(l, MID, 160 + i * 40, 28, '#ffffff', { literal: true, align: 'center' }));
            if (!cv.own) return cv.text(whole('Pick any page to go on'), MID, 440, 24, C.dim, { literal: true, align: 'center' });
            const w = 300, h = 76, y = 410, f = focusKey === 'clock:ok';
            cv.roundRect(MID - w / 2, y, w, h, 38, f ? '#ffffff' : C.red);
            cv.text(whole('OK'), MID, y + 49, 30, f ? '#0f0f0f' : '#ffffff', { literal: true, font: 'bold', align: 'center' });
            cv.target(MID - w / 2, y, w, h, () => { goBack(clockFrom); dirty = true; }, 'clock:ok', 38);
            return undefined;
        }
        // What's new after an update (news.js): the series' notes, one a line, and OK back to where it was
        function drawNews(cv) {
            newsDue = null;                              // (shown: once)
            const v = news.series(APP_VERSION), notes = news.NOTES[v] || [];
            cv.text(whole(news.TITLE, { version: v }), MID, 96, 36, C.amber, { literal: true, font: 'bold', align: 'center' });
            const L = MID - 600;
            notes.slice(0, 7).forEach((k, i) => {
                const y = 150 + i * 40;
                cv.circle(L, y - 9, 6, C.red);
                cv.text(fit(cv, whole(k), 26, 1180, LIT), L + 22, y, 26, '#ffffff', LIT);
            });
            if (!cv.own) return cv.text(whole('Pick any page to go on'), MID, 460, 24, C.dim, { literal: true, align: 'center' });
            const w = 300, h = 76, y = 430, f = focusKey === 'news:ok';
            cv.roundRect(MID - w / 2, y, w, h, 38, f ? '#ffffff' : C.red);
            cv.text(whole('OK'), MID, y + 49, 30, f ? '#0f0f0f' : '#ffffff', { literal: true, font: 'bold', align: 'center' });
            cv.target(MID - w / 2, y, w, h, () => { goBack(newsFrom); dirty = true; }, 'news:ok', 38);
            return undefined;
        }
        function drawPlayer(cv) {
            cv.fillRect(0, TOP, W, H - TOP, videoShown ? '#000000' : C.bg);
            if (videoShown) cv.fillRect(BOX.x, BOX.y, BOX.w, BOX.h, '#000000');
            if (videoShown) cv.video(VID, ...vbox(BOX.x, BOX.y, BOX.w, BOX.h), 0);
            const cx = BOX.x + BOX.w / 2, cy = BOX.y + BOX.h / 2 - 10, bot = BOX.y + BOX.h;
            // the title and channel over a scrim at the top
            if (model.title) {
                cv.gradientRect(BOX.x, BOX.y, BOX.w, 130, [[0, '#000000d0'], [1, '#00000000']]);
                const it = model.item(model.id);
                cv.text(fit(cv, model.title, 30, BOX.w - 60, LITB), BOX.x + 30, BOX.y + 48, 30, '#ffffff', LITB);
                if (it && it.channel) cv.text(fit(cv, it.channel, 22, BOX.w - 60, LIT), BOX.x + 30, BOX.y + 82, 22, '#cccccc', LIT);
            }
            let mid = null;
            if (!model.connected) mid = translate('The RideTube service (jap-ridetube-d) is not running');
            else if (model.state === 'preparing') {
                const p = Math.max(0, Math.min(100, model.pct || 0));
                cv.circle(cx, cy - 20, 54, '#00000099');
                cv.arc(cx, cy - 20, 44, 52, 0, 360, '#ffffff26');
                if (p > 0) cv.arc(cx, cy - 20, 44, 52, 0, p * 3.6, C.red, { round: true });
                cv.text(Math.round(p) + '%', cx, cy - 10, 30, '#ffffff', { literal: true, font: 'bold', align: 'center' });
                cv.text(prepText(), cx, cy + 82, 26, '#dddddd', { literal: true, align: 'center' });
            } else if (model.state === 'error') mid = translate('Error: ') + (model.error ? whole(model.error) : translate('playback stopped'));
            else if (!model.active()) mid = model.state === 'ended' ? translate('Finished') : translate('Pick a video on Home or Search');
            else if (noVideo()) mid = translate('Audio only until the car is in P (Park)');
            else if (!cv.place || !gpu()) mid = translate('The picture needs the GPU renderer (mgu-render) - the sound plays');
            else if (!videoShown) mid = translate('Starting the picture...');
            if (model.state === 'paused' && !mid) { cv.circle(cx, cy, 60, '#000000a0'); cv.arc(cx, cy, 57, 60, 0, 360, '#ffffff50'); tri(cv, cx + 5, cy, 46, '#ffffff'); }
            if (mid) {
                if (model.state === 'paused') { cv.circle(cx, cy - 40, 46, '#000000a0'); tri(cv, cx + 4, cy - 40, 36, '#ffffff'); }
                cv.text(fit(cv, mid, 34, 1500, LIT), W / 2, BOX.y + BOX.h / 2 + (model.state === 'paused' ? 50 : 12), 34, '#ffffff', { literal: true, align: 'center' });
                if (offlineHint()) cv.text(fit(cv, offlineHint(), 26, 1500, LIT), W / 2, BOX.y + BOX.h / 2 + 56, 26, '#ffd27a', { literal: true, align: 'center' });
            }
            // the progress bar at the bottom: the track, the part played, the scrubber; the times under it
            if (model.total > 0 && model.active() && model.state !== 'preparing') {
                cv.gradientRect(BOX.x, bot - 120, BOX.w, 120, [[0, '#00000000'], [1, '#000000d8']]);
                const tx = BOX.x + 30, tw = BOX.w - 60, ty = bot - 62, k = Math.min(1, model.elapsed / model.total), fx = tx + Math.round(tw * k);
                cv.roundRect(tx, ty, tw, 6, 3, '#ffffff55');
                cv.roundRect(tx, ty, fx - tx, 6, 3, C.red);
                cv.circle(fx, ty + 3, 9, C.red);
                cv.text(clock(model.elapsed), tx, bot - 20, 24, '#ffffff', LITB);
                cv.text(clock(model.total), tx + tw, bot - 20, 24, '#dddddd', { literal: true, font: 'bold', align: 'right' });
            }
        }
        /*
         * The player where the kit runs the screen: the video over the whole surface (no header, no bar), the
         * overlay over it, drawn in screen px / scale (sharp text) at the screen's origin. Its targets go back into
         * the page's px (dx, dy). Hidden, the same keys cover the whole screen and only show it again (the
         * controller stays on its key, so a turn or a press wakes it; a tap anywhere too).
         */
        const OVK = ['ov:back', 'ov:qr', 'ov:close', 'ov:repeat', 'ov:rw', 'ov:play', 'ov:ff', 'ov:q', 'ov:zoom', 'ov:full', 'ov:bar'];
        const ovKeys = () => {
            const k = canRepeat() ? OVK : OVK.filter((x) => x !== 'ov:repeat');
            return model.can('download') && model.id ? k.slice(0, 2).concat('ov:dl', k.slice(2)) : k;
        };
        // a play failed with no internet while downloads are on the car: where they are
        const offlineHint = () => (model.state === 'error' && model.errorOffline && model.downloaded().length ? translate('Downloaded videos still play - Library') : null);
        // podcast mode (Picture while driving off, not parked): artwork, title, chapter, the bar with chapter ticks and skipped segments, controls
        // a glove can hit (-10 s, play/pause, +10 s (held: previous / next), Close), the next video, a skipped-sponsor notice
        function drawPodcast(cv, SW, SH, LX, tg, run, live) {
            cv.fillRect(0, 0, SW, SH, C.bg);
            const x0 = LX + 46, top = 40, ch = model.channel || (model.item(model.id) || {}).channel;
            const bx = x0 + brand(cv, x0, top + 31, 32) + 24;
            const chip = translate('Audio only · not in Park'), cw = cv.textWidth(chip, 22, LIT) + 40;
            cv.roundRect(bx, top, cw, 40, 20, C.ph);
            cv.text(chip, bx + cw / 2, top + 28, 22, C.dim, { literal: true, align: 'center' });
            // Repeat: a pill after the chip (pink while on), its target larger than it; Read aloud after it (blue while it speaks)
            let px = bx + cw + 24;
            if (canRepeat()) {
                const rp = repeatOn(), rt = translate(rp ? 'Repeat on' : 'Repeat off'), rw = cv.textWidth(rt, 22, LITB) + 76, rx = px, rf = focusKey === 'ov:repeat';
                cv.roundRect(rx, top, rw, 40, 20, rf ? '#3ea6ff' : rp ? C.red : C.ph);
                repeatGlyph(cv, rx + 26, top + 20, '#ffffff', 0.6);
                cv.text(rt, rx + 46, top + 28, 22, '#ffffff', LITB);
                tg(rx - 10, top - 16, rw + 20, 72, run(toggleRepeat), 'ov:repeat', 30);
                px = rx + rw + 24;
            }
            if (canSay()) {
                const st = translate('Read aloud'), sw = cv.textWidth(st, 22, LITB) + 76, sf = focusKey === 'ov:say';
                cv.roundRect(px, top, sw, 40, 20, sf ? '#3ea6ff' : model.speaking ? '#1f4f7a' : C.ph);
                speakerGlyph(cv, px + 28, top + 20, '#ffffff');
                cv.text(st, px + 52, top + 28, 22, '#ffffff', LITB);
                tg(px - 10, top - 16, sw + 20, 72, run(sayTitle), 'ov:say', 30);
            }
            // why: no selector reading from the car at all yet, or the rule for the picture
            const why = parked.state().seen ? translate('The picture comes back in P (Park)') : translate('No gear signal from the car yet');
            cv.text(why, SW - 60, top + 28, 22, parked.state().seen ? '#909090' : C.amber, { literal: true, align: 'right' });
            // laid out from the bottom: the notice / up-next row, the controls, the bar; the artwork takes what is left
            const cy = SH - 178, by = cy - 128, ay = top + 72, ah = Math.max(120, by - 56 - ay), aw = Math.round(ah * 16 / 9), ax = x0;
            const th = model.thumbs[model.id];
            if (!th) model.wantThumb(model.id);
            const pid = th && cv.place ? slot(model.id, th) : null;
            if (pid) cv.picture(pid, ax, ay, aw, ah, 24); else { cv.roundRect(ax, ay, aw, ah, 24, C.ph); tri(cv, ax + aw / 2 + 4, ay + ah / 2, 50, '#ffffff38'); }
            // title block
            const tx = ax + aw + 70, tw = SW - tx - 60;
            if (ch) cv.text(fit(cv, ch, 28, tw, LIT), tx, ay + 30, 28, C.dim, LIT);
            const words = String(model.title || model.id || '').split(/\s+/).filter(Boolean);
            let l1 = '', i = 0;
            for (; i < words.length; i++) { const t = l1 ? l1 + ' ' + words[i] : words[i]; if (l1 && cv.textWidth(t, 44, LITB) > tw) break; l1 = t; }
            [fit(cv, l1, 44, tw, LITB), fit(cv, words.slice(i).join(' '), 44, tw, LITB)].filter(Boolean).forEach((l, k) => cv.text(l, tx, ay + 84 + k * 52, 44, '#ffffff', LITB));
            const chap = model.chapter();
            if (chap) cv.text(fit(cv, chap, 28, tw, LIT), tx, ay + ah - 6, 28, '#3ea6ff', LIT);
            // the bar
            const bw = SW - x0 - 60, tot = model.total, ex = model.extras && model.extras.id === model.id ? model.extras : null;
            const at = (ms) => x0 + Math.round(bw * Math.min(1, tot ? ms / tot : 0));
            let barT = null;                // the bar's target, recorded last: the knob seeks there, so turning ends on it
            cv.roundRect(x0, by, bw, 10, 5, '#3f3f3f');
            if (tot > 0) {
                const el = shownAt(), bf = focusKey === 'ov:bar';
                cv.roundRect(x0, by, Math.max(10, at(el) - x0), 10, 5, C.red);
                if (ex) sbSegs(ex).forEach((g) => cv.fillRect(at(g[0]), by, Math.max(4, at(g[1]) - at(g[0])), 10, sbColor(g)));
                if (ex) ex.chapters.forEach((k) => { if (k[0] > 0) cv.fillRect(at(k[0]) - 2, by, 4, 10, C.bg); });
                if (bf) cv.circle(at(el), by + 5, 24, '#3ea6ff');
                cv.circle(at(el), by + 5, bf || scrub ? 18 : 14, C.red);
                barT = () => tg(x0 - 10, by - 36, bw + 20, 80, run(() => model.toggle()), 'ov:bar', 0, turnSeek);
                seekBar = { x0, w: bw, y0: by - 40, y1: by + 50, s: cv.place.scale };
                scrubBubble(cv, at(el), by - 6);
                cv.text(clock(el), x0, by + 50, 26, C.dim, LIT);
                cv.text('-' + clock(tot - el), x0 + bw, by + 50, 26, C.dim, { literal: true, align: 'right' });
            } else if (model.state === 'preparing') cv.text(prepText(), x0, by + 50, 26, C.dim, LIT);
            // controls
            const mid = x0 + bw / 2 + 100;                        // four buttons: previous, play, next, Close
            const big = (key, x, r, light, fn, glyph, hold) => {
                const f = focusKey === key;
                cv.circle(x, cy, r, f ? '#3ea6ff' : light ? '#ffffff' : C.ph);
                glyph(light && !f ? C.bg : '#ffffff');
                tg(x - r - 10, cy - r - 10, 2 * r + 20, 2 * r + 20, run(fn), key, r + 10, undefined, hold);
            };
            // -10 s / +10 s; held, previous / next video, as the overlay's
            const skip = (key, x, dir) => big(key, x, 58, false, () => model.skip(dir * 10000), (c) => {
                if (!skipHeld(dir)) { cv.text(dir < 0 ? '-10' : '+10', x, cy + 14, 38, c, { literal: true, font: 'bold', align: 'center' }); return; }
                cv.quad([[x - 18 * dir, cy - 26], [x - 18 * dir, cy + 26], [x + 16 * dir, cy], [x - 18 * dir, cy - 26]], c);
                cv.fillRect(dir > 0 ? x + 17 : x - 26, cy - 26, 9, 52, c);
            }, skipBtn(dir));
            if (live) {
                skip('ov:rw', mid - 300, -1);
                big('ov:play', mid - 100, 72, true, () => model.toggle(), (c) => {
                    if (model.state === 'paused') tri(cv, mid - 92, cy, 60, c);
                    else { cv.roundRect(mid - 124, cy - 32, 16, 64, 4, c); cv.roundRect(mid - 92, cy - 32, 16, 64, 4, c); }
                });
                skip('ov:ff', mid + 100, 1);
            }
            else if (model.state === 'error' && model.id) big('ov:play', mid - 100, 72, true, again, (c) => retryGlyph(cv, mid - 100, cy, 30, c));
            if (model.active()) {
                // Close, after the other controls
                const kx = mid + 300;
                big('ov:close', kx, 58, false, closeVideo, (c) => xGlyph(cv, kx, cy, 20, c));
            }
            if (queue.length) {
                const up = translate('Up next') + '  ·  ' + String(queue[0].title || queue[0].id), uw = Math.min(700, cv.textWidth(up, 26, LIT) + 50);
                cv.roundRect(SW - 60 - uw, SH - 96, uw, 64, 16, '#1c1c1c');
                cv.text(fit(cv, up, 26, uw - 50, LIT), SW - 60 - uw + 25, SH - 54, 26, '#dddddd', LIT);
            }
            const ask = askSeg();
            if (ask) {
                const tt = translate('Skip ') + translate(sbName(ask[2])), w2 = cv.textWidth(tt, 30, LITB) + 80, f = focusKey === 'ov:sbskip';
                cv.roundRect(x0, SH - 100, w2, 72, 36, f ? '#3ea6ff' : '#ffffff');
                cv.text(tt, x0 + 40, SH - 52, 30, f ? '#ffffff' : C.bg, LITB);
                tg(x0, SH - 100, w2, 72, run(sbJump(ask)), 'ov:sbskip', 36);
            } else if (resumePill(cv, x0, SH - 100, 72, 30, tg, run)) {
                // (the resume notice)
            } else if (model.toast && Date.now() < model.toast.until) {
                const tt = model.toast.warn ? model.toast.text : translate(model.toast.text), w2 = cv.textWidth(tt, 26, LIT) + 60, wn = model.toast.warn;
                cv.roundRect(x0, SH - 96, w2, 64, 32, wn ? '#4a3a10' : '#1f3d1f');
                cv.text(tt, x0 + 30, SH - 54, 26, wn ? '#ffd27a' : '#7ee07e', LIT);
            }
            if (model.state === 'error') cv.text(fit(cv, translate('Error: ') + (model.error ? whole(model.error) : translate('playback stopped')), 28, bw, LIT), x0, SH - 54, 28, '#ff6b6b', LIT);
            if (barT) barT();
        }
        let removeArmed = null;   // {id, t}: the player's Downloaded pressed once (ov:dl)
        // a round control: dark, white when the controller is on it (its glyph dark then)
        const ctlOf = (cv, tg, run) => (key, x, y, r, fn, glyph, hold) => {
            const f = focusKey === key;
            cv.circle(x, y, r, f ? '#ffffff' : '#00000099');
            glyph(f ? '#0f0f0f' : '#ffffff');
            tg(x - r - 6, y - r - 6, 2 * r + 12, 2 * r + 12, run(fn), key, r + 6, undefined, hold);
        };
        // -10 s / +10 s: a circle arrow with 10 in it; held (#18), previous / next video
        function skipGlyph(cv, x, cy, dir, c) {
            if (skipHeld(dir)) {
                cv.quad([[x - 14 * dir, cy - 20], [x - 14 * dir, cy + 20], [x + 12 * dir, cy], [x - 14 * dir, cy - 20]], c);
                cv.fillRect(dir > 0 ? x + 13 : x - 20, cy - 20, 7, 40, c);
                return;
            }
            cv.arc(x, cy, 19, 23.5, dir < 0 ? 0 : 60, dir < 0 ? 300 : 360, c);
            cv.quad([[x - 1 * dir, cy - 29], [x + 9 * dir, cy - 21], [x - 1 * dir, cy - 13], [x - 1 * dir, cy - 29]], c);
            cv.text('10', x, cy + 7, 18, c, { literal: true, font: 'bold', align: 'center' });
        }
        const playGlyph = (cv, x, cy, k, c) => {
            if (model.state === 'paused') tri(cv, x + 5 * k, cy, 46 * k, c);
            else { cv.roundRect(x - 17 * k, cy - 22 * k, 12 * k, 44 * k, 3 * k, c); cv.roundRect(x + 5 * k, cy - 22 * k, 12 * k, 44 * k, 3 * k, c); }
        };
        // Full screen: four corners pointing out (in full screen: pointing in)
        const fullGlyph = (cv, x, y, c, out) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => cv.polyline(out
            ? [[x + sx * 5, y + sy * 13], [x + sx * 13, y + sy * 13], [x + sx * 13, y + sy * 5]]
            : [[x + sx * 13, y + sy * 5], [x + sx * 5, y + sy * 5], [x + sx * 5, y + sy * 13]], 3.5, c));
        // Download (cap download): a press downloads the video; on one downloaded (or on its way), the first press asks
        // "Press again to remove" for 5 s (as Sign out), the second removes it
        function dlState() {
            const sv = model.saved(model.id), armed = !!removeArmed && removeArmed.id === model.id && !!sv && !sv.error;
            return { sv, armed, label: armed ? translate('Press again to remove') : !sv ? translate('Download') : sv.ready ? translate('Downloaded') : dlText(sv) };
        }
        function dlPress() {
            const { sv, armed } = dlState();
            if (!sv || sv.error) { model.download(model.id, String(settings.get('quality') || 'auto')); return; }
            if (removeArmed) clearTimeout(removeArmed.t);
            if (armed) { removeArmed = null; model.remove(model.id); return; }
            const a = removeArmed = { id: model.id, t: setTimeout(() => { if (removeArmed === a) { removeArmed = null; dirty = true; } }, 5000) };
        }
        const dlGlyph = (cv, x, y, c) => {
            const sv = model.saved(model.id);
            if (sv && sv.ready) cv.polyline([[x - 12, y], [x - 3, y + 10], [x + 13, y - 9]], 5, c);
            else { cv.line(x, y - 15, x, y + 4, 4, c); cv.polyline([[x - 9, y - 5], [x, y + 5], [x + 9, y - 5]], 4, c); cv.roundRect(x - 13, y + 10, 26, 4, 2, c); }
        };
        const phoneGlyph = (cv, x, y, c) => { cv.strokeRoundRect(x - 10, y - 17, 20, 34, 4, 3, c); cv.fillRect(x - 4, y + 10, 8, 3, c); };
        // On phone: a QR code of the video's public link at this second, on a card at cx, cy (true when drawn)
        function qrCard(cv, cx, cy, tg) {
            if (!model.id || qrUntil <= Date.now()) return false;
            const url = 'https://youtu.be/' + model.id + (qrAt > 5000 ? '?t=' + Math.floor(qrAt / 1000) : ''), mod = 8;   // a fixed code while it is scanned
            const n = QR.encode(url).length, side = (n + 8) * mod, cw = side + 520, chh = side + 60, qx0 = cx - cw / 2, qy0 = cy - chh / 2;
            cv.roundRect(qx0, qy0, cw, chh, 24, '#212121f2');
            cv.roundRect(qx0 + 30 - 6, qy0 + 30 - 6, side + 12, side + 12, 18, '#ffffff');
            QR.draw(cv, url, qx0 + 30, qy0 + 30, mod);
            cv.text(translate('Continue on your phone'), qx0 + side + 80, qy0 + chh / 2 - 20, 34, '#ffffff', LITB);
            cv.text(translate('Scan with the camera to go on from ') + clock(qrAt), qx0 + side + 80, qy0 + chh / 2 + 24, 22, '#cccccc', LIT);
            tg(qx0, qy0, cw, chh, () => { qrUntil = 0; wake(); }, 'ov:qrcard', 24);
            return true;
        }
        const qrPress = () => { qrUntil = qrUntil > Date.now() ? 0 : Date.now() + 30000; qrAt = model.elapsed; };
        // Up next on the watch page: the list's next videos, then YouTube's related ones (asked once per video)
        function upNextList() {
            if (model.can('related') && model.id && !(model.related && model.related.id === model.id)) model.loadRelated(model.id);
            const rel = model.related && model.related.id === model.id ? model.related.items : [];
            const seen = {};
            return queue.concat(rel).filter((r) => {
                if (!playable(r) || r.id === model.id || seen[r.id] || (r.short && !settings.get('shorts'))) return false;
                seen[r.id] = true;
                return true;
            });
        }
        /*
         * The watch page (YouTube's, drawn anew), in the overlay's px: the video in a 16:9 box with its controls over it
         * (-10 s, play / pause, +10 s, the progress bar, the time, Full screen; they hide as the full view's do and a tap
         * or the controller brings them back), back to the list top left; under it the title and the channel; on the
         * right the actions (Repeat, Download, On phone, Close) and Up next. Targets: the box's, the actions, Up next
         * (up:<id>), the bar last (the knob seeks there).
         */
        function drawWatch(cv, pl, s, SW, SH, tg) {
            const run = (fn) => () => { fn(); wake(); }, ctl = ctlOf(cv, tg, run);
            const LX = HMI.left / s, live = model.state === 'playing' || model.state === 'paused', act = model.active();
            const vx = LX + 20, vy = 18, vw = 832, vh = 468, bx = vx + vw / 2, by = vy + vh / 2 - 8;
            picArea = null;                                  // (double taps: the full view only)
            cv.xf(s, 0, 0).fillRect(0, 0, SW, SH, C.bg);
            cv.roundRect(vx, vy, vw, vh, 12, '#000000');
            // the box itself, not vbox: op 19 fits the frame into it, and ytdec --no-upscale sends the video alone at its own
            // aspect, so a 16:9 video fills the box (vbox's full-screen aspect would shrink it to a band in the middle)
            if (videoShown) { cv.xf(1, 0, 0); cv.video(VID, vx * s, vy * s, vw * s, vh * s, 12 * s); cv.xf(s, 0, 0); }
            if (qrCard(cv, SW / 2, SH / 2, tg)) { cv.xf(); hmiIcons(cv); return; }
            const shown = overlay(), BOXK = ['ov:rw', 'ov:play', 'ov:ff', 'ov:full'];
            ctl('ov:back', vx + 38, vy + 38, 26, () => goBack(browse), (c) => cv.polyline([[vx + 43, vy + 26], [vx + 31, vy + 38], [vx + 43, vy + 50]], 5, c));
            let mid = null, barT = null;
            if (!model.connected) mid = OFF;
            else if (model.state === 'error') mid = translate('Error: ') + (model.error ? whole(model.error) : translate('playback stopped'));
            if (netDown() && (model.state === 'preparing' || model.retry || (model.state === 'error' && model.errorOffline))) mid = net1();
            if (upNext) mid = message('Up next in {seconds} s: {title}', { seconds: Math.max(1, Math.ceil((nextAt - Date.now()) / 1000)), title: upNext.title || upNext.id });
            else if (!act && model.state !== 'error') mid = model.state === 'ended' ? translate('Finished') : translate('Pick a video on Home or Search');
            else if (!gpu()) mid = translate('The picture needs the GPU renderer (mgu-render) - the sound plays');
            else if (live && !videoShown && !mid) mid = translate('Starting the picture...');
            if (!shown && live && !upNext) {
                // hidden: a thin red line for where it is; the box's keys only wake it (the controller stays on its key)
                if (model.total > 0) cv.fillRect(vx, vy + vh - 4, Math.round(vw * Math.min(1, shownAt() / model.total)), 4, C.red);
                BOXK.forEach((k) => tg(vx, vy, vw, vh, wake, k, 12));
            } else if (model.state === 'preparing') {
                const p = Math.max(0, Math.min(100, model.pct || 0));
                cv.circle(bx, by, 56, '#00000099');
                cv.arc(bx, by, 44, 52, 0, 360, '#ffffff26');
                if (p > 0) cv.arc(bx, by, 44, 52, 0, p * 3.6, C.red, { round: true });
                cv.text(Math.round(p) + '%', bx, by + 10, 30, '#ffffff', { literal: true, font: 'bold', align: 'center' });
                if (!mid) cv.text(prepText(), bx, by + 96, 24, '#dddddd', { literal: true, align: 'center' });
            } else if (upNext) {
                ctl('ov:play', bx, by, 48, () => { nextAt = 1; }, (c) => tri(cv, bx + 4, by, 38, c));
            } else if (live) {
                cv.gradientRect(vx, vy + vh - 130, vw, 130, [[0, '#00000000'], [1, '#000000d8']]);
                ctl('ov:rw', bx - 160, by, 38, () => model.skip(-10000), (c) => skipGlyph(cv, bx - 160, by, -1, c), skipBtn(-1));
                ctl('ov:play', bx, by, 50, () => model.toggle(), (c) => playGlyph(cv, bx, by, 0.9, c));
                ctl('ov:ff', bx + 160, by, 38, () => model.skip(10000), (c) => skipGlyph(cv, bx + 160, by, 1, c), skipBtn(1));
            } else if (model.state === 'error' && model.id && model.connected) {
                const tx = bx - 90, lx = bx + 90;            // Try again and, beside it, the logs page (as the full view's)
                ctl('ov:play', tx, by, 48, again, (c) => retryGlyph(cv, tx, by, 24, c));
                cv.text(translate('Try again'), tx, by + 86, 24, '#dddddd', { literal: true, align: 'center' });
                ctl('ov:logs', lx, by, 40, openLogs, (c) => { cv.line(lx, by + 14, lx, by - 13, 5, c); cv.polyline([[lx - 11, by - 2], [lx, by - 13], [lx + 11, by - 2]], 5, c); });
                cv.text(whole('Send logs'), lx, by + 86, 24, '#dddddd', { literal: true, align: 'center' });
            }
            if (mid) cv.text(fit(cv, mid, 26, vw - 60, LIT), bx, live && shown || model.state === 'preparing' || upNext || model.state === 'error' ? by + 128 : by + 10, 26, '#ffffff', { literal: true, align: 'center' });
            if (mid && mid === net1()) cv.text(fit(cv, uplink.error || net2(), 22, vw - 60, LIT), bx, by + 164, 22, '#dddddd', { literal: true, align: 'center' });
            if (mid && offlineHint()) cv.text(fit(cv, offlineHint(), 22, vw - 60, LIT), bx, mid === net1() ? by + 198 : by + 164, 22, '#ffd27a', { literal: true, align: 'center' });
            if (shown && live && !upNext && model.total > 0) {
                // the bar along the box's foot, the time under its left end, Full screen under its right end
                const x0 = vx + 24, w = vw - 48, y = vy + vh - 56, el = shownAt(), at = (ms) => x0 + Math.round(w * Math.min(1, ms / model.total)), fx = at(el), bf = focusKey === 'ov:bar';
                const ex = model.extras && model.extras.id === model.id ? model.extras : null;
                cv.roundRect(x0, y, w, 6, 3, '#ffffff55');
                cv.roundRect(x0, y, fx - x0, 6, 3, C.red);
                if (ex) sbSegs(ex).forEach((g) => cv.fillRect(at(g[0]), y, Math.max(3, at(g[1]) - at(g[0])), 6, sbColor(g)));
                if (ex) ex.chapters.forEach((c) => { if (c[0] > 0) cv.fillRect(at(c[0]) - 2, y, 4, 6, '#000000'); });
                if (bf) cv.circle(fx, y + 3, 18, '#ffffff');
                cv.circle(fx, y + 3, bf || scrub ? 14 : 10, C.red);
                barT = () => tg(x0 - 10, y - 22, w + 20, 38, run(() => model.toggle()), 'ov:bar', 0, turnSeek);
                seekBar = { x0, w, y0: y - 28, y1: y + 18, s };
                scrubBubble(cv, fx, y - 8);
                cv.text(clock(el) + ' / ' + clock(model.total), x0, vy + vh - 14, 22, '#ffffff', LITB);
                const fx2 = vx + vw - 44, fy = vy + vh - 22, ff = focusKey === 'ov:full';
                if (ff) cv.circle(fx2, fy, 22, '#ffffff');
                fullGlyph(cv, fx2, fy, ff ? '#0f0f0f' : '#ffffff', true);
                tg(fx2 - 30, fy - 16, 60, 38, run(() => { fullView = true; }), 'ov:full', 16);
            }
            // over the box's foot, above the bar, as the full view's: the resume point (or a toast) left, Skip right
            if (shown && live && !upNext) {
                const ny = vy + vh - 126;
                const resumed = resumePill(cv, vx + 24, ny, 50, 22, tg, run);
                if (!resumed && model.toast && Date.now() < model.toast.until) {
                    const tt = model.toast.warn ? model.toast.text : translate(model.toast.text), tw2 = Math.min(vw - 48, cv.textWidth(tt, 22, LIT) + 44), wn = model.toast.warn;
                    cv.roundRect(vx + 24, ny, tw2, 50, 25, wn ? '#4a3a10e6' : '#1f3d1fe6');
                    cv.text(fit(cv, tt, 22, tw2 - 44, LIT), vx + 46, ny + 33, 22, wn ? '#ffd27a' : '#7ee07e', LIT);
                }
                const ask = askSeg();
                if (ask) {
                    const tt = translate('Skip ') + translate(sbName(ask[2])), w2 = cv.textWidth(tt, 22, LITB) + 56, sx = vx + vw - 24 - w2, f = focusKey === 'ov:sbskip';
                    cv.roundRect(sx, ny, w2, 50, 25, f ? '#ffffff' : '#3a3a3ae6');
                    cv.text(tt, sx + 28, ny + 33, 22, f ? '#0f0f0f' : '#ffffff', LITB);
                    tg(sx, ny, w2, 50, run(sbJump(ask)), 'ov:sbskip', 25);
                }
            }
            // under the box: the title (Read aloud on: a speaker at its end says it, ringed blue while it speaks), the channel's
            // round initial, its name and the video's meta
            const it = model.item(model.id) || {}, ch = model.channel || it.channel, sayIt = canSay();
            if (model.title) cv.text(fit(cv, model.title, 28, sayIt ? vw - 64 : vw, LITB), vx, vy + vh + 42, 28, C.text, LITB);
            if (sayIt) {
                const sx = vx + vw - 24, sy = vy + vh + 32;
                if (model.speaking) cv.circle(sx, sy, 29, '#3ea6ff');
                ctl('ov:say', sx, sy, 24, sayTitle, (c) => speakerGlyph(cv, sx, sy, c));
            }
            if (ch) {
                initial(cv, ch, vx + 18, vy + vh + 78, 18);
                const nw = cv.text(fit(cv, ch, 22, 360, LITB), vx + 48, vy + vh + 86, 22, C.text, LITB);
                const meta = (Array.isArray(it.meta) ? it.meta : []).filter((m) => typeof m === 'string' && m).join(' · ');
                if (meta) cv.text(fit(cv, meta, 20, vw - 80 - nw, LIT), vx + 48 + nw + 16, vy + vh + 86, 20, C.dim, LIT);
            }
            // the right column: the actions as YouTube's pills, then Up next
            const rx0 = vx + vw + 32, rw = SW - 24 - rx0;
            let px = rx0;
            const pill = (key, label, fn, glyph, lit) => {
                const f = focusKey === key, w = cv.textWidth(label, 20, LITB) + 72;
                if (px + w > rx0 + rw) return;
                cv.roundRect(px, vy, w, 52, 26, f ? '#ffffff' : C.card);
                glyph(px + 28, vy + 26, f ? '#0f0f0f' : lit || '#ffffff');
                cv.text(label, px + 50, vy + 33, 20, f ? '#0f0f0f' : lit || '#ffffff', LITB);
                tg(px, vy, w, 52, run(fn), key, 26);
                px += w + 10;
            };
            if (model.id && live && canRepeat()) pill('ov:repeat', translate(repeatOn() ? 'Repeat on' : 'Repeat'), toggleRepeat, (x, y, c) => repeatGlyph(cv, x, y, c, 0.55), repeatOn() ? '#ff4e45' : null);
            if (model.id && model.can('download')) pill('ov:dl', dlState().label, dlPress, (x, y, c) => { cv.xf(s * 0.7, x * s * 0.3, y * s * 0.3); dlGlyph(cv, x, y, c); cv.xf(s, 0, 0); });
            if (model.id) pill('ov:qr', translate('On phone'), qrPress, (x, y, c) => { cv.xf(s * 0.7, x * s * 0.3, y * s * 0.3); phoneGlyph(cv, x, y, c); cv.xf(s, 0, 0); });
            if (act) pill('ov:close', translate('Close'), closeVideo, (x, y, c) => xGlyph(cv, x, y, 8, c));
            const ups = upNextList().slice(0, 3);
            if (ups.length) {
                cv.text(translate('Up next'), rx0, vy + 106, 24, C.text, LITB);
                const tw = 224, th = 126, list = ups;
                ups.forEach((r, i) => {
                    const y = vy + 124 + i * (th + 16), key = 'up:' + r.id, f = focusKey === key;
                    if (f) { cv.roundRect(rx0 - 8, y - 8, rw + 16, th + 16, 14, C.card); cv.strokeRoundRect(rx0 - 8, y - 8, rw + 16, th + 16, 14, 3, '#ffffff'); }
                    const thb = model.thumbs[r.id];
                    if (!thb) model.wantThumb(r.id);
                    const pid = thb && cv.place ? slot(r.id, thb) : null;
                    if (pid) cv.picture(pid, rx0, y, tw, th, 10); else { cv.roundRect(rx0, y, tw, th, 10, C.ph); tri(cv, rx0 + tw / 2 + 2, y + th / 2, 22, '#ffffff38'); }
                    if (r.duration_s > 0) {
                        const d = clock(r.duration_s * 1000), dw = cv.textWidth(d, 18, LITB) + 12;
                        cv.roundRect(rx0 + tw - 6 - dw, y + th - 30, dw, 24, 4, '#000000cc');
                        cv.text(d, rx0 + tw - 12, y + th - 12, 18, '#ffffff', { literal: true, font: 'bold', align: 'right' });
                    }
                    const tx = rx0 + tw + 16, lines = wrap(cv, String(r.title || r.id), rw - tw - 16);
                    lines.forEach((l, k) => cv.text(l, tx, y + 26 + k * 30, 24, C.text, LITB));
                    const meta = [r.channel].concat(Array.isArray(r.meta) ? r.meta : []).filter((m) => typeof m === 'string' && m).join(' · ');
                    if (meta) cv.text(fit(cv, meta, 20, rw - tw - 16, LIT), tx, y + 26 + lines.length * 30 + 2, 20, C.dim, LIT);
                    tg(rx0 - 8, y - 8, rw + 16, th + 16, run(() => pressVideo(r, () => play(r.id, r, list))), key, 14);
                });
            }
            // a short note (Read aloud's "Press again to play", busy, failed) at the top of the video box, clear of its controls
            if (note && Date.now() < note.until) {
                const nw = Math.min(vw - 160, cv.textWidth(note.text, 22, LIT) + 48);
                cv.roundRect(bx - nw / 2, vy + 14, nw, 48, 24, '#4a3a10f0');
                cv.text(fit(cv, note.text, 22, nw - 32, LIT), bx, vy + 46, 22, '#ffd27a', { literal: true, align: 'center' });
            }
            if (barT) barT();
            cv.xf();
            hmiIcons(cv);
        }
        function drawFull(cv) {
            const pl = cv.place, s = pl.scale, SW = pl.w / s, SH = pl.h / s, dx = pl.ox / s, dy = pl.oy / s;
            cv.chrome = null;              // no header or bar composed over it (display.js present)
            // read: the page stays placed as the browsing pages (reaching down), so oy, and the targets with it, hold
            void cv.extra;
            const ctls = [];                               // the controls this frame shows (a double tap on them is theirs)
            const tg = (x, y, w, h, run, key, r, turn, hold) => { ctls.push({ x, y, w, h }); return cv.target(x - dx, y - dy, w, h, run, key, r, turn, hold); };
            cv.xf(1, 0, 0).fillRect(0, 0, pl.w, pl.h, '#000000');
            seekBar = null;                                // (set again where this frame draws the bar)
            const pod = model.active() && noVideo();   // no picture allowed: podcast mode (no picture, big controls, always shown)
            if (!pod && !fullView) { drawWatch(cv, pl, s, SW, SH, tg); return; }
            picArea = pod ? null : { SW, s, ctls };        // double taps: the video player only (podcast mode has its big buttons)
            if (videoShown && !pod) cv.video(VID, ...vbox(0, 0, pl.w, pl.h), 0);
            if (!overlay() && !pod) {
                cv.xf(); ovKeys().forEach((k) => tg(0, 0, SW, SH, wake, k, 0, k === 'ov:bar' ? turnSeek : undefined));
                picArea.ctls = [];                         // (hidden: those keys only wake it, no control under a tap)
                return;
            }
            cv.xf(s, 0, 0);
            const LX = HMI.left / s, act = model.active(), live = model.state === 'playing' || model.state === 'paused';
            const cx = SW / 2, cy = SH / 2 - 6, run = (fn) => () => { fn(); wake(); };
            if (pod) { drawPodcast(cv, SW, SH, LX, tg, run, live); hmiIcons(cv); return; }
            const ctl = ctlOf(cv, tg, run);
            // top: back to the watch page, the title and channel over a scrim
            cv.gradientRect(0, 0, SW, 160, [[0, '#000000d8'], [1, '#00000000']]);
            const bx = LX + 44, by = 52;
            ctl('ov:back', bx, by, 30, () => { fullView = false; }, (c) => cv.polyline([[bx + 5, by - 12], [bx - 7, by], [bx + 5, by + 12]], 5, c));
            const ch = model.channel || (model.item(model.id) || {}).channel;
            // top right, Download (cap download), left of On phone: a press downloads the video; on one downloaded (or on its
            // way), the first press asks "Press again to remove" for 5 s (as Sign out), the second removes it
            let tright = SW - 64;
            if (model.id && model.can('download')) {
                const { sv, label } = dlState(), dlx = SW - 150 - 42 - cv.textWidth(translate('On phone'), 24, LIT) - 70;
                ctl('ov:dl', dlx, by, 30, dlPress, (c) => {
                    dlGlyph(cv, dlx, by, c);
                    if (sv && !sv.ready && !sv.error && sv.pct > 0) cv.arc(dlx, by, 27, 31, 0, sv.pct * 3.6, C.red, { round: true });
                });
                const lw = cv.textWidth(label, 24, LIT);
                cv.text(label, dlx - 42, by + 9, 24, sv && sv.error ? '#ff8a80' : '#ffffff', Object.assign({}, LIT, { align: 'right' }));
                tright = dlx - 42 - lw - 24;
            }
            if (model.title) cv.text(fit(cv, model.title, 30, Math.min(SW - LX - 160, tright - LX - 96), LITB), LX + 96, by - 4, 30, '#ffffff', LITB);
            if (ch) cv.text(fit(cv, ch, 22, Math.min(SW - LX - 300, tright - LX - 96), LIT), LX + 96, by + 30, 22, '#cccccc', LIT);
            // top right, On phone: a QR code of the video's public link at this second
            if (model.id) {
                const px = SW - 150;
                ctl('ov:qr', px, by, 30, qrPress, (c) => phoneGlyph(cv, px, by, c));
                cv.text(translate('On phone'), px - 42, by + 9, 24, '#ffffff', Object.assign({}, LIT, { align: 'right' }));
            }
            if (qrCard(cv, cx, cy, tg)) { cv.xf(); hmiIcons(cv); return; }
            // middle left, Close: the video ends and the list shows again (mirrors Quality / Zoom on the right)
            if (act) {
                const kx = LX + 150;
                ctl('ov:close', kx, cy, 42, closeVideo, (c) => xGlyph(cv, kx, cy, 15, c));
                cv.text(translate('Close'), kx, cy + 76, 22, '#dddddd', { literal: true, align: 'center' });
            }
            // beside it, Repeat (pink while on): the video plays again from the start when it ends
            if (model.id && live && canRepeat()) {
                const rx = LX + 330, on = repeatOn();
                ctl('ov:repeat', rx, cy, 42, toggleRepeat, (c) => repeatGlyph(cv, rx, cy, on && c === '#ffffff' ? C.red : c));
                cv.text(translate(on ? 'Repeat on' : 'Repeat'), rx, cy + 76, 22, on ? C.red : '#dddddd', { literal: true, align: 'center' });
            }
            // middle: -10 s, play / pause, +10 s (held: previous / next); preparing: the ring with the percentage
            let mid = null;
            if (!model.connected) mid = OFF;
            else if (model.state === 'error') mid = translate('Error: ') + (model.error ? whole(model.error) : translate('playback stopped'));
            const up = upNext;
            if (up) {
                mid = message('Up next in {seconds} s: {title}', { seconds: Math.max(1, Math.ceil((nextAt - Date.now()) / 1000)), title: up.title || up.id });
                ctl('ov:play', cx, cy, 58, () => { nextAt = 1; }, (c) => tri(cv, cx + 5, cy, 46, c));
            } else if (!act && model.state !== 'error') mid = model.state === 'ended' ? translate('Finished') : translate('Pick a video on Home or Search');
            else if (noVideo()) mid = translate('Audio only until the car is in P (Park)');
            else if (!gpu()) mid = translate('The picture needs the GPU renderer (mgu-render) - the sound plays');
            else if (live && !videoShown) mid = translate('Starting the picture...');
            if (model.state === 'preparing') {
                const p = Math.max(0, Math.min(100, model.pct || 0));
                cv.circle(cx, cy, 56, '#00000099');
                cv.arc(cx, cy, 44, 52, 0, 360, '#ffffff26');
                if (p > 0) cv.arc(cx, cy, 44, 52, 0, p * 3.6, C.red, { round: true });
                cv.text(Math.round(p) + '%', cx, cy + 10, 30, '#ffffff', { literal: true, font: 'bold', align: 'center' });
                cv.text(prepText(), cx, cy + 100, 26, '#dddddd', { literal: true, align: 'center' });
            } else if (live) {
                // -10 s / +10 s; held, previous / next video (#18: the button shows it, letting go takes it)
                const skip = (key, x, dir) => ctl(key, x, cy, 42, () => model.skip(dir * 10000), (c) => skipGlyph(cv, x, cy, dir, c), skipBtn(dir));
                skip('ov:rw', cx - 210, -1);
                ctl('ov:play', cx, cy, 58, () => model.toggle(), (c) => playGlyph(cv, cx, cy, 1, c));
                skip('ov:ff', cx + 210, 1);
                // right: Video quality (a press takes the next one; the video starts again there) and zoom (fill crops)
                const qv = String(settings.get('quality') || 'auto'), fl = settings.get('fill') !== false, qx = SW - 330, zx = SW - 150;
                ctl('ov:q', qx, cy, 42, () => { const q = QUALITIES[(QUALITIES.indexOf(qv) + 1) % QUALITIES.length]; settings.set('quality', q); model.quality(q); },
                    (c) => cv.text(qv === 'auto' ? translate('Auto') : qv + 'p', qx, cy + 8, 22, c, { literal: true, font: 'bold', align: 'center' }));
                cv.text(translate('Quality'), qx, cy + 76, 22, '#dddddd', { literal: true, align: 'center' });
                ctl('ov:zoom', zx, cy, 42, () => { settings.set('fill', !fl); model.fill(!fl); }, (c) => {
                    cv.strokeRoundRect(zx - 22, cy - 15, 44, 30, 4, 3, c);
                    if (fl) cv.fillRect(zx - 22, cy - 15, 44, 30, c); else cv.fillRect(zx - 12, cy - 15, 24, 30, c);
                });
                cv.text(translate(fl ? 'Unzoom' : 'Zoom'), zx, cy + 76, 22, '#dddddd', { literal: true, align: 'center' });
            } else if (model.state === 'error' && model.id && model.connected) {
                const tx = cx - 105, lx = cx + 105; // the pair centred under the title
                ctl('ov:play', tx, cy, 58, again, (c) => retryGlyph(cv, tx, cy, 26, c));
                cv.text(translate('Try again'), tx, cy + 100, 26, '#dddddd', { literal: true, align: 'center' });
                // beside it: the logs page (an arrow going up, out of the car)
                ctl('ov:logs', lx, cy, 42, openLogs, (c) => { cv.line(lx, cy + 15, lx, cy - 14, 5, c); cv.polyline([[lx - 12, cy - 2], [lx, cy - 14], [lx + 12, cy - 2]], 5, c); });
                cv.text(whole('Send logs'), lx, cy + 100, 26, '#dddddd', { literal: true, align: 'center' });
            }
            // bottom right, right of the bar (YouTube's place): back to the watch page (the corners pointing in)
            if (model.id) ctl('ov:full', SW - 66, SH - 52, 30, () => { fullView = false; }, (c) => fullGlyph(cv, SW - 66, SH - 52, c, false));
            if (mid) cv.text(fit(cv, mid, 30, SW - 2 * LX, LIT), cx, model.state === 'preparing' || live || up || (model.state === 'error' && model.id) ? cy + 150 : cy + 10, 30, '#ffffff', { literal: true, align: 'center' });
            if (mid && offlineHint()) cv.text(fit(cv, offlineHint(), 26, SW - 2 * LX, LIT), cx, model.id ? cy + 196 : cy + 56, 26, '#ffd27a', { literal: true, align: 'center' });
            // bottom: the progress bar (the track, the part played, the scrubber) and the times; its target recorded
            // last (after Skip and Start over): the knob seeks there, so turning ends on it
            let barT = null;
            if (model.total > 0 && live) {
                cv.gradientRect(0, SH - 150, SW, 150, [[0, '#00000000'], [1, '#000000d8']]);
                const x0 = LX + 40, w = SW - x0 - (model.id ? 120 : 40), y = SH - 66, el = shownAt(), fx = x0 + Math.round(w * Math.min(1, el / model.total)), bf = focusKey === 'ov:bar';
                const at = (ms) => x0 + Math.round(w * Math.min(1, ms / model.total)), ex = model.extras && model.extras.id === model.id ? model.extras : null;
                cv.roundRect(x0, y, w, 6, 3, '#ffffff55');
                cv.roundRect(x0, y, fx - x0, 6, 3, C.red);
                if (ex) sbSegs(ex).forEach((g) => cv.fillRect(at(g[0]), y, Math.max(3, at(g[1]) - at(g[0])), 6, sbColor(g)));   // SponsorBlock: skipped green, asked yellow
                if (ex) ex.chapters.forEach((c) => { if (c[0] > 0) cv.fillRect(at(c[0]) - 2, y, 4, 6, '#000000'); });
                if (bf) cv.circle(fx, y + 3, 18, '#ffffff');
                cv.circle(fx, y + 3, bf || scrub ? 14 : 10, C.red);
                barT = () => tg(x0 - 10, y - 34, w + 20, 70, run(() => model.toggle()), 'ov:bar', 0, turnSeek);
                seekBar = { x0, w, y0: y - 40, y1: y + 40, s };
                scrubBubble(cv, fx, y - 8);
                const tt0 = clock(el) + ' / ' + clock(model.total), tw = cv.textWidth(tt0, 24, LITB), chap = model.chapter();
                cv.text(tt0, x0, SH - 22, 24, '#ffffff', LITB);
                if (chap) cv.text(fit(cv, '·  ' + chap, 24, w - tw - 20, LIT), x0 + tw + 14, SH - 22, 24, '#dddddd', LIT);
            }
            const resumed = live && resumePill(cv, LX + 40, SH - 170, 60, 26, tg, run);
            if (!resumed && model.toast && Date.now() < model.toast.until && live) {
                const tt = model.toast.warn ? model.toast.text : translate(model.toast.text), tw2 = cv.textWidth(tt, 24, LIT) + 48, wn = model.toast.warn;
                cv.roundRect(LX + 40, SH - 150, tw2, 50, 25, wn ? '#4a3a10e6' : '#1f3d1fe6');
                cv.text(tt, LX + 64, SH - 116, 24, wn ? '#ffd27a' : '#7ee07e', LIT);
            }
            const ask = live && askSeg();
            if (ask) {
                const tt = translate('Skip ') + translate(sbName(ask[2])), w2 = cv.textWidth(tt, 28, LITB) + 70, sx = SW - 60 - w2, sy = SH - 168, f = focusKey === 'ov:sbskip';
                cv.roundRect(sx, sy, w2, 60, 30, f ? '#ffffff' : '#3a3a3ae6');
                cv.text(tt, sx + 35, sy + 40, 28, f ? '#0f0f0f' : '#ffffff', LITB);
                tg(sx, sy, w2, 60, run(sbJump(ask)), 'ov:sbskip', 30);
            }
            // a double tap's hint on its side: « 10 s / 20 s » (10 s a tap after the first)
            if (tapFx && Date.now() < tapFx.until) {
                const t = (tapFx.dir < 0 ? '«  ' : '') + tapFx.n * 10 + ' s' + (tapFx.dir > 0 ? '  »' : ''), tw = cv.textWidth(t, 34, LITB) + 56;
                const hx = tapFx.dir < 0 ? LX + 60 : SW - 60 - tw, hy = cy - 150;
                cv.roundRect(hx, hy, tw, 64, 32, '#000000b0');
                cv.text(t, hx + tw / 2, hy + 44, 34, '#ffffff', { literal: true, font: 'bold', align: 'center' });
            }
            if (barT) barT();
            hmiIcons(cv);
        }
        // the HMI's home and back arrow column: its taps stay the HMI's, but no black hole over the video;
        // the same two icons where the HMI has them (screen px), on the scrim
        function hmiIcons(cv) {
            cv.xf(1, 0, 0);
            cv.circle(44, 42, 30, '#00000099');
            HOME(cv, 44, 44, '#ffffff', '#1a1a1a');
            cv.circle(52, 398, 30, '#00000099');
            cv.polyline([[60, 384], [46, 398], [60, 412]], 5, '#ffffff');
            cv.xf();
        }
        // the controller (in use) on a key this frame lacks - the page changed under it (a tile played, a question page
        // came up, the player went to podcast mode): onto the page's own place. Never onto I agree or Send: a push there acts
        const SAFE = { logs: 'logs:cancel', clock: 'clock:ok', player: 'ov:play' };
        // A question page just come up takes it onto its safe answer, even from the rail
        let focusMode = null;
        function keepFocus(cv) {
            const fresh = mode !== focusMode;
            focusMode = mode;
            if (!focusKey || !cv.own || !ctx.focus) return;
            const ks = cv.targets.map((x) => x.key), ask = fresh && /^(logs|clock)$/.test(mode) && ks.indexOf(SAFE[mode]) >= 0;
            if (!ks.length || (ks.indexOf(focusKey) >= 0 && !ask)) return;
            const k = [SAFE[mode], backKey[mode]].find((x) => x && ks.indexOf(x) >= 0)
                || ks.find((x) => !/^rail:|:[<>]$|^logs:send$/.test(x)) || (ks.indexOf('rail:' + railSel()) >= 0 ? 'rail:' + railSel() : ks[0]);
            focusKey = k;
            setImmediate(() => ctx.focus(k));
        }
        let last = null, lastRev = -1, lastT = 0, upNext = null;
        function render() {
            const now = Date.now();
            upNext = autoNext();
            // the wrong-clock warning, the first time a page (not the player or the logs) is drawn this app session
            if (model.clock && !clockSeen && mode !== 'clock' && mode !== 'player' && mode !== 'logs') { clockFrom = mode; show('clock'); }
            else if (mode === 'clock' && !model.clock) goBack(clockFrom);   // set right meanwhile
            else if (newsDue && mode !== 'clock' && mode !== 'player' && mode !== 'logs') { newsFrom = mode; show('news'); }
            // redraw on a change (and 4 times a second); unchanged, the same frame again keeps the layer alive (>= 1 message/s)
            if (!last || dirty || model.rev !== lastRev || now - lastT > 250) {
                dirty = false; lastRev = model.rev; lastT = now;
                const cv = ctx.canvas(W, H).clear(C.bg);
                frameNo++;
                inset(cv);
                offlineSaid = false;
                if (mode === 'player' && cv.own && cv.place && cv.place.full) drawFull(cv);
                else {
                    if (headed() && cv.own) drawHead(cv);
                    if (mode === 'player') drawPlayer(cv); else if (mode === 'channel') drawChannel(cv); else if (mode === 'results') drawResults(cv);
                    else if (mode === 'pl') drawPlaylists(cv); else if (mode === 'list') drawPlaylist(cv); else if (mode === 'logs') drawLogs(cv); else if (mode === 'clock') drawClock(cv); else if (mode === 'news') drawNews(cv); else if (PAGES[mode]) PAGES[mode](cv); else drawFeed(cv, isFeed(mode) ? mode : 'home');
                    if (browsing() && note && now < note.until) {
                        const nt = note.text, nw = cv.textWidth(nt, 26, LIT) + 60, ny = H + (cv.own ? cv.extra : 0) - 96;
                        cv.roundRect(MID - nw / 2, ny, nw, 64, 32, '#4a3a10');
                        cv.text(nt, MID, ny + 42, 26, '#ffd27a', { literal: true, align: 'center' });
                    } else if (headed() && netDown() && !offlineSaid) {
                        const t1 = net1(), t2 = uplink.error || net2(), nw = Math.min(1200, Math.max(cv.textWidth(t1, 24, LITB), cv.textWidth(t2, 20, LIT)) + 120);
                        const nx = MID - nw / 2, ny = H + (cv.own ? cv.extra : 0) - 92;
                        cv.roundRect(nx, ny, nw, 78, 16, '#272727f2');
                        noNet(cv, nx + 46, ny + 36, 0.75, C.text);
                        cv.text(t1, nx + 92, ny + 34, 24, C.text, LITB);
                        cv.text(fit(cv, t2, 20, nw - 110, LIT), nx + 92, ny + 62, 20, C.dim, LIT);
                    }
                    // where the kit runs the screen the rail has the pages: the header shows just the name
                    if (cv.own) G.frame(cv, ctx.theme(), [], -1); else G.frame(cv, ctx.theme(), TABS.map((m) => NAMES[m]), TABS.indexOf(mode));
                }
                drawVolume(cv);
                last = cv;
                keepFocus(cv);
            }
            return ui.image('VIEW_GFX', last);
        }
        viewLoop = ctx.loop('VIEW', 10, render);
        // the Language setting changed (or, on Auto, the car's language): the new catalog, hello again with its lang and
        // region (feeds, search and related come in it), the page shown asks again, every text drawn or sent again
        function relang() {
            const lang = pickLanguage();
            if (!setLanguage(lang)) return;
            const hi = hello();
            if (JSON.stringify(hi) === helloSent) return;   // same text and same YouTube language and country
            helloSent = JSON.stringify(hi);
            log.info('language ' + lang + ', YouTube ' + hi.lang + (hi.region ? '-' + hi.region : ''));
            model.relang(hi);
            OFF = translate('The RideTube service (jap-ridetube-d) is not running');
            OFF2 = translate('Install the RideTube service (jap-ridetube-d) from the MGU Store');
            suggestions = SUGGEST.map(translate);
            showSlots();
            lastPlay = lastList = lastAcct = null;
            labels(); info(); openFeed();
            dirty = true;
        }
        if (settings.onChange) settings.onChange((key) => { if (key === 'language') relang(); });
        // Picture while driving switched: the gate follows now, not at its next 250 ms check; Typing while driving: the
        // Search page's Type a search says what a press does now
        settings.onChange((key) => { if (key === PICTURE) { log.info('picture while driving: ' + (pictureDriving() ? 'on' : 'off (the picture only in P)')); sync(); dirty = true; kick(); } });
        settings.onChange((key) => { if (key === TYPING) { log.info('typing while driving: ' + (typingDriving() ? 'on' : 'off (typing only in P)')); dirty = true; kick(); } });
        settings.onChange((key) => { if (key === READ) { log.info('read aloud: ' + (readAloud() ? 'on' : 'off')); sayArmed = null; if (!readAloud()) model.hush(); dirty = true; kick(); } });
        if (ctx.hmiLanguage) ctx.hmiLanguage(() => relang());   // the country follows the car in every mode
        log.info('ridetube app started');
    },
});
