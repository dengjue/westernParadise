import { Group, Mesh, SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { MULTIPLAYER } from '@/01-shared';
import { CourtyardRemotePlayers } from '@/07-systems';

function setup(reducedMotion = false) {
  const scene = new Group();
  const template = new Group();
  const mesh = new Mesh(new SphereGeometry());
  template.add(mesh);
  const remote = new CourtyardRemotePlayers(scene, template, reducedMotion);
  const player = { id: '1', ...MULTIPLAYER.spawn, yaw: Math.PI - 0.1 };
  remote.apply({ type: 'snapshot', tick: 1, changed: [player], removed: [] }, 0);
  const model = scene.getObjectByName('remote-player-1')!;
  return { scene, mesh, remote, player, model };
}

describe('courtyard remote players', () => {
  it('shares render resources, interpolates across the yaw seam and removes departed roles', () => {
    const { scene, mesh, remote, player, model } = setup();
    expect((model.children[0] as Mesh).geometry).toBe(mesh.geometry);
    expect((model.children[0] as Mesh).material).toBe(mesh.material);
    const next = { ...player, x: 1, yaw: -Math.PI + 0.1 };
    remote.apply({ type: 'snapshot', tick: 2, changed: [next], removed: [] }, 100);
    remote.update(150);
    expect(model.position.x).toBeCloseTo(0.5);
    expect(model.rotation.y).toBeCloseTo(Math.PI);
    remote.update(200);
    expect(model.position.x).toBe(1);
    expect(model.rotation.y).toBe(next.yaw);
    remote.apply({ type: 'snapshot', tick: 3, changed: [], removed: ['1'] }, 300);
    expect(scene.getObjectByName('remote-player-1')).toBeUndefined();
  });

  it('snaps in reduced motion and clears all roles when disposed', () => {
    const { scene, remote, player, model } = setup(true);
    remote.apply({ type: 'snapshot', tick: 2, changed: [{ ...player, x: 1 }], removed: [] }, 100);
    expect(model.position.x).toBe(1);
    remote.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
