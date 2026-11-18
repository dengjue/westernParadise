import type { DataTexture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { FrameBudgetDriver } from '../src/04-engine/FrameBudgetDriver';
import { LandPmremAtlasGate } from '../src/06-world/land/LandPmremAtlasGate';
import type { LandPmremAtlasHandle } from '../src/06-world/land/LandPmremAtlas';

function createAtlas(): LandPmremAtlasHandle {
  return {
    textures: [] as DataTexture[],
    stats: {
      compressedBytes: 1,
      decodedBytes: 1,
      decodeMs: 1,
      yieldedFrames: 1,
    },
    dispose: vi.fn(),
  };
}

class FrameQueue {
  private nextId = 1;
  readonly callbacks = new Map<number, FrameRequestCallback>();

  request = (callback: FrameRequestCallback): number => {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  };

  cancel = (id: number): void => {
    this.callbacks.delete(id);
  };

  runOne(): void {
    const first = this.callbacks.entries().next().value as
      [number, FrameRequestCallback] | undefined;
    if (!first) throw new Error('no queued frame');
    this.callbacks.delete(first[0]);
    first[1](0);
  }
}

describe('LandPmremAtlasGate', () => {
  it('waits for decode, resumes construction, and transfers ownership on success', () => {
    const gate = new LandPmremAtlasGate();
    const atlas = createAtlas();
    const frames = new FrameQueue();
    let stage = 'build',
      completed: LandPmremAtlasHandle | undefined;
    function* build(): Generator<void, LandPmremAtlasHandle, void> {
      let complete = false;
      try {
        stage = 'environment:waiting-atlas';
        const environment = yield* gate.wait();
        stage = 'finalize';
        complete = true;
        return environment;
      } finally {
        if (!complete) gate.dispose();
      }
    }

    const driver: FrameBudgetDriver<LandPmremAtlasHandle> = new FrameBudgetDriver({
      iterator: build(),
      budgetMs: 100,
      getStepLabel: () => stage,
      onYield: () => {
        if (stage === 'environment:waiting-atlas' && gate.pending) driver.pause();
      },
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      onComplete: (environment) => {
        gate.transfer();
        completed = environment;
      },
      onError: (error) => {
        throw error;
      },
    });
    driver.start();
    frames.runOne();

    expect(gate.pending).toBe(true);
    expect(driver.stats.steps).toBe(1);
    expect(frames.callbacks.size).toBe(0);

    gate.resolve(atlas);
    driver.resume();
    frames.runOne();
    gate.dispose();

    expect(completed).toBe(atlas);
    expect(atlas.dispose).not.toHaveBeenCalled();
    atlas.dispose();
    expect(atlas.dispose).toHaveBeenCalledTimes(1);
  });

  it('propagates decode failure from the paused environment wait', () => {
    const gate = new LandPmremAtlasGate();
    const failure = new Error('decode failed');
    const wait = gate.wait();

    expect(wait.next()).toEqual({ done: false, value: undefined });
    gate.reject(failure);

    expect(() => wait.next()).toThrow(failure);
    gate.dispose();
  });

  it('releases a late decode result after cancellation while decoding', async () => {
    const controller = new AbortController();
    const gate = new LandPmremAtlasGate();
    const atlas = createAtlas();
    let resolveLoad!: (value: LandPmremAtlasHandle) => void;
    const loading = new Promise<LandPmremAtlasHandle>((resolve) => {
      resolveLoad = resolve;
    }).then((result) => gate.resolve(result));
    controller.signal.addEventListener('abort', () => gate.dispose(), { once: true });

    controller.abort();
    resolveLoad(atlas);
    await loading;

    expect(atlas.dispose).toHaveBeenCalledTimes(1);
  });

  it('releases the atlas if construction is cancelled after decode succeeds', () => {
    const gate = new LandPmremAtlasGate();
    const atlas = createAtlas();
    const frames = new FrameQueue();
    let stage = 'waiting';
    function* build(): Generator<void, void, void> {
      let complete = false;
      try {
        yield* gate.wait();
        stage = 'building-atmosphere';
        yield;
        complete = true;
      } finally {
        if (!complete) gate.dispose();
      }
    }

    const driver: FrameBudgetDriver<void> = new FrameBudgetDriver({
      iterator: build(),
      budgetMs: 100,
      getStepLabel: () => stage,
      onYield: () => {
        if (gate.pending || stage === 'building-atmosphere') driver.pause();
      },
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      onComplete: () => {},
      onError: (error) => {
        throw error;
      },
    });
    driver.start();
    frames.runOne();
    gate.resolve(atlas);
    driver.resume();
    frames.runOne();
    expect(frames.callbacks.size).toBe(0);

    driver.cancel();

    expect(frames.callbacks.size).toBe(0);
    expect(atlas.dispose).toHaveBeenCalledTimes(1);
  });
});
