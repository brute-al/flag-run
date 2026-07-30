// Most sound effects are synthesized with the Web Audio API -- no sampled
// audio files needed for those, so there's nothing to license or fetch. The
// exception is gunfire and explosions: those four cues use short, real,
// CC0/royalty-free recordings (see sfx/ -- each one's source page is linked
// in DEPLOY_NOTES.md) layered in over the synthesized version, because a
// real recording reads as "war" in a way a pure oscillator/noise burst
// can't. Everything else (engine hum, missile whoosh, pickup chimes) is
// still fully synthesized. If a sample fails to load for any reason (slow
// network, blocked request, very old browser), every sample-backed cue
// below quietly falls back to its original synthesized version, so sound is
// never silently missing.
//
// The flag-run music cue itself is NOT handled here anymore -- it used to be
// a synthesized loop (`RunHomeMusic`) started on flagPickup, but that meant
// it played simultaneously underneath the real "flag-getting" song from
// music.js's MusicPlayer, layering an unwanted 8-bit-sounding loop under a
// real recording. music.js now owns that moment entirely.

const AudioContextClass = window.AudioContext || window.webkitAudioContext;

// Short real recordings layered onto the synthesized cues below (see the
// header comment). Paths are resolved relative to this module so it works
// regardless of what subpath the game is served from.
const SAMPLE_FILES = {
  gunshotRifle: "../sfx/gunshot-rifle.mp3", // turret fire + heli chaingun
  gunshotCannon: "../sfx/gunshot-cannon.mp3", // tank cannon
  explosionMedium: "../sfx/explosion-medium.mp3", // turret destroyed
  explosionLoud: "../sfx/explosion-loud.mp3", // vehicle/building destroyed
};

export class SoundEngine {
  constructor() {
    this.enabled = !!AudioContextClass;
    if (!this.enabled) return; // very old browser: sound quietly disabled

    this.ctx = new AudioContextClass();
    this.noiseBuffer = this._makeNoiseBuffer();
    this._buildEngineHum();

    // Sample buffers populate asynchronously; every sample-backed cue checks
    // `this.samples[name]` before playing and falls back to its
    // synthesized version if it isn't ready yet.
    this.samples = {};
    this._loadSamples();
  }

  async _loadSamples() {
    await Promise.all(
      Object.entries(SAMPLE_FILES).map(async ([name, relPath]) => {
        try {
          const url = new URL(relPath, import.meta.url).href;
          const res = await fetch(url);
          const arrayBuffer = await res.arrayBuffer();
          this.samples[name] = await this.ctx.decodeAudioData(arrayBuffer);
        } catch (err) {
          // Missing sample -- the caller's synthesized fallback covers this,
          // so this is a soft failure, just worth a note in the console.
          console.warn(`SoundEngine: couldn't load sample "${name}" (${relPath})`, err);
        }
      })
    );
  }

  // Plays a loaded sample with a little per-shot pitch/gain jitter so rapid
  // retriggering (the chaingun firing many times a second) doesn't sound
  // like the exact same clip stuck on a loop. Returns true if it actually
  // played something, false if that sample isn't loaded yet -- callers use
  // the return value to decide whether to fall back to their synthesized
  // version instead.
  _playSample(name, { gain = 0.5, rateJitter = 0.06 } = {}) {
    const buffer = this.samples[name];
    if (!buffer) return false;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * rateJitter;
    const g = this.ctx.createGain();
    g.gain.value = gain * (0.9 + Math.random() * 0.2);
    source.connect(g).connect(this.ctx.destination);
    source.start(now);
    return true;
  }

  // Must be called from within a user-gesture handler (keydown/click) —
  // browsers block audio until the page has seen interaction.
  resume() {
    if (this.enabled && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  _makeNoiseBuffer() {
    const length = this.ctx.sampleRate; // 1 second of white noise, reused for all bursts
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // A real engine reads more like filtered noise (air/mechanical rumble)
  // than a pure sawtooth buzz, so this layers looping filtered noise (the
  // "rumble") with a very quiet low-frequency oscillator (the "body" of the
  // note) — both much quieter than the original single loud oscillator.
  _buildEngineHum() {
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.ctx.destination);

    // Looping noise through a lowpass filter whose cutoff rises with speed —
    // this is most of the perceived "engine" sound.
    this.engineNoise = this.ctx.createBufferSource();
    this.engineNoise.buffer = this.noiseBuffer;
    this.engineNoise.loop = true;
    this.engineNoiseFilter = this.ctx.createBiquadFilter();
    this.engineNoiseFilter.type = "lowpass";
    this.engineNoiseFilter.Q.value = 0.7;
    this.engineNoiseFilter.frequency.value = 120;
    this.engineNoiseGain = this.ctx.createGain();
    this.engineNoiseGain.gain.value = 0.7; // relative mix under the shared engineGain
    this.engineNoise.connect(this.engineNoiseFilter);
    this.engineNoiseFilter.connect(this.engineNoiseGain);
    this.engineNoiseGain.connect(this.engineGain);
    this.engineNoise.start();

    // Faint low tone for a bit of rotational "body" under the noise.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 55;
    this.engineOscGain = this.ctx.createGain();
    this.engineOscGain.gain.value = 0.3; // relative mix under the shared engineGain
    this.engineOsc.connect(this.engineOscGain);
    this.engineOscGain.connect(this.engineGain);
    this.engineOsc.start();
  }

  // speedFrac: 0..1 fraction of top speed. active: whether a run is in progress.
  setEngineIntensity(speedFrac, active) {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    // Overall level kept low and understated — this is ambient background,
    // not a lead sound.
    const targetGain = active ? 0.028 + speedFrac * 0.032 : 0;
    const targetFilterFreq = 120 + speedFrac * 500;
    const targetOscFreq = 55 + speedFrac * 70;
    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.12);
    this.engineNoiseFilter.frequency.setTargetAtTime(targetFilterFreq, now, 0.12);
    this.engineOsc.frequency.setTargetAtTime(targetOscFreq, now, 0.12);
  }

  handleEvent(eventName) {
    if (!this.enabled) return;
    switch (eventName) {
      case "turretFire":
        this._playTurretFire();
        break;
      case "vehicleHit":
        this._playHit();
        break;
      case "vehicleDestroyed":
        this._playExplosion();
        break;
      case "flagPickup":
        this._playPickup();
        // The "now haul it home" music moment is handled by music.js's
        // MusicPlayer (a real song crossfades in) -- no synthesized loop
        // here anymore, see this file's header comment.
        break;
      case "flagCapture":
        this._playFanfare();
        break;
      case "playerFireCannon":
        this._playCannonShot();
        break;
      // Duel mode's AI opponent (milestone 2) fires the same tank cannon the
      // player does -- same sound, kept as its own event name (rather than
      // reusing "playerFireCannon") so the event stream stays honest about
      // who actually fired.
      case "aiFireCannon":
        this._playCannonShot();
        break;
      case "playerFireMg":
        this._playChaingunShot();
        break;
      case "playerFireMissile":
        this._playMissileShot();
        break;
      case "turretHit":
        this._playTurretHit();
        break;
      case "turretDestroyed":
        this._playSmallExplosion();
        break;
      case "buildingHit":
        this._playMetalHit();
        break;
      case "buildingDestroyed":
        this._playExplosion();
        break;
      case "powerupPickup":
        this._playPowerupPickup();
        break;
      case "powerupExpired":
        this._playPowerupExpired();
        break;
    }
  }

  // Short pitch-drop blip — the turret's "pew". Prefers the real rifle
  // gunshot sample (see header comment); falls back to the synthesized
  // blip below if that sample isn't loaded yet.
  _playTurretFire() {
    if (this._playSample("gunshotRifle", { gain: 0.32, rateJitter: 0.08 })) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.12);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  // Sharp filtered noise thud — taking a hit.
  _playHit() {
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start(now);
    source.stop(now + 0.16);
  }

  // Longer, bassier filtered noise sweep — vehicle/building destroyed.
  // Prefers the real "loud explosion" recording; falls back to the
  // synthesized sweep below if that sample isn't loaded yet.
  _playExplosion() {
    if (this._playSample("explosionLoud", { gain: 0.55 })) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.7;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2200, now);
    filter.frequency.exponentialRampToValueAtTime(80, now + 0.6);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start(now);
    source.stop(now + 0.7);
  }

  // Shorter, quieter version of the explosion — a turret going down is a
  // smaller event than losing your own vehicle. Prefers the real "medium
  // explosion" recording; falls back to the synthesized version below.
  _playSmallExplosion() {
    if (this._playSample("explosionMedium", { gain: 0.45 })) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.9;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + 0.35);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start(now);
    source.stop(now + 0.4);
  }

  // High, ringing bandpass noise burst — a non-lethal hit on a turret's armor.
  _playMetalHit() {
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1900;
    filter.Q.value = 3;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start(now);
    source.stop(now + 0.1);
  }

  // A bright metallic "clang" — landing a hit on an enemy turret specifically.
  // Distinct from the generic _playMetalHit() (used for turret armor grazes
  // that aren't the satisfying confirmation cue, and for buildings): this
  // layers a short ringing bell-like tone (two close, slightly detuned
  // oscillators for a metallic beat) over a sharp high-passed noise
  // transient, so a solid hit on a turret reads as its own rewarding "clank"
  // instead of blending into every other impact sound.
  _playTurretHit() {
    const now = this.ctx.currentTime;

    const bell1 = this.ctx.createOscillator();
    bell1.type = "triangle";
    bell1.frequency.setValueAtTime(1600, now);
    bell1.frequency.exponentialRampToValueAtTime(950, now + 0.09);
    const bell2 = this.ctx.createOscillator();
    bell2.type = "triangle";
    bell2.frequency.setValueAtTime(1660, now);
    bell2.frequency.exponentialRampToValueAtTime(980, now + 0.09);
    const bellGain = this.ctx.createGain();
    bellGain.gain.setValueAtTime(0.001, now);
    bellGain.gain.exponentialRampToValueAtTime(0.24, now + 0.008);
    bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    bell1.connect(bellGain);
    bell2.connect(bellGain);
    bellGain.connect(this.ctx.destination);
    bell1.start(now);
    bell1.stop(now + 0.17);
    bell2.start(now);
    bell2.stop(now + 0.17);

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2600;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.16, now + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    source.connect(filter).connect(noiseGain).connect(this.ctx.destination);
    source.start(now);
    source.stop(now + 0.06);
  }

  // Low, heavy thump — the tank's cannon firing. Prefers the real, heavier
  // gunshot sample; falls back to the synthesized thump below.
  _playCannonShot() {
    if (this._playSample("gunshotCannon", { gain: 0.5, rateJitter: 0.05 })) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.18);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain).connect(this.ctx.destination);
    source.connect(noiseGain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
    source.start(now);
    source.stop(now + 0.08);
  }

  // Quick, bright blip — the helicopter's chaingun firing (called rapidly).
  // Prefers the real rifle gunshot sample with extra pitch jitter (since
  // this retriggers many times a second, more variance keeps it from
  // sounding like a single clip stuck on repeat); falls back to the
  // synthesized blip below.
  _playChaingunShot() {
    if (this._playSample("gunshotRifle", { gain: 0.26, rateJitter: 0.12 })) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  // A short low-to-high-to-low "whoosh" -- filtered noise sweep plus a
  // descending sawtooth -- distinct from both the cannon's thud and the
  // chaingun's quick blip, for the heli's slower, heavier missile.
  _playMissileShot() {
    const now = this.ctx.currentTime;

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.3);
    filter.Q.value = 1.2;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.24, now + 0.03);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.3);
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.exponentialRampToValueAtTime(0.14, now + 0.03);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    source.connect(filter).connect(noiseGain).connect(this.ctx.destination);
    osc.connect(oscGain).connect(this.ctx.destination);
    source.start(now);
    source.stop(now + 0.32);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  // Quick two-note rising chime — flag grabbed.
  _playPickup() {
    this._playNoteSequence([
      { freq: 520, start: 0, dur: 0.1 },
      { freq: 780, start: 0.09, dur: 0.15 },
    ]);
  }

  // Three-note ascending fanfare — mission complete.
  _playFanfare() {
    this._playNoteSequence([
      { freq: 523, start: 0, dur: 0.16 },
      { freq: 659, start: 0.15, dur: 0.16 },
      { freq: 784, start: 0.3, dur: 0.35 },
    ]);
  }

  // A quick sparkly ascending run -- grabbing a hidden powerup out of a
  // downed building. Brighter and faster than the flag's two-note pickup
  // chime so the two don't get confused, and layered with a short shimmer
  // of high-passed noise for a bit of "magic" glint.
  _playPowerupPickup() {
    this._playNoteSequence([
      { freq: 660, start: 0, dur: 0.08 },
      { freq: 880, start: 0.06, dur: 0.08 },
      { freq: 1108, start: 0.12, dur: 0.2 },
    ]);

    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 4000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start(now);
    source.stop(now + 0.24);
  }

  // A short descending blip -- the active buff has just run out. Quiet and
  // unobtrusive since it's an incidental status change, not a big event.
  _playPowerupExpired() {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.25);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  _playNoteSequence(notes) {
    const base = this.ctx.currentTime;
    for (const note of notes) {
      const start = base + note.start;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + note.dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + note.dur + 0.02);
    }
  }
}
