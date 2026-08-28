# Deploy notes (read this before redeploying)

## NEXT UP — where we left off (2026-08-28, powerup rebalance + visual cues)
**Implementation + tests done, not yet committed/deployed.** User feedback
after playing with powerups: OVERCHARGE's 2x damage didn't feel different
enough shot-to-shot; ARMOR and LASER worked but were invisible on the
vehicle itself (only the HUD showed they were active); BIG SHOT actively
felt bad because its fattened bullet radius makes it *more* likely to clip a
building you weren't aiming at, not less, and since it isn't piercing that
shot is just wasted. This batch covers all four: OVERCHARGE bumped, ARMOR/
LASER given vehicle-visuals, and BIG SHOT replaced outright rather than
just rebalanced (see the design flaw explained below).

**What shipped (OVERCHARGE 2x → 4x):** `game.js`'s `POWERUP_STATS.overcharge
.damageMult`, `2` → `4`. `entities.js`'s `POWERUP_INFO.overcharge.glyph`
("2X" → "4X") and the one test asserting the old value (`test/sim.mjs`) were
updated to match. No other code cared about the literal number.

**What shipped (ARMOR bubble / LASER glow):** `vehicleArt.js`'s
`drawVehicle()` takes a new optional `powerupType` param; when it's
`"armor"` it draws a stroked ring + soft fill around the vehicle body using
`POWERUP_INFO.armor`'s existing `color`/`glow`, and when it's `"laser"` it
draws a softer pulsing filled halo using `POWERUP_INFO.laser`'s. Both
colors are the *same* ones the floating world-pickup icon already uses
(entities.js's `Powerup.draw()`), so nothing new was invented — the glow
you picked up off the ground is now the glow you're wearing. `game.js`'s
`draw()` passes `this.activePowerup?.type` only for the player's own
vehicle (the duel-mode AI never holds a powerup, so it always gets `null`
and renders exactly as before). Pulse uses `performance.now()`, same
pattern the heli's rotor animation already relied on.

**BIG SHOT → SPLASH (rewritten, not just rebalanced):** confirmed via
`game.js`'s building-collision check (`Math.hypot(...) < o.radius +
bullet.radius`, around line 725) that BIG SHOT's `radiusMult: 2.2` widened
the bullet's own collision radius, not just its sprite — so a shot that
would've cleanly missed a building's edge at normal width now clipped it,
and since BIG SHOT wasn't piercing, that shot died right there instead of
reaching whatever it was actually aimed at. That's a real design flaw, not
a tuning problem, so rather than rebalancing the number the type itself was
replaced. Presented the user 4 candidate replacement concepts (splash/
explosive rounds, rapid fire, spread shot, ricochet); they picked splash
rounds. Renamed the type key `bigShot` → `splash` everywhere (arena.js's
seed list, entities.js's `POWERUP_INFO`, game.js's `POWERUP_STATS`, and
every reference across `test/sim.mjs`/README). New stats:
`{ damageMult: 1.2, radiusMult: 1, splashRadius: 55, splashDamageMult: 0.5
}` — the bullet itself is now completely ordinary (`radiusMult: 1`, same
hit test as a plain shot), and a new `Game._applySplash(bullet, x, y,
excludeObstacle, excludeTurret)` method — called once from each of the
building-hit and turret-hit branches in the collision-handling block,
right where the bullet would otherwise just stop — deals `splashDamageMult`
of the shot's damage to every *other* destructible building and live
turret within `splashRadius` of the impact point (the thing directly hit
is excluded, since it already took a full hit via the existing path). A
splash round can now take out a turret and singe the building next to it,
or vice versa, in one shot, and a `fieryExplosion` particle burst at the
impact point sells the bigger hit. Every other powerup leaves
`splashRadius`/`splashDamageMult` at `0`, so `_applySplash` is a no-op for
them — no shared-code risk.

**Test updates**: `test/sim.mjs`'s old BIG SHOT `_weaponModifiers()` check
now asserts SPLASH keeps `radiusMult === 1` and carries a `splashRadius`;
the "OVERCHARGE doubles damage" check now asserts `damageMult === 4`; both
`VALID_TYPES` lists (initial seeding + re-seed-on-new-round) updated to
`"splash"`. Added a new end-to-end section (23) that fires an actual
`Bullet` with `splashRadius`/`splashDamageMult` set at a building placed
next to a second, direct-placed neighbor building, and confirms: the
direct hit takes full damage, the neighbor takes exactly the reduced
splash share without being hit directly, and a plain non-splash bullet
under the same setup leaves the neighbor completely untouched. Reran the
full suite — stable "ALL PASS".

**Docs**: README's Powerups paragraph updated for 4x OVERCHARGE, the new
ARMOR/LASER vehicle-visual behavior, and SPLASH's new description.

**Not yet done — three separate things are now stacked up waiting on one
commit:** (1) this powerup batch, (2) the jeep-ram/heli-hovercraft tweaks
from the entry directly below (implemented and tested last session, never
pushed), and (3) the mobile/touch-support backlog bullet added to this
README's "Where this could go next" section (a docs-only change, also never
pushed) — all blocked on the same thing, the Claude-in-Chrome browser
extension being disconnected mid-session. Bundle all three into the next
GitHub commit once it reconnects, rather than doing three separate small
commits.

---

## Previous — 2026-07-31, two small feel tweaks
**Implementation + tests done, not yet committed/deployed.** User feedback
after trying the oblique camera pass (see the entry directly below): the
jeep's building-ram self-damage felt too punishing, and the heli's
nose-relative flight ("rotating and going") started feeling weird/dated now
that the tank and jeep both drive hovercraft-style. Both are small, targeted
changes -- no new mechanics, just tuning + reusing an existing model.

**What shipped (jeep ram damage halved):** `vehicle.js`'s jeep preset,
`collisionDamage: 10` → `5`. This is the *only* number that needed to
change -- everything else (the ram-handling block in `game.js`, the
`vehicleHit` event, the existing tests, which only assert `> 0` /
relative comparisons, not the exact value) was already generic over
whatever this constant is. Still a real cost (a jeep only has 100 health),
just not run-ending from a couple of bumps anymore.

**What shipped (heli movement → hovercraft, matching tank/jeep):** the
heli now uses the exact same omni movement model the tank and jeep already
had (`game.js`'s `omni: type === "tank" || type === "jeep" || type ===
"heli"`) instead of its old nose-relative "throttle along the nose, turn
strafes sideways" scheme. The key subtlety: the heli's nose is *also* its
twin-stick aim direction (it has no separate turret sprite to keep
independent, unlike the tank), so simply swapping its movement model risked
also changing what it aims at. It doesn't -- `Vehicle.update()`'s heading
section was already checking `isAerial` before `omni` (aim-angle tracking
takes priority), so that part needed zero changes; only the *thrust*
section's branch order flipped (`omni` now checked before `isAerial`, with
the old nose-relative thrust code kept intact as an `isAerial`-only
fallback branch for any caller that doesn't pass `omni`). Net effect: WASD
now sets an absolute travel direction directly for the heli too, exactly
like the tank/jeep, while the nose keeps independently tracking the
mouse/right-stick regardless of which way the stick is actually pushing it
-- twin-stick aim is completely untouched.

**Why it's floatier than the tank without any new tuning**: the heli
already had much lower `grip` (1.4 vs. the tank's 5.5) and `rollingFriction`
(0.35 vs. 1.1) than the tank, from its original preset. Since the omni
movement math derives its "how much drift bleeds off" and "how fast it
settles when you let go" behavior directly from those same two stats, running
the heli through the identical omni code the tank uses automatically comes
out looser/driftier -- no new floatiness constant needed, the existing
preset numbers already implied it once both vehicles shared one movement
model instead of two different ones.

**Test updates**: one test needed to flip its own assertion --
`test/sim.mjs`'s "omni movement is still opt-in" test previously *proved*
the heli kept flying the old way; now that this is the whole point of the
change, it was rewritten to prove the opposite (absolute-direction movement
+ independent nose), renamed accordingly. The lower-level "Helicopter: stick
strafes, rotate input spins it" section (calls `Vehicle.update()` directly
with plain throttle/turn, no `omni`) needed no logic changes -- it now
exercises what the header comment renamed to "legacy nose-relative flight,
fallback path" — still real, still tested, just no longer what a live player
actually experiences. Reran `node test/sim.mjs` 3x after the changes --
stable "ALL PASS" each time.

**Docs**: `vehicle.js`'s heli description, `index.html`'s help text, and
README's Controls/Vehicles sections all updated to describe hovercraft
movement as "all three vehicles" rather than singling out tank+jeep, with a
note that the heli's version is looser/driftier.

**Not yet done**: commit to GitHub, verify Vercel deployment, live-verify
(both changes are feel/physics tuning that's hard to fully confirm without
actually holding a key down in a real browser session -- same limitation
noted for every prior movement-feel change this session -- so `test/sim.mjs`
is the authoritative check, same precedent as the tank/jeep hovercraft work
below).

---

## NEXT UP — where we left off (2026-07-31, oblique/pitched camera pass)
**Implementation + tests done, not yet committed/deployed.** This is the
"isometric view" the user asked about earlier in the session, now
implemented -- except it's deliberately **not** true isometric. Before
building anything, we pinned down the terminology: true isometric (Desert
Strike, SimCity 2000) rotates the whole world 45° so the ground reads as a
diamond and moving north on the map moves you diagonally on screen -- a
totally different projection requiring re-derived `worldToScreen()` math and
every asset redrawn to match the rotated grid. The user's actual reference,
*Return Fire* (1995), doesn't do that (confirmed via Wikipedia: "a 3D
bird's-eye view", not isometric) -- its map stays axis-aligned to the
screen, and the pitched-camera feel comes entirely from objects visibly
having height/depth, not from rotating the world. The user confirmed: build
the Return Fire version, not a Desert-Strike-style diamond-grid rewrite.

**Why this was a much smaller lift than a true isometric rewrite would have
been**: `camera.js`'s `worldToScreen()` needed **zero changes** -- it's still
the exact same `wx - camera.x, wy - camera.y` subtraction as before. Nothing
about the world's orientation changed. What actually sells the "pitched, not
flat" look is the same cheap 2D trick applied more broadly and more
proportionally than before:

- **Buildings** (`arena.js`): the wall/roof extrusion trick already existed
  (see the 2026-07-2x "Redesign building visuals" entry below) but used one
  fixed 5,7px offset for every building regardless of size. Added a
  per-building `height` field (`_buildingsToObstacles`, deterministic from
  the building's own footprint radius -- bigger buildings look taller, no
  extra randomness needed) and scaled `_drawBuilding`'s extrusion offset to
  it. Procedural rocks got a smaller matching treatment (a soft
  radius-scaled ground shadow, `_drawRock`) so the two arena modes read
  consistently.
- **Turrets** (`entities.js`): tall (rooftop-piercing) turrets already lifted
  their head 34px above a ground shadow on a support pole (see the tall-
  turret work below); *regular* turrets previously sat perfectly flat
  (lift = 0). Gave them a smaller lift (12px) with the same pole treatment
  (now generalized to any lift > 0, colored per turret type instead of
  hardcoded steel-blue), so every turret now reads as standing up off the
  ground -- while keeping tall turrets clearly more elevated so that
  distinction (their shots clear rooftops) doesn't get washed out.
- **Vehicles** (`vehicleArt.js`/`game.js`): `drawVehicle()` gained an
  optional `lift` param (default 0, so nothing else calling it changes
  behavior) -- draws a soft ground-contact shadow at the vehicle's true
  screen position, then renders the hull/turret/heli/jeep body offset
  `lift` pixels up from it. `game.js` wires a shared `VEHICLE_LIFT = 8`
  constant into both the player's and the AI opponent's draw calls. Purely
  a screen-space offset -- `vehicle.x`/`vehicle.y` (physics, collision, aim
  math, everything else) are completely untouched.

**The depth-sort this all actually required**: once height became
significant enough to notice, the *old* draw order (every building, then
every turret, then every vehicle, always, regardless of position -- see
`Game.draw()` before this change) would start looking wrong: a vehicle
driving behind a tall building should be hidden by its wall, but the old
code always drew vehicles last regardless. Fixed by splitting
`Arena.draw()` into `drawBackground()` (ground/roads/bases -- no height,
always safe to draw first/underneath everything) and `drawObstacle()` (culls
+ draws one obstacle), then rewriting `Game.draw()` to build a single
combined list of every building, turret, flag, powerup, bullet, and vehicle
keyed by its own true world y (this game's orientation: larger y = closer to
the camera), sort it ascending, and execute the draws in that order. So
whichever object is actually closer to the camera always wins the
occlusion, regardless of which category it belongs to. `Arena.draw()` itself
is kept as a legacy convenience wrapper (background + obstacles, unsorted)
for anything that just wants "the whole arena" on its own -- `game.js`
doesn't call it anymore. Particles (explosions/sparks/dust) stay outside the
sort, always drawn last on top -- they're short-lived and purely decorative
(see README's "Effects" section), so giving every one its own sort entry
every frame wasn't worth it.

**Test coverage**: no new dedicated test section was needed -- the existing
"draw() runs against the real map without throwing" smoke test
(`test/sim.mjs`, using a no-op `Proxy` fake canvas context) already exercises
every changed draw path (buildings, rocks, turrets, both vehicle types, the
new sort) every time it runs, and passing that after this change is exactly
the regression coverage this kind of purely-visual, non-state-mutating
change needs. Reran `node test/sim.mjs` 3x after the change -- stable "ALL
PASS" each time, no behavior changes to any game-state test (as expected,
since every change here is screen-space-only).

**Not yet done**: commit to GitHub, verify Vercel deployment, live-screenshot
to confirm the pitched/elevated look actually reads as intended (buildings
with visible walls scaled to size, turrets standing on poles, vehicles with
a soft drop shadow) rather than just checking it doesn't throw.

**What's next after this ships** (per the user's own sequencing): a general
visual/audio polish pass, done last since it'd need re-tuning against
this new perspective anyway. No specific polish items chosen yet beyond the
standing options list (licensed CC0 sample pack, weapon-cooldown HUD
indicator, destructible base structures instead of a fixed turret pair, a
smarter threat-reactive duel-mode AI -- see README's "Where this could go
next").

---

## NEXT UP — where we left off (2026-07-31, duel mode milestone 3)
**Implementation + tests done, not yet committed/deployed** (see task list --
next steps are updating this file's own "commit/deploy/live-verify" steps
below once that happens). This finishes duel mode into an actual, winnable
match, per the user's own explicit spec: **(1)** first side to get the flag
wins, **(2)** the AI should feel "more like a real opponent" rather than a
pure rusher or pure flag-runner, **(3)** the opponent has to actually get the
flag to win -- blowing it up over and over doesn't end the round by itself.

**What shipped:** a new `_updateAiMode(dt)` state machine in `game.js`,
sitting above `aiDriver.js` (left completely unchanged -- it still only
knows how to chase whatever route/target it's handed). Four modes: `hunt`
(default -- drives the armed tank toward the player's flag and fights,
exactly like milestone 2, for `AI_HUNT_DURATION` = 30 seconds), `returnToBase`
(routes home, still fights along the way -- retreating to swap isn't
surrendering), `flagRun` (once home, swaps into an unarmed jeep via the new
`_spawnAiJeep()` -- the same base-swap rule the player follows via `V` -- and
routes to the player's flag, `playerFlag`), `deliver` (carries it home;
arriving sets `state = "lost"`). Respawning (`_spawnAI()`, reused for both
round-start and post-death) always resets to `hunt` in a fresh tank, so a
dead flag-running jeep naturally bounces the AI back to aggression for a
while before its next attempt -- this cadence is what's meant to read as "a
real opponent" splitting its attention, rather than a live-position-chasing
AI (deliberately **not** added -- see scope decisions below).

The player's own win path (`flag.carrier`+distance check) was already there
and untouched; the AI's new `deliver`-mode check is its exact mirror, so the
win condition is fully symmetric. A flag-carrying AI jeep destroyed
mid-run drops `playerFlag` on the spot (`playerFlag.dropAt()`, new
`aiFlagDropped` event) exactly like the player's own jeep would, and the
"OUT OF VEHICLES" lives-exhaustion loss for the player is untouched, still a
separate mechanic from this flag-delivery win/loss.

New HUD line `playerFlagStatus` (duel-mode only) mirrors the existing
`flagStatus` line but for the player's *own* flag ("safe at your base" /
"taken by the enemy!" / "dropped in the field"), styled as a warning (red/
orange, bold) rather than `flagStatus`'s neutral color, so the player
actually notices the AI is out there with it instead of finding out only
once the round is already lost. New sound: `aiFlagPickup` deliberately
reuses the existing damage-thud SFX (`_playHit()`), not the celebratory
pickup chime, since it's a threat cue, not a reward. `aiFlagDropped` and
`aiFlagCapture` get no dedicated sound, matching the existing "OUT OF
VEHICLES" precedent of leaning on HUD/message text for those moments. Both
are also deliberately **not** wired into `music.js`'s crossfade system, to
avoid fighting the player's own flag-carrying crossfade logic.

**Scope decisions (not bugs, not forgotten):**
- **No periodic re-pathing during `hunt`.** The AI's hunt-mode route toward
  `playerFlag` is set once at spawn/mode-entry, same as milestone 2, rather
  than continuously re-aimed at the player's live position. Chasing the
  player's actual position would read as more "real opponent"-like too, but
  risked destabilizing the existing milestone-1 distance-based navigation
  test, and the user's "more like a real opponent" answer was specifically
  about splitting attention between combat and flag-running, not about live
  pursuit.
- **No threat-reactive AI.** It doesn't abort a flag run if the player is
  closing in, doesn't retreat at low health, etc. -- it commits to each
  phase in fixed durations and only reacts to actually dying. Listed in
  README's "Where this could go next" as a future improvement.

**Test regression + fix:** `AI_HUNT_DURATION` broke section 19's "AI made
real progress toward the player's flag" test (90 sim-seconds, checks
`endDist < startDist * 0.6`) -- the AI would break off after 30 seconds and
head *toward its own base* (away from the flag) for part of that window,
invalidating the distance comparison. Fixed by pinning
`game.aiModeTimer = Infinity` right before that specific test's loop, so it
isolates milestone-1's baseline navigation from milestone-3's new
mode-switching (which gets its own dedicated coverage instead, see below).
Confirmed stable across 3 consecutive `node test/sim.mjs` runs after the fix.

**New test coverage** (`test/sim.mjs`, three new sections after the
territorial-turret tests): the full `hunt` → `returnToBase` → `flagRun` →
`deliver` cycle (positions/timers set directly, same "isolate the mechanic"
philosophy as the rest of the suite, rather than waiting out real
pathfinding for each transition); the AI actually picking up and delivering
`playerFlag` and ending the round (`state === "lost"`, `aiFlagCapture`
event, `update()` becomes a no-op afterward); a flag-carrying AI jeep
dying mid-run drops the flag at the death spot (`aiFlagDropped` event) and
respawns back into `hunt` mode as a tank, while `state` stays `"playing"`
throughout (combat alone never ends it); and the new `playerFlagStatus` HUD
field across all three states plus confirming it's `null` outside duel mode.

**Docs:** README's "Duel mode" section rewritten to describe milestone 3 as
shipped (dropped the "(experimental)" tag from the section header and from
`mirrorMap.js`/`aiDriver.js` in the project-layout list, since duel mode is
now a complete, winnable mode); the "next milestone" bullet in "Where this
could go next" replaced with the isometric-camera discussion (see below) and
the specific threat-reactive-AI scope-out noted above.

**Not yet done:** commit to GitHub, verify Vercel deployment, live-verify
(duel-mode checkbox copy + the new `playerFlagStatus` HUD element -- likely
via the same `javascript_tool` direct-import/teleport-state technique used
for the tall-turret visual check, since watching a full AI flag-run cycle in
real time isn't practical over automation).

**What's next after this ships** (explicit user-confirmed sequencing,
*not yet started*): an isometric/3-4 camera perspective swap (discussed at
length -- `Camera.worldToScreen()` moves from flat top-down subtraction to
an axonometric projection, needs a painter's-algorithm depth-sort pass
across arena/entities/vehicles, building height/extrusion redesigned for a
true isometric look, and the twin-stick screen-to-world aim conversion
reasoned through under the new projection), done *before* a general
visual/audio polish pass since polish would need re-tuning against the new
projection anyway. No specific polish items chosen yet beyond the standing
options list (licensed CC0 sample pack, weapon-cooldown HUD indicator,
destructible base structures instead of a fixed turret pair).

---

## NEXT UP — where we left off (2026-07-31, later same day)
**Both follow-ups below are confirmed live**: three commits
(79232a2/8869b95/93a7788), a READY Vercel deployment
(dpl_DADxWVPeZVzsTY9ckMNPr2oLXRiN) matching the last of them, and a live
check -- the jeep's vehicle-select card shows the new hovercraft copy, and
(since holding a key down doesn't survive across frames in this automation
browser, same limitation noted in the entry below) the turret visual change
was verified by dynamically importing `entities.js` in the live page's own
console and drawing one of each turret type straight to a throwaway canvas:
side by side, the regular turret is a round brown/red bunker and the tall
one is unmistakably a square steel-blue tower with its amber "▲" marker and
raised support pole -- exactly the "square instead of circle, different
color" ask. The jeep's actual hovercraft movement still relies on
`test/sim.mjs` (section 11c) as the authoritative check for the same
held-key reason as the tank's version.

Two more small follow-ups from the user after trying the hovercraft tank +
gamepad-mute fixes (see the entry directly below): the jeep's driving now
felt like a holdover from the old design once the tank went hovercraft, and
the tall sniper turrets were hard to pick out from regular ones at a glance.

**What shipped (jeep hovercraft movement):** extended the exact same
`input.omni` handling `Vehicle.update()` already had for the tank (see
below) to the jeep too -- `game.js` now sets
`omni: this.vehicle.type === "tank" || this.vehicle.type === "jeep"`. No
changes needed in `vehicle.js` itself, since the omni branch was already
vehicle-type-agnostic; the jeep is actually simpler than the tank case since
it has no turret to keep visually independent -- WASD just sets the whole
vehicle's travel direction directly, and the sprite cosmetically settles to
face wherever it's going, same as the tank's hull does now. The heli is
untouched (its flight was never the complaint). Updated the jeep's
description text, `index.html`/`README.md` controls copy, and fixed two
single-frame ramming tests (`test/sim.mjs`) that were still using the old
`throttle: 1` convention for "thrust toward the building" -- they happened
to still pass (only one frame runs, off pre-set velocity), but the input no
longer meant what the comment said, so updated them to `turn: 1` to match.
Added a dedicated test proving the jeep now moves in an absolute direction
regardless of hull facing, plus a companion test confirming the heli still
strafes the old nose-relative way (omni is still opt-in, not blanket).

**What shipped (tall turret visual distinction):** `entities.js`'s
`Turret.draw()` now renders `tall` turrets as a **square** silhouette (both
the base plate and body -- previously always circles regardless of `tall`)
in a **steel-blue palette** (`#2f4a68`/`#3d6ba0`) instead of a shade of the
same warm brown/red every other turret uses, plus the raised support pole's
stroke colors were retinted to match. The existing raised-on-a-pole height
and amber "▲" marker/health-bar tint are kept as additional reinforcement,
but the shape + color change is the part meant to read at a distance,
before you're close enough to notice the pole or icon. No logic changed
(`tall` still only affects the pole-lift, the `Bullet`'s rooftop-piercing
flag, and now the shape/color) -- confirmed via the existing "draw() runs
against the real map without throwing" smoke test in `test/sim.mjs`, since
there's no headless way to assert on rendered pixel output; a live
screenshot is the real check here (see below once deployed).

---

## NEXT UP — where we left off (2026-07-31)
**Both fixes below are confirmed live**: three commits
(51afb51/9fb90ec/1d3627a) each verified via their own diff pages, a READY
Vercel deployment (dpl_2K6ex3rnX4QjEof7sV7WsA6Hrxk5) matching the last of
them, and a live in-browser check -- the tank's vehicle-select card shows
the new hovercraft copy, and picking the tank in-game and moving the mouse
showed the turret visibly swivel to track the cursor independently of the
hull (twin-stick aim still working after the movement change). No console
errors from the game's own code (only the same unrelated github.com
extension-connection error noted in past entries). The hovercraft
*movement* itself and the gamepad-mute behavior couldn't be exercised live
in this automation browser -- synthetic held-key events don't sustain
across frames the way a real keypress does, and there's no physical
controller to plug into it -- so the dedicated `test/sim.mjs` coverage
added this session (section 11c for hovercraft movement + the bump-recovery
regression guard, section 12 for gamepad-mute) is the authoritative check
for those two, consistent with this same limitation noted for past
hard-to-screenshot mechanics (aim-and-fire, missile arcs).

Follow-up user feedback on twin-stick aiming (see the entry directly below):
**(1)** the mouse's resting cursor position was fighting the right stick
whenever a gamepad was connected, and **(2)** the tank's driving felt wrong
now that its turret aims independently -- the user's own suggested fix was
to make it "more of a hovercraft."

**What shipped (gamepad mute):** `CombinedInput.getAim()`/`isFiring()`/
`isFiring2()` now check `gamepad.isConnected()` first -- if a controller has
ever been touched this session, it's the *exclusive* aim/fire input, full
stop, and the mouse/keyboard are never consulted at all (previously they
fell back to the mouse whenever the right stick recentered, which is what
caused the fight). `GamepadInput` gained a small `isConnected()` getter to
support this. No existing test could trigger a `gamepadconnected` event in
this headless env, so a new test in `test/sim.mjs` (section 12) sets
`pad.index` directly (exactly what `isConnected()` checks) to simulate a
connected controller and confirms the mouse's still-held aim/fire state is
fully ignored once it is.

**What shipped (tank hovercraft movement):** the tank's own WASD/left-stick
input now sets an absolute movement direction directly (`src/vehicle.js`,
new `input.omni` branch), instead of turning the hull and thrusting along
it. The hull itself becomes purely cosmetic post-move, slewing to visually
face wherever the tank's actually traveling (reusing the same `slewAngle()`
helper the twin-stick aim tracking already uses). `game.js` only sets
`omni: true` for the *player's own* tank (`this.vehicle.type === "tank"`) --
the duel-mode AI opponent's tank keeps driving the old turn-to-face way
unchanged, since `aiDriver.js`'s pursuit steering assumes that model and
never sets the flag. Explicitly **heli-only excluded**: the user said the
heli's already-decoupled flight didn't feel like a problem.
  - A regression surfaced via the existing ramming test: a bare "add thrust
    in the held direction, every frame" model has nothing to fight a
    *perpendicular* velocity kick, like the bounce `arena.js`'s
    `_resolveCircleCollision` applies on impact -- so a rammed tank took one
    hit, then flew off at the deflected angle and never came back, and the
    building was never destroyed. Fix: while a direction is actively held,
    velocity is decomposed into along-input vs. perpendicular-to-input
    components, and the perpendicular part is damped by the tank's own
    `grip` stat -- the same stat that used to tame lateral drift under the
    old car-physics model. New dedicated test in `test/sim.mjs` (section
    11c) injects a hard sideways velocity kick and confirms it bleeds off
    while a direction is held, plus confirms the omni flag is opt-in (a jeep
    given the same input still steers the old way).
- `index.html`/`README.md`: help text, tank card description, and controls
  section updated to describe hovercraft movement and gamepad-exclusive
  aim/fire.
- Tests: `node test/sim.mjs` stable at ALL PASS across multiple runs,
  including the new gamepad-mute and hovercraft-movement coverage above.

---

Duel mode's **milestone 2 (combat) and the territorial-turrets follow-up are
both confirmed live** (see the previous entry below for their commit/
deployment verification trail). On top of that, **twin-stick aiming is also
confirmed live**: three commits (9c44a1f/e22f2f0/fdabc47) all verified via
their own diff pages, a READY Vercel deployment
(dpl_5wnh2f8V5zk6bFkLCi3UyYjDB4iQ) matching the last of them, and a live
in-browser check (tank selected, mouse cursor moved and the turret visibly
tracked it in two before/after screenshots, HUD showing the new "CANNON
(AIM TO FIRE)" label, no console errors from the game's own code -- only an
unrelated github.com extension-connection error). A live visual of an
actual fired shot wasn't captured (the muzzle flash/bullet is on-screen for
well under a second, same limitation noted for milestone 2's verification),
but the dedicated Game-integration tests exercise the exact aim-then-fire
path with real physics, which is the authoritative check.

**What shipped (twin-stick aiming, replacing Q/E turret traverse):** the
user played Minishoot Adventure and wanted the tank/heli to aim like a
modern twin-stick shooter -- move one direction, shoot another -- instead of
the old Q/E-relative turret traverse. After a few direct questions (asked
and answered in chat, not via the broken AskUserQuestion tool): keyboard
aiming should use the mouse cursor (the standard PC equivalent of a
controller's right stick, same scheme as Enter the Gungeon); aiming should
autofire on its own, no separate fire button; and the heli's missile should
now be a *modifier* -- hold F while aiming to swap the ongoing autofire from
chaingun to missile, rather than F being its own separate trigger. Movement
itself (tank forward/turn, heli translate) is unchanged.
- `src/vehicle.js`: new `slewAngle()` helper turns an angle toward a target
  at up to a given rate/sec via the shortest path. `Vehicle.update()`'s tank
  (`hasTurret`) and heli (`isAerial`) branches both now check for an
  `input.aimAngle`: if present, the turret/nose slews toward it directly,
  fully independent of the hull, at a new per-vehicle `aimSlewRate` (18
  rad/s tank, 14 rad/s heli -- fast enough to feel instant without visibly
  popping). If `aimAngle` is absent, both branches fall back to the
  **original incremental `turretTurn` logic unchanged** -- this is what lets
  the duel-mode AI opponent (`aiDriver.js`) keep aiming exactly as before
  with zero changes to it or its tests, since it never supplies an
  `aimAngle`, only `turretTurn`.
- `src/input.js`: dropped Q/E entirely. Added mouse tracking (screen
  position + left-button-held) and `getAim(ctx)`, which converts the mouse's
  screen position into a world-space angle relative to the vehicle (using
  `ctx` = vehicle position + camera position + canvas size, the inverse of
  `Camera.worldToScreen`). `isFiring()` now means "left mouse button held."
  `isFiring2()` (F) is unchanged at the key-binding level but is now used
  purely as the heli's weapon-swap modifier, not a standalone trigger.
- `src/gamepadInput.js`: dropped the shoulder-bumper `turretTurn` mapping.
  Added `getAim()` using the right stick (axes 2/3) -- no sign flip needed
  unlike throttle, since an angle doesn't need the "up = positive" scalar
  correction throttle does. Remembers the last-deflected angle so the
  turret doesn't snap back when the stick is released. `isFiring()` is now
  "right stick deflected past its deadzone" (the twin-stick convention:
  pushing a direction fires in it, no separate trigger).
- `src/combinedInput.js`: `getAim(ctx)` prioritizes whichever device is
  actively engaged this frame (right stick deflected, or mouse held/moved),
  falling back to the right stick's last-known angle, then the mouse's live
  angle, then nothing -- mirrors the existing throttle/turn merge philosophy
  applied to a value that can't just be summed.
- `src/game.js`: `update()` now takes optional `canvasW`/`canvasH` (needed
  for the mouse-to-world conversion; defaults keep the headless test suite
  working unchanged). Resolves `aim` once per frame and reuses it for both
  the vehicle's turret/nose tracking and the weapon-firing block. The
  primary weapon now always fires along `aim.angle` (not
  `turretAngle`/`heading`), gated on `aim.active` (mouse held / stick
  deflected) with no separate fire-button check. The secondary weapon
  (heli missile) fires along the same `aim.angle` whenever `aim.active` AND
  the F modifier is held -- same autofire stream, different ammo.
- `index.html`/`README.md`: help text and vehicle descriptions rewritten to
  describe mouse/right-stick aiming instead of Q/E and SPACE.
- Tests: rewrote the old Q/E-traverse test (tank) to prove twin-stick
  tracking instead (turret follows `aimAngle` regardless of hull heading,
  fires along the aim angle, doesn't fire without the trigger held); added
  a new heli test proving nose-tracking independent of translation and the
  held-F weapon swap; updated the gamepad-merge test for the new
  `getVector()`/`getAim()` split; added `aimAngle` to every other existing
  test that fires a weapon (turret-destruction, missile-vs-turret,
  particle/muzzle-flash, AI-vs-player combat) so they keep aiming at the
  same targets as before. All duel-mode/AI-combat tests were **not**
  touched at all -- the legacy `turretTurn` fallback path means the AI's
  aiming is completely unaffected. Stable across 5 consecutive
  `node test/sim.mjs` runs (ALL PASS).

Before milestone 2, the user separately asked two exploratory questions
(answered but explicitly NOT built): whether the game could support a second
*human* player instead of AI, and whether that human could be remote (a
friend on a different machine) rather than local split-screen. Both were
answered narratively only -- local split-screen is a moderate lift (mostly
duplicating the camera/HUD, since the AIDriver input-swap architecture
already proves a second controllable vehicle is cheap), remote play is a
materially bigger lift (needs a signaling/relay server or authoritative
server, a deterministic-or-state-synced simulation, and latency-hiding, none
of which exist today), and typical hosting costs for remote play land
anywhere from free (small usage, generous free tiers) to a few dollars a
month for a dedicated always-on relay. Nothing here was built or scoped
further; revisit only if the user asks to actually build either.

Milestone 1 (mirrored map + AI driving toward the flag, no combat) is
already confirmed live -- see the "milestone 1" write-up further down this
section for that verification trail (three commits' diff pages, a READY
Vercel deployment, and a live in-browser check). This entry covers what's
new in milestone 2.

**What shipped (milestone 2 -- "give the AI a weapon, staged first, before
vehicle-switching/flag-pickup/win-condition"):** the user asked specifically
for "shooting" on the AI opponent, and separately asked whether the AI could
also *switch vehicles* mid-run the way a human can (start armed to fight
through, switch to the jeep once the flag's gettable). That fuller
switching+flag-pickup+win-condition behavior was scoped as its own future
milestone (it pulls in the still-missing AI flag-pickup and win-condition
work too, not just switching) -- what's actually built here is the smaller,
explicitly staged first step: an armed, damageable AI.
- `src/aiDriver.js`: the AI now drives a **tank** instead of milestone 1's
  unarmed jeep (jeeps have no weapon by design in this game -- see
  `VEHICLE_TYPES.jeep`). New `_computeCombat(vehicle, target)` computes a
  turret-aim `turretTurn` and a fire decision, completely independent of the
  route-following steering logic above it -- exactly like a human tank's Q/E
  turret traverse works independently of where the hull is driving. Only
  does anything for a vehicle with `hasTurret`/`weapon` (a no-op for the
  jeep, so this is safe to call unconditionally regardless of which vehicle
  type ends up driving). Engagement range (560, close to a defensive
  turret's own 620) gates whether it bothers aiming at all; once in range, it
  only fires once the turret's aim error is under a small tolerance (0.12
  rad) -- no spraying wildly off-target. `update()`'s new third parameter
  (`target`, optional, defaults to `null`) carries the combat target; every
  existing call site that only cares about driving (including tests) keeps
  working unchanged.
- `src/game.js`: `_setupDuel()` was split into itself (one-time per-round
  setup: the player's flag target, a fresh `AIDriver`) plus a new
  `_spawnAI()` (vehicle + health + route), so respawning after death reuses
  the exact same spawn logic as round start instead of duplicating it. New
  `this.aiHealth` (mirrors `this.health`) and `this.aiRespawnTimer` (mirrors
  the player's `respawnTimer`/`"respawning"` state, reusing the same
  `RESPAWN_DELAY`). The AI's weapon-fire block in `update()` mirrors the
  player's own tank-cannon block almost line for line -- same `Bullet`
  construction, same muzzle flash -- except it's non-friendly (so it damages
  the player vehicle via the existing turret-fire collision path, not the
  friendly-fire-vs-turrets path) and deliberately skips the player's own
  powerup modifiers (a powerup the player picks up shouldn't buff the enemy).
  Symmetrically, the friendly-bullet collision loop (which already checked
  bullets against turrets) now also checks against `aiVehicle`, using the
  exact same piercing/hitTargets bookkeeping as the turret check right above
  it. On death: fiery explosion + camera shake (same treatment turrets and
  the player's own vehicle get), `aiRespawnTimer` starts counting down, and
  the AI is simply absent (no update, no draw) until it clears and
  `_spawnAI()` rebuilds it fresh at its base with a recomputed route and full
  health -- unlike the player, there's no lives cap on this yet (no
  win/loss condition exists to tie a "ran out of AI lives" state to), so it
  just keeps respawning indefinitely.
- `src/audio.js`: one new event, `aiFireCannon`, mapped to the same
  `_playCannonShot()` the player's own cannon uses -- same sound, kept as a
  distinct event name (rather than reusing `playerFireCannon`) so the event
  stream stays honest about who actually fired. Hits/destruction reuse the
  existing generic `vehicleHit`/`vehicleDestroyed` events unchanged (the
  sound content doesn't care whose vehicle got hit).
- 20 new test checks: `AIDriver` combat in isolation (empty route so the hull
  never moves -- turret sweeps onto and fires on an in-range/aimed target,
  stays silent with no target or one out of range, a jeep AI ignores combat
  entirely), and the whole thing wired into a real duel-mode `Game` (AI fire
  actually damages the player, sustained player fire actually destroys and
  respawns the AI at full health). All passing, stable across 5 consecutive
  `node test/sim.mjs` runs.

**What's explicitly still NOT here** (per the user's own staged-build
choice -- this was deliberately scoped smaller than the
switching/flag-pickup/win-condition idea discussed above): the AI can't
switch vehicles, can't pick up the player's flag (still rendered but inert),
and there's still no win/loss condition -- destroying the AI just respawns
it, there's no consequence either direction yet.

**What shipped (territorial turrets -- user follow-up after seeing milestone
2 work):** after trying duel mode combat, the user asked for a real
capture-the-flag feel: turrets should defend their own half of the mirrored
map rather than every turret universally gunning for the player. Implemented
as pure retargeting, no change to turret count/placement/layout (that's
still the same 8-turret layout spread unmirrored across the doubled route,
same as milestone 1 left it -- a separate, not-yet-requested follow-up):
- `src/entities.js`: `Bullet` gained a `targetsPlayer` field (default `true`,
  so every existing non-friendly-bullet call site -- single-player turret
  fire, the AI opponent's own cannon -- keeps meaning "hit the player"
  without any changes needed at those call sites). `Turret.update()` gained
  a matching `targetsPlayer` parameter (also defaulting to `true`) that it
  just forwards onto the `Bullet` it constructs.
- `src/game.js`: the turret-update loop now computes, per turret, per frame:
  in duel mode, is this turret's `y` north or south of `arena.height / 2` --
  the exact line `mirrorMap.js` reflected everything about, so it's already
  the natural halfway mark of the doubled map, no new geometry needed. North
  (your side) turrets target `aiVehicle` and pass `targetsPlayer: false`;
  south (the AI's side) turrets keep targeting `this.vehicle` with the
  default `true`. Outside duel mode (no `aiVehicle` to speak of) every
  turret keeps its old behavior unconditionally. A north turret with no live
  AI to shoot at (mid-respawn) just sits idle for that frame rather than
  aiming at a stale position.
- The bullet-vs-vehicle collision handling in `update()` now has three
  branches instead of two: friendly bullets (unchanged: turrets, and in duel
  mode the AI vehicle too), non-friendly bullets with `targetsPlayer: false`
  (new: territorial turret fire hits `aiVehicle`), and non-friendly bullets
  with `targetsPlayer: true` (unchanged: hits the player). The "what happens
  when the AI takes a hit" logic (damage, death, fireball, respawn timer)
  was factored into a new `_damageAI()` helper shared by this new branch and
  the existing friendly-fire-vs-aiVehicle branch, rather than duplicated.
- 12 new test checks: a turret on your side actually fires on and damages
  the AI (and not you, even though you're technically still on the map), a
  turret on the AI's side actually fires on and damages you (and not the
  AI), and an explicit single-player regression check that turrets still
  unconditionally target the player with no territoriality at all outside
  duel mode. All passing, stable across 5 consecutive `node test/sim.mjs`
  runs.

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
