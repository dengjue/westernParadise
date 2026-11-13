import type { AppEventMap, EventBusLike, WeatherId, WeatherPreset } from '@/00-types';
import { AUDIO } from '@/01-shared';
import { Rng } from '@/02-core';

export interface AmbientAudioOptions {
  readonly eventTarget: EventTarget;
  readonly events: EventBusLike<AppEventMap>;
  readonly contextFactory: () => AudioContext;
  readonly seed: number;
  readonly weather: WeatherPreset;
  readonly weatherPresets: Readonly<Record<WeatherId, WeatherPreset>>;
  readonly noAudio: boolean;
}

/**
 * 手势门控的自然声床：不加载文件，只在用户第一次键盘/指针操作后创建 Web Audio 图。
 * 低通噪声承担风与远景底噪，高通噪声承担雨声，短振荡器音承担脚步和檐铃。
 */
export class AmbientAudio {
  private readonly eventTarget: EventTarget;
  private readonly contextFactory: () => AudioContext;
  private readonly seed: number;
  private readonly weatherPresets: Readonly<Record<WeatherId, WeatherPreset>>;
  private readonly noAudio: boolean;
  private readonly removeWeatherChanged: () => void;
  private readonly removePlayerStep: () => void;
  private readonly removeAudioRequest: () => void;
  private enabled = true;
  private currentWeather: WeatherPreset;
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private readonly noiseSources: AudioBufferSourceNode[] = [];
  private started = false;
  private disposed = false;
  private bellElapsedMs = 0;

  constructor(options: AmbientAudioOptions) {
    this.eventTarget = options.eventTarget;
    this.contextFactory = options.contextFactory;
    this.seed = options.seed;
    this.weatherPresets = options.weatherPresets;
    this.noAudio = options.noAudio;
    this.currentWeather = options.weather;
    this.removeAudioRequest = options.events.on('audio:request', ({ enabled }) => {
      this.enabled = enabled;
      if (enabled) void this.start();
      if (this.context && this.masterGain) {
        this.masterGain.gain.setTargetAtTime(
          enabled ? AUDIO.masterGain : 0,
          this.context.currentTime,
          0.12,
        );
      }
    });
    this.removeWeatherChanged = options.events.on('weather:changed', ({ to }) => {
      this.currentWeather = this.weatherPresets[to];
      this.applyRainGain();
    });
    this.removePlayerStep = options.events.on('player:step', ({ surface }) => {
      this.playFootstep(surface);
    });

    if (!this.noAudio) {
      this.eventTarget.addEventListener('keydown', this.onUserGesture);
      this.eventTarget.addEventListener('pointerdown', this.onUserGesture);
    }
  }

  get isStarted(): boolean {
    return this.started;
  }

  update(stepMs: number): void {
    if (!this.started || this.context === null) {
      return;
    }
    this.bellElapsedMs += Math.max(0, stepMs);
    if (this.bellElapsedMs >= AUDIO.bell.intervalMs) {
      this.bellElapsedMs %= AUDIO.bell.intervalMs;
      this.playBell();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.removeWeatherChanged();
    this.removePlayerStep();
    this.removeAudioRequest();
    this.eventTarget.removeEventListener('keydown', this.onUserGesture);
    this.eventTarget.removeEventListener('pointerdown', this.onUserGesture);
    this.stopGraph();
  }

  private readonly onUserGesture = (_event: Event): void => {
    void this.start();
  };

  private async start(): Promise<void> {
    if (this.started || this.disposed || this.noAudio) {
      return;
    }
    this.started = true;
    try {
      const context = this.contextFactory();
      this.context = context;
      this.createGraph(context);
      await context.resume();
    } catch {
      this.stopGraph();
      this.started = false;
    }
  }

  private createGraph(context: AudioContext): void {
    const now = context.currentTime;
    this.masterGain = context.createGain();
    this.masterGain.gain.setValueAtTime(this.enabled ? AUDIO.masterGain : 0, now);
    this.masterGain.connect(context.destination);

    const noiseBuffer = this.createNoiseBuffer(context);
    const windSource = context.createBufferSource();
    windSource.buffer = noiseBuffer;
    windSource.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(AUDIO.wind.lowPassHz, now);
    const windGain = context.createGain();
    windGain.gain.setValueAtTime(AUDIO.wind.gain, now);
    windSource.connect(windFilter).connect(windGain).connect(this.masterGain);

    const distantSource = context.createBufferSource();
    distantSource.buffer = noiseBuffer;
    distantSource.loop = true;
    const distantFilter = context.createBiquadFilter();
    distantFilter.type = 'lowpass';
    distantFilter.frequency.setValueAtTime(AUDIO.distant.lowPassHz, now);
    const distantGain = context.createGain();
    distantGain.gain.setValueAtTime(AUDIO.distant.gain, now);
    distantSource.connect(distantFilter).connect(distantGain).connect(this.masterGain);

    const rainSource = context.createBufferSource();
    rainSource.buffer = noiseBuffer;
    rainSource.loop = true;
    const rainFilter = context.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.setValueAtTime(AUDIO.rain.highPassHz, now);
    this.rainGain = context.createGain();
    this.rainGain.gain.setValueAtTime(0, now);
    rainSource.connect(rainFilter).connect(this.rainGain).connect(this.masterGain);

    this.noiseSources.push(windSource, distantSource, rainSource);
    for (const source of this.noiseSources) {
      source.start(now);
    }
    this.applyRainGain();
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const sampleCount = Math.max(1, Math.floor(context.sampleRate * AUDIO.noiseBufferSeconds));
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    const rng = new Rng(this.seed);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = rng.next() * 2 - 1;
    }
    return buffer;
  }

  private applyRainGain(): void {
    if (this.context === null || this.rainGain === null) {
      return;
    }
    const now = this.context.currentTime;
    const target = AUDIO.rain.gain * this.currentWeather.precipitation.audioGain;
    this.rainGain.gain.cancelScheduledValues(now);
    this.rainGain.gain.setValueAtTime(this.rainGain.gain.value, now);
    this.rainGain.gain.linearRampToValueAtTime(target, now + AUDIO.fadeSeconds);
  }

  private playFootstep(surface: 'ground' | 'platform'): void {
    if (this.context === null || this.masterGain === null || !this.started) {
      return;
    }
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(
      surface === 'platform'
        ? AUDIO.footsteps.platformFrequencyHz
        : AUDIO.footsteps.groundFrequencyHz,
      now,
    );
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(AUDIO.footsteps.gain, now + AUDIO.footsteps.attackSeconds);
    gain.gain.linearRampToValueAtTime(0, now + AUDIO.footsteps.releaseSeconds);
    oscillator.connect(gain).connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + AUDIO.footsteps.releaseSeconds);
  }

  private playBell(): void {
    if (this.context === null || this.masterGain === null || !this.started) {
      return;
    }
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(AUDIO.bell.frequencyHz, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(AUDIO.bell.gain, now + AUDIO.bell.attackSeconds);
    gain.gain.linearRampToValueAtTime(0, now + AUDIO.bell.releaseSeconds);
    oscillator.connect(gain).connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + AUDIO.bell.releaseSeconds);
  }

  private stopGraph(): void {
    for (const source of this.noiseSources) {
      try {
        source.stop();
      } catch {
        // 已停止的 source 不影响其它音频节点释放。
      }
      source.disconnect();
    }
    this.noiseSources.length = 0;
    this.masterGain?.disconnect();
    const context = this.context;
    this.context = null;
    this.masterGain = null;
    this.rainGain = null;
    if (context !== null) {
      void context.close().catch(() => undefined);
    }
  }
}
