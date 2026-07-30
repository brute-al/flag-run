# Flag Run — extraction prototype

A modern, top-down take on the classic "drive into the enemy base, grab the
flag, and haul it back while their turrets try to stop you" formula. Vanilla
JS + HTML5 Canvas, no build step, no engine dependency.

## Run it

Browsers block ES module imports from `file://`, so serve the folder over
HTTP with anything you've got, for example:

```bash
cd flag-runner
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000` in a browser.

## Controls

- Pick a vehicle on the start screen (click a card)
- `W`/`↑` `S`/`↓` — throttle forward / reverse
- `A`/`←` `D`/`→` — turn left / right
- `SPACE` — fire your weapon (tank/heli only — the jeep is unarmed)
- `V` — swap vehicles, only while parked inside your own base
- `R` — start a whole new round from the vehicle picker

## Vehicles

Only the **jeep** can pick up and carry the flag — it's unarmed and has just
2 lives; lose both jeeps and the round is over. The **tank** and
**helicopter** are expendable support vehicles with unlimited redeploys and
their own weapon, whose job is clearing turrets out of the jeep's way, not
finishing the mission themselves.

- **Jeep** — fast, light, unarmed. Only vehicle that can carry the flag. 2 lives total.
- **Tank** — slow and planted, barely drifts, biggest health pool, slow heavy cannon. Unlimited lives.
- **Helicopter** — fast and floaty, flies straight over ground obstacles, fragile, fast weak chaingun. Unlimited lives.

Each has its own stats (top speed, grip, turn rate, health, weapon) defined
in `src/vehicle.js`, and its own silhouette in `src/vehicleArt.js`.

## The core loop

1. Pick a vehicle, then drive south from your base (blue) into the arena.
2. Two turrets guard the enemy base and will shred an unescorted jeep. Take
   the tank or helicopter out first and shoot back (`SPACE`) to knock the
   turrets out — each has a visible health pip and goes gray/inert once
   destroyed.
3. Drive (or fly) back to your own base and press `V` to swap into the jeep
   — the arena, turret damage, and flag all stay exactly as you left them.
4. Reach the enemy base and touch the flag to pick it up (jeep only).
   Carrying it makes the jeep heavier: slower top speed and looser handling,
   so the return trip is riskier than the approach.
5. Get the flag back inside your own base's circle to win. `R` to pick a
   vehicle and start a new round.
6. If a vehicle's health hits zero it's destroyed (flag drops on the spot if
   the jeep was carrying it) and it respawns at base after a short delay —
   except the jeep, which only gets 2 lives total. Lose both and it's
   "OUT OF JEEPS — ROUND LOST."

## Art style & audio

Visuals are flat-color "toon" shading rather than gradients: bold black
outlines, one hard-edged highlight band per shape, faceted (not perfectly
round) rocks. It's a 2D stand-in for a proper cel-shaded 3D look — see
"Where this could go next" below.

All sound is synthesized live with the Web Audio API in `src/audio.js` —
there are no sampled audio files, so nothing to license or download. The
engine hum is deliberately understated: filtered noise for the mechanical
rumble plus a very quiet low tone for body, both scaling with speed, mixed
much lower than a lead sound. One-shot cues cover turret fire, taking a hit,
firing the cannon/chaingun, a turret getting hit or destroyed, an explosion
on vehicle loss, a flag-pickup chime, and a mission-complete fanfare.

## Real-world map

The arena is your actual neighborhood: building footprints and streets
pulled from OpenStreetMap and converted into the game's obstacle/road
format. Buildings became solid obstacles (collision uses a bounding circle
around each footprint; the drawn shape is the real footprint), roads are
drawn as street overlays, and the two bases are placed at the north/south
ends with any overlapping buildings cleared out of the way.

Two things worth knowing:

- **You have to actually drive the streets.** The building grid is dense
  enough that cutting straight across a block usually isn't possible — you
  navigate it the way you would in real life, by following streets and
  turning at intersections. That's not a bug, it's what makes it feel like
  the real place.
- **Getting this data required a manual step**, since this environment's
  sandbox can't reach OpenStreetMap's live query APIs (Nominatim/Overpass)
  directly. The workflow was: export a `.osm` XML file by hand from
  `openstreetmap.org/export`, then `tools/convert_osm.py` parses it, projects
  lat/lon to flat meters centered on the export box, and scales it into game
  units (2 game units per meter by default). To swap in a different
  neighborhood, export a new `.osm` file for that area and re-run:
  `python3 tools/convert_osm.py your-export.osm src/mapData.js`.

The procedural rock-field arena from the original prototype still exists
side by side — `new Game(input, { useRealMap: false })` gets you that
version instead (this is what the test suite uses for the vehicle/weapon/
lives mechanics, since sparse procedural obstacles are easier to test
against with simple "steer at the target" logic).

Map data is © OpenStreetMap contributors, licensed under the Open Database
License (ODbL) — see `src/mapData.js`'s header comment and
[openstreetmap.org/copyright](https://www.openstreetmap.org/copyright).

## Handling model

The vehicle uses momentum-based arcade physics, not simple "point and go"
movement: your heading and your velocity are tracked separately, so hard
turns at speed cause the vehicle to slide (its momentum keeps carrying it in
the old direction) before "grip" pulls it back in line. That's the skiddy,
weighty feel the loop is built around. Tuning knobs live at the top of
`src/vehicle.js` (`accel`, `grip`, `turnRate`, etc.) if you want it looser,
tighter, faster, etc.

## Project layout

```
index.html        canvas + HUD shell
style.css         HUD/page styling
src/
  main.js         canvas setup, resize handling, game loop, HUD + vehicle-select wiring
  input.js        keyboard -> {throttle, turn} mapping
  vehicle.js      arcade drift physics + vehicle type presets (jeep/tank/heli)
  vehicleArt.js   per-vehicle-type canvas rendering (the toon art style)
  camera.js       lerp-follow world camera
  arena.js        world bounds/obstacles/roads/bases -- procedural or real-map, same shape either way
  mapData.js      generated neighborhood data (buildings + roads), see "Real-world map" below
  entities.js     Flag, Turret, Bullet
  game.js         orchestrates state: select, pickup, capture, damage, respawn, win, sound events
  audio.js        Web Audio synth engine (engine hum + one-shot SFX)
tools/
  convert_osm.py  turns an OpenStreetMap .osm export into src/mapData.js
test/
  sim.mjs         headless logic test (drives the loop end-to-end per vehicle, no browser needed)
```

Run the logic test any time with `node test/sim.mjs` — it covers per-vehicle
movement and the win condition (on the procedural arena), jeep-only flag
pickup, tank/heli weapons damaging and destroying turrets, the jeep's 2-life
round-loss condition (and that tank/heli never run out), mid-round vehicle
switching at base, and — for the real-world map specifically — that
buildings convert cleanly into obstacles, no building overlaps a base, the
road network actually connects the two bases, and capture/win mechanics
still work with real obstacles in the mix.

## Where this could go next

- **Real 3D toon shading.** The current look is a 2D approximation (flat
  fills + outlines). An actual cel-shaded look — flat lighting bands plus an
  outline pass — means moving the renderer to Three.js with a custom toon
  shader; simple box/cylinder geometry is enough, no real 3D art assets
  needed. The physics/game-state code in `vehicle.js` and `game.js` doesn't
  touch the canvas at all, so this would be a renderer swap, not a rewrite.
- Destructible base structures instead of a fixed turret pair.
- A second enemy base / capture point for a real back-and-forth match, or a
  simple AI opponent doing the same flag-run against you.
- Swap the synthesized SFX for a licensed/CC0 sample pack (e.g. Kenney.nl)
  if you want a punchier, less "retro synth" sound.
- A visible weapon-cooldown/reload indicator in the HUD instead of just the
  fire-rate feel.
