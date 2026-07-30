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

Only the **jeep** can pick up and carry the flag — it's unarmed and the most
fragile of the three. Every vehicle type now has its own finite life pool
(2 tanks, 2 helicopters, 3 jeeps by default) that lasts the whole round: lose
all the lives across all three types and the round is over. Running out of
just one type doesn't end things early — you're automatically switched into
whichever type you've still got left, so the tank/heli can keep clearing the
way even after the jeeps are gone (though without a jeep left, the flag can't
actually be picked up again until the round resets).

- **Jeep** — fast, light, unarmed. Only vehicle that can carry the flag. 3 lives. Very fragile: on top of taking damage from turret/gunfire like anything else, ramming a building bruises the jeep itself, not just the building.
- **Tank** — slow and planted, barely drifts, biggest health pool, slow heavy cannon. 2 lives. Armored enough that ramming a building costs it nothing extra.
- **Helicopter** — fast and floaty, flies straight over ground obstacles, fragile, fast weak chaingun. 2 lives.

Each has its own stats (top speed, grip, turn rate, health, weapon) defined
in `src/vehicle.js`, and its own silhouette in `src/vehicleArt.js`.

**Ramming.** Ground vehicles (jeep, tank) don't just need their weapon to
clear a destructible building — hitting one hard enough chips away at its
health too, and enough hits will knock it down outright. The tank hits much
harder than the jeep (it can flat-out bulldoze a weak building by ramming
alone), while the jeep's ramming is more of a nudge, not a real substitute
for the tank's cannon. Unlike the tank, the jeep isn't armored for this: every
time it rams a building, the impact costs the jeep some of its own health too
(mild/moderate, not lethal in one hit) — "precious and important, but very
weak." The helicopter never rams anything: it's aerial and flies straight
over ground obstacles instead of colliding with them.

**Powerups.** A handful of destructible buildings secretly hide a pickup —
and unlike the rest of the neighborhood, a seeded building is unmistakable:
it glows gold with a pulsing halo, so hunting one down is a real choice, not
a lucky demolition. Destroy one and it drops a floating, time-limited buff:
OVERCHARGE (2x damage), BIG SHOT (fatter, harder-hitting rounds), LASER
(pierces through buildings/turrets instead of stopping on the first hit), or
ARMOR (halves incoming damage — the one defensive buff in the set). Drive
over the dropped icon to grab it; the HUD shows which buff is active and how
much time is left. Which 5 buildings hide a powerup is re-rolled every round
(each time you pick a vehicle from the start screen), so it's never the same
spot twice.

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
   the jeep was carrying it) and it respawns at base after a short delay.
   Each vehicle type has its own life pool (2 tanks, 2 helis, 3 jeeps); once
   one type is spent you're auto-switched into whichever type still has
   lives left. Only once every type is exhausted does the round actually
   end: "OUT OF VEHICLES — ROUND LOST."

## Effects

Explosions, sparks, muzzle flashes, and dust give combat some visual weight:
firing kicks off a muzzle flash at the gun tip, every bullet impact throws a
quick spark, a destroyed building blows apart into flying debris and smoke.
A destroyed vehicle or turret gets a proper fireball instead — flame
particles that cool from a hot yellow core through orange and red to smoky
char, a bright detonation flash, and a black smoke column that lingers
after the fire dies down. Big destructions (vehicle, turret, building) also
kick the camera with a short screen shake so they read as an actual impact,
not just a health bar dropping to zero. Driving fast in a ground vehicle
kicks up a trail of dust behind it (the helicopter skips this — it's
flying, not kicking up gravel). All of this lives in `src/effects.js`
(`ParticleSystem`) plus a small shake extension to `src/camera.js`; it's
purely decorative and never touches game state, so it can't affect anything
the headless test suite checks.

## Art style & audio

Visuals are flat-color "toon" shading rather than gradients: bold black
outlines, one hard-edged highlight band per shape, faceted (not perfectly
round) rocks. It's a 2D stand-in for a proper cel-shaded 3D look — see
"Where this could go next" below.

Most sound is synthesized live with the Web Audio API in `src/audio.js`.
The exception is gunfire and explosions: turret fire, the heli's chaingun,
the tank's cannon, and both explosion cues (turret vs. vehicle/building)
layer in a short real recording (`sfx/`, four small CC0/royalty-free clips
sourced from Pixabay — see `DEPLOY_NOTES.md` for the specific source pages)
on top of the original synthesized version, since a real recording reads as
"war" in a way a pure oscillator/noise burst can't. Each cue plays its
sample with a little random pitch/gain jitter so rapid retriggering (the
chaingun firing several times a second) doesn't sound like the same clip
looping, and quietly falls back to the synthesized version if a sample
hasn't finished loading yet -- sound is never silently missing. Everything
else -- the engine hum, missile whoosh, hit/pickup chimes, turret-destroyed
confirmation clank, and the fanfare -- is still fully synthesized. The
engine hum is deliberately understated: filtered noise for the mechanical
rumble plus a very quiet low tone for body, both scaling with speed, mixed
much lower than a lead sound.

On top of all that, `src/music.js` (`MusicPlayer`) plays real background
music: one of three tracks is picked at random each time a new round starts
and loops quietly for the whole match, then crossfades out to a dedicated
"flag-getting" track the moment the jeep grabs the flag, and crossfades
back once it's dropped or captured. It uses plain `<audio>` elements rather
than the Web Audio API machinery the rest of `audio.js` runs on, since these
are full songs (several MB each) rather than short one-shot cues -- see
`music/` and `DEPLOY_NOTES.md` for the track sources. This is the only music
cue for the jeep's flag run now -- there used to also be a synthesized
"run home" loop in `audio.js`, but it played simultaneously underneath this
real track, so it was removed rather than layering two songs at once.

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
  camera.js       lerp-follow world camera + screen shake
  effects.js      particle system -- explosions, sparks, muzzle flashes, dust
  arena.js        world bounds/obstacles/roads/bases -- procedural or real-map, same shape either way
  mapData.js      generated neighborhood data (buildings + roads), see "Real-world map" below
  entities.js     Flag, Turret, Bullet
  game.js         orchestrates state: select, pickup, capture, damage, respawn, win, sound events
  audio.js        Web Audio synth engine (engine hum + one-shot SFX) + 4 real gunfire/explosion samples
  music.js        background music player -- random track per round, crossfades to a flag-getting track
sfx/              4 short CC0 gunshot/explosion recordings (see DEPLOY_NOTES.md for sources)
music/            3 background tracks + 1 flag-getting track (see DEPLOY_NOTES.md for sources)
tools/
  convert_osm.py  turns an OpenStreetMap .osm export into src/mapData.js
test/
  sim.mjs         headless logic test (drives the loop end-to-end per vehicle, no browser needed)
```

Run the logic test any time with `node test/sim.mjs` — it covers per-vehicle
movement and the win condition (on the procedural arena), jeep-only flag
pickup, tank/heli weapons damaging and destroying turrets, ramming a
building down at speed (and that it scales with vehicle weight, that the
jeep alone takes self-damage from the impact, and that the aerial heli never
rams), the shared finite-lives round-loss condition across all three vehicle
types (auto-switching into whichever type still has lives left, and only
ending the round once the whole garage is empty), mid-round vehicle
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
  (A smaller first pass at "more visual pizzazz" already shipped within the
  current 2D canvas renderer — see "Effects" above — without needing this.)
- Destructible base structures instead of a fixed turret pair.
- A second enemy base / capture point for a real back-and-forth match, or a
  simple AI opponent doing the same flag-run against you.
- Swap the synthesized SFX for a licensed/CC0 sample pack (e.g. Kenney.nl)
  if you want a punchier, less "retro synth" sound.
- A visible weapon-cooldown/reload indicator in the HUD instead of just the
  fire-rate feel.
