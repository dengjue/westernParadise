import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { EventBus } from '@/02-core';
import { LandCamera } from '@/07-systems';
import { LAND_JOURNEY as J, PURE_LAND } from '@/01-shared';
import type { AppEventMap } from '@/00-types';

function fixture(reduced = false) {
  const events = new EventBus<AppEventMap>(),
    camera = new PerspectiveCamera();
  const look = { yaw: 0, pitch: 0 };
  const input = {
    moveAxis: { x: 0, z: 0 },
    consumeLookDelta: () => look,
    consumeZoomDelta: () => 0,
    dispose() {},
  };
  const control = new LandCamera(camera, input, events, reduced);
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) control.update(1000 / 60);
  };
  return { events, camera, look, input, control, advance };
}

describe('游览状态与手动接管', () => {
  it('路线中途暂停精确停住，恢复从同一进度继续，手动环顾不跳回预设', () => {
    const f = fixture();
    f.events.emit('land:tour', { enabled: true });
    f.advance(J.holdSeconds + J.travelSeconds / 2);
    const paused = f.camera.position.clone();
    f.events.emit('land:tour', { enabled: false });
    f.advance(2);
    expect(f.camera.position.distanceTo(paused)).toBeLessThan(1e-9);
    f.events.emit('land:tour', { enabled: true });
    f.control.update(1000 / 60);
    expect(f.camera.position.distanceTo(paused)).toBeLessThan(0.5);
    f.look.yaw = 0.01;
    const before = f.camera.position.clone();
    f.control.update(1000 / 60);
    f.look.yaw = 0;
    expect(f.camera.position.distanceTo(before)).toBeLessThan(0.5);
    f.control.dispose();
    expect(f.events.size).toBe(0);
  });
  it('所有曲线路线有限且在屋檐外的开放通道上；减动效只在停留结束换景', () => {
    for (const reduced of [false, true]) {
      const f = fixture(reduced);
      f.events.emit('land:tour', { enabled: true });
      const start = f.camera.position.clone();
      f.advance(J.holdSeconds / 2);
      expect(f.camera.position.distanceTo(start)).toBe(0);
      for (let i = 0; i < 4 * (J.holdSeconds + J.travelSeconds) * 60; i++) {
        f.control.update(1000 / 60);
        expect(f.camera.position.y).toBeGreaterThanOrEqual(5.8 - 1e-6);
        expect(f.camera.position.length()).toBeLessThan(200);
      }
      f.control.dispose();
    }
  });
  it('弹窗/后台冻结相机与游览，步行再次请求不重置位置，选景退出自动模式', () => {
    const f = fixture();
    f.control.selectView(2, true);
    f.control.startWalking();
    f.input.moveAxis.z = 1;
    f.advance(1);
    const position = f.camera.position.clone();
    f.control.startWalking();
    expect(f.camera.position.toArray()).toEqual(position.toArray());
    for (const type of ['land:modal', 'land:suspend'] as const) {
      if (type === 'land:modal') f.events.emit(type, { open: true });
      else f.events.emit(type, { suspended: true });
      f.advance(1);
      expect(f.camera.position.toArray()).toEqual(position.toArray());
    }
    expect(f.camera.position.y).toBeCloseTo(1.25 + J.eyeHeight);
    f.control.selectView(1, true);
    expect(f.camera.position.toArray()).toEqual(PURE_LAND.views[1].position);
    f.control.dispose();
  });
});
