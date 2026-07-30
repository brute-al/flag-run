# Deploy notes (read this before redeploying)

## Current live state (as of 2026-07-30)
- Live at https://flag-runner-extraction.vercel.app (Vercel project
  `flag-runner-extraction`, team `team_ZW7QOF2JqfjosJSSxi7bOT4F`).
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
