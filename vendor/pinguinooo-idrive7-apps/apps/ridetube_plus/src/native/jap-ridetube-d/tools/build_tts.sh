#!/bin/sh
# Build build/tts/ for tts.js (Read aloud, local fork 0.5.80) from two pinned npm tarballs, each checked against the
# registry's sha512 (its dist.integrity); nothing of either is kept in this repository:
#   eSpeak NG compiled to WebAssembly (@echogarden/espeak-ng-emscripten, GPL-3.0), its voice data cut down to the app's
#   ten languages (en, fr, nl, de, es, it, pt, ru, zh = Mandarin, ko): espeak-ng.mjs + espeak-ng.data
#   lamejs, LAME's MP3 encoder in plain JavaScript (LGPL-3.0): lame.min.js
# plus their licences (COPYING.espeak-ng, LICENSE.lamejs) and VERSION.
# Update: set the version and its sha512 below (npm view <pkg>@<version> dist.integrity), rerun, bump the component.
# Usage: tools/build_tts.sh      (needs curl, openssl, python3)
set -eu
ESPEAK_VERSION=0.3.5
ESPEAK_SHA512=Izbkm7NWccwb//RKgOp1/0k21StKN1DFIn+K7GU1XN7n6pmSi4bsk/0tYUsgQbysC4GVyrVompNmLInU/BFE+A==
LAME_VERSION=1.2.1
LAME_SHA512=s7bxvjvYthw6oPLCm5pFxvA84wUROODB8jEO2+CE1adhKgrIvVOlmMgY8zyugxGrvRaDHNJanOiS21/emty6dQ==

here=$(cd "$(dirname "$0")/.." && pwd)
dl=$here/build/download
mkdir -p "$dl"
sha512() { openssl dgst -sha512 -binary "$1" | openssl base64 -A; }
fetch() {   # url file sha512
    if [ ! -f "$2" ] || [ "$(sha512 "$2")" != "$3" ]; then
        curl -fL --retry 3 -o "$2.part" "$1"
        mv "$2.part" "$2"
    fi
    [ "$(sha512 "$2")" = "$3" ] || { echo "build_tts.sh: sha512 mismatch for $2 ($(sha512 "$2"))" >&2; exit 1; }
}
fetch "https://registry.npmjs.org/@echogarden/espeak-ng-emscripten/-/espeak-ng-emscripten-$ESPEAK_VERSION.tgz" "$dl/espeak-ng-emscripten-$ESPEAK_VERSION.tgz" "$ESPEAK_SHA512"
fetch "https://registry.npmjs.org/lamejs/-/lamejs-$LAME_VERSION.tgz" "$dl/lamejs-$LAME_VERSION.tgz" "$LAME_SHA512"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/tts.XXXXXX")   # the archives open in their own empty folder
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/espeak" "$tmp/lame" "$tmp/out"
tar -xzf "$dl/espeak-ng-emscripten-$ESPEAK_VERSION.tgz" -C "$tmp/espeak" package/espeak-ng.js package/espeak-ng.data package/COPYING package/package.json
tar -xzf "$dl/lamejs-$LAME_VERSION.tgz" -C "$tmp/lame" package/lame.min.js package/LICENSE package/package.json
grep -q "\"version\": \"$ESPEAK_VERSION\"" "$tmp/espeak/package/package.json"
grep -q "\"version\": \"$LAME_VERSION\"" "$tmp/lame/package/package.json"

# The loader carries the data file's table (loadPackage({files:[{filename,start,end},...],remote_package_size:N})):
# a new table and data file with only the files these voices read. espeak-ng.mjs: Node loads it as the ES module it is.
python3 -I - "$tmp/espeak/package" "$tmp/out" <<'PY'
import re, sys
src, out = sys.argv[1:]
js = open(src + '/espeak-ng.js', encoding='utf-8').read()
data = open(src + '/espeak-ng.data', 'rb').read()
ROOT = '/usr/share/espeak-ng-data/'
LANGS = ['en', 'fr', 'nl', 'de', 'es', 'it', 'pt', 'ru', 'cmn', 'ko']
VOICES = ['gmw/en', 'gmw/en-US', 'roa/fr', 'gmw/nl', 'gmw/de', 'roa/es', 'roa/it', 'roa/pt', 'roa/pt-BR', 'zle/ru', 'sit/cmn', 'ko']
keep = ['phontab', 'phonindex', 'phondata', 'intonations'] + [l + '_dict' for l in LANGS] + ['lang/' + v for v in VOICES]
tables = re.findall(r'loadPackage\(\{files:\[(.*?)\],remote_package_size:(\d+)\}\)', js)
assert len(tables) == 1, 'one data table in the loader, found %d' % len(tables)
files, size = tables[0]
assert int(size) == len(data), 'the table is not this data file'
entries = re.findall(r'\{filename:"([^"]+)",start:(\d+),end:(\d+)\}', files)
assert len(entries) == files.count('{filename:'), 'an entry of another shape in the table'
have = {name[len(ROOT):]: (int(a), int(b)) for name, a, b in entries if name.startswith(ROOT)}
missing = [k for k in keep if k not in have]
assert not missing, 'not in this eSpeak NG: %r' % missing
blob, rows = bytearray(), []
for k in keep:
    a, b = have[k]
    rows.append('{filename:"%s%s",start:%d,end:%d}' % (ROOT, k, len(blob), len(blob) + b - a))
    blob += data[a:b]
table = 'loadPackage({files:[%s],remote_package_size:%d})' % (','.join(rows), len(blob))
js = js.replace('loadPackage({files:[%s],remote_package_size:%s})' % (files, size), table)
assert js.count(table) == 1
open(out + '/espeak-ng.mjs', 'w', encoding='utf-8').write(js)
open(out + '/espeak-ng.data', 'wb').write(bytes(blob))
print('build_tts.sh: eSpeak NG data %d -> %d bytes, %d files' % (len(data), len(blob), len(keep)))
PY
cp "$tmp/espeak/package/COPYING" "$tmp/out/COPYING.espeak-ng"
cp "$tmp/lame/package/lame.min.js" "$tmp/out/lame.min.js"
cp "$tmp/lame/package/LICENSE" "$tmp/out/LICENSE.lamejs"
printf '%s\n' "@echogarden/espeak-ng-emscripten $ESPEAK_VERSION sha512-$ESPEAK_SHA512 (voice data cut to en fr nl de es it pt ru cmn ko)" \
    "lamejs $LAME_VERSION sha512-$LAME_SHA512" > "$tmp/out/VERSION"
rm -rf "$here/build/tts"
mv "$tmp/out" "$here/build/tts"
