import { describe, expect, it } from 'vitest';
import { AUDIO, WEATHER_PRESETS } from '@/01-shared';
import { EventBus } from '@/02-core';
import { AmbientAudio } from '@/03-platform';
import type { AppEventMap } from '@/00-types';

class FakeAudioParam {
  value = 0;

  setValueAtTime(value: number): void {
    this.value = value;
  }
  setTargetAtTime(value: number): void {
    this.value = value;
  }

  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }

  cancelScheduledValues(): void {
    // 测试替身不需要保存时间线，只验证调用路径存在。
  }
}

class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];

  connect<T extends FakeAudioNode>(destination: T): T {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

class FakeAudioBuffer {
  readonly samples: Float32Array;

  constructor(length: number) {
    this.samples = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.samples;
  }
}

class FakeAudioContext {
  readonly destination = new FakeAudioNode();
  readonly gains: Array<FakeAudioNode & { gain: FakeAudioParam }> = [];
  readonly sources: Array<FakeAudioNode & { start(): void; stop(): void }> = [];
  readonly oscillators: Array<FakeAudioNode & { start(): void; stop(): void }> = [];
  readonly sampleRate = 100;
  currentTime = 0;
  closed = false;
  state = 'suspended';

  createGain(): FakeAudioNode & { gain: FakeAudioParam } {
    const node = Object.assign(new FakeAudioNode(), { gain: new FakeAudioParam() });
    this.gains.push(node);
    return node;
  }

  createBiquadFilter(): FakeAudioNode & { type: string; frequency: FakeAudioParam } {
    return Object.assign(new FakeAudioNode(), {
      type: 'lowpass',
      frequency: new FakeAudioParam(),
    });
  }

  createBufferSource(): FakeAudioNode & {
    buffer: FakeAudioBuffer | null;
    loop: boolean;
    start(): void;
    stop(): void;
  } {
    const node = Object.assign(new FakeAudioNode(), {
      buffer: null,
      loop: false,
      start: () => undefined,
      stop: () => undefined,
    });
    this.sources.push(node);
    return node;
  }

  createOscillator(): FakeAudioNode & {
    type: string;
    frequency: FakeAudioParam;
    start(): void;
    stop(): void;
  } {
    const node = Object.assign(new FakeAudioNode(), {
      type: 'sine',
      frequency: new FakeAudioParam(),
      start: () => undefined,
      stop: () => undefined,
    });
    this.oscillators.push(node);
    return node;
  }

  createBuffer(_channels: number, length: number, _sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length);
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function audioOptions(
  target: EventTarget,
  events: EventBus<AppEventMap>,
  contextFactory: () => FakeAudioContext,
  noAudio: boolean,
) {
  return {
    eventTarget: target,
    events,
    contextFactory: () => contextFactory() as unknown as AudioContext,
    seed: 20261112,
    weather: WEATHER_PRESETS.rain,
    weatherPresets: WEATHER_PRESETS,
    noAudio,
  };
}

describe('AmbientAudio', () => {
  it('默认不创建上下文，?noaudio 即使收到手势也保持静音', () => {
    const target = new EventTarget();
    const events = new EventBus<AppEventMap>();
    let factoryCalls = 0;
    const audio = new AmbientAudio(
      audioOptions(
        target,
        events,
        () => {
          factoryCalls += 1;
          return new FakeAudioContext();
        },
        true,
      ),
    );

    target.dispatchEvent(new Event('keydown'));
    expect(factoryCalls).toBe(0);
    expect(audio.isStarted).toBe(false);
    audio.dispose();
  });

  it('用户手势后创建风雨声床，并响应天气、脚步和檐铃事件', async () => {
    const target = new EventTarget();
    const events = new EventBus<AppEventMap>();
    const context = new FakeAudioContext();
    const audio = new AmbientAudio(audioOptions(target, events, () => context, false));

    expect(audio.isStarted).toBe(false);
    target.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();

    expect(audio.isStarted).toBe(true);
    expect(context.sources).toHaveLength(3);
    expect(context.gains.length).toBeGreaterThanOrEqual(4);

    events.emit('weather:changed', { from: 'rain', to: 'clear' });
    events.emit('player:step', { surface: 'platform' });
    audio.update(AUDIO.bell.intervalMs);
    expect(context.oscillators).toHaveLength(2);

    audio.dispose();
    expect(context.closed).toBe(true);
  });
  it('静音不创建图；前后台冻结并遵守用户开关，空间声随区域而改变', async () => {
    const target = new EventTarget(),
      events = new EventBus<AppEventMap>(),
      context = new FakeAudioContext();
    const audio = new AmbientAudio({
      ...audioOptions(target, events, () => context, false),
      spatial: true,
    });
    events.emit('audio:request', { enabled: false });
    target.dispatchEvent(new Event('pointerdown'));
    expect(audio.isStarted).toBe(false);
    events.emit('audio:request', { enabled: true });
    await Promise.resolve();
    expect(context.sources).toHaveLength(4);
    events.emit('audio:position', { x: 28, y: 0, z: 28 });
    const near = context.gains.map((g) => g.gain.value);
    events.emit('audio:position', { x: 500, y: 100, z: 500 });
    expect(context.gains.some((g, i) => g.gain.value < near[i]!)).toBe(true);
    events.emit('land:suspend', { suspended: true });
    expect(context.state).toBe('suspended');
    events.emit('audio:request', { enabled: false });
    events.emit('land:suspend', { suspended: false });
    expect(context.state).toBe('suspended');
    events.emit('audio:request', { enabled: true });
    expect(context.state).toBe('running');
    events.emit('audio:volume', { value: 0.25 });
    expect(context.gains[0]!.gain.value).toBeCloseTo(AUDIO.masterGain * 0.25);
    audio.dispose();
    expect(events.size).toBe(0);
  });
});
