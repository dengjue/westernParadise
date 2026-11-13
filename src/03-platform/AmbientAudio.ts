import type { AppEventMap, EventBusLike, WeatherId, WeatherPreset } from '@/00-types';
import { AUDIO, LAND_SOUND } from '@/01-shared';
import { Rng } from '@/02-core';

export interface AmbientAudioOptions {
  readonly eventTarget: EventTarget;
  readonly events: EventBusLike<AppEventMap>;
  readonly contextFactory: () => AudioContext;
  readonly seed: number;
  readonly weather: WeatherPreset;
  readonly weatherPresets: Readonly<Record<WeatherId, WeatherPreset>>;
  readonly noAudio: boolean;
  readonly spatial?: boolean;
}

function distanceWeight(
  source: { x: number; y: number; z: number; radius: number },
  x: number,
  y: number,
  z: number,
): number {
  const t = Math.max(
    0,
    1 - Math.hypot(Math.abs(x) - source.x, y - source.y, z - source.z) / source.radius,
  );
  return t * t * (3 - 2 * t);
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
  private birdElapsedMs = 0;
  private suspended = false;
  private volume = 1;
  private readonly spatial: boolean;
  private windGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private waterWeight = 0;
  private groveWeight = 0;
  private bellWeight = 0;
  private readonly oneShots = new Set<OscillatorNode>();
  private readonly removes: (() => void)[];

  constructor(options: AmbientAudioOptions) {
    this.eventTarget = options.eventTarget;
    this.contextFactory = options.contextFactory;
    this.seed = options.seed;
    this.weatherPresets = options.weatherPresets;
    this.noAudio = options.noAudio;
    this.currentWeather = options.weather;
    this.spatial = options.spatial ?? false;
    this.volume = this.spatial ? LAND_SOUND.defaultVolume : 1;
    this.removes = [
      options.events.on('land:suspend', ({ suspended }) => {
        this.suspended = suspended;
        this.syncPlayback();
      }),
      options.events.on('audio:volume', ({ value }) => {
        this.volume = Math.max(0, Math.min(1, value));
        this.syncPlayback();
      }),
      options.events.on('audio:position', (position) =>
        this.setPosition(position.x, position.y, position.z),
      ),
    ];
    this.removeAudioRequest = options.events.on('audio:request', ({ enabled }) => {
      this.enabled = enabled;
      if (enabled) void this.start();
      this.syncPlayback();
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
    if (!this.started || this.context === null || !this.enabled || this.suspended) {
      return;
    }
    this.bellElapsedMs += Math.max(0, stepMs);
    if (this.bellElapsedMs >= AUDIO.bell.intervalMs) {
      this.bellElapsedMs %= AUDIO.bell.intervalMs;
      this.playBell();
    }
    if (this.spatial) {
      this.birdElapsedMs += Math.max(0, stepMs);
      if (this.birdElapsedMs >= LAND_SOUND.bird.intervalMs) {
        this.birdElapsedMs %= LAND_SOUND.bird.intervalMs;
        this.playBird();
      }
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
    for (const remove of this.removes) remove();
    this.eventTarget.removeEventListener('keydown', this.onUserGesture);
    this.eventTarget.removeEventListener('pointerdown', this.onUserGesture);
    this.stopGraph();
  }

  private readonly onUserGesture = (_event: Event): void => {
    void this.start();
  };

  private async start(): Promise<void> {
    if (this.started || this.disposed || this.noAudio || !this.enabled || this.suspended) {
      return;
    }
    this.started = true;
    try {
      const context = this.contextFactory();
      this.context = context;
      this.createGraph(context);
      await context.resume();
      if (!this.disposed) this.syncPlayback();
    } catch {
      this.stopGraph();
      this.started = false;
    }
  }

  private createGraph(context: AudioContext): void {
    const now = context.currentTime;
    this.masterGain = context.createGain();
    this.masterGain.gain.setValueAtTime(this.enabled ? AUDIO.masterGain * this.volume : 0, now);
    this.masterGain.connect(context.destination);

    const noiseBuffer = this.createNoiseBuffer(context);
    const windSource = context.createBufferSource();
    windSource.buffer = noiseBuffer;
    windSource.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(AUDIO.wind.lowPassHz, now);
    const windGain = context.createGain();
    this.windGain = windGain;
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
    if (this.spatial) {
      const source = context.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      const low = context.createBiquadFilter(),
        high = context.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.setValueAtTime(LAND_SOUND.water.lowPassHz, now);
      high.type = 'highpass';
      high.frequency.setValueAtTime(LAND_SOUND.water.highPassHz, now);
      this.waterGain = context.createGain();
      this.waterGain.gain.setValueAtTime(this.waterWeight * LAND_SOUND.water.gain, now);
      source.connect(high).connect(low).connect(this.waterGain).connect(this.masterGain);
      this.noiseSources.push(source);
    }
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
    if (
      this.context === null ||
      this.masterGain === null ||
      !this.started ||
      !this.enabled ||
      this.suspended
    ) {
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
    this.trackOneShot(oscillator, gain);
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
    gain.gain.linearRampToValueAtTime(
      AUDIO.bell.gain * (this.spatial ? this.bellWeight : 1),
      now + AUDIO.bell.attackSeconds,
    );
    gain.gain.linearRampToValueAtTime(0, now + AUDIO.bell.releaseSeconds);
    oscillator.connect(gain).connect(this.masterGain);
    this.trackOneShot(oscillator, gain);
    oscillator.start(now);
    oscillator.stop(now + AUDIO.bell.releaseSeconds);
  }

  private syncPlayback(): void {
    const context = this.context;
    if (!context || this.disposed) return;
    const playing = this.enabled && !this.suspended;
    this.masterGain?.gain.setTargetAtTime(
      playing ? AUDIO.masterGain * this.volume : 0,
      context.currentTime,
      AUDIO.fadeSeconds,
    );
    // 后台冻结整个时钟和声源；重新可见沿用用户开关，不自动解静音。
    if (playing) void context.resume().catch(() => undefined);
    else void context.suspend().catch(() => undefined);
  }

  private setPosition(x: number, y: number, z: number): void {
    if (!this.spatial) return;
    this.waterWeight = distanceWeight(LAND_SOUND.water, x, y, z);
    this.groveWeight = distanceWeight(LAND_SOUND.grove, x, y, z);
    this.bellWeight = distanceWeight(LAND_SOUND.bell, x, y, z);
    if (this.context) {
      const now = this.context.currentTime;
      this.waterGain?.gain.setTargetAtTime(
        this.waterWeight * LAND_SOUND.water.gain,
        now,
        LAND_SOUND.fadeSeconds,
      );
      this.windGain?.gain.setTargetAtTime(
        AUDIO.wind.gain * (0.55 + this.groveWeight * 0.45),
        now,
        LAND_SOUND.fadeSeconds,
      );
    }
  }

  private playBird(): void {
    if (!this.context || !this.masterGain || this.groveWeight < 0.01) return;
    const c = LAND_SOUND.bird,
      now = this.context.currentTime;
    const oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(c.frequencyHz, now);
    oscillator.frequency.linearRampToValueAtTime(c.riseHz, now + c.duration / 2);
    oscillator.frequency.linearRampToValueAtTime(c.frequencyHz, now + c.duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(c.gain * this.groveWeight, now + c.duration / 4);
    gain.gain.linearRampToValueAtTime(0, now + c.duration);
    oscillator.connect(gain).connect(this.masterGain);
    this.trackOneShot(oscillator, gain);
    oscillator.start(now);
    oscillator.stop(now + c.duration);
  }

  private trackOneShot(oscillator: OscillatorNode, gain: GainNode): void {
    this.oneShots.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.oneShots.delete(oscillator);
    };
  }

  private stopGraph(): void {
    for (const oscillator of this.oneShots) {
      try {
        oscillator.stop();
      } catch {
        /* 已结束的节点仍可安全断开。 */
      }
      oscillator.disconnect();
    }
    this.oneShots.clear();
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
    this.windGain = this.waterGain = null;
    if (context !== null) {
      void context.close().catch(() => undefined);
    }
  }
}
