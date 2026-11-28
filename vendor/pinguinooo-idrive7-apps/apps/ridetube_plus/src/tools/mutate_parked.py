#!/usr/bin/env python3
# Added 2026-11-27 in a local fork of RideTube: README.md, This fork.
"""Deliberate breaks of the picture rule; each must make its test fail with an assertion (a crash or a timeout counts
   as missed). Never edits the repo: every mutant runs in its own temporary copy.
   python3 tools/mutate_parked.py .         the parked gate (kit/runtime/parked.js, Picture while driving off) against
                                            kit/tools/test_parked.js
   python3 tools/mutate_parked.py . --app   the app's side (Picture and Typing while driving: the settings, their defaults,
                                            the migration, the off mode, every keyboard; Read aloud: off by default, the
                                            tile's two presses, its buttons) against kit/tools/test_ridetube.js;
                                            needs dist/jap_ridetube built
   python3 tools/mutate_parked.py . --say   the service's Read aloud (say / hush in native/jap-ridetube-d/ytd.js: the
                                            video paused and resumed, busy, the mic hold) against its test_ytd.js"""
import json, os, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
repo, app, say = os.path.abspath(sys.argv[1]), '--app' in sys.argv[2:], '--say' in sys.argv[2:]
DIST = 'dist/jap_ridetube/source/javascript/'
TWIN = {'apps/jap_ridetube/main.js': DIST + 'app.js', 'apps/jap_ridetube/yt.js': DIST + 'yt.js', 'kit/runtime/parked.js': DIST + 'kit/parked.js'}
PARKED = [
    ('no selector rule (speed only)', "return speed > 0 || !inP(stage, sel);", "return speed > 0;"),
    ('speed threshold back to 3 km/h', "return speed > 0 || !inP(stage, sel);", "return speed > MAX_KMH || !inP(stage, sel);"),
    ('moving does not forget the selector', "if (park && speed > 0) forget();", ""),
    ('no stale window', "if (speed === null || (strict && now() - at > staleMs)) return strict;", "if (speed === null) return strict;"),
    ('lost provider ignored', "if (lost()) return true;", ""),
    ('loss does not forget', "else if (answered && a === false) { answered = false; forget();", "else if (answered && a === false) { answered = false;"),
    ('a P in either field wins (no disagreement check)', "&& [stage, sel].every((g) => g === 'P' || !opinion(g))", ""),
    ('NP counts as P', "n === 4 ? 'NP'", "n === 4 ? 'P'"),
    ('D wire number read as P', "1: 'P', 2: 'R', 3: 'N', 4: 'D'", "1: 'P', 2: 'R', 3: 'N', 4: 'P'"),
    ('subscription error ignored', "return !!(sub && sub.error);", "return false;"),
    ('park not strict', "strict = park || !!(opts && opts.strict)", "strict = !!(opts && opts.strict)"),
]
M, Y, K = 'apps/jap_ridetube/main.js', 'apps/jap_ridetube/yt.js', 'kit/runtime/parked.js'
APP = [
    ('app: the picture always', M, "const noVideo = drivingGate(parked, pictureDriving);", "const noVideo = () => false;"),
    ('app: P only always (0.6.70)', M, "const noVideo = drivingGate(parked, pictureDriving);", "const noVideo = () => parked.moving();"),
    ('gate: always allowed', Y, "return !on() && moving;", "return false;"),
    ('gate: P only always', Y, "return !on() && moving;", "return moving;"),
    ('gate: the parked rule not asked while on (a lost gear signal forgotten)', Y, "const moving = parked.moving(); return !on() && moving;", "return !on() && parked.moving();"),
    ('setting read inverted', M, "const pictureDriving = () => settings.get(PICTURE) !== false;", "const pictureDriving = () => settings.get(PICTURE) === false;"),
    ('default off', 'json', 'picture_driving', True),
    ('migration leaves broken values', Y, "BOOLS.filter((b) => typeof get(b[0]) !== 'boolean')", "[]"),
    ('migration turns a saved off on', Y, "typeof get(b[0]) !== 'boolean'", "get(b[0]) !== true"),
    ('migration never applied', M, "moves.forEach((w) => settings.set(w[0], w[1]));", ""),
    ('off: a red light shows the picture (speed only)', K, "return speed > 0 || !inP(stage, sel);", "return speed > 0;"),
    ('off: a lost speed signal keeps the picture', K, "if (speed === null || (strict && now() - at > staleMs)) return strict;", "if (speed === null) return strict;"),
    # Typing while driving (0.6.72): the same gate, its own setting
    ('typing: always allowed', M, "const noTyping = drivingGate(parked, typingDriving);", "const noTyping = () => false;"),
    ('typing: P only always (0.6.71)', M, "const noTyping = drivingGate(parked, typingDriving);", "const noTyping = () => parked.moving();"),
    ('typing follows the picture setting', M, "const noTyping = drivingGate(parked, typingDriving);", "const noTyping = drivingGate(parked, pictureDriving);"),
    ('typing setting read inverted', M, "const typingDriving = () => settings.get(TYPING) !== false;", "const typingDriving = () => settings.get(TYPING) === false;"),
    ('typing default off', 'json', 'typing_driving', True),
    ('migration leaves a broken typing value', Y, "[[PICTURE, true], [TYPING, true], [READ, false]]", "[[PICTURE, true], [READ, false]]"),
    ('migration makes a broken typing value off', Y, "[[PICTURE, true], [TYPING, true], [READ, false]]", "[[PICTURE, true], [TYPING, false], [READ, false]]"),
    ('typing: the search keyboard ungated', M, "            if (noTyping()) {\n                if (fromPage)", "            if (false) {\n                if (fromPage)"),
    ('typing: the channel keyboard ungated', M, "if (noTyping()) { flash(translate('Typing works only in P (Park)')); return; }", ""),
    ('typing: the Search tile asks the parked rule', M, "moving: () => noTyping(),", "moving: () => parked.moving(),"),
    # Read aloud (0.6.72, the service's cap say): off by default, never said unasked, two presses
    ('read aloud: default on', 'json', 'read_aloud', False),
    ('read aloud: the setting ignored (a press always says)', M, "if (!readAloud()) { playIt(); return; }", ""),
    ('read aloud: the first press plays', M, "sayArmed = { id: r.id, until: Date.now() + 12000 };", "playIt(); return;"),
    ('read aloud: the second press says again (never plays)', M, "if (sayArmed && sayArmed.id === r.id && Date.now() < sayArmed.until) { sayArmed = null; note = null; playIt(); return; }", ""),
    ('read aloud: an older service asked (no cap check)', M, "            if (!model.can('say')) {", "            if (false) {"),
    ('read aloud: Up next plays at once', M, "run(() => pressVideo(r, () => play(r.id, r, list)))", "run(() => play(r.id, r, list))"),
    ('read aloud: its button never stops it', M, "if (model.speaking) model.hush(); else model.speak(model.title, getLanguage());", "model.speak(model.title, getLanguage());"),
    ('migration leaves a broken read_aloud value', Y, "[[PICTURE, true], [TYPING, true], [READ, false]]", "[[PICTURE, true], [TYPING, true]]"),
    ('migration makes a broken read_aloud value on', Y, "[[PICTURE, true], [TYPING, true], [READ, false]]", "[[PICTURE, true], [TYPING, true], [READ, true]]"),
]
D = 'native/jap-ridetube-d/ytd.js'
SAY = [
    ('say: the video not paused for it', "    if (this.state === 'playing') {\n        s.resume = true;", "    if (false) {\n        s.resume = true;"),
    ('say: never resumed after', "    return s.resume && this.state === 'paused' ? this.resume() : undefined;", "    return undefined;"),
    ('say: the app\'s pause resumed after it', "case 'pause': if (this.speech) this.hush('pause', false);", "case 'pause': if (this.speech) this.hush('pause');"),
    ('say: a video paused by the user resumed after it', "s = { n: ++this.sayN, resume: !!(old && old.resume) };", "s = { n: ++this.sayN, resume: true };"),
    ('say: the clip\'s STOP taken as the video\'s', "    if (this.speech && this.speech.clip) return this.sayEvent(this.speech, 'state', v);\n", ""),
    ('say: no timer (a clip the player never stops never ends)', "    s.timer = setTimeout(() => this.guard(() => this.sayDone(s, 'done', 'said (' + ms + ' ms, no STOP)')), ms + this.opts.sayGraceMs);", "    s.timer = true;"),
    ('say: the clip on the stopped player\'s connection', "await this.audio.release();   // the stopped player ignores playFile (car, 2026-11-03): a new connection, as resume's", "// (no new connection)"),
    ('say: speaks while the mic is held', "        this.recovering || !!this.micHeld;", "        this.recovering;"),
    ('say: the mic hold does not cut it off', "    if (this.speech) {   // Read aloud speaking: cut off", "    if (false) {   // Read aloud speaking: cut off"),
    ('say: hush does nothing', "    case 'hush': return this.hush('hush');", "    case 'hush': return undefined;"),
    ('say: a play does not drop it', "    this.sayDrop('stop ' + (reason || 'for a play'));", ""),
    ('say: the cap without the helper', "this.canSay() ? ['say'] : []", "['say']"),
]


def copy(d, parts):
    for p in parts:
        shutil.copytree(os.path.join(repo, p), os.path.join(d, p), symlinks=True)


def edit(d, rel, old, new):
    p = os.path.join(d, rel)
    s = open(p, encoding='utf-8').read()
    assert s.count(old) == 1, ('anchor', rel, old)
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))


def default_flip(d, key, was):
    for rel in ('apps/jap_ridetube/app.json', DIST + 'kit/app-spec.json'):
        p = os.path.join(d, rel)
        j = json.load(open(p, encoding='utf-8'))
        hit = [s for s in j['settings'] if s['key'] == key]
        assert len(hit) == 1 and hit[0]['default'] is was, ('default anchor', rel, key)
        hit[0]['default'] = not was
        json.dump(j, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def run(name, prepare, test, timeout):
    d = tempfile.mkdtemp(prefix='mut-picture-')
    try:
        prepare(d)
        try:
            r = subprocess.run(['node', os.path.join(d, test)], capture_output=True, text=True, timeout=timeout, cwd=d)
            out = (r.stdout + r.stderr).strip().splitlines()
            hit = r.returncode != 0 and any('AssertionError' in l for l in out)
            why = next((l.strip() for l in out if 'AssertionError' in l or 'message' in l), out[-1] if out else '')
        except subprocess.TimeoutExpired:
            hit, why = False, 'timed out (inconclusive)'
        return hit, ('CAUGHT ' if hit else 'MISSED ') + name + ' :: ' + why[:200]
    finally:
        shutil.rmtree(d, ignore_errors=True)


if say:
    src = open(os.path.join(repo, D), encoding='utf-8').read()
    jobs = []
    for name, old, new in SAY:
        assert src.count(old) == 1, ('anchor', name)
        jobs.append((name, lambda d, o=old, n=new: (shutil.copytree(os.path.join(repo, 'native/jap-ridetube-d'), os.path.join(d, 'native/jap-ridetube-d'),
                                                                    symlinks=True, ignore=shutil.ignore_patterns('build', 'dist')), edit(d, D, o, n)),
                     'native/jap-ridetube-d/test/test_ytd.js', 900))   # (a broken audio path slows the rest: 406 s seen)
    workers = 3
elif not app:
    src = open(os.path.join(repo, K), encoding='utf-8').read()
    jobs = []
    for name, old, new in PARKED:
        assert src.count(old) == 1, ('anchor', name)
        jobs.append((name, lambda d, o=old, n=new: (copy(d, ['kit']), edit(d, K, o, n)), 'kit/tools/test_parked.js', 60))
    workers = 1
else:
    if not os.path.exists(os.path.join(repo, DIST + 'app.js')):
        sys.exit('dist/jap_ridetube is not built: python3 kit/tools/build.py jap_ridetube first')
    for rel, twin in TWIN.items():     # the built copies are the sources as they are (an English build copies them)
        assert open(os.path.join(repo, rel), 'rb').read() == open(os.path.join(repo, twin), 'rb').read(), ('stale build', twin)
    jobs = []
    for name, rel, old, new in APP:
        # every anchor checked before the first mutant (a stale one would end the whole run after its 15 minutes)
        assert rel == 'json' or open(os.path.join(repo, rel), encoding='utf-8').read().count(old) == 1, ('anchor', name)
        def prepare(d, rel=rel, old=old, new=new):
            copy(d, ['apps', 'kit', 'dist/jap_ridetube'])
            if rel == 'json':
                default_flip(d, old, new)
            else:
                edit(d, rel, old, new)
                edit(d, TWIN[rel], old, new)
        jobs.append((name, prepare, 'kit/tools/test_ridetube.js', 420))
    workers = 3
with ThreadPoolExecutor(workers) as ex:
    results = list(ex.map(lambda j: run(*j), jobs))
for hit, line in results:
    print(line)
caught = sum(1 for hit, _ in results if hit)
print('%d of %d mutants caught' % (caught, len(results)))
sys.exit(0 if caught == len(results) else 1)
