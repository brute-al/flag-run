# Deploy notes (read this before redeploying)

## NEXT UP — where we left off (2026-07-30)
Duel mode's **milestone 1 is built, tested, and confirmed live in
production**: a mirrored, double-height version of the map with an AI
vehicle that autonomously drives toward the player's flag along the real
road network. Verified via all three commits' own diff pages
(9460156/f2bb24f/0250b1d), `list_deployments` showing a READY production
deployment matching the latest commit, and a live in-browser check on
https://flag-runner-extraction.vercel.app: checking "Duel mode
(experimental)" and starting a round shows the doubled/mirrored map, the
player's own flag rendered at their base, and a second (AI-driven) jeep
visibly present and moving elsewhere on the map. This directly follows up
the design discussion recorded lower in this file's history (the user's
"could we do a mirrored map with a computer opponent" question) -- that
discussion is now superseded by this actual, shipped implementation; treat
this entry, not the old discussion notes further down, as current.

**What shipped (milestone 1 -- "symmetric map + dumb AI vehicle driving
toward your flag, no combat yet"):**
- `src/mirrorMap.js` (`mirrorMapData`): doubles a map dataset's height and
  mirrors every building/road point about the original height, so the two
  halves are an exact mirror image (same building density, same roads).
  Arena's own base placement is already purely a function of width/height,
  so handing it this doubled dataset "just works" -- no Arena changes
  needed. **Important subtlety caught by testing, not assumed:** naively
  mirroring does NOT guarantee the two halves' road networks are physically
  connected -- they only share a point if some original road happens to sit
  exactly on the mirror line, which isn't guaranteed (the source map's roads
  were laid out to serve its own single pair of bases, not to reach its own
  edge). Fixed by explicitly bridging the two halves with one connector road
  anchored at the real network's own largest-connected-component,
  southernmost point (found via a full BFS over the road graph, not assumed
  to be the literal southernmost data point, in case that point happened to
  be an unreachable fragment).
- `src/pathfinding.js`: shared road-graph builder + BFS route-finder,
  factored out of what used to be inline-only connectivity-check logic in
  `test/sim.mjs` section 5 (that section is unchanged; this is a reusable
  extraction, not a behavior change to it). `findRoute()` always falls back
  to a direct two-point line rather than returning null, so callers never
  special-case "no route".
- `src/aiDriver.js` (`AIDriver`): a pure-pursuit-style controller
  implementing the same `getVector()/isFiring()/isFiring2()` interface as
  `Input`/`GamepadInput`, so `Vehicle.update()` doesn't know or care that
  it's being driven by AI instead of a person. **Two real failure modes hit
  during testing, both already called out by test/sim.mjs section 1's
  autopilot-avoidance comment, and both had to be fixed, not just
  tolerated:**
  1. *Orbiting forever*: a vehicle's real minimum turning radius grows with
     speed (300+ units for the jeep at top speed), so chasing a tight (40
     unit) arrival radius at full throttle meant it would circle a waypoint
     endlessly, never closing the last few units. Fixed with a much wider
     arrival radius (90 units) and a throttle cap well below top speed
     (`MAX_THROTTLE = 0.55`), both of which keep its actual turning radius
     smaller than the gaps between waypoints. Also had an actual bug on top
     of this: reaching the final waypoint set the steering vector to
     "stop" but never advanced `waypointIndex` to mark the route complete,
     so `reachedEnd` could never become `true` even once genuinely arrived.
  2. *Permanently wedged against a building*: no obstacle avoidance at all
     means it can drive itself into a tight corner and get physically
     stuck. Fixed with a simple "notice you're not actually moving despite
     throttling, reverse for a moment, retry" recovery; and because a single
     reverse-and-retry can itself loop forever against a tight enough
     corner, after 3 failed attempts on the same waypoint it gives up on
     hitting that one precisely and skips ahead instead.
  Verified by first writing a standalone diagnostic script driving the real
  duel-mode Game for 90-240 simulated seconds and logging position/waypoint
  progress every few seconds -- this is what caught both failure modes
  above; don't assume the pursuit math works just because it looks right on
  paper, actually run it against the real map's geometry. (One full run was
  timed at completing the entire ~4800-unit mirrored route in about 233
  simulated seconds -- slow, but it does get there; the shipped test only
  asserts "made real progress" within a much shorter budget, not full
  arrival, to keep the suite fast.)
- `game.js`: new `duel` constructor option (default `false`, so
  single-player is completely unaffected -- verified explicitly in tests).
  When on: `reset()` mirrors the map, spawns `this.aiVehicle` (a jeep) at
  the mirrored base facing into the arena, places `this.playerFlag` at the
  player's own base as the AI's target, and computes its route once at
  round start (the target doesn't move yet, so no need to re-path every
  frame). `update()` drives the AI vehicle every frame with the same
  physics/collision the player uses; `draw()` renders it and the second
  flag. No combat, no win-condition changes, no HUD changes yet.
- `index.html`/`style.css`/`main.js`: a "Duel mode (experimental)" checkbox
  on the select screen, read into `game.duel` right before
  `game.chooseVehicle()` (only for starting a whole new round -- hidden
  during the mid-round vehicle-swap overlay, since duel mode can't change
  there anyway).
- 13 new test checks (mirror math, bridge connectivity, AIDriver on a
  synthetic route, and the full Game integration proving single-player is
  untouched and duel mode makes real measurable progress toward the flag on
  the actual map) -- all passing, `node test/sim.mjs` runs in well under a
  second (physics-only simulation, no rendering, so even the 90-second
  simulated-time check is fast in wall-clock terms).

**What's explicitly NOT here yet** (later milestones, per the user's own
staged-build choice): the AI can't fire and can't take damage; the player's
own flag isn't actually pickup-able by the AI (it's rendered but inert);
there's no symmetric win/loss condition; turret placement wasn't mirrored
(the existing 8 turrets just spread across the now-doubled route length,
unchanged logic); the AI doesn't react to the player at all.

## Current live state (as of 2026-07-30)
- Live at https://flag-runner-extraction.vercel.app (Vercel project
  `flag-runner-extraction`, team `team_ZW7QOF2JqfjosJSSxi7bOT4F`).
- **Latest batch, pushed and deployed this session:** three changes
  in response to user playtesting feedback (commits `c62ab88`, `6b27bde`,
  `8f1d884`, all on top of `aad7eab`; Vercel deployment `dpl_AZ6RKnFGMQrpn2nE3WqCxgrQzKnR`
  confirmed READY at this commit):
  1. Removed the old synthesized `RunHomeMusic` class/`this.tension` calls
     from `src/audio.js` entirely -- it used to start on `flagPickup` and
     stop on `flagCapture`/`flagDropped`/`roundReset`, but that meant it
     played simultaneously underneath the real `flag-getting.mp3` track from
     `src/music.js`'s `MusicPlayer` (also wired to the same events), which
     read as an unwanted 8-bit-sounding loop buried under the real song.
     music.js now owns that moment on its own.
  2. Jeep now takes self-damage ramming buildings: `VEHICLE_TYPES.jeep` gets
     a new `collisionDamage: 10` field (`vehicle.js`), applied in the same
     ram-contact block in `game.js` that already dings the *building's*
     health (`o.health -= this.vehicle.ramDamage`) -- gated so only the jeep
     has `collisionDamage > 0`, the tank stays immune (its armor absorbs
     ramming for free). Fires a `vehicleHit` event too, reusing the existing
     hit sound/particle cue rather than adding a new one.
  3. Reworked the lives system: every vehicle type now has a finite pool
     (`VEHICLE_TYPES[type].lives`: jeep 3, tank 2, heli 2 -- previously jeep
     had 2 and tank/heli were `Infinity`). The round-loss check in
     `game.js`'s death handling changed from "did *this* type run out" to
     "did *every* type run out" (`Object.values(this.lives).some((n) => n >
     0)`); if the current type is out but another still has lives, the game
     auto-switches `this.vehicleType` to the first type with lives left
     (search order follows `Object.keys(this.lives)`, i.e. jeep, then tank,
     then heli) so the next respawn comes back as that type instead of
     ending the round. `getHudState()` now returns a `lives: {...}` object
     (all three counts) instead of just `jeepLives`; `main.js`'s status line
     shows `JEEPS: n · TANKS: n · HELIS: n`. Test coverage in
     `test/sim.mjs` section 3 rewritten to drive through the whole garage
     (kill all 3 jeeps -> auto-switch to tank -> kill both tanks -> auto-
     switch to heli -> kill both helis -> round lost), replacing the old
     "jeep 2-life / tank-heli-infinite" tests.
  All changes covered by `node test/sim.mjs` (145 checks, all passing) except
  the audio.js removal, which (like all audio) isn't exercised by the
  headless suite -- verified by ear in-browser instead.
- Added real background music (`src/music.js`'s `MusicPlayer`, wired into
  `main.js`): 3 tracks in `music/` are candidates for a random per-round
  pick (`battle-rage.mp3`, `battle-eternity.mp3`, `battle-song.mp3`), looped
  quietly via plain `<audio>` elements (not the Web Audio API the rest of
  the audio code uses, since these are full songs). `music/flag-getting.mp3`
  crossfades in when the jeep grabs the flag and crossfades back to the
  background track on capture/drop. User-provided files (filenames follow
  Pixabay Music's `author-title-id.mp3` naming convention, e.g.
  `vanguardiacreate-epic-battle-344846.mp3`, suggesting that's their
  origin) — uploaded directly into chat and copied in, not fetched by this
  sandbox.
  - **New pitfall found while verifying this one:** for a file path that
    has *never existed in the repo before* (a brand-new folder like
    `music/`), GitHub's per-file `commits/main/<path>` history page can
    say "No commits history" for a beat even though the commit actually
    landed fine — this is just indexing lag for a new path, not the
    silent-no-op bug described below. Confirmed by checking the *commit's
    own* page (`github.com/.../commit/<sha>`), which showed the correct
    file tree and byte sizes immediately. So: for a brand-new path, check
    the commit's own diff page first; only treat a per-file history page
    as authoritative for paths that already existed before this commit.
- Added 4 real gunfire/explosion samples (`sfx/`) layered over the
  synthesized versions of turret fire, heli chaingun, tank cannon, and both
  explosion cues (`src/audio.js`'s `_playSample()`), plus fiery vehicle/
  turret explosions (`ParticleSystem.fieryExplosion()` in `src/effects.js`)
  and a reworked upbeat/major-key flag-run music cue (`RunHomeMusic` in
  `src/audio.js`, replacing the old dissonant `TensionMusic` drone). Sample
  sources, all CC0/royalty-free, no attribution required (Pixabay Content
  License), downloaded by the user and uploaded into the chat since this
  sandbox's network allowlist only reaches github.com directly (confirmed
  blocked: kenney.nl, mixkit.co, opengameart.org's own CDN, raw file hosts
  in general):
  - `sfx/gunshot-rifle.mp3` — https://pixabay.com/sound-effects/film-special-effects-rifle-gunshot-99749/
  - `sfx/gunshot-cannon.mp3` — https://pixabay.com/sound-effects/film-special-effects-single-gunshot-54-40780/
  - `sfx/explosion-medium.mp3` — https://pixabay.com/sound-effects/film-special-effects-medium-explosion-40472/
  - `sfx/explosion-loud.mp3` — https://pixabay.com/sound-effects/film-special-effects-loud-explosion-425457/
  Each sample-backed cue falls back to its original synthesized version if
  the sample hasn't loaded yet (`SoundEngine._playSample()` returns `false`
  in that case) — sound is never silently missing. `node test/sim.mjs`
  doesn't touch `audio.js` at all (no AudioContext in Node), so none of this
  is covered by the headless suite; verified manually in-browser instead.
- **IMPORTANT WORKFLOW LESSON (2026-07-30):** After clicking "Commit changes"
  on GitHub's web upload UI, two commits in a row silently failed to land
  (the page navigated, no visible error, but the file's own commit history
  on GitHub showed the change never actually happened -- confirmed by
  checking `github.com/brute-al/flag-run/commits/main/<path>` per file).
  This was only caught because the user reported "I don't see the gold
  buildings" after I'd claimed the deploy was done. **From now on, after
  every commit-changes click, take a screenshot and/or check that specific
  file's commit history page before moving to the next upload -- do not just
  trust the upload tool's "uploaded N files" confirmation or a final
  `list_deployments` READY status, since a same-commit-message deploy can
  still be building off stale file content if the commit itself silently
  no-opped.** Also note: `raw.githubusercontent.com` is CDN-cached (can lag
  a real commit by several minutes) -- verify against the actual Vercel
  deployment URL (or `github.com/.../commits/main/<path>`), not raw.
- Added a particle/effects pass for visual "pizzazz": explosions, sparks,
  muzzle flashes, dust, and camera screen shake on big impacts. New file
  `src/effects.js` (`ParticleSystem`), small shake extension to
  `src/camera.js`. Purely decorative -- wired into `game.js` at existing
  event sites (fire, hit, destroy) but never reads/writes gameplay state.
  10 new tests added, all passing.
- Powerup buildings now render gold with a pulsing halo (`_drawBuilding` in
  `arena.js`) instead of being invisible until destroyed — the whole point
  was to give players something to actively hunt down. Added a 4th powerup,
  ARMOR (halves incoming damage via a new `damageTakenMult` field on
  `POWERUP_STATS`/`_weaponModifiers`, applied at the `vehicleHit` bullet-
  damage line in `game.js`). Seeding was already re-randomized every round
  (each `reset()` builds a brand-new `Arena`, which re-runs
  `_seedPowerups`) — that part turned out to already be correct, just
  undocumented and invisible. 8 new tests added, 116 total, all passing.
- Ramming-damage feature added (not yet pushed — see "Pending push" below):
  jeep/tank chip away at destructible buildings by hitting them at speed
  (`ramDamage` in `vehicle.js`, cooldown/contact logic in `game.js`), heli is
  aerial and never rams. 5 new tests added, all 108 tests passing.
  - While adding this, found the pre-existing `[heli — weapon: chaingun]
    destroyed the turret` test was flaky (unseeded `Math.random()` turret
    spread could occasionally kill the heli — it has only 70 HP — causing a
    mid-test respawn that moved it away from the turret before finishing it
    off). Unrelated to the ramming code (which is gated off for aerial
    vehicles), fixed by re-pinning the heli's test position every frame so a
    respawn can't derail the test. Confirmed via 15 consecutive clean runs.
- All 15 files deployed, powerups feature live, 103/103 tests passing.
- `src/mapData.js` ships **393 of 786 real OSM buildings** (every other one,
  spatially even sample) with full road fidelity (28KB mapData.js, ~85KB
  total deploy payload). Found a full-fidelity backup (`tools/mapdata_b64.txt`,
  gzip+base64, decompresses to the original 786-building/47-road dataset) —
  note its **roads are a coarser/simplified draft** (2-point straight lines
  vs. the live version's detailed multi-point roads), so always take
  buildings from that backup but roads from the currently-live mapData.js,
  never both from the backup.
- Tried merging nearby buildings into fewer/larger shapes (shapely
  buffer+union) to cut size further — abandoned it. Merging chains
  transitively: even a small buffer radius fused entire street-fronts into
  single 400-650-unit-diagonal blobs, which is a real risk of silently
  blocking roads that should stay drivable (obstacles are solid for
  collision). Simple stride-sampling has no such correctness risk and was
  used instead.

## How deploys work here — UPDATED 2026-07-30, this supersedes the section below
There is now a working git pipeline — use this instead of `deploy_to_vercel`:
- GitHub repo: `brute-al/flag-run` (public), full project pushed (src/, test/,
  tools/, root files).
- Vercel project `flag-runner-extraction` is connected to that repo's `main`
  branch (Project Settings → Git). Confirmed working: a test commit
  (`eae4948`) auto-triggered deployment `dpl_CrMdHga8dFTzgYiW1YQFRiYBzZ4E`,
  no `deploy_to_vercel` call involved.
- **Why this matters**: the sandbox's own bash/CLI can't reach github.com or
  vercel.com directly (confirmed — see dead-end list below), but the
  **Claude in Chrome browser tools run in the user's real, already-authenticated
  browser**, which has normal internet access. The key tool is
  `file_upload` (`mcp__claude-in-chrome__file_upload`): it attaches a local
  file straight to a page's file input, so pushing a file to GitHub's web
  upload UI never requires typing that file's contents into a tool call.
  This is what actually removes the cost, not just shrinks it.
- **New workflow for future changes**: edit file(s) on disk as usual → open
  GitHub in the browser (`tabs_context_mcp`, `navigate` to
  `github.com/brute-al/flag-run/upload/main/<subfolder>` for the right
  path, or `.../edit/main/<path>` for a quick text tweak) → `file_upload` the
  changed file(s) (only the ones that changed, not all 15) → commit → Vercel
  auto-builds and deploys within seconds. Confirm with
  `list_deployments`/`get_deployment` same as before.
- This is why the full 786-building map (see "Known limitation" below) is
  now safe to restore in one go: no output-token ceiling applies to a
  browser file upload.

### Old path (kept for reference / fallback if browser tools are unavailable)
The `deploy_to_vercel` MCP tool still works and requires **every file's full
contents inlined in one tool call**. Two things that look like better options
both dead-end *for this route specifically*:
- **Vercel CLI** is installed in the sandbox, but `vercel login` fails —
  outbound network to vercel.com's API / the npm registry isn't reachable
  from here, only the MCP tool's own proxy can reach Vercel.
- **git/GitHub via sandbox bash** — same problem, no outbound access to
  github.com from bash directly (this is why the browser-based route above
  was needed instead — the browser has its own real network path).

So: no incremental deploys via `deploy_to_vercel`, no CI, no CLI — every call
to it = resend all 15 files' full content in one message. Prefer the git
pipeline above; only fall back to this if Claude in Chrome isn't connected.

## What burned a full session's budget last time
Regenerating minified/JSON-escaped versions of every file from scratch each
time, hitting the output-token ceiling mid-generation (once accidentally
shipped a single-file deploy that broke prod), and re-deriving `mapData.js`
compaction (flat-encoding buildings, sampling every 4th one) live under
pressure.

## Recommended workflow for next time (git pipeline — no minification needed)
1. Edit source files in `src/` normally, no need to hand-minify — file size
   no longer matters since `file_upload` doesn't cost output tokens.
2. Run `node test/sim.mjs` first — expect "ALL PASS".
3. Load browser tools if deferred: `ToolSearch` for
   `mcp__claude-in-chrome__tabs_context_mcp,navigate,computer,read_page,
   tabs_create_mcp,find,file_upload,browser_batch`.
4. `tabs_context_mcp{createIfEmpty:true}` → `navigate` to
   `github.com/brute-al/flag-run/upload/main/<subfolder>` (e.g. `.../src`)
   for the folder containing the changed file(s), or `.../edit/main/<path>`
   to tweak one text file directly in GitHub's editor.
5. `find` the file-input dropzone → `file_upload` with the changed file(s)'
   absolute paths → `find`+click "Commit changes".
6. Confirm via `list_deployments` (projectId `prj_IcvOCDPp0yCbWgbiWJfOsfmiAsyS`,
   teamId `team_ZW7QOF2JqfjosJSSxi7bOT4F`) that a new deployment appeared with
   `meta.githubCommitSha` matching, state `READY`.
7. Fallback: if Claude in Chrome isn't connected/available, use the old
   `deploy_to_vercel` path above (minify + inline all 15 files).

## Building density — DECIDED 2026-07-30, do not "fix" this
Building fidelity was originally capped (169, then 393 of 786) to fit
`deploy_to_vercel`'s output budget. That technical constraint is gone now
that the git pipeline is set up (restoring the full 786 would be a trivial
`file_upload` push, no budget planning needed).

However: the user was asked directly and said the 393-building density is
**more fun** than the full 786 and wants it kept as the standard. This is a
deliberate gameplay/design choice, not a limitation. Do not restore full
building density unless the user explicitly asks for it again.
