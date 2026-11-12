import { BoxGeometry, GridHelper, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { Scene } from 'three';
import { RENDER } from '@/01-shared';

/**
 * ⚠️ 工程冒烟占位场景，不是场景设计，M1 时整体删除替换。
 *
 * 它的唯一用途是验证「Three 初始化 → 主循环 → 渲染 → 单文件产物」整条链路可用，
 * 因此刻意只放中性灰的地面、网格与方块：光照由 06-world 的 LightingRig 统一提供，**不含任何题材内容、
 * 不含建筑构件、不含文字、不含宗教元素**。
 *
 * 资源释放由 04-engine 的 dispose() 统一遍历 scene 完成，本模块不重复释放。
 */
export interface WorldHandle {
  readonly root: Group;
  /** 让方块缓慢旋转，肉眼可判断主循环确实在跑；减动效偏好下由 boot 跳过调用。 */
  update(deltaMs: number): void;
}

export function createPlaceholderWorld(scene: Scene): WorldHandle {
  const root = new Group();
  root.name = 'smoke-placeholder';
  const size = RENDER.placeholderGroundSize;

  const ground = new Mesh(
    new PlaneGeometry(size, size),
    new MeshStandardMaterial({ color: 0x2a2f31, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  const grid = new GridHelper(size, size, 0x4a5558, 0x333c3e);
  grid.position.y = 0.002;
  root.add(grid);

  const marker = new Mesh(
    new BoxGeometry(0.8, 0.8, 0.8),
    new MeshStandardMaterial({ color: 0x8a9498, roughness: 0.7, metalness: 0.05 }),
  );
  marker.position.set(0, 0.4, 0);
  root.add(marker);

  scene.add(root);

  return {
    root,
    update(deltaMs: number): void {
      // 0.0004 rad/ms ≈ 24°/s，慢到不会引起不适，但足以看清是否在动。
      marker.rotation.y += deltaMs * 0.0004;
    },
  };
}
