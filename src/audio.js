// All sound effects are synthesized with the Web Audio API — no sampled
// audio files, so there's nothing to license or fetch. Two kinds of sound:
// a continuous "engine hum" oscillator whose pitch/volume track vehicle
// speed, and short one-shot cues (tones or filtered noise bursts) fired in
// response to game events.

const AudioContextClass = window.AudioContext || window.webkitAudioContext;

export class SoundEngine {
  constructor() {
    this.enabled = !!AudioContextClass;
    if (!this.enabled) return; // very old browser: sound quietly disabled

    this.ctx = new AudioContextClass();
    this.noiseBuffer = this._makeNoiseBuffer();
    this._buildEngineHum();
    this.tension = new RunHomeMusic(this.ctx, this.noiseBuffer);
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
        // Only the jeep can ever trigger a pickup, so this is exactly the
        // "now haul it home under fire" moment -- kick in the tense loop.
        this.tension.start();
        break;
      case "flagCapture":
        this._playFanfare();
        this.tension.stop();
        break;
      case "flagDropped":
        // Carrier went down mid-run and the flag hit the ground -- the
        // "hauling it home" tension is over until it's picked up again.
        this.tension.stop();
        break;
      case "roundReset":
        this.tension.stop(true);
        break;
      case "playerFireCannon":
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

  // Short pitch-drop blip — the turret's "pew".
  _playTurretFire() {
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

  // Longer, bassier filtered noise sweep — vehicle destroyed.
  _playExplosion() {
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
  // smaller event than losing your own vehicle.
  _playSmallExplosion() {
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

  // Low, heavy thump — the tank's cannon firing.
  _playCannonShot() {
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
  _playChaingunShot() {
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

// A small looping "let's go" cue for the jeep's run home with the flag: a
// bright, driving bass riff in a consonant major key under a syncopated
// upbeat and a crisp shaker-like tick -- meant to feel like a triumphant
// getaway, not a horror-movie dread drone (that's what this replaced).
// Entirely synthesized (oscillators + filtered noise), same as every other
// sound in this file -- nothing sampled, so there's no licensing question
// and no audio file to fetch. Runs on a standard Web Audio "lookahead
// scheduler" (schedule a little ahead of real time, re-check on a short
// interval) so the beat stays tight even though setTimeout itself isn't
// precise.
class RunHomeMusic {
  constructor(ctx, sharedNoiseBuffer) {
    this.ctx = ctx;
    this.noiseBuffer = sharedNoiseBuffer;
    this.playing = false;
    this.tempo = 150; // bpm -- brisk and driving, a sprint not a dirge
    this.beatDuration = 60 / this.tempo;
    this.nextNoteTime = 0;
    this.beatIndex = 0;
    this.schedulerTimer = null;

    // An 8-beat bass riff walking a bright, consonant A-major-flavored
    // progression (A - C#4 - E4 - A - B3 - C#4) -- replaces the old drone's
    // deliberately dissonant interval with something that actually resolves.
    this.bassNotes = [220, 220, 277.18, 329.63, 220, 220, 246.94, 277.18];

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.ctx.destination);
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(1, now, 0.15);
    this.beatIndex = 0;
    this.nextNoteTime = now + 0.05;
    this._scheduleLoop();
  }

  // `hard` skips the fade-out, used on a full round reset where we want
  // silence immediately rather than a lingering tail into the next round.
  stop(hard = false) {
    if (!this.playing && !hard) return;
    this.playing = false;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(0, now, hard ? 0.05 : 0.3);
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  _scheduleLoop() {
    if (!this.playing) return;
    // Schedule any beats that fall within the next 150ms, then check back
    // in 50ms -- keeps the actual note timing sample-accurate (set via the
    // AudioContext clock) regardless of setTimeout jitter.
    while (this.nextNoteTime < this.ctx.currentTime + 0.15) {
      this._scheduleBeat(this.beatIndex, this.nextNoteTime);
      this.beatIndex++;
      this.nextNoteTime += this.beatDuration;
    }
    this.schedulerTimer = setTimeout(() => this._scheduleLoop(), 50);
  }

  _scheduleBeat(index, time) {
    // A punchy, filtered plucked bass note on every beat, stepping through
    // the riff -- the harmonic engine of the cue.
    const note = this.bassNotes[index % this.bassNotes.length];
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(note, time);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, time);
    filter.frequency.exponentialRampToValueAtTime(500, time + 0.18);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.24, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    osc.connect(filter).connect(gain).connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.24);

    // A bright triangle note on the off-beat ("and"), an octave up from the
    // bass -- this syncopation is what gives the loop forward momentum
    // instead of a flat, plodding pulse.
    const upTime = time + this.beatDuration / 2;
    const up = this.ctx.createOscillator();
    const upGain = this.ctx.createGain();
    up.type = "triangle";
    up.frequency.value = note * 2;
    upGain.gain.setValueAtTime(0.001, upTime);
    upGain.gain.exponentialRampToValueAtTime(0.1, upTime + 0.01);
    upGain.gain.exponentialRampToValueAtTime(0.001, upTime + 0.1);
    up.connect(upGain).connect(this.masterGain);
    up.start(upTime);
    up.stop(upTime + 0.12);

    // A crisp shaker-like tick every beat (louder on the downbeat), keeping
    // the groove feeling energetic rather than sparse.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hatFilter = this.ctx.createBiquadFilter();
    hatFilter.type = "highpass";
    hatFilter.frequency.value = 6000;
    const tickGain = this.ctx.createGain();
    tickGain.gain.setValueAtTime(0.001, time);
    tickGain.gain.exponentialRampToValueAtTime(index % 2 === 0 ? 0.1 : 0.05, time + 0.003);
    tickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(hatFilter).connect(tickGain).connect(this.masterGain);
    src.start(time);
    src.stop(time + 0.05);
  }
}
