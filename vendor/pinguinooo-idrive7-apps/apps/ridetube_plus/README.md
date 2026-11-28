<img src="icon.png" width="70" alt="RideTube Plus icon">

# RideTube Plus for iDrive 7

Online video on the BMW iDrive 7 head unit (MGU), for the [mgu-store](https://github.com/robertnisipeanu/mgu-store):
a fork of [RideTube](https://github.com/JustAnotherPU/ridetube) 0.6.7 (GPL-3.0-or-later, see `NOTICE`) with these
changes:

- **Picture while driving**, a setting, on by default: the picture shows in every gear and at any speed. Off, it
  shows only in P at exactly 0 km/h with fresh gear and speed signals; anything else plays the sound with an
  audio-only view. Video the driver can see while moving is illegal in many places (New York: VAT 375(24)); the app
  does not decide that for you.
- **Typing while driving**, a setting, on by default: the keyboard for a search opens in every gear. Off, it opens
  only in P at 0 km/h, as before. Typing while driving is restricted in many places too.
- **Read aloud**, a setting, off by default: a video's first press says its title through the car's media player
  (a video playing pauses for it, then goes on), the second press plays it; the watch page and the audio-only view
  get a speaker button. The speech is made on the car by the RideTube service 0.5.80 this repo installs (eSpeak NG,
  ten languages); with an older service the app says once that Read aloud needs 0.5.80, and a press plays the video.
- A dark look the app draws itself: a top bar with search and the account, page chips, video cards, a watch page.
- A note when the car has no internet (from the Store's uplink); the page loads again once it is back.

Everything else is RideTube's: sign-in on the car, feeds, search, chapters, SponsorBlock, downloads, the sound
through the car's media player. RideTube's own README, with the fork's notes on top, is `src/README.md`.

## Status

Nothing of this fork has run on a car yet. It is tested in software only (`src/README.md`, "This fork", and the
parked test steps in `src/docs/CAR-DAY-SAFETY.md`).

## Install

One install, from this source alone; RideTube's own source is not needed.

1. Add this repo as a source (the repo's README, "Install an app").
2. Pick **RideTube Plus** (version 0.6.72), Install. The Store installs what it needs first, from this source:
   **Node.js 22** (`jap-node22`, unpacked on the unit as it installs), then the **RideTube service**
   (`jap-ridetube-d` 0.5.80), then the app, which the head unit builds from `src/` with its own oap-sdk. The
   renderer, the controller gate, `mgu-deploy` and `mgu-python` come from the Store's own and its default
   `cauliflowermossgrape/idrive7-apps` source, as for every app here (keep those sources).
3. If the Store shows the RideTube service as pending, restart the head unit (Store, Restart head unit): a new
   tool's service starts once the unit's restart list has it, which the unit reads when it starts.

**From 0.6.71:** the Store shows updates for RideTube Plus (0.6.71 to 0.6.72) and the RideTube service (0.5.8 to
0.5.80). Update RideTube Plus: the Store updates the service first (the app requires 0.5.80), then the app. The
service's install check, which now also speaks a word with the new speech files, runs at the head unit's next start;
if it fails there, 0.5.8 comes back and the app plays videos without Read aloud.

The Store lists it as RideTube Plus; on the car the app keeps the fork's own title and tile
(`src/apps/jap_ridetube/app.json` and `icon.png`). Updates come from this repo's `main` only. To uninstall
everything, sign out in the app first (`src/README.md`, "Uninstall"), then remove the app, `jap-ridetube-d` and
`jap-node22`.

## Beside RideTube

RideTube Plus keeps RideTube's ids: the app `jap_ridetube` (the only app id RideTube's service answers),
`jap-ridetube-d` and `jap-node22`. Ids are global on the car and the Store installs one component of an id at a
time, updated only from the source it came from, so the two can never run side by side (two services would fight
over `/run/jap-ridetube-d/ctl.sock` and the car's media player). With both sources added:

| Installed | What the Store does |
|---|---|
| nothing | installs all three from this source |
| RideTube (app, service, Node) | lists this source's three as `<id>@<this source>`, refused: `jap_ridetube is already installed from ...` |
| RideTube's service 0.5.7, its app removed | refuses RideTube Plus: `needs jap-ridetube-d 0.5.80 or newer, which no source has` (only the service's own source may update it, and it has 0.5.7). Remove the RideTube service, then install |
| RideTube's Node.js 22 only | installs the service and the app from here and uses that Node.js 22 (the same program) |
| RideTube Plus | lists RideTube's rows as `<id>@<RideTube's source>`, refused. Back to RideTube: remove RideTube Plus and its service, then install RideTube |

## What gets installed

| Part (repo path) | Version | What it is |
|---|---|---|
| `apps/ridetube_plus/src` (the app) | 0.6.72 | the fork at `0b3738f` (`NOTICE`) |
| `native/jap-ridetube-d` | 0.5.80 | the fork's service: RideTube's 0.5.8 at upstream `fbd8953` with Read aloud added. Its files as the tree has them; its two programs (`ytdec`, `ytdlp.pyz`) from RideTube's published 0.5.7 kit, built from the same sources; `tts/` (eSpeak NG compiled to WebAssembly with voice data for the app's ten languages, and lamejs) as the fork's `tools/build_tts.sh` builds it, 12.4 MB. RideTube publishes service 0.5.7 |
| `native/jap-node22` | 22.23.4 | `bin/node` of RideTube's own jap-node22, byte for byte, packed as `node.xz` (the 137 MB program is over GitHub's 100 MB file limit); its `activate` unpacks it with mgu-python's lzma and checks the size and sha256 before it moves it into place |

A first install downloads about 56 MB from this repo, 69 MB at most (the app's folder 14 MB, the service's 23 MB,
Node's 32 MB); RideTube's own three come to 61 MB. The update from 0.6.71 reads the app's and the service's folders
again, 36 MB at most. The whole repo packs to 56 MiB; the Store reads a repo whole (when a folder read fails) only up
to 64 MiB, and `test/ridetube_plus` fails at 60.

## How this folder works

| Path | What |
|---|---|
| `src/` | the fork's whole tree, unchanged: its own app kit, the app (`src/apps/jap_ridetube`), RideTube's service, decoder and touch tool sources (`src/native`), its tests and tools |
| `store.json` | what the Store lists: id, version (always the same as `src/apps/jap_ridetube/app.json`), title, description |
| `icon.png` | the Store's icon (drawn from `kit/icons/ridetube_plus.svg`); the car's tile comes from `src/apps/jap_ridetube/icon.png` |
| `NOTICE` | licence, upstream credit and the commits this is made from |

`mgu-repo.json` lists it as a component of its own (the `apps/*` pattern excludes this folder): built by
`src/kit/tools/build.py jap_ridetube` with the oap-sdk the Store makes in `src/oap-sdk`, which leaves
`src/dist/jap_ridetube@<version>.tgz`; it requires `jap-ridetube-d` 0.5.80, `mgu-render` 0.6.11 and `mgu-inputgate`
1.0.0. Its `build.shared` names its own `src/`, so an install downloads this folder only, not the whole repo. The
folder is not named `jap_ridetube` on purpose: the Store builds an app whose folder is named for its id under
another id (`jap_ridetube2`) beside another source's app of that id, and the service refuses that one.

The service and Node.js 22 are two more `components`, tools at `native/jap-ridetube-d` and `native/jap-node22`
(outside this folder, so the app's install does not download them). A repo-tree tool has no build step: its folder
holds its `component.json` and every file it installs, and the Store packs them on the unit. The service's
`component.json` is `src/native/jap-ridetube-d/component.json` with each file's `from` set to the file's place in
the kit; `tools/ridetube-plus-sync.js` writes it and copies the files. `test/ridetube_plus` checks all of this,
and unpacks `node.xz` the way the unit does; `tools/check.sh` checks the app, its kit and the tools' Node 8 code
under Node 8. The fork's own tests (Node 18 or newer, Python 3.12, ffmpeg) are in `src/` (`src/README.md`, "Build and
test on a computer").

## To update

From the repo root, for a new fork commit (0.6.72, typing and Read aloud, came in this way):

1. `rm -rf apps/ridetube_plus/src && mkdir apps/ridetube_plus/src && git -C <fork> archive <commit> -- .
   ':(exclude)kit/tools/.font-cache' | tar -x -C apps/ridetube_plus/src`
2. Set `store.json`'s `version` to `src/apps/jap_ridetube/app.json`'s (a car updates an app only to a higher
   version), and put the new commit and what changed in `NOTICE`.
3. `node tools/ridetube-plus-sync.js --write`: the service kit follows the tree. If the fork changed the service
   (`src/native/jap-ridetube-d`), give it a new version in its `component.json` in the fork first, and set
   `mgu-repo.json`'s `jap-ridetube-d` requirement to it.
4. The sync lists the files the service's build makes that the kit lacks (`missing`), and `tools/check.sh` says when
   a source changed since its file was built (`src/native/ytdec`, `build_pyz.sh`, `build_tts.sh`). Build those again
   from a copy of `src/native`, so nothing lands in `src/`: `make target` in `ytdec/` (Docker); `sh tools/build_pyz.sh`
   (Python 3.12) and `sh tools/build_tts.sh` (curl, openssl, python3; it checks both npm tarballs by sha512) in
   `jap-ridetube-d/`. Copy `ytdec/build/target/ytdec`, `jap-ridetube-d/build/ytdlp.pyz` and
   `jap-ridetube-d/build/tts/*` (into `tts/`) to `native/jap-ridetube-d/`, and pin their sha256 and sources in
   `test/ridetube_plus/tools.test.js` (`BUILT`). The repo must stay under the size test (above).
5. `NODE=<node 8> tools/check.sh`, commit.

Node.js 22 changes only with RideTube's: when its `jap-ridetube-d` requires a newer `jap-node22`, take that kit's
`files/bin/node` (RideTube's or `JustAnotherPU/mgu-apps`' `catalog` release), pack it with
`xz -T1 --x86 --lzma2=preset=6e -c bin/node > native/jap-node22/node.xz` (XZ Utils 5.4.5 made this one), and set the
version, `SIZE` and `SHA256` in `native/jap-node22/unpack.js` and `check.sh`, and the pins in the test.
