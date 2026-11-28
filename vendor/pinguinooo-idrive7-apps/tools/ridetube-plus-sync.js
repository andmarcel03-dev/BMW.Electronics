'use strict';
/**
 * RideTube Plus's service as a Store tool (native/jap-ridetube-d) from the fork's tree (apps/ridetube_plus/src):
 * every file the service's component.json lists, copied as it is, and that component.json with each file's "from"
 * set to its own path in the kit (the Store packs a repo-tree tool only from files inside its folder). The two
 * programs the service's build makes, ytdec and ytdlp.pyz, are not in the tree; they stay as committed, and
 * test/ridetube_plus pins them to the sources they were built from.
 *   node tools/ridetube-plus-sync.js           lists what differs from the tree; exit 1 if anything does
 *   node tools/ridetube-plus-sync.js --write   copies the files and writes the component.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = 'apps/ridetube_plus/src/native/jap-ridetube-d';
const KIT = 'native/jap-ridetube-d';

/* What the kit is made of: copies [[repo path in the tree, repo path in the kit]], built (kit paths of the build's
 * programs) and manifest (the kit's component.json text). */
function plan(root) {
    const c = JSON.parse(fs.readFileSync(path.join(root || ROOT, SRC, 'component.json'), 'utf8'));
    const copies = [];
    const built = [];
    c.files.forEach((f) => {
        if (/^build\//.test(f.from)) {
            built.push(`${KIT}/${f.path}`);
        } else {
            copies.push([path.posix.normalize(`${SRC}/${f.from}`), `${KIT}/${f.path}`]);
        }
    });
    (c.units || []).forEach((u) => copies.push([`${SRC}/${u.from}`, `${KIT}/${u.from}`]));
    const kit = Object.assign({}, c, { files: c.files.map((f) => Object.assign({}, f, { from: f.path })) });
    return { copies, built, manifest: JSON.stringify(kit, null, 2) + '\n' };
}

function mkdirs(dir) {
    if (!fs.existsSync(dir)) {
        mkdirs(path.dirname(dir));
        fs.mkdirSync(dir);
    }
}

function readOrNull(file) {
    try {
        return fs.readFileSync(file);
    } catch (e) {
        return null;
    }
}

if (require.main === module) {
    const write = process.argv.indexOf('--write') >= 0;
    const p = plan();
    const differ = [];
    const put = (to, data, mode) => {
        const now = readOrNull(path.join(ROOT, to));
        if (now && now.equals(data)) {
            return;
        }
        differ.push(to);
        if (write) {
            mkdirs(path.dirname(path.join(ROOT, to)));
            fs.writeFileSync(path.join(ROOT, to), data);
            fs.chmodSync(path.join(ROOT, to), mode);
        }
    };
    p.copies.forEach((c) => put(c[1], fs.readFileSync(path.join(ROOT, c[0])), fs.statSync(path.join(ROOT, c[0])).mode & 0o777));
    put(`${KIT}/component.json`, Buffer.from(p.manifest), 0o644);
    const missing = p.built.filter((f) => !fs.existsSync(path.join(ROOT, f)));
    differ.forEach((f) => console.log(`${write ? 'wrote ' : 'differs'} ${f}`));
    missing.forEach((f) => console.log(`missing ${f}: the service's build makes it (${SRC}/build.sh), see apps/ridetube_plus/README.md`));
    console.log(differ.length || missing.length ? `${differ.length} ${write ? 'written' : 'differ'}, ${missing.length} missing` : 'in step with the tree');
    process.exit((differ.length && !write) || missing.length ? 1 : 0);
}

module.exports = { plan, SRC, KIT };
