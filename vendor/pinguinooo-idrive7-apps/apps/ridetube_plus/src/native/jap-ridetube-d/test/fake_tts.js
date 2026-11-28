#!/usr/bin/env node
'use strict';
// stands in for tts.js in test_ytd.js: argv = [log, lang], the text on stdin; an "MP3" (frame sync, then zeros) on
// stdout: 16000 bytes (2 s at 64 kbps), 800 for a text starting SHORT; FAIL fails, HANG never ends, JUNK is no MP3.
const fs = require('fs');
const log = process.argv[2], lang = process.argv[3], parts = [];
process.stdin.on('data', (d) => parts.push(d));
process.stdin.on('end', () => {
    const text = Buffer.concat(parts).toString('utf8');
    fs.appendFileSync(log, JSON.stringify({ text: text, lang: lang, cwd: process.cwd() }) + '\n');
    if (/^FAIL/.test(text)) { process.stderr.write('no voice\n'); process.exit(1); }
    if (/^HANG/.test(text)) { setInterval(() => {}, 1000); return; }
    const out = Buffer.alloc(/^SHORT/.test(text) ? 800 : 16000);
    if (!/^JUNK/.test(text)) { out[0] = 0xff; out[1] = 0xfb; }
    process.stdout.write(out);
});
