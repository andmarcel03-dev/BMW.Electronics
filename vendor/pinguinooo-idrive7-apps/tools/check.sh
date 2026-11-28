#!/usr/bin/env bash
# Self-check of every app in apps/ (and the kit): Node 8 syntax, the pinned cluster-render client, then the unit tests.
# NODE=/path/to/node8 tools/check.sh   (the car runs Node 8; a newer node still runs it but proves less)
# Nothing to register for a new app: apps/* and test/<id>/ are found by listing.
set -euo pipefail
cd "$(dirname "$0")/.."
NODE=${NODE:-node}
CR_SHA=3b88e1898da6e2dd4c00b9dda816cbe242edde102fab7fc4dc3cb881d6c369d9  # idrive-apps@793da1e

ver=$("$NODE" --version)
echo "node $ver"
case "$ver" in v8.*) ;; *) echo "warning: not Node 8, the syntax check proves less than on the car" >&2 ;; esac

syntax() { local n=0 f; for f in "$@"; do "$NODE" --check "$f"; n=$((n+1)); done; echo "syntax ok: $n files ($label)"; }

label=kit; syntax kit/runtime/*.js
for app in apps/*/; do
  id=$(basename "$app")
  [ -f "$app/app.json" ] || continue
  files=("$app"*.js)
  # a built package in dist/<id>/ (what the car runs) is checked too
  if [ -d "dist/$id/source/javascript" ]; then
    while IFS= read -r f; do files+=("$f"); done < <(find "dist/$id/source/javascript" -name '*.js' | sort)
  fi
  label=$id; syntax "${files[@]}"
  f="$app"cluster_render_client.js
  if [ -f "$f" ]; then
    if command -v sha256sum >/dev/null; then sum=$(sha256sum "$f"); else sum=$(shasum -a 256 "$f"); fi
    [ "${sum%% *}" = "$CR_SHA" ] || { echo "$f does not match idrive-apps@793da1e" >&2; exit 1; }
    echo "$id: cluster_render_client.js matches idrive-apps@793da1e"
  fi
done
# an app built by its own kit (apps/<folder>/src: its kit/ and apps/<id>/, a components entry in mgu-repo.json):
# the kit runtime and app files its build.py ships
for src in apps/*/src/; do
  [ -d "${src}kit/runtime" ] || continue
  label=${src%/}; syntax "${src}"kit/runtime/*.js "${src}"apps/*/*.js
done
# the Store tools in native/: the javascript the car runs on its Node 8 (thumb.js, tts.js, tts/ and vendor/ run on jap-node22)
files=()
for f in native/*/*.js; do case "$f" in */thumb.js|*/tts.js) ;; *) files+=("$f") ;; esac; done
if [ ${#files[@]} -gt 0 ]; then label=native; syntax "${files[@]}"; fi

"$NODE" test/run.js
