/**
 * Synthesised sound effects and music (no external audio files, no licensing questions).
 * The AudioContext is created lazily on the first player gesture to satisfy
 * browser autoplay policies.
 *
 * Effects and music have separate switches: `muted` covers every sound effect, `musicEnabled`
 * covers the background score. Muting one never silences the other.
 */
import { AUDIO, MUSIC } from '../config';
import { loadMusicEnabled, loadMuted, loadVolume, saveMusicEnabled, saveMuted, saveVolume } from './Storage';

export type MusicMood = 'menu' | 'game';

interface MusicMoodSpec {
  readonly stepMs: number;
  readonly wave: OscillatorType;
  readonly gain: number;
  readonly chords: readonly (readonly number[])[];
  readonly bell?: readonly number[];
  readonly bellEverySteps?: number;
  readonly bellGain?: number;
}

export type SoundName =
  | 'shoot'
  | 'shotgun'
  | 'hit'
  | 'hurt'
  | 'pickup'
  | 'explode'
  | 'blast'
  | 'wave'
  | 'boss'
  | 'gameover'
  | 'dash'
  | 'click';

interface ToneOptions {
  from: number;
  to?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

interface NoiseOptions {
  duration: number;
  gain?: number;
  filter?: BiquadFilterType;
  frequency?: number;
  frequencyTo?: number;
  delay?: number;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  /** Sound effects only; the music is governed by `musicEnabled` instead. */
  private muted = false;
  private currentVolume: number = AUDIO.masterVolume;
  private musicEnabled = true;
  private musicWanted = false;
  private musicMood: MusicMood = 'menu';
  private musicBus: GainNode | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      this.muted = loadMuted();
      this.currentVolume = loadVolume();
      this.musicEnabled = loadMusicEnabled();
    }
  }

  /** Call from a user gesture (menu play button, first click). Safe to call often. */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => this.startMusic());
      return;
    }
    this.startMusic();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get volume(): number {
    return this.currentVolume;
  }

  /** Mutes every sound effect. The music plays through its own bus and gain, so it is unaffected. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    saveMuted(muted);
    if (!muted) this.unlock();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  get isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  /** Options toggle: on resumes whatever mood the current scene last asked for. */
  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    saveMusicEnabled(enabled);
    if (enabled) {
      this.startMusic();
      return;
    }
    this.stopMusicTimer();
    this.fadeMusic(0);
  }

  toggleMusic(): boolean {
    this.setMusicEnabled(!this.musicEnabled);
    this.unlock();
    return this.musicEnabled;
  }

  /**
   * The two audio switches exactly as the M and N keys drive them, shared by every scene: unlock on
   * the key press (browsers only start audio from a gesture), toggle the bus, and beep only when
   * turning sound back on — a click played while muting is the one nobody can hear anyway.
   */
  toggleMusicBus(): void {
    this.unlock();
    if (this.toggleMusic()) this.play('click');
  }

  toggleSoundBus(): void {
    this.unlock();
    if (!this.toggleMute()) this.play('click');
  }

  /**
   * Menu and run each ask for their own mood. Switching mood restarts the progression from the top;
   * asking for the mood already playing is a no-op so scene restarts never hiccup.
   */
  playMusic(mood: MusicMood): void {
    this.musicWanted = true;
    if (mood !== this.musicMood) {
      this.musicMood = mood;
      this.musicStep = 0;
      this.stopMusicTimer();
    }
    this.startMusic();
  }

  /** Silence the music for good until something asks for a mood again. */
  stopMusic(): void {
    this.musicWanted = false;
    this.stopMusicTimer();
    this.fadeMusic(0);
  }

  private get moodSpec(): MusicMoodSpec {
    return this.musicMood === 'game' ? MUSIC.game : MUSIC.menu;
  }

  private startMusic(): void {
    if (!this.musicEnabled || !this.musicWanted) return;
    const ctx = this.ctx;
    // Autoplay policy: nothing starts until unlock() has resumed the context.
    if (!ctx || ctx.state !== 'running') return;

    if (!this.musicBus) {
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.0001;
      this.musicBus.connect(this.master ?? ctx.destination);
    }
    this.fadeMusic(1);

    if (this.musicTimer === null) {
      this.musicStep = 0;
      this.musicTimer = setInterval(() => this.playMusicStep(), this.moodSpec.stepMs);
      this.playMusicStep();
    }
  }

  private stopMusicTimer(): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private fadeMusic(level: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const target = Math.max(0.0001, level * MUSIC.volume);
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), ctx.currentTime);
    bus.gain.linearRampToValueAtTime(target, ctx.currentTime + MUSIC.fadeMs / 1000);
  }

  /** One chord of the loop. Runs on a timer, so it never depends on the Phaser clock. */
  private playMusicStep(): void {
    const spec = this.moodSpec;
    const chord = spec.chords[this.musicStep % spec.chords.length];
    const ring = (spec.stepMs / 1000) * MUSIC.sustain;

    if (this.ctx && this.musicBus && chord) {
      for (const frequency of chord) {
        this.musicNote(frequency, ring, spec.wave, spec.gain, MUSIC.attackFraction);
      }
      if (spec.bell && spec.bellEverySteps && spec.bellGain) {
        const every = spec.bellEverySteps;
        if (this.musicStep % every === 0) {
          const bell = spec.bell[(this.musicStep / every) % spec.bell.length];
          if (bell) this.musicNote(bell, ring * 0.6, 'sine', spec.bellGain, 0.02);
        }
      }
    }

    this.musicStep += 1;
  }

  private musicNote(
    frequency: number,
    durationSec: number,
    type: OscillatorType,
    gain: number,
    attackFraction: number,
  ): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const start = ctx.currentTime;
    const end = start + durationSec;
    const attackEnd = start + durationSec * attackFraction;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, frequency), start);

    const peak = Math.max(0.0001, gain);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(peak, attackEnd);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(env).connect(bus);
    osc.start(start);
    osc.stop(end + 0.05);
  }

  setVolume(volume: number): void {
    this.currentVolume = Math.min(1, Math.max(0, volume));
    saveVolume(this.currentVolume);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.currentVolume, this.ctx.currentTime, 0.02);
    }
  }

  play(name: SoundName): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    switch (name) {
      case 'shoot':
        this.tone({ from: 720, to: 340, duration: 0.07, type: 'square', gain: 0.16 });
        this.noise({ duration: 0.05, gain: 0.08, filter: 'highpass', frequency: 1800 });
        break;
      case 'shotgun':
        this.noise({ duration: 0.16, gain: 0.22, filter: 'lowpass', frequency: 2600, frequencyTo: 500 });
        this.tone({ from: 220, to: 90, duration: 0.16, type: 'sawtooth', gain: 0.14 });
        break;
      case 'hit':
        this.noise({ duration: 0.05, gain: 0.1, filter: 'bandpass', frequency: 1200 });
        break;
      case 'hurt':
        this.tone({ from: 240, to: 70, duration: 0.26, type: 'sawtooth', gain: 0.22 });
        this.noise({ duration: 0.2, gain: 0.14, filter: 'lowpass', frequency: 900 });
        break;
      case 'pickup':
        this.tone({ from: 620, to: 940, duration: 0.11, type: 'sine', gain: 0.18 });
        this.tone({ from: 940, to: 1320, duration: 0.1, type: 'sine', gain: 0.12, delay: 0.09 });
        break;
      case 'explode':
        this.noise({ duration: 0.32, gain: 0.2, filter: 'lowpass', frequency: 1600, frequencyTo: 180 });
        this.tone({ from: 140, to: 50, duration: 0.3, type: 'sine', gain: 0.18 });
        break;
      // Thrown-bomb detonation: deeper, longer and louder than 'explode', with a sharp crack on
      // top so a 5-damage hit still feels like the heaviest thing on the field.
      case 'blast':
        this.noise({ duration: 0.5, gain: 0.28, filter: 'lowpass', frequency: 2400, frequencyTo: 110 });
        this.noise({ duration: 0.08, gain: 0.16, filter: 'highpass', frequency: 3400 });
        this.tone({ from: 190, to: 36, duration: 0.46, type: 'sine', gain: 0.32 });
        this.tone({ from: 96, to: 44, duration: 0.62, type: 'triangle', gain: 0.24, delay: 0.03 });
        break;
      case 'wave':
        this.tone({ from: 440, to: 440, duration: 0.12, type: 'triangle', gain: 0.14 });
        this.tone({ from: 660, to: 660, duration: 0.16, type: 'triangle', gain: 0.14, delay: 0.13 });
        break;
      case 'boss':
        this.tone({ from: 110, to: 70, duration: 0.7, type: 'sawtooth', gain: 0.2 });
        this.noise({ duration: 0.6, gain: 0.12, filter: 'lowpass', frequency: 400 });
        break;
      case 'gameover':
        this.tone({ from: 320, to: 120, duration: 0.9, type: 'sawtooth', gain: 0.18 });
        this.tone({ from: 240, to: 90, duration: 1.0, type: 'triangle', gain: 0.12, delay: 0.12 });
        break;
      // Dash: a short airy whoosh, brighter than a bomb and much shorter.
      case 'dash':
        this.noise({ duration: 0.18, gain: 0.12, filter: 'bandpass', frequency: 900, frequencyTo: 2400 });
        this.tone({ from: 320, to: 760, duration: 0.12, type: 'sine', gain: 0.1 });
        break;
      case 'click':
        this.tone({ from: 880, to: 880, duration: 0.04, type: 'sine', gain: 0.1 });
        break;
      default:
        break;
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.currentVolume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private tone(options: ToneOptions): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const start = ctx.currentTime + (options.delay ?? 0);
    const end = start + options.duration;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = options.type ?? 'square';
    osc.frequency.setValueAtTime(Math.max(20, options.from), start);
    if (options.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), end);
    }

    const peak = Math.max(0.0001, options.gain ?? 0.15);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  private noise(options: NoiseOptions): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 1);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }

    const start = ctx.currentTime + (options.delay ?? 0);
    const end = start + options.duration;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    source.buffer = this.noiseBuffer;
    filter.type = options.filter ?? 'lowpass';
    filter.frequency.setValueAtTime(Math.max(60, options.frequency ?? 1200), start);
    if (options.frequencyTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, options.frequencyTo), end);
    }

    const peak = Math.max(0.0001, options.gain ?? 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    source.connect(filter).connect(gain).connect(master);
    source.start(start);
    source.stop(end + 0.02);
  }
}

export const audio = new AudioManager();
