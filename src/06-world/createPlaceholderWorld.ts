import { BoxGeometry, GridHelper, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { Scene } from 'three';
import { RENDER, WORLD } from '@/01-shared';

/**
 * 历史冒烟占位场景，仅保留作旧回归参考；运行时已由 createCourtyardWorld 替换。
 *
 * 它的唯一用途是验证「Three 初始化 → 主循环 → 渲染 → 单文件产物」整条链路可用，
 * 因此刻意只放中性灰的地面、网格、碰撞测试台阶与方块：光照由 06-world 的 LightingRig
 * 统一提供，**不含任何题材内容、不含建筑构件、不含文字、不含宗教元素**。
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
  const groundWidth = Math.max(RENDER.placeholderGroundSize, WORLD.courtyard.width);
  const groundDepth = Math.max(RENDER.placeholderGroundSize, WORLD.courtyard.depth);

  const ground = new Mesh(
    new PlaneGeometry(groundWidth, groundDepth),
    new MeshStandardMaterial({ color: 0x2a2f31, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = WORLD.ground.baseHeight;
  root.add(ground);

  const gridSize = Math.max(groundWidth, groundDepth);
  const grid = new GridHelper(gridSize, Math.ceil(gridSize), 0x4a5558, 0x333c3e);
  grid.position.y = WORLD.ground.baseHeight + 0.002;
  root.add(grid);

  for (const area of WORLD.ground.heightAreas) {
    const height = area.height - WORLD.ground.baseHeight;
    if (height <= 0) {
      continue;
    }
    const platform = new Mesh(
      new BoxGeometry(area.maxX - area.minX, height, area.maxZ - area.minZ),
      new MeshStandardMaterial({ color: 0x4b5557, roughness: 0.9, metalness: 0 }),
    );
    platform.name = 'ground-height-test-platform';
    platform.position.set(
      (area.minX + area.maxX) / 2,
      WORLD.ground.baseHeight + height / 2,
      (area.minZ + area.maxZ) / 2,
    );
    platform.receiveShadow = true;
    root.add(platform);
  }

  const marker = new Mesh(
    new BoxGeometry(0.8, 0.8, 0.8),
    new MeshStandardMaterial({ color: 0x8a9498, roughness: 0.7, metalness: 0.05 }),
  );
  marker.position.set(0, WORLD.ground.baseHeight + 0.4, 0);
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
