import { describe, expect, it } from 'vitest';
import { FrameBudgetDriver } from '../src/04-engine/FrameBudgetDriver';

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

describe('FrameBudgetDriver', () => {
  it('defers its first slice and distributes generator steps across frames', () => {
    const frames = new FrameQueue();
    let now = 0,
      work = 0,
      result: string | undefined,
      stage = 'warmup';
    function* task(): Generator<void, string, void> {
      for (let index = 0; index < 5; index++) {
        stage = index < 3 ? 'geometry' : 'flush';
        work++;
        now += 2;
        yield;
      }
      return 'ready';
    }

    const driver = new FrameBudgetDriver({
      iterator: task(),
      budgetMs: 5,
      deferFirstFrame: true,
      getStepLabel: () => stage,
      now: () => now,
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      onComplete: (value) => {
        result = value;
      },
      onError: (error) => {
        throw error;
      },
    });

    driver.start();
    frames.runOne();
    expect(work).toBe(0);
    frames.runOne();
    expect(work).toBe(3);
    expect(frames.callbacks.size).toBe(1);
    frames.runOne();

    expect(result).toBe('ready');
    expect(driver.stats.frames).toBe(3);
    expect(driver.stats.steps).toBe(6);
    expect(driver.stats.maxStepMs).toBe(2);
    expect(driver.stats.maxStepLabel).toBe('geometry');
    expect(driver.stats.overBudgetSteps).toBe(0);
  });

  it('records an indivisible step that exceeds the slice budget', () => {
    const frames = new FrameQueue();
    let now = 0;
    function* task(): Generator<void, void, void> {
      now += 8;
      yield;
    }

    const driver = new FrameBudgetDriver({
      iterator: task(),
      budgetMs: 6,
      now: () => now,
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      onComplete: () => {},
      onError: (error) => {
        throw error;
      },
    });
    driver.start();
    frames.runOne();

    expect(driver.stats.maxStepMs).toBe(8);
    expect(driver.stats.overBudgetSteps).toBe(1);
  });

  it('keeps a bounded descending list of the slowest labeled steps when requested', () => {
    const frames = new FrameQueue();
    let now = 0,
      stage = '';
    function* task(): Generator<void, void, void> {
      for (const [label, duration] of [
        ['small', 2],
        ['large', 10],
        ['middle', 6],
        ['largest', 12],
      ] as const) {
        stage = label;
        now += duration;
        yield;
      }
    }

    const driver = new FrameBudgetDriver({
      iterator: task(),
      budgetMs: 100,
      slowStepLimit: 3,
      getStepLabel: () => stage,
      now: () => now,
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      onComplete: () => {},
      onError: (error) => {
        throw error;
      },
    });
    driver.start();
    frames.runOne();

    expect(driver.stats.slowestSteps).toEqual([
      { stage: 'largest', durationMs: 12 },
      { stage: 'large', durationMs: 10 },
      { stage: 'middle', durationMs: 6 },
    ]);
  });

  it('pauses pending frames and closes the generator on cancellation', () => {
    const frames = new FrameQueue();
    let now = 0,
      released = 0;
    function* task(): Generator<void, void, void> {
      try {
        while (true) {
          now++;
          yield;
        }
      } finally {
        released++;
      }
    }

    const driver = new FrameBudgetDriver({
      iterator: task(),
      budgetMs: 3,
      now: () => now,
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      onComplete: () => {},
      onError: (error) => {
        throw error;
      },
    });
    driver.start();
    frames.runOne();
    expect(driver.stats.steps).toBe(3);
    expect(frames.callbacks.size).toBe(1);

    driver.pause();
    expect(frames.callbacks.size).toBe(0);
    driver.resume();
    expect(frames.callbacks.size).toBe(1);
    driver.cancel();

    expect(frames.callbacks.size).toBe(0);
    expect(released).toBe(1);
  });
});
