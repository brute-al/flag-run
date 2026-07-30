import { Input } from "./input.js";
import { GamepadInput } from "./gamepadInput.js";
import { CombinedInput } from "./combinedInput.js";
import { Game } from "./game.js";
import { SoundEngine } from "./audio.js";
import { MusicPlayer } from "./music.js";
import { VEHICLE_TYPES } from "./vehicle.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const healthBar = document.getElementById("healthBar");
const flagStatusEl = document.getElementById("flagStatus");
const messageEl = document.getElementById("message");
const statusLineEl = document.getElementById("statusLine");
const powerupStatusEl = document.getElementById("powerupStatus");
const swapPromptEl = document.getElementById("swapPrompt");
const selectScreen = document.getElementById("selectScreen");

// Vehicle card copy comes straight from the same presets the game logic
// uses, so the picker can never drift out of sync with actual stats.
for (const card of document.querySelectorAll(".vehicleCard")) {
  const preset = VEHICLE_TYPES[card.dataset.vehicle];
  card.querySelector(".vDesc").textContent = preset.description;
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const keyboardInput = new Input();
const gamepadInput = new GamepadInput();
const input = new CombinedInput(keyboardInput, gamepadInput);
const game = new Game(input);
const sound = new SoundEngine();
const music = new MusicPlayer();

// Vehicle-select overlay is used two ways: `swapMode = false` starts a whole
// new round (game.chooseVehicle), `swapMode = true` swaps mid-round without
// touching the arena/flag/turrets/lives (game.switchVehicle), only available
// while parked in your own base.
let swapMode = false;

function openSelectScreen(isSwap) {
  swapMode = isSwap;
  if (isSwap) game.paused = true;
  else game.state = "select";
  selectScreen.classList.remove("hidden");
}

function closeSelectScreen() {
  game.paused = false;
  selectScreen.classList.add("hidden");
  swapMode = false;
}

for (const card of document.querySelectorAll(".vehicleCard")) {
  card.addEventListener("click", () => {
    sound.resume(); // first user gesture: unlock audio in browsers that require it
    music.resume();
    const type = card.dataset.vehicle;
    if (swapMode) game.switchVehicle(type);
    else game.chooseVehicle(type);
    closeSelectScreen();
  });
}

window.addEventListener("keydown", (e) => {
  sound.resume();
  music.resume();
  if (e.code === "KeyR") {
    openSelectScreen(false);
  } else if (e.code === "KeyV" && game.state === "playing" && !game.paused && game.isAtOwnBase()) {
    openSelectScreen(true);
  }
});

// Start/Y aren't part of the per-frame driving/firing vector, so they're
// polled here and edge-detected (only act on the frame the button first
// goes down) rather than repeating every frame it's held.
let prevGamepadRestart = false;
let prevGamepadSwap = false;

let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp to avoid huge steps on tab-switch
  lastTime = now;

  const restartHeld = gamepadInput.isRestartHeld();
  if (restartHeld && !prevGamepadRestart) {
    sound.resume();
    music.resume();
    openSelectScreen(false);
  }
  prevGamepadRestart = restartHeld;

  const swapHeld = gamepadInput.isSwapHeld();
  if (swapHeld && !prevGamepadSwap && game.state === "playing" && !game.paused && game.isAtOwnBase()) {
    sound.resume();
    music.resume();
    openSelectScreen(true);
  }
  prevGamepadSwap = swapHeld;

  game.update(dt);
  game.draw(ctx, canvas.width, canvas.height);

  for (const event of game.drainEvents()) {
    sound.handleEvent(event);
    music.handleEvent(event);
  }
  const engineActive = game.state === "playing";
  const speedFrac = engineActive ? game.vehicle.speed / game.vehicle.maxSpeed : 0;
  sound.setEngineIntensity(speedFrac, engineActive);

  const hud = game.getHudState();
  healthBar.style.width = `${hud.healthPct * 100}%`;
  flagStatusEl.textContent = hud.flagStatus;
  messageEl.textContent = hud.message;

  // Every vehicle type has its own finite life pool now (see game.js), so
  // show all three rather than just the jeep's.
  const jeepsText = hud.lives ? `JEEPS: ${hud.lives.jeep}` : "";
  const tanksText = hud.lives ? `TANKS: ${hud.lives.tank}` : "";
  const helisText = hud.lives ? `HELIS: ${hud.lives.heli}` : "";
  const weaponText = hud.weaponLabel ? `WEAPON: ${hud.weaponLabel.toUpperCase()} (SPACE)` : "";
  const weapon2Text = hud.weapon2Label ? `${hud.weapon2Label.toUpperCase()} (F)` : "";
  statusLineEl.textContent = [jeepsText, tanksText, helisText, weaponText, weapon2Text].filter(Boolean).join("   ·   ");

  if (hud.powerupLabel) {
    powerupStatusEl.textContent = `${hud.powerupLabel} ${Math.ceil(hud.powerupTimeLeft)}s`;
    powerupStatusEl.classList.remove("hidden");
  } else {
    powerupStatusEl.classList.add("hidden");
  }

  swapPromptEl.classList.toggle("hidden", !hud.canSwap || swapMode);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
