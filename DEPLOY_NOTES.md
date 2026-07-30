# Deploy notes (read this before redeploying)

## Current live state (as of 2026-07-30)
- Live at https://flag-runner-extraction.vercel.app (Vercel project
  `flag-runner-extraction`, team `team_ZW7QOF2JqfjosJSSxi7bOT4F`).
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

## How deploys work here — read this first
The only working deploy path in this sandbox is the `deploy_to_vercel` MCP
tool, which requires **every file's full contents inlined in one tool call**.
Two things that look like better options both dead-end:
- **Vercel CLI** is installed in the sandbox, but `vercel login` fails —
  outbound network to vercel.com's API / the npm registry isn't reachable
  from here, only the MCP tool's own proxy can reach Vercel.
- **git/GitHub** — same problem, no outbound access to github.com, so a
  Vercel Git integration isn't reachable either.

So: no incremental deploys, no CI, no CLI. Every deploy = resend all 15
files' full content in one message.

## What burned a full session's budget last time
Regenerating minified/JSON-escaped versions of every file from scratch each
time, hitting the output-token ceiling mid-generation (once accidentally
shipped a single-file deploy that broke prod), and re-deriving `mapData.js`
compaction (flat-encoding buildings, sampling every 4th one) live under
pressure.
## Git pipeline test
Connected Vercel to this GitHub repo on 2026-07-30 -- this commit is a test push to confirm auto-deploy works.


## Recommended workflow for next time
1. Keep source files in `src/` normal and readable (don't hand-minify them
   for day-to-day edits).
2. Before a deploy, regenerate a `dist/` copy: minify changed files with
   `npx --yes terser <file> --compress --mangle --module`, and only
   re-derive `dist/mapData.js` if the map data itself changed.
3. Read each `dist/` file fresh and paste verbatim into the `files` array of
   one `deploy_to_vercel` call — target `production`, name
   `flag-runner-extraction`, teamId `team_ZW7QOF2JqfjosJSSxi7bOT4F`.
4. Poll `get_deployment` with the returned deployment id until `state` is
   `READY` before telling the user it's live.
5. Run `node test/sim.mjs` before every deploy — expect "ALL PASS".

## Known limitation / open task
Full building fidelity (675 buildings, not 169) was cut to fit inside one
deploy call's output budget. Restoring it is safe (network/tests unaffected)
but should be done as its own focused task with a full budget, not squeezed
into a low-budget session — regenerating + validating the larger
`mapData.js` was the single most expensive step historically.
