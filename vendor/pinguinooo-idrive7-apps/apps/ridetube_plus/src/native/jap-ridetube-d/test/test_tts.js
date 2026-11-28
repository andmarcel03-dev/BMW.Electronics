'use strict';
// node test/test_tts.js (Node 22+, as the car's jap-node22): tts.js's text, voice and audio shaping (Read aloud, local
// fork 0.5.80); with build/tts (tools/build_tts.sh), real speech in each of the ten languages from a copy laid out as on
// the car (tts.js beside tts/), each an MP3 the car's player takes: MPEG-1 Layer III, 64 kbps, 44.1 kHz, mono.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { clean, voiceFor, shape } = require('../tts.js');

const results = [];
const t = (name, fn) => { try { fn(); results.push('ok   ' + name); } catch (e) { results.push('FAIL ' + name + '\n' + (e.stack || e)); } };

t('clean: emoji and markup out, separators as pauses, spaces folded, 300 characters at most', () => {
    assert.strictEqual(clean('Never Gonna Give You Up 🎵 | Rick Astley'), 'Never Gonna Give You Up, Rick Astley');
    assert.strictEqual(clean('<b>Tom</b> & Jerry #shorts'), 'b Tom /b & Jerry shorts', '& stays: eSpeak NG says "and"');
    assert.strictEqual(clean(' | a\nb\tc • '), 'a b c');
    assert.strictEqual(clean('x'.repeat(400)).length, 300);
    assert.strictEqual(clean('🎵🎶❤️'), '');
});
t('voiceFor: the app\'s language, unless most letters are Hangul, Han or Cyrillic; Japanese: the app\'s', () => {
    assert.strictEqual(voiceFor('en', 'Hello'), 'en-us');
    assert.strictEqual(voiceFor('de', 'Hallo'), 'de');
    assert.strictEqual(voiceFor('zh', 'Hello'), 'cmn');
    assert.strictEqual(voiceFor('en', 'Как собрать компьютер'), 'ru');
    assert.strictEqual(voiceFor('en', '这是朗读测试'), 'cmn');
    assert.strictEqual(voiceFor('en', '방탄소년단 다이너마이트'), 'ko');
    assert.strictEqual(voiceFor('fr', 'BTS (방탄) Dynamite Official MV'), 'fr', 'mostly Latin');
    assert.strictEqual(voiceFor('en', 'ドライブの動画'), 'en-us', 'no Japanese voice');
    assert.strictEqual(voiceFor('xx', 'Hello'), 'en-us');
    assert.strictEqual(voiceFor(undefined, 'Hello'), 'en-us');
});
t('shape: 22050 Hz to 44100 Hz, the peak at 90 %, 0.25 s of silence before and 0.35 s after; near silence not blown up', () => {
    const pcm = new Int16Array(22050).map((_, i) => Math.round(8000 * Math.sin(i / 10)));
    const out = shape(pcm, 22050);
    assert.strictEqual(out.length, 11025 + 44100 + 15435);
    let peak = 0;
    out.forEach((v) => { peak = Math.max(peak, Math.abs(v)); });
    assert.ok(Math.abs(peak - 0.9 * 32767) < 400, String(peak));
    assert.ok(out.slice(0, 11025).every((v) => v === 0) && out.slice(-15435).every((v) => v === 0));
    assert.ok(Math.max(...shape(new Int16Array(100).fill(10), 22050)) <= 40, 'at most 4x');
});

const dir = path.join(__dirname, '..', 'build', 'tts');
if (!fs.existsSync(path.join(dir, 'espeak-ng.data'))) results.push('skip real speech: no build/tts (tools/build_tts.sh)');
else {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
    fs.copyFileSync(path.join(__dirname, '..', 'tts.js'), path.join(stage, 'tts.js'));
    fs.symlinkSync(dir, path.join(stage, 'tts'));
    const say = (lang, text) => cp.spawnSync(process.execPath, [path.join(stage, 'tts.js'), lang], { input: text, cwd: '/', maxBuffer: 4 << 20 });
    [['en', 'Never Gonna Give You Up'], ['fr', 'Comment changer une roue'], ['nl', 'De snelste auto'], ['de', 'Alle Funktionen erklärt'],
        ['es', 'Las mejores carreteras'], ['it', 'La storia della Ferrari'], ['pt', 'Como dirigir na neve'], ['ru', 'Как собрать компьютер'],
        ['zh', '新能源汽车评测'], ['ko', '다이너마이트 공식 뮤직비디오']].forEach(([lang, text]) => t('real speech: ' + lang, () => {
        const r = say(lang, text), b = r.stdout;
        assert.strictEqual(r.status, 0, String(r.stderr));
        assert.ok(b.length > 8000 && b.length < 200000, String(b.length));   // 1 to 25 s at 64 kbps
        assert.deepStrictEqual([b[0], b[1], b[2] >> 4, (b[2] >> 2) & 3, b[3] >> 6], [0xff, 0xfb, 5, 0, 3], 'MPEG-1 Layer III, 64 kbps, 44.1 kHz, mono');
    }));
    t('real speech: nothing to say: exit 1', () => {
        const r = say('en', ' 🎵 | ');
        assert.strictEqual(r.status, 1);
        assert.ok(/nothing to say/.test(r.stderr), String(r.stderr));
    });
    fs.rmSync(stage, { recursive: true, force: true });
}
console.log(results.join('\n'));
process.exit(results.some((r) => r.indexOf('FAIL') === 0) ? 1 : 0);
