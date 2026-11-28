'use strict';
// Read aloud (local fork 0.5.80). node22 tts.js <lang>: the text on stdin spoken by eSpeak NG (tts/espeak-ng.mjs, compiled
// to WebAssembly, voice data for the app's ten languages) as an MP3 on stdout (lamejs: 44.1 kHz mono, 64 kbps, the
// format the car's media player plays), for ytd.js's `say`. Runs as the fetch uid, offline (cwd /, no network use).
// Exit 0 with the MP3, else 1 and why on stderr. The voice: the text's own script when most of its letters are Hangul,
// Han or Cyrillic (Korean, Mandarin, Russian), else <lang>, the app's language (en fr nl de es it pt ru zh ko).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const url = require('url');

const MAX = 300, RATE = 44100, KBPS = 64;
const VOICES = { en: 'en-us', fr: 'fr', nl: 'nl', de: 'de', es: 'es', it: 'it', pt: 'pt-br', ru: 'ru', zh: 'cmn', ko: 'ko' };   // (the app's pt is Brazilian)
const dir = path.join(__dirname, 'tts');

// a title as words to say: no emoji, no markup (eSpeak NG skips tags: a stray < would swallow words; & it reads as
// "and" in the voice's language), separators as pauses, at most MAX characters
function clean(t) {
    return String(t).normalize('NFC')
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ')
        .replace(/[\p{Cc}<>#*_=~^`|\\[\]{}•·]+/gu, (m) => (/[|•·]/.test(m) ? ', ' : ' '))
        .replace(/\s+/g, ' ').replace(/ ,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').slice(0, MAX);
}
function voiceFor(lang, text) {
    const n = (re) => (text.match(re) || []).length;
    const latin = n(/\p{Script=Latin}/gu), kana = n(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
    const own = [['ko', n(/\p{Script=Hangul}/gu)], ['cmn', kana ? 0 : n(/\p{Script=Han}/gu)], ['ru', n(/\p{Script=Cyrillic}/gu)]]
        .filter((x) => x[1] > 0 && x[1] >= latin);
    return own.length ? own[0][0] : VOICES[String(lang || '').slice(0, 2)] || 'en-us';
}
// 16-bit mono at `from` Hz -> RATE Hz (linear), the peak at 90 % (eSpeak speaks well under a video's level), with
// 0.25 s of silence before (a player can clip a file's first moment) and 0.35 s after
function shape(pcm, from) {
    let peak = 1;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const gain = Math.min(4, 0.9 * 32767 / peak), n = Math.floor(pcm.length * RATE / from), lead = Math.round(RATE * 0.25);
    const out = new Int16Array(lead + n + Math.round(RATE * 0.35));
    for (let i = 0; i < n; i++) {
        const p = i * from / RATE, k = Math.floor(p), f = p - k, a = pcm[k], b = k + 1 < pcm.length ? pcm[k + 1] : a;
        out[lead + i] = Math.max(-32768, Math.min(32767, Math.round((a + (b - a) * f) * gain)));
    }
    return out;
}
function mp3(samples) {
    const ctx = {};
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'lame.min.js'), 'utf8'), ctx, { filename: 'lame.min.js' });
    const enc = new ctx.lamejs.Mp3Encoder(1, RATE, KBPS), parts = [];
    for (let i = 0; i < samples.length; i += 1152) {
        const b = enc.encodeBuffer(samples.subarray(i, i + 1152));
        if (b.length) parts.push(Buffer.from(b.buffer, b.byteOffset, b.length));
    }
    const e = enc.flush();
    if (e.length) parts.push(Buffer.from(e.buffer, e.byteOffset, e.length));
    return Buffer.concat(parts);
}
async function speak(text, lang) {
    const { default: init } = await import(url.pathToFileURL(path.join(dir, 'espeak-ng.mjs')).href);
    const m = await init(), w = new m.eSpeakNGWorker(), voice = voiceFor(lang, text);
    w.set_voice(voice);
    const chunks = [];
    let total = 0;
    w.synthesize(text, (samples) => { if (samples && samples.length) { chunks.push(Int16Array.from(samples)); total += samples.length; } return false; });
    if (!total) throw new Error('no speech from eSpeak NG (' + voice + ')');
    const pcm = new Int16Array(total);
    let o = 0;
    chunks.forEach((c) => { pcm.set(c, o); o += c.length; });
    return mp3(shape(pcm, w.samplerate));
}

if (require.main === module) {
    const lang = process.argv[2] || 'en', parts = [];
    process.stdin.on('data', (d) => parts.push(d));
    process.stdin.on('end', () => {
        const text = clean(Buffer.concat(parts).toString('utf8'));
        if (!text) { process.stderr.write('nothing to say\n'); process.exit(1); }
        speak(text, lang).then((out) => process.stdout.write(out, () => process.exit(0)))
            .catch((e) => { process.stderr.write(String(e && e.message || e).slice(0, 300) + '\n'); process.exit(1); });
    });
}
module.exports = { clean, voiceFor, shape };
