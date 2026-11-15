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
  it('按角色姿态装配有限 cell，并在无姿态时卸载全部驻留 payload', async () => {
    const { materials, owned } = createMaterials();
    const parent = new Group();
    const stream = createEastRegionCellStream(parent, materials);
    stream.update({ x: 180, z: 0, forwardX: 1, forwardZ: 0 }, 120);
    await flushPromises();

    let snapshot = stream.snapshot();
    expect(snapshot.desired).toBe(16);
    expect(snapshot.mounted).toBe(snapshot.queue.ready);
    expect(snapshot.mounted).toBeLessThanOrEqual(16);
    expect(snapshot.queue.loading).toBeLessThanOrEqual(2);
    expect(snapshot.queue.queued).toBeLessThanOrEqual(14);
    expect(parent.children).toHaveLength(1);

    const regionRoot = parent.children[0] as Group;
    const initialKeys = regionRoot.children.map((cell) => cell.userData['cell']);
    stream.update({ x: 300, z: 0, forwardX: -1, forwardZ: 0 }, 120);
    await flushPromises();
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

  it('在异步 loader 启动前取消需求，不会挂回迟到 payload', async () => {
    const { materials, owned } = createMaterials();
    const parent = new Group();
    const stream = createEastRegionCellStream(parent, materials);
    stream.update({ x: 180, z: 0, forwardX: 1, forwardZ: 0 }, 120);
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
