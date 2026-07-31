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
- `W`/`↑` `S`/`↓` — throttle forward / reverse (heli only); on the **tank**
  and **jeep**, see hovercraft movement below instead
- `A`/`←` `D`/`→` — turn left / right (heli only); on the **tank** and
  **jeep**, see hovercraft movement below instead
- **Hovercraft movement** (tank + jeep): WASD/arrows (or the left stick) set
  an absolute direction to move in directly — no need to turn first, it just
  slides that way immediately, forward/back/strafing all included. On the
  tank, the hull is purely cosmetic and just visually settles to face
  wherever it's actually traveling, independent of the turret's own aim. The
  jeep has no turret to keep independent, so it's even simpler there — the
  whole vehicle just slides and faces its travel direction. Only the heli
  still flies the older way (see its own strafing note below).
- **Twin-stick aim** (tank/heli only — the jeep is unarmed): your turret/heli
  nose tracks your mouse cursor independently of however you're driving, and
  autofires whenever you're aiming somewhere and holding the left mouse
  button — move one way, shoot another, no separate fire key. On a
  controller, the right stick does this: push it in a direction to aim and
  autofire, same as the mouse. Once a controller is connected it's the sole
  aim/fire input — the mouse's resting position stops mattering entirely, so
  it can't fight the right stick.
- `F` (or a controller's `B`/left trigger) — heli only: hold this while
  aiming to swap the ongoing autofire from its chaingun to its longer-range
  missile, which arcs over rooftops instead of stopping on the first
  building in the way
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

- **Jeep** — fast, light, unarmed. Only vehicle that can carry the flag. 3 lives. Very fragile: on top of taking damage from turret/gunfire like anything else, ramming a building bruises the jeep itself, not just the building. Moves hovercraft-style (see Controls above).
- **Tank** — slow, armored, biggest health pool, slow heavy cannon. 2 lives. Armored enough that ramming a building costs it nothing extra. Moves hovercraft-style (see Controls above): WASD sets an absolute travel direction directly, independent of the turret's own aim.
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
   the tank or helicopter out first and aim at them (mouse or right stick) to
   knock the turrets out — each has a visible health pip and goes gray/inert once
   destroyed. A handful of turrets scattered along the route are the taller,
   raised **sniper** variety, whose shots clear rooftops instead of stopping
   at the nearest wall — they're deliberately built and colored differently
   (square, steel-blue, up on a raised pole) rather than just brown circles,
   so you can spot the ones cover won't fully protect you from at a glance.
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

## Duel mode

Check "Duel mode" on the vehicle-select screen to play against a computer
opponent instead of the usual single-player run. The map becomes a mirrored,
double-height copy of the same neighborhood (`src/mirrorMap.js`) — your half
is unchanged, the far half is an exact mirror image with matching building
density and road layout, so both sides are laid out fairly. The AI drives a
tank from its base toward your flag, navigating the real road network the
same way the connectivity test does (`src/pathfinding.js`'s shared road
graph + BFS route), using the same arcade vehicle physics and obstacle
collision as the player (`src/aiDriver.js`).

This was a **staged build** — see `DEPLOY_NOTES.md` for the full history —
and is now a complete, winnable mode. **Milestone 1** shipped a fair
symmetric map and an AI that can actually navigate to your flag on its own,
including recovering when it wedges itself against a building (reverses and
retries, and after a few failed attempts on the same spot, gives up on that
exact point and moves on rather than oscillating forever). **Milestone 2**
armed it: the AI's turret independently swivels toward and fires on you
whenever you're within range and it's roughly aimed — independent of the
hull, just like your own turret tracks your mouse/right-stick aim
independently of however you're driving — and it can now take damage and be
destroyed, respawning after a short delay just like you do. Turrets are also
**territorial**: ones north of the map's exact halfway line (your side)
defend it by targeting the AI opponent, ones south of that line (the AI's
side) defend it by targeting you — a real capture-the-flag feel where
you're each fighting through the other's defenses while your own turrets
cover you.

**Milestone 3** finishes it into an actual, winnable match. The AI now
splits its attention instead of hunting forever: it drives its tank and
fights you for a while (30 seconds by default), then breaks off, drives home,
swaps into an unarmed jeep at its own base — exactly the rule you follow via
`V` — and makes a real run at your own flag. First side to actually deliver
the *other* flag to their own base wins; beating up the AI (or it beating up
you) never ends the round by itself, only a real delivery does — if you
destroy its jeep mid-run, the flag just drops where it fell and the AI
bounces back into hunting for a while before it tries again, the same way
your own jeep dropping the enemy flag doesn't lose you the round. A
dedicated HUD line ("YOUR FLAG: ...") tracks your own flag's status the same
way the existing flag status line already tracks the enemy one, so you
actually notice the AI is out there with it before you've already lost.

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
  mirrorMap.js    mirrors map data to build duel mode's symmetric double-height map
  pathfinding.js  shared road-graph + BFS route finder, used by the AI opponent and the connectivity test
  aiDriver.js     autonomous "input" source that steers a vehicle along a route (routing/combat only -- see game.js's _updateAiMode for what it's told to do and when)
sfx/              4 short CC0 gunshot/explosion recordings (see DEPLOY_NOTES.md for sources)
music/            3 background tracks + 1 flag-getting track (see DEPLOY_NOTES.md for sources)
tools/
  convert_osm.py  turns an OpenStreetMap .osm export into src/mapData.js
test/
  sim.mjs         headless logic test (drives the loop end-to-end per vehicle, no browser needed)
```

Run the logic test any time with `node test/sim.mjs` — it covers per-vehicle
movement and the win condition (on the procedural arena), jeep-only flag
pickup, twin-stick aiming (the tank turret and heli nose track an aim angle
independently of the hull/driving, firing along that angle rather than the
hull's, and the heli's held-missile weapon swap), tank/heli weapons damaging
and destroying turrets, ramming a
building down at speed (and that it scales with vehicle weight, that the
jeep alone takes self-damage from the impact, and that the aerial heli never
rams), the shared finite-lives round-loss condition across all three vehicle
types (auto-switching into whichever type still has lives left, and only
ending the round once the whole garage is empty), mid-round vehicle
switching at base, and — for the real-world map specifically — that
buildings convert cleanly into obstacles, no building overlaps a base, the
road network actually connects the two bases, and capture/win mechanics
still work with real obstacles in the mix. It also covers experimental duel
mode: the map-mirroring math, that the mirrored map's two halves are
actually connected (not just each half individually), that the AI opponent
makes real, measurable progress toward the player's flag on the real map
within a generous time budget — not just that a route exists — and that the
AI's turret actually aims and fires when a target is in range, that its
fire actually damages the player, that player fire actually damages and
destroys the AI, and that it respawns afterward at full health. As of
milestone 3, it also covers the AI's full hunt → return-to-base → flag-run →
deliver mode cycle, the AI actually picking up and delivering the player's
own flag home (ending the round), that combat alone never ends the round for
either side, that a flag-carrying AI jeep drops the flag on death and
respawns back into hunt mode, and the duel-only HUD line that tracks the
player's own flag status.

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
- **Isometric/3/4 camera perspective.** Currently discussed as the next big
  step after duel mode (now that milestones 1-3 are all shipped, see "Duel
  mode" above) and before another visual/audio polish pass — see
  `DEPLOY_NOTES.md`.
- A smarter duel-mode AI that reacts to danger mid-flag-run (aborts a jeep
  run if the player is closing in, retreats when low health, etc.) instead
  of committing to hunt/flag-run in fixed phases — deliberately left out of
  milestone 3's scope, see the class-level comment at the top of `Game` in
  `src/game.js`.
- Swap the synthesized SFX for a licensed/CC0 sample pack (e.g. Kenney.nl)
  if you want a punchier, less "retro synth" sound.
- A visible weapon-cooldown/reload indicator in the HUD instead of just the
  fire-rate feel.
