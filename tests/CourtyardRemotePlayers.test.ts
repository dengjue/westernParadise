import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { MULTIPLAYER, companionHint } from '@/01-shared';
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
  it('仅导航到已知最近伙伴，随观察方向、高差和离场更新', () => {
    const { remote, player } = setup();
    const observer = { x: 0, y: 0, z: 0, headingDeg: 0 };
    const east = { ...player, id: '2', x: 3, y: 42, z: 0 };
    remote.apply({ type: 'snapshot', tick: 2, removed: [], changed: [east] }, 0);
    expect(remote.nearestTo(0, 0)).toEqual(east);
    expect(companionHint(east, observer)).toContain('右侧 3 m · 高 42 m');
    expect(companionHint(east, { ...observer, headingDeg: 90 })).toContain('前方 3 m');
    expect(companionHint(east, { ...observer, x: 3, y: 50 })).toContain('近旁 0 m · 低 8 m');
    remote.apply({ type: 'snapshot', tick: 3, removed: ['1', '2'], changed: [] }, 0);
    expect(remote.nearestTo(0, 0)).toBeUndefined();
    remote.dispose();
  });
  it('联机角色按编号配色；相同色号共享材质，不修改本地身体', () => {
    const scene = new Group(),
      template = new Group();
    const body = new Mesh(new SphereGeometry(), new MeshStandardMaterial());
    body.name = 'player-body';
    template.add(body);
    const remote = new CourtyardRemotePlayers(scene, template, false, true);
    remote.apply(
      {
        type: 'snapshot',
        tick: 1,
        removed: [],
        changed: ['1', '2', '7'].map((id) => ({ id, ...MULTIPLAYER.spawn })),
      },
      0,
    );
    const coat = (id: string) =>
      (
        scene.getObjectByName(`remote-player-${id}`)!.getObjectByName('player-body') as Mesh<
          typeof body.geometry,
          MeshStandardMaterial
        >
      ).material;
    expect(coat('1')).toBe(coat('7'));
    expect(coat('1').color.getHex()).not.toBe(coat('2').color.getHex());
    expect(body.material.color.getHex()).toBe(0xffffff);
    let disposed = 0;
    coat('1').addEventListener('dispose', () => disposed++);
    remote.dispose();
    expect(disposed).toBe(1);
    body.geometry.dispose();
    body.material.dispose();
  });
  it('步行扫掠阻止迎面穿过，允许侧移、退出重叠、从空中角色下方通过', () => {
    const { remote, player } = setup();
    const { x, y, z } = player;
    expect(remote.allowsGroundStep(x, y, z + 1.1, 0, -0.2)).toBe(false);
    expect(remote.allowsGroundStep(x, y, z + 1.1, 0.15, 0)).toBe(true);
    expect(remote.allowsGroundStep(x, y, z + 0.2, 0, 0.15)).toBe(true);
    expect(remote.allowsGroundStep(x, y, z + 2, 0, -4)).toBe(false);
    remote.apply(
      { type: 'snapshot', tick: 2, changed: [{ ...player, flying: true, y: 42 }], removed: [] },
      100,
    );
    expect(remote.allowsGroundStep(x, y, z + 1.1, 0, -0.2)).toBe(true);
    remote.clear();
    expect(remote.allowsGroundStep(x, y, z + 1.1, 0, -0.2)).toBe(true);
  });

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
