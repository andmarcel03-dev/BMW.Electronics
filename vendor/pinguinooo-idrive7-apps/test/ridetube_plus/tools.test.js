'use strict';
/**
 * RideTube Plus installs on its own: this repo lists its service (native/jap-ridetube-d) and Node.js 22
 * (native/jap-node22) as Store tools, and the Store installs an app's requirements first, from the app's own source.
 * Checked here: the requirement chain, the service byte for byte from the fork's tree, its two programs and Read
 * aloud's speech files pinned to the sources they were built from, node.xz unpacking (on this machine's python3, as
 * the car's mgu-python does) to the program RideTube's jap-node22 ships, and a repo small enough for the Store to
 * download whole.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const cp = require('child_process');
const sync = require('../../tools/ridetube-plus-sync.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel));
const json = (rel) => JSON.parse(read(rel).toString('utf8'));
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const SKIP = ['.git', 'node_modules', 'dist', 'oap-sdk', 'build', '__pycache__', 'car-day', '.DS_Store'];

// The service's two programs: RideTube's jap-ridetube-d 0.5.7 kit's (its catalog release asset, sha256 67d12652...),
// built at upstream 6e7209f; their sources are the same at fbd8953, the fork's base. A changed source needs a new build.
// Read aloud's files (service 0.5.80): tools/build_tts.sh's output (eSpeak NG and lamejs from their pinned npm tarballs),
// the same bytes as the fork's own 0.5.80 package (fork 2c13c6b).
const TTS = { source: 'apps/ridetube_plus/src/native/jap-ridetube-d/tools/build_tts.sh',
    tree: '940dd0c779aea4e3ba4998708dd68b49324b20c4223c7a3ab8beab23631badb5' };
const tts = (sha256) => Object.assign({ sha256 }, TTS);
const BUILT = {
    'native/jap-ridetube-d/ytdec': { sha256: '8c42bc7cd6f9b99f3523014bfcb7d50e387c3dc04ec440897a545784daee20c1',
        source: 'apps/ridetube_plus/src/native/ytdec', tree: '77d611f74b967767b3338efd7bd1d0701628bb66e57a82bfdc5bd32dbf089502' },
    'native/jap-ridetube-d/ytdlp.pyz': { sha256: '421315a930d6166ee8f4fb582d0e2d1d20281309f2ef162b6a79c7de0995c88b',
        source: 'apps/ridetube_plus/src/native/jap-ridetube-d/tools/build_pyz.sh',
        tree: 'ebd9ccadbd25003689cd5e33a78a0b3e2aa5469ec2c16ab3462001ab0436d358' },
    'native/jap-ridetube-d/tts/espeak-ng.mjs': tts('56a7dd76b923adb72c2807259e52ef56b10d36b1fe318c2fdfc9aceca94929cc'),
    'native/jap-ridetube-d/tts/espeak-ng.data': tts('4157e8bd793f10f0e963c4d68a1f878e94e937d7913d8a6de7d39ae09fa36f3a'),
    'native/jap-ridetube-d/tts/lame.min.js': tts('15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4'),
    'native/jap-ridetube-d/tts/COPYING.espeak-ng': tts('8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'),
    'native/jap-ridetube-d/tts/LICENSE.lamejs': tts('cd144ca132e3842b01f5ed2d6f3a32141e24a1cc15e115aa5f19a2294ce0a379'),
    'native/jap-ridetube-d/tts/VERSION': tts('fed6834d9ec8163138916e3b72b29f7036d500ce630747ed99e0ebd52ef2d961')
};
const NODE_XZ = '4785435b9844fbb278916e14d3169ce0d0e1847b3ba26ca8c17be50aa4f06c6c';
// RideTube's jap-node22 22.23.4 bin/node: nodejs.org unofficial-builds linux-x64-glibc-217, loader /lib/ld-linux-x86-64.so.2
const NODE = { size: 137332600, sha256: '8aacb15e7d149fdbfa73f6ec91641dcd1c479eb62dca4a5db9cd8f70bd6df02e' };
// the Store downloads a repo whole only up to 64 MiB (mgu-updater repo_max_bytes); a margin for the tar headers
const WHOLE_MAX = 60 * 1024 * 1024;

const repo = json('mgu-repo.json');
const entry = (id) => (repo.components || []).filter((c) => c.id === id)[0];
const manifest = (id) => json(entry(id).path + '/component.json');
const atLeast = (v, min) => {
    const a = String(v).split('.').map(Number), b = min.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return true;
};

// one digest of a file, or of a folder's files (path and sha256 of each, sorted), build outputs left out
function treeSha(rel) {
    const top = path.join(ROOT, rel);
    if (fs.statSync(top).isFile()) return sha(fs.readFileSync(top));
    const lines = [];
    (function walk(dir) {
        fs.readdirSync(dir).forEach((n) => {
            const p = path.join(dir, n);
            if (SKIP.indexOf(n) >= 0) return;
            if (fs.statSync(p).isDirectory()) walk(p);
            else lines.push(path.relative(top, p).split(path.sep).join('/') + ' ' + sha(fs.readFileSync(p)));
        });
    }(top));
    return sha(lines.sort().join('\n'));
}

function rmrf(p) {
    let st;
    try { st = fs.lstatSync(p); } catch (e) { return; }
    if (st.isDirectory()) fs.readdirSync(p).forEach((n) => rmrf(path.join(p, n)));
    if (st.isDirectory()) fs.rmdirSync(p); else fs.unlinkSync(p);
}

// a unit's /var/opt in a temporary folder: jap-node22's version folder with unpack.js and the given node.xz, and
// mgu-python's python3 (this machine's, which has lzma as mgu-python does); runs unpack.js there
function unpackIn(xz, again) {
    const py = cp.spawnSync('python3', ['-I', '-c', 'import lzma, sys; print(sys.executable)'], { encoding: 'utf8' });
    ok(py.status === 0 && py.stdout.trim(), 'needs python3 with lzma (the car\'s mgu-python has it): ' + (py.stderr || py.error));
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'jap-node22-'));
    const ver = path.join(t, 'var/opt/jap-node22/versions/22.23.4');
    const bin = path.join(t, 'var/opt/mgu-python/current/bin');
    [ver, bin].forEach((d) => d.split(path.sep).reduce((a, s) => {
        const p = a + s + path.sep;
        if (!fs.existsSync(p)) fs.mkdirSync(p);
        return p;
    }, ''));
    fs.symlinkSync(py.stdout.trim(), path.join(bin, 'python3'));
    fs.writeFileSync(path.join(ver, 'unpack.js'), read('native/jap-node22/unpack.js'));
    if (Buffer.isBuffer(xz)) fs.writeFileSync(path.join(ver, 'node.xz'), xz);
    else fs.symlinkSync(path.join(ROOT, xz), path.join(ver, 'node.xz'));
    const run = () => cp.spawnSync(process.execPath, ['unpack.js'], { cwd: ver, encoding: 'utf8' });
    return { t, ver, runs: again ? [run(), run()] : [run()] };
}

module.exports = [
    ['the service and Node 22 are tools of this repo, outside the app\'s folder', () => {
        const app = entry('jap_ridetube');
        ['jap-ridetube-d', 'jap-node22'].forEach((id) => {
            const e = entry(id) || {};
            ok(e.kind === 'tool' && e.path === 'native/' + id && e.build === undefined,
                'mgu-repo.json needs a tool entry for ' + id + ' at native/' + id + ', without a build');
            const c = manifest(id);
            ok(c.id === id && c.kind === 'tool' && c.build === undefined, e.path + '/component.json must be the tool ' + id);
            ok((e.path + '/').indexOf(app.path + '/') !== 0, id + ' must not sit in ' + app.path + ', or every install of the app downloads it');
        });
        const shared = app.build.shared;
        ok(Array.isArray(shared) && shared.length > 0 && shared.every((p) => (p + '/').indexOf(app.path + '/') === 0),
            'the app\'s build.shared must name only paths in ' + app.path + ', so the Store downloads that folder, not the whole repo');
        ok(JSON.stringify(repo.apps.build.shared) === '["kit"]',
            'the apps pattern\'s build.shared must be ["kit"], so an app downloads its folder and the kit, not the whole repo');
    }],
    ['each requirement is the version this repo ships', () => {
        const svc = manifest('jap-ridetube-d'), node = manifest('jap-node22');
        ok(entry('jap_ridetube').requires['jap-ridetube-d'] === svc.version,
            'RideTube Plus must require jap-ridetube-d ' + svc.version + ', the service in native/jap-ridetube-d');
        ok(svc.requires['jap-node22'] === node.version, 'jap-ridetube-d must require jap-node22 ' + node.version + ', the one in native/jap-node22');
        ok(atLeast(node.requires['mgu-deploy'], '0.7.0') && atLeast(node.requires['mgu-python'], '1.0.2'),
            'jap-node22 must require mgu-deploy 0.7.0 (activate) and mgu-python 1.0.2 (lzma)');
    }],
    ['the service is the fork tree\'s, byte for byte', () => {
        const p = sync.plan(ROOT);
        ok(read(sync.KIT + '/component.json').toString('utf8') === p.manifest,
            sync.KIT + '/component.json is not the tree\'s with local files (node tools/ridetube-plus-sync.js --write)');
        p.copies.forEach((c) => ok(read(c[0]).equals(read(c[1])), c[1] + ' differs from ' + c[0] + ' (node tools/ridetube-plus-sync.js --write)'));
        // GPL-3.0 (RideTube, eSpeak NG), BSD-3-Clause (jpeg-js), LGPL-3.0 (lamejs: its notice and the licence text)
        ['LICENSE', 'THIRD_PARTY_LICENSES', 'vendor/jpeg-js/LICENSE', 'tts/COPYING.espeak-ng', 'tts/LICENSE.lamejs', 'tts/COPYING.LESSER']
            .forEach((f) => ok(manifest('jap-ridetube-d').files.some((x) => x.path === f), 'the service kit must ship ' + f));
    }],
    ['the service\'s programs are builds of the sources in the tree', () => {
        const built = sync.plan(ROOT).built;
        ok(JSON.stringify(built) === JSON.stringify(Object.keys(BUILT)), 'the service builds ' + built.join(', ') + '; BUILT pins ' + Object.keys(BUILT).join(', '));
        built.forEach((f) => {
            ok(fs.existsSync(path.join(ROOT, f)), f + ' is missing: the service\'s build makes it (apps/ridetube_plus/README.md, "To update")');
            ok(sha(read(f)) === BUILT[f].sha256, f + ' is not the pinned build (BUILT in this file)');
            ok(treeSha(BUILT[f].source) === BUILT[f].tree, BUILT[f].source + ' changed since ' + path.basename(f) +
                ' was built: build it again (apps/ridetube_plus/README.md, "To update") and pin the new one here');
        });
    }],
    ['Node 22: node.xz unpacks to the program jap-node22 22.23.4 ships, or nothing is installed', () => {
        const c = manifest('jap-node22');
        ok(sha(read('native/jap-node22/node.xz')) === NODE_XZ, 'native/jap-node22/node.xz is not the pinned one');
        ok(JSON.stringify(c.activate) === '["node","unpack.js"]' && JSON.stringify(c.check) === '["check.sh"]',
            'jap-node22 must unpack in activate (node unpack.js) and run check.sh after');
        ok(['node.xz', 'unpack.js', 'check.sh', 'LICENSE'].every((f) => c.files.some((x) => x.path === f)) &&
            c.files.filter((x) => x.path === 'check.sh')[0].mode === '0755', 'jap-node22 ships node.xz, unpack.js, check.sh (0755) and LICENSE');
        const src = read('native/jap-node22/unpack.js').toString('utf8');
        ok(src.indexOf('var SIZE = ' + NODE.size + ';') >= 0 && src.indexOf('var SHA256 = \'' + NODE.sha256 + '\';') >= 0,
            'unpack.js must check for the size and sha256 of jap-node22 22.23.4\'s bin/node');
        const good = unpackIn('native/jap-node22/node.xz', true);
        try {
            const r = good.runs[0], out = path.join(good.ver, 'bin', 'node');
            ok(r.status === 0 && /^\{"status":"bin\/node unpacked/.test(r.stdout.trim().split('\n').pop()), 'unpack.js failed: ' + r.stderr);
            ok(fs.statSync(out).size === NODE.size && sha(fs.readFileSync(out)) === NODE.sha256 && (fs.statSync(out).mode & 0o777) === 0o755,
                'bin/node is not jap-node22 22.23.4\'s program, mode 0755');
            ok(good.runs[1].status === 0 && /in place/.test(good.runs[1].stdout), 'a second activate must leave bin/node as it is');
        } finally {
            rmrf(good.t);
        }
        // a cut node.xz, and one of something else: exit 1, nothing left in bin/
        const cut = unpackIn(read('native/jap-node22/node.xz').slice(0, 1 << 20));
        const other = unpackIn(cp.spawnSync('python3', ['-I', '-c', 'import lzma, sys; sys.stdout.buffer.write(lzma.compress(b"not node" * 99))']).stdout);
        try {
            [[cut, 'ends early'], [other, 'did not give the program']].forEach((x) => {
                const r = x[0].runs[0], bin = path.join(x[0].ver, 'bin');
                ok(r.status === 1 && r.stderr.indexOf(x[1]) >= 0, 'a bad node.xz must fail with "' + x[1] + '": ' + r.status + ' ' + r.stderr);
                ok(!fs.existsSync(bin) || fs.readdirSync(bin).length === 0, 'a bad node.xz must leave nothing in bin/');
            });
        } finally {
            rmrf(cut.t);
            rmrf(other.t);
        }
    }],
    ['the repo stays small enough for the Store to download whole', () => {
        const bufs = [];
        (function walk(rel) {
            fs.readdirSync(path.join(ROOT, rel)).sort().forEach((n) => {
                const r = rel ? rel + '/' + n : n;
                if (SKIP.indexOf(n) >= 0 || /\.(pyc|mgu|tgz)$/.test(n)) return;
                if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r);
                else bufs.push(read(r));
            });
        }(''));
        const packed = zlib.gzipSync(Buffer.concat(bufs)).length;
        ok(packed <= WHOLE_MAX, 'the repo packs to ' + (packed / 1048576).toFixed(1) + ' MiB; the Store downloads a repo whole only up to ' +
            '64 MiB (an install falls back to that), so keep it under 60');
    }]
];
