'use strict';
/**
 * RideTube Plus (apps/ridetube_plus): a RideTube fork with its own kit, listed by its own entry in mgu-repo.json.
 * What the Store needs to install it in the RideTube app's place: the id RideTube's service answers, a folder the
 * Store cannot build under another id, the version its build leaves, Store text without the video site's name.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ID = 'jap_ridetube';
const DIR = 'apps/ridetube_plus';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel));
const json = (rel) => JSON.parse(read(rel).toString('utf8'));
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const repo = json('mgu-repo.json');
const entry = (repo.components || []).filter((c) => c.id === ID)[0] || {};
const app = () => json(DIR + '/src/apps/' + ID + '/app.json');

module.exports = [
    ['its own component, out of the apps pattern', () => {
        ok(entry.kind === 'app' && typeof entry.path === 'string', 'mgu-repo.json needs a components entry for ' + ID);
        // a folder named for its id is built as <id>2 beside RideTube's own app, and jap-ridetube-d answers only jap_ridetube
        ok(entry.path.split('/').pop() !== ID, 'the folder must not be named ' + ID);
        ok(entry.path === DIR, 'path must be ' + DIR);
        ok(repo.apps.exclude.indexOf('ridetube_plus') >= 0, 'the apps pattern must exclude ridetube_plus');
    }],
    ['the manifest is the app the build makes', () => {
        const store = json(DIR + '/' + entry.manifest), a = app();
        ok(store.id === ID && a.id === ID, 'the manifest and the app.json id must be ' + ID);
        ok(store.version === a.version, 'the manifest\'s version ' + store.version + ' must be the app\'s ' + a.version);
        const b = entry.build || {};
        ok(b.python === DIR + '/src/kit/tools/build.py' && fs.existsSync(path.join(ROOT, b.python)), 'build.python must be the fork\'s build.py');
        ok(JSON.stringify(b.args) === '["{id}"]' && b.sdk === DIR + '/src/oap-sdk' && b.output === DIR + '/src/dist/{id}@{version}.tgz',
            'build args, sdk and output must be where the fork\'s build.py reads and writes');
    }],
    ['requires what RideTube\'s own catalog requires', () => {
        const svc = json(DIR + '/src/native/jap-ridetube-d/component.json');
        const r = entry.requires || {};
        ok(r['jap-ridetube-d'] === svc.version, 'requires jap-ridetube-d ' + svc.version + ', the service the fork was made with');
        ok(r['mgu-render'] === '0.6.11' && r['mgu-inputgate'] === '1.0.0', 'requires mgu-render 0.6.11 and mgu-inputgate 1.0.0');
    }],
    ['Store title, description and icon', () => {
        const store = json(DIR + '/' + entry.manifest);
        ok(store.title === 'RideTube Plus', 'title must be RideTube Plus');
        ok(!/you\s*tube/i.test([store.title, store.description, entry.title, entry.description].join(' ')),
            'the Store\'s title and description must not use the video site\'s name');
        const b = read(DIR + '/' + entry.icon);
        ok(b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' && b.readUInt32BE(16) === 140 && b.readUInt32BE(20) === 140 &&
            b.length <= 128 * 1024, 'the Store icon must be a 140x140 PNG of at most 128 KiB');
    }],
    ['loggingId apart, licence files kept', () => {
        const log = app().loggingId;
        fs.readdirSync(path.join(ROOT, 'apps')).filter((d) => fs.existsSync(path.join(ROOT, 'apps', d, 'app.json')))
            .forEach((d) => ok(json('apps/' + d + '/app.json').loggingId !== log, d + ' shares loggingId ' + log));
        ['src/LICENSE', 'src/THIRD_PARTY_LICENSES', 'src/kit/LICENSE', 'NOTICE']
            .forEach((f) => ok(fs.existsSync(path.join(ROOT, DIR, f)), DIR + '/' + f + ' is missing'));
    }]
];
