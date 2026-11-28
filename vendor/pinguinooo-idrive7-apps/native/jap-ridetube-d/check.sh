#!/bin/sh
# mgu-deploy "check": yt-dlp loads from ytdlp.pyz in mgu-python, node22 loads the JPEG decoder, and tts.js (Read aloud,
# this local fork) speaks a word into an MP3 with the eSpeak NG it ships; offline on purpose.
set -eu
d=$(cd "$(dirname "$0")" && pwd)
/var/opt/mgu-python/current/bin/python3 -I -c "import sys;sys.path.insert(0,'$d/ytdlp.pyz');import yt_dlp,yt_dlp_ejs"
/var/opt/jap-node22/current/bin/node -e "require('$d/vendor/jpeg-js/decoder.js');require('$d/thumb.js')"
n=$(echo ok | /var/opt/jap-node22/current/bin/node "$d/tts.js" en | wc -c | tr -d ' ')
[ "$n" -gt 1000 ] || { echo "check.sh: tts.js gave $n bytes, no speech" >&2; exit 1; }
