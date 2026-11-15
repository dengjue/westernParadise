import { describe, expect, it } from 'vitest';
import { Group, MeshStandardMaterial } from 'three';
import type { PureLandMaterials } from '@/05-materials';
import { createEastRegionCellStream } from '@/06-world/land/EastRegionCellStream';

function createMaterials(): {
  materials: PureLandMaterials;
  owned: MeshStandardMaterial[];
} {
  const owned = Array.from({ length: 6 }, () => new MeshStandardMaterial());
  return {
    materials: {
      stone: owned[0]!,
      carvedStone: owned[1]!,
      dark: owned[2]!,
      jade: owned[3]!,
      goldDark: owned[4]!,
      gold: owned[5]!,
    } as unknown as PureLandMaterials,
    owned,
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 80; index++) await Promise.resolve();
}

describe('阶段 4 · 东侧 cell 有界运行时调度', () => {
  it('每逻辑更新最多构建一个 cell，并按姿态装配/卸载驻留 payload', async () => {
    const { materials, owned } = createMaterials();
    const parent = new Group();
    const stream = createEastRegionCellStream(parent, materials);
    const eastPose = { x: 180, z: 0, forwardX: 1, forwardZ: 0 };
    stream.update(eastPose, 120);
    await flushPromises();

    let snapshot = stream.snapshot();
    expect(snapshot.desired).toBe(16);
    expect(snapshot.mounted).toBe(0);
    expect(snapshot.queue.loading).toBe(2);
    expect(snapshot.queue.queued).toBeLessThanOrEqual(14);
    expect(parent.children).toHaveLength(1);

    for (let tick = 0; tick < 8; tick++) stream.update(eastPose, 1000 / 60);
    await flushPromises();
    expect(stream.snapshot().mounted).toBe(1);

    for (let tick = 0; tick < 15; tick++) {
      stream.update(eastPose, 1000 / 60);
      await flushPromises();
    }
    snapshot = stream.snapshot();
    expect(snapshot.mounted).toBe(16);
    expect(snapshot.mounted).toBe(snapshot.queue.ready);

    const regionRoot = parent.children[0] as Group;
    const initialKeys = regionRoot.children.map((cell) => cell.userData['cell']);
    const turnedPose = { x: 300, z: 0, forwardX: -1, forwardZ: 0 };
    stream.update(turnedPose, 120);
    await flushPromises();
    for (let tick = 0; tick < 16; tick++) {
      stream.update(turnedPose, 1000 / 60);
      await flushPromises();
    }
    snapshot = stream.snapshot();
    const turnedKeys = regionRoot.children.map((cell) => cell.userData['cell']);
    expect(snapshot.mounted).toBe(snapshot.queue.ready);
    expect(turnedKeys).toHaveLength(16);
    expect(turnedKeys.filter((key) => initialKeys.includes(key)).length).toBeLessThan(16);

    stream.update(null, 16);
    await flushPromises();
    snapshot = stream.snapshot();
    expect(snapshot).toMatchObject({
      desired: 0,
      mounted: 0,
      queue: { ready: 0, queued: 0 },
    });
    stream.dispose();
    for (const material of owned) material.dispose();
  });

  it('取消等待构建许可的 loader 后，不会挂回迟到 payload', async () => {
    const { materials, owned } = createMaterials();
    const parent = new Group();
    const stream = createEastRegionCellStream(parent, materials);
    stream.update({ x: 180, z: 0, forwardX: 1, forwardZ: 0 }, 120);
    await flushPromises();
    stream.update(null, 16);
    await flushPromises();

    expect(stream.snapshot()).toMatchObject({
      desired: 0,
      mounted: 0,
      queue: { ready: 0, loading: 0, queued: 0 },
    });
    stream.dispose();
    expect(parent.children).toHaveLength(0);
    for (const material of owned) material.dispose();
  });
});
