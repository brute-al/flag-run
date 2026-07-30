// Background music: a few longer tracks loop quietly during normal play,
// one of them picked at random each time a new round starts. When the flag
// is picked up, the background track crossfades out and a dedicated
// "flag-getting" track crossfades in; dropping or capturing the flag
// crossfades back to a background track. This uses plain <audio> elements
// rather than the Web Audio API machinery in audio.js, since these are full
// songs (a few MB each) rather than short one-shot cues -- streaming/looping
// a whole file through <audio> is simpler and avoids decoding minutes of
// PCM into memory up front. Purely decorative, same as effects.js: nothing
// here reads or writes gameplay state, so the headless test suite (which
// never touches the DOM's <audio>/Audio APIs) is unaffected -- `enabled`
// just comes back false in Node and every method below becomes a no-op.
const BACKGROUND_TRACKS = ["../music/battle-rage.mp3", "../music/battle-eternity.mp3", "../music/battle-song.mp3"];
const FLAG_TRACK = "../music/flag-getting.mp3";

const BG_VOLUME = 0.32;
const FLAG_VOLUME = 0.38;
const FADE_MS = 1200;

export class MusicPlayer {
  constructor() {
    this.enabled = typeof Audio !== "undefined";
    if (!this.enabled) return;

    this.bg = new Audio(new URL(BACKGROUND_TRACKS[0], import.meta.url).href);
    this.bg.loop = true;
    this.bg.volume = 0;

    this.flag = new Audio(new URL(FLAG_TRACK, import.meta.url).href);
    this.flag.loop = true;
    this.flag.volume = 0;

    this._unlocked = false;
    this._fades = new Map(); // audio element -> interval id, so a new fade cancels one already in flight
  }

  // Must be called from within a user-gesture handler (keydown/click), same
  // requirement as SoundEngine.resume(). Playing (then immediately pausing)
  // each element once inside a real gesture registers this page/tab as
  // having audio permission, so the *next* play() call -- triggered later
  // from a game event, not directly from the click -- isn't blocked by the
  // browser's autoplay policy.
  resume() {
    if (!this.enabled || this._unlocked) return;
    this._unlocked = true;
    for (const el of [this.bg, this.flag]) {
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      el.pause();
    }
  }

  handleEvent(eventName) {
    if (!this.enabled) return;
    if (eventName === "roundReset") this._startRound();
    else if (eventName === "flagPickup") this._crossfade(this.flag, this.bg);
    else if (eventName === "flagCapture" || eventName === "flagDropped") this._crossfade(this.bg, this.flag);
  }

  // Picks a fresh random background track for the new round and fades it
  // in from silence; the flag track is reset to the start and silenced so
  // it's ready to go the next time the flag is picked up.
  _startRound() {
    const track = BACKGROUND_TRACKS[Math.floor(Math.random() * BACKGROUND_TRACKS.length)];
    const url = new URL(track, import.meta.url).href;
    if (this.bg.src !== url) this.bg.src = url;
    this.bg.currentTime = 0;
    this.flag.pause();
    this.flag.currentTime = 0;
    const playPromise = this.bg.play();
    if (playPromise && playPromise.catch) playPromise.catch(() => {});
    this._fadeTo(this.bg, BG_VOLUME);
    this._fadeTo(this.flag, 0);
  }

  // Fades `inEl` up to its target volume while fading `outEl` down to 0.
  _crossfade(inEl, outEl) {
    if (inEl.paused) {
      inEl.currentTime = 0;
      const playPromise = inEl.play();
      if (playPromise && playPromise.catch) playPromise.catch(() => {});
    }
    const target = inEl === this.bg ? BG_VOLUME : FLAG_VOLUME;
    this._fadeTo(inEl, target);
    this._fadeTo(outEl, 0);
  }

  _fadeTo(el, target) {
    const existing = this._fades.get(el);
    if (existing) clearInterval(existing);
    const start = el.volume;
    const startTime = performance.now();
    const id = setInterval(() => {
      const t = Math.min(1, (performance.now() - startTime) / FADE_MS);
      el.volume = start + (target - start) * t;
      if (t >= 1) {
        clearInterval(id);
        this._fades.delete(el);
      }
    }, 50);
    this._fades.set(el, id);
  }
}
