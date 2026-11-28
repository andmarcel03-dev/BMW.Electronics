# Car day safety: YouTube (RideTube fork, jap_ridetube 0.6.72, service jap-ridetube-d 0.5.80)

The first install of this fork on the G01 X3 (iDrive 7). Parked the whole time, in P, about 30 minutes. Nothing in
this repo has touched the car yet (written 2026-11-27; Picture while driving, Typing while driving and Read aloud added the
same day). Tick each box on the day. Every step ends with its undo, so
stopping at any step leaves the car as it was before that step. Stop at the first step that does not pass and send
what it asks for.

## 0. Before the car

- [ ] Do this after the head-unit sleep bisect (S0 to S2 in `~/Documents/Projects/iDrive-Apps/docs/CAR-DAY-SAFETY.md`),
      so a new root service can't muddy that result.
- [ ] The app package: `car-day/jap_ridetube@0.6.72.tgz` in this folder, sha256
      `fd7548b916477e4caf4120674b1c90432b73b95d79cc2ba0d75770cdd7164165` (`shasum -a 256` to check). Copy it to a USB stick
      (FAT32 or exFAT) into a folder named `oap` at the stick's root: `oap/jap_ridetube@0.6.72.tgz`, nothing else in it
      (not an older 0.6.7x).
      It was built on claudius-vm with every test green but two upstream fetcher tests that fail the same way on the
      parent commit (`test_audio_flatten` and, online, `test_fetch_matches_old_pipeline`: the VM's ffmpeg reads the
      first audio packet's length as N/A). It ships without `node_modules/oap-sdk` on purpose: the car's deploy tool
      makes that from the car's own copy of BMW's SDK.
- [ ] Only for Read aloud (Step I, optional): the fork's service `car-day/jap-ridetube-d@0.5.80.tgz`, sha256
      `d16c96f0ac5cea7b92ceca6865a5754427434209e8f381ade062b9160e0f067b`. It stays on the laptop: Step I copies it over
      SSH. Not on the stick (the `oap/` folder takes apps only).
- [ ] Your phone's hotspot works.

## 1. Power, internet, crash-loop rules

- [ ] Engine running (or the battery charger on), P, parking brake on.
- [ ] Phone hotspot on. MGU Store > Settings > **Wi-Fi**: join it until the Store says `Online`.
- Never kill an app or MainApp process by hand: a hand kill counts as a crash.
- Restart only through the Store (Settings, Restart head unit), at most once, then wait 2 minutes.
- Never reinstall an app that crashed: remove it.
- Why: three MainApp deaths in about 33 s make the platform delete every app and its data.

## 2. Step A, the trivial one: upstream RideTube as it ships

This proves the service, the renderer and the sound on this car before the fork is involved.

- [ ] Store > Settings > **Add source** `JustAnotherPU/ridetube`, follow **Releases** (type only `owner/repo`).
- [ ] Install **RideTube** (0.6.7). The Store adds `jap-ridetube-d`, `jap-node22`, `mgu-python`, `mgu-render` 0.6.11+,
      `mgu-deploy` 0.7.0 and `mgu-inputgate` with it.
- [ ] Open RideTube > menu > **Health check**. Photo the rows.
- [ ] Search, play one video: picture on the screen, sound from the speakers. Close it (the player's Close).
- Undo: Store > RideTube > Remove (and the tools it added, if you stop here).

## 3. Step B: remove the upstream app only

- [ ] Store > RideTube > **Remove**. Keep `jap-ridetube-d` and `jap-node22`: the fork uses that same service.
- Why: app ids are global on the car and the fork keeps the id `jap_ridetube` (the service only answers that id), so
  the Store refuses the fork while upstream's app is installed ("jap_ridetube is already installed from ...").
- Undo: Store > RideTube > Install.

## 4. Step C: install the fork from the stick

- [ ] Plug the stick in. Within about 5 s the Store lists the stick (`usb:<label>/oap`) with **YouTube** 0.6.72.
- [ ] Install it. Expect the Store's line `prepared jap_ridetube 0.6.72: marked local-only, node_modules/oap-sdk generated
      from ...`. Every running app restarts once: normal for any app install.
- [ ] If the Store refuses it, photo the message and stop. Do not try it more than once.
- Undo: Store > YouTube > Remove, then Step B's undo.

## 5. Step D: open it

- [ ] Apps menu: a tile **YouTube** with a plain red triangle. Open it: the top bar (the red triangle and the word
      YouTube, the search box, the account circle), the chips (Home, Subscriptions, Watch later, Playlists, ...).
- [ ] The knob: turn it through the chips and the cards (the card it is on gets a white frame), push to play.
- [ ] Menu > **Health check**: the same rows as in Step A.
- Undo: none needed (Back leaves).

## 6. Step E: the picture and typing in P, N, D and R with the switches on, then once each off, foot on the brake

- [ ] The settings: the account circle (top right) opens the menu; at its end three lines ("Video the driver can see is
      illegal in many places (New York: VAT 375(24)).", "Typing while driving is restricted in many places too." and "The
      app does not decide that for you."), then the switches **Picture while driving (off: only in P)** and **Typing
      while driving (off: only in P)**, both ticked (on is the default), and **Read aloud: a video's first press reads
      its title, the second plays it**, unticked (off is the default). Photo them if any line is cut off.
- [ ] In P, play a video: the watch page shows the picture in its box within a few seconds, title and channel under
      it, Up next on the right.
- [ ] Shift to **N**: the picture stays, the sound plays on. Then **D**, standing (the red-light case): the picture stays.
      Then **R**: the camera takes the screen; once it lets go, the picture is there. Back to **P**.
- [ ] Once with it off: menu > untick **Picture while driving**, back to the video. In P the picture shows. Shift to
      **N**: within about a second the picture goes, the screen says "Audio only · not in Park", the sound plays on.
      Back to **P**: the picture comes back.
- [ ] If, with it off, the screen says "No gear signal from the car yet" while in P: shift P > N > P once. If it stays,
      this car does not give apps the gear: off, the picture never shows (the safe side); on, it does not matter. Send
      the app's log lines that start with `parked check:` and `picture while driving:`.
- [ ] Tick **Picture while driving** again (on is how you asked for it).
- [ ] Typing, the switch on: in **D**, standing, Search > **Type a search**: the keyboard opens. Type one letter, then
      cancel. Back to **P**.
- [ ] Once with it off: menu > untick **Typing while driving**. In **D**, standing: the Search page's tile says "Typing
      works only in P (Park)", a press opens no keyboard and says it again; Subscriptions > **Search channels** opens
      none either. Back to **P**: Type a search opens the keyboard. Cancel it.
- [ ] Tick **Typing while driving** again.
- [ ] Full screen: the corner button at the bottom right of the video box. Back: the arrow top left, or the button at
      the bottom right.
- Undo: the player's **Close**; the switch back to how you want it.

## 6a. Step I, optional: Read aloud (the fork's service 0.5.80, over SSH, parked in P)

Read aloud needs the service this fork builds (0.5.80: `say` and `hush`, eSpeak NG in jap-node22). Everything else in
this app works with the service the Store installed. Skip this whole step and nothing changes.

- [ ] Over SSH as root (as for Step H): note the service's version now,
      `/var/opt/mgu-deploy/mgu-deploy.sh status | grep jap-ridetube-d` (the Store's is 0.5.7 or 0.5.8).
- [ ] Copy the package: `scp car-day/jap-ridetube-d@0.5.80.tgz root@<car>:/tmp/`, then on the car
      `sha256sum /tmp/jap-ridetube-d@0.5.80.tgz` (the sha256 in section 0).
- [ ] Install in place: `/var/opt/mgu-deploy/mgu-deploy.sh install --artifact /tmp/jap-ridetube-d@0.5.80.tgz --other-source --yes`
      (`--other-source`: the Store's source installed the service). The tool's own check runs first (`check.sh`: yt-dlp
      loads, the JPEG decoder loads, and `tts.js` says "ok" into an MP3); it refuses the install if any fails, and the
      version before stays. Expect `jap-ridetube-d 0.5.80` installed and the service restarted. Send the output.
- [ ] By hand, still on the car: `echo "Read aloud test" | /var/opt/jap-node22/current/bin/node /var/opt/jap-ridetube-d/current/tts.js en | wc -c`
      prints a number over 10000 within about 5 s. Send the number and the time it took.
- [ ] In the app (close it and open it again, so it says hello to the new service): menu > tick **Read aloud**. On
      Home, press a video once: within a few seconds its title is spoken through the speakers and the page says
      "Press again to play". Press it again: it plays.
- [ ] While a video plays (watch page): the round speaker at the end of the title. Press it: the video pauses, its
      title is spoken, then the video goes on from where it was (no jump, the picture and sound in step). Press it
      again while it speaks: it stops and the video goes on.
- [ ] Turn the volume knob while it speaks: it changes like the video's sound. Send a short phone video of one
      title spoken and the video going on, and a photo of the media screen while it speaks (the clip has no tags, so
      it may show `say-<n>.mp3` there for those seconds).
- [ ] Untick **Read aloud** (or keep it, your choice): a press plays at once again.
- Undo: `/var/opt/mgu-deploy/mgu-deploy.sh rollback jap-ridetube-d --yes` (the kept version before), or Store >
  RideTube service > reinstall. The app needs nothing: with the old service it hides Read aloud and says it needs
  0.5.80 once.
- While 0.5.80 is installed the Store offers no newer upstream service: it compares versions as numbers and 0.5.80
  sorts above upstream's 0.5.9 to 0.5.79 (an upstream 0.6.x would still show). The undo puts upstream's back.
- Stop and roll back if: the title is never spoken, the video does not come back after it, the sound of the video
  comes back without its picture, or the service's Health check fails.

## 7. Step F: no internet

- [ ] Turn the phone's hotspot off. Within about 5 s: "No internet: connect the phone hotspot", with the Store's reason
      under it (a note on an empty page, a strip at the bottom over a page with videos).
- [ ] Hotspot back on: the note goes and the page loads again.
- Undo: hotspot on.

## 8. Step G: the Media menu, photos only

- [ ] With a video playing in P, open the iDrive **Media** menu. Photo the source list, the now-playing screen and the
      cluster.
- What to expect: the sound is the car's active entertainment source (BMW's own OAP media source) with the video's
      title and picture on the media screen and the cluster, as upstream and a community probe saw on their cars. Not
      seen on this car yet, and which name the source row shows is unknown: the photo answers both. There is no
      separate "YouTube" source row: iDrive 7 does not let apps register a new named source.
- Undo: none needed.

## 9. Step H, optional, read-only over SSH: BMW's own menu entry ids

Only for a later "YouTube" launcher inside the Media menu. Nothing changes on the car.

- [ ] `ls /usr/lib/oap-mainapp/preinstalled_apps/`, then for each folder there
      `grep -o '"insertion[A-Za-z]*" *: *[0-9]*' /usr/lib/oap-mainapp/preinstalled_apps/<folder>/rhmiData/application.json`.
      Save the output and send it.
- Never guess such an id: an app entry under a wrong one can crash MainApp in a loop (rule 1).

## 10. Stop at once (Close, then Store > YouTube > Remove) if

- with Picture while driving **off**, the picture shows in N, D or R, or while the car rolls (on, it is meant to);
- with Typing while driving **off**, the keyboard opens in N, D or R (on, it is meant to);
- Read aloud speaks without a press, or leaves the video paused or silent after it (roll the service back: Step I's undo);
- the HMI or the sound misbehaves, or anything BMW shows is covered;
- the Health check fails again and again, or the app crashes (remove it, never reinstall it).

## 11. Undo everything

- [ ] In the app: Sign out (or revoke "YouTube on TV" at myaccount.google.com/permissions).
- [ ] Store > YouTube > Remove. Then either Store > RideTube > Install (upstream back), or remove `jap-ridetube-d` and
      `jap-node22` too.
- [ ] Before locking the car: Close the video (its decoder keeps a log open on `/var/opt` while a video is up).

## 12. Proven on the desk vs untested until the car

| Item | Status |
|---|---|
| Picture while driving on (the default): the picture at 50 km/h, in D at 0 km/h, R, N, rolling, with no gear signal yet and with a lost speed signal | Proven: `kit/tools/test_ridetube.js` (the app's frames, the decoder told to show it) and `tools/shoot.js` frames 04, 09, 10 |
| Picture while driving off: the picture only in P at 0 km/h; D at 0 km/h, R, N, any speed, no gear yet, unknown values, a lost signal (also one lost while the setting was on): sound only; switching it takes effect at once | Proven: `kit/tools/test_parked.js` (park mode) and `kit/tools/test_ridetube.js` (no video op in D, R, N, rolling or with a quiet speed signal; the gate with the real parked rule); deliberate breaks caught: 11 of 11 in the parked rule, 12 of 12 on the app's side (`tools/mutate_parked.py`, `--app`) |
| The settings saved: a first install, upstream's, 0.6.70's or 0.6.71's settings.json, a broken value or file come out as the defaults (Picture and Typing while driving on, Read aloud off); a saved choice stays | Proven: the real app started on each saved file (`kit/tools/test_ridetube.js`, saved settings) |
| Typing while driving on (the default): the keyboard driving and at a red light; off: 0.6.71's rule exactly (only in P, 0 km/h, fresh signals; D, R, N, rolling or a lost signal: no keyboard, the note), the Search page, the menu's Search and Search channels alike | Proven: `kit/tools/test_ridetube.js` (WP10, Subscriptions); deliberate breaks caught: 10 of 10 on the app's side (`tools/mutate_parked.py --app`, with the picture's) |
| BMW's own keyboard (the HMI speller) while the car moves: with the switch on the app no longer stops it, but the HMI could have a lock of its own | Untested: this car day is parked (Step E tries D standing). Upstream RideTube offers typing while driving behind its own switch (its changelog); not seen on a car by this fork |
| Read aloud off by default; on, a tile's first press asks the service to say its title and the second plays it (Watch later, every video page, Up next); the watch page's speaker and podcast mode's button; nothing said unasked; an older service: a press plays | Proven: `kit/tools/test_ridetube.js` (Read aloud); deliberate breaks caught: 9 of 9 (`tools/mutate_parked.py --app`) |
| The service's `say`: a video playing paused for the speech and resumed where it was (a new connection, `setTime` there); paused or idle, it stays so; hush, pause, resume, seek, a new say, a play, a stop, the mic hold, busy, a failing or hung helper | Proven against the fake MediaPlayer (`native/jap-ridetube-d/test/test_ytd.js`, Read aloud); deliberate breaks caught: 12 of 12 (`tools/mutate_parked.py --say`) |
| eSpeak NG on Node 22: speech in all ten languages as an MP3 of the car player's format (MPEG-1 Layer III, 44.1 kHz, mono, 64 kbps); English checked by speech recognition | Proven on claudius-vm's Node 22.23.4 (`test/test_tts.js`; Whisper heard "Never gonna give you up, official video, Rick Astley"); untested on the car's CPU: Step I times it |
| The car's player says the clip, at the volume knob's level, and the video comes back after it | Untested on this car: Step I. The clip takes the video sound's own path (source 1046 to sink 1024, `playFile` of a finished file), and an MP3 played that way on another iDrive 7 car (aurelmarius's mediaprobe 0.1.2, 2026-11-13) |
| The settings text in the HMI menu (the switches' labels and the three lines above them, in each language) | Untested: the HMI draws it (the package's string tables carry it, checked); Step E photographs it |
| The gear signals exist on this car and reach apps (`statusGearboxDrive`, `DataPowerTrain2`) with the values the code expects (P 1, R 2, N 3, D 4) | Untested: Step E (it matters only with the setting off). Shift Lights subscribes to the same interface, but its values on this car were never logged. With the setting off anything unexpected keeps the picture off, and the log's `parked check:` lines show the raw values |
| The YouTube-style screens (top bar, chips, cards, watch page, full screen, audio-only view, no internet, sign in) | Proven in software renders of the renderer stream (`tools/shoot.js`, 19 frames with Read aloud's, pixel-identical on the Mac and claudius-vm (the PNG files differ only by the two Node builds' zlib); RideTube sends no renderer animations, so these are the animations-off render); the car's renderer draws them on the GPU |
| Touch and knob reach every control | Proven in the stubbed head unit (every target reached by turning) |
| Install from a stick with the SDK generated on the car | Untested: Step C (the Store's documented `oap/` route and its deploy tool's package preparation) |
| Sound, title and picture on the media screen and cluster | Untested on this car: Step G |
| The no-internet note follows the Store's uplink | Proven against a status file; untested with the real uplink: Step F |
