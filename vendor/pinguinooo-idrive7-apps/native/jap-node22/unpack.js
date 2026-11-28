'use strict';
/*
 * jap-node22's "activate" (mgu-deploy runs it with the unit's Node 8, as root, in this version's folder, for at most
 * 120 s, on every install of it): bin/node from node.xz. The 137 MB program is too big for a file on GitHub, so it
 * comes xz-packed, and mgu-python's lzma unpacks it (Node 8 has no xz). It must be byte for byte the program
 * RideTube's jap-node22 22.23.4 installs, or nothing is moved into place and the install fails (mgu-deploy then puts
 * back what was there). A bin/node already right is left as it is.
 *   node unpack.js        last stdout line: {"status": "..."}; exit 1 with the reason on stderr
 */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');

var SIZE = 137332600;
var SHA256 = '8aacb15e7d149fdbfa73f6ec91641dcd1c479eb62dca4a5db9cd8f70bd6df02e';
// /var/opt/jap-node22/versions/<version>/ -> /var/opt/mgu-python/current/bin/python3
var PYTHON = path.join(__dirname, '..', '..', '..', 'mgu-python', 'current', 'bin', 'python3');
var XZ = path.join(__dirname, 'node.xz');
var OUT = path.join(__dirname, 'bin', 'node');
var PART = OUT + '.partial';
// node.xz streamed into the file argv[2], at most 4 MiB of output at a time (the decoder needs 9 MiB)
var DECODE = [
    'import lzma, sys',
    'd = lzma.LZMADecompressor(lzma.FORMAT_XZ)',
    'with open(sys.argv[1], "rb") as i, open(sys.argv[2], "wb") as o:',
    '    while not d.eof:',
    '        b = i.read(1 << 20) if d.needs_input else b""',
    '        if d.needs_input and not b:',
    '            sys.exit("node.xz ends early")',
    '        o.write(d.decompress(b, 1 << 22))'
].join('\n');

function sizeOf(file) {
    try {
        return fs.statSync(file).size;
    } catch (e) {
        return -1;
    }
}

function sha256(file) {
    var h = crypto.createHash('sha256'), buf = Buffer.alloc(1 << 20), fd = fs.openSync(file, 'r'), n;
    try {
        while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
            h.update(buf.slice(0, n));
        }
    } finally {
        fs.closeSync(fd);
    }
    return h.digest('hex');
}

function right(file) {
    return sizeOf(file) === SIZE && sha256(file) === SHA256;
}

function fail(why) {
    try {
        fs.unlinkSync(PART);
    } catch (e) { /* not there */ }
    console.error(why);
    process.exit(1);
}

if (right(OUT)) {
    console.log(JSON.stringify({ status: 'bin/node is in place' }));
    process.exit(0);
}
try {
    fs.mkdirSync(path.dirname(OUT));
} catch (e) {
    if (e.code !== 'EEXIST') {
        fail('cannot make bin/: ' + e.message);
    }
}
var r = cp.spawnSync(PYTHON, ['-I', '-c', DECODE, XZ, PART], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (r.error || r.status !== 0) {
    fail('mgu-python did not unpack node.xz: ' + (r.error ? r.error.message : String(r.stderr).trim().split('\n').pop()));
}
if (!right(PART)) {
    fail('node.xz did not give the program jap-node22 22.23.4 ships (size or sha256 differ)');
}
fs.chmodSync(PART, 0o755);
fs.renameSync(PART, OUT);
console.log(JSON.stringify({ status: 'bin/node unpacked from node.xz, sha256 ' + SHA256.slice(0, 16) }));
