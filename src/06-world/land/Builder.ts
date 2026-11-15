import {
  BoxGeometry,
  BufferAttribute,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAND_RENDER } from '@/01-shared';
import type { LandDetail } from '@/01-shared';
import { DistanceLod } from '@/04-engine';
import type { LandContact } from './ContactShadows';
import { batchStaticCells } from './CellBatch';

type Point = readonly [number, number, number];
interface BuilderOptions {
  cellSize?: number;
  cellOrigin?: readonly [number, number];
  dynamicLod?: boolean;
  multiDraw?: boolean;
  detail?: LandDetail;
  tubeCache?: Map<string, TubeGeometry>;
  cacheStats?: { hits: number; misses: number; bytes: number };
}

function disposeObjectGeometries(objects: readonly Object3D[]): void {
  const geometries = new Set<BufferGeometry>();
  for (const object of objects)
    object.traverse((child) => {
      const geometry = (child as Object3D & { geometry?: BufferGeometry }).geometry;
      if (geometry) geometries.add(geometry);
    });
  for (const geometry of geometries) geometry.dispose();
}

/** 静态细构件按材质合批。数千栏杆、斗拱、窗格只占少量 draw call。 */
export class LandBuilder {
  readonly contacts: LandContact[] = [];
  private readonly batches = new Map<Material, Map<string, BufferGeometry[]>>();
  private readonly objects: Object3D[] = [];
  private boxGeometry: BoxGeometry | undefined;
  private cylinderGeometry: CylinderGeometry | undefined;
  private sphereGeometry: SphereGeometry | undefined;
  private readonly transform = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly scale = new Vector3();
  private readonly center = new Vector3();
  private readonly tubeCache: Map<string, TubeGeometry>;
  readonly cacheStats: { hits: number; misses: number; bytes: number };

  constructor(private readonly options: BuilderOptions = {}) {
    this.tubeCache = options.tubeCache ?? new Map();
    this.cacheStats = options.cacheStats ?? { hits: 0, misses: 0, bytes: 0 };
  }

  /** 只在资产顶层构建三级，子构建器禁用递归 LOD；中档阴影副本共享几何与材质。 */
  lod(
    point: Point,
    radius: number,
    kind: 'roof' | 'sculpture',
    best: LandDetail,
    build: (builder: LandBuilder, detail: LandDetail) => void,
  ): boolean {
    if (!this.options.dynamicLod) return false;
    const details = ['near', 'middle', 'far'] as const;
    const minimum = details.indexOf(best);
    if (best === 'far') {
      // 远景群楼从不升级细节，无需每座保留独立 LOD draw call。
      // 先用远档原型生成完整构件，再把尚未合并的区块批次转交父构建器，避免二次复制顶点。
      const child = new LandBuilder({
        cellSize: this.options.cellSize,
        cellOrigin: this.options.cellOrigin,
        detail: best,
        tubeCache: this.tubeCache,
        cacheStats: this.cacheStats,
      });
      try {
        build(child, best);
        for (const [material, cells] of child.batches) {
          let target = this.batches.get(material);
          if (!target) {
            target = new Map();
            this.batches.set(material, target);
          }
          for (const [cell, parts] of cells) {
            const batch = target.get(cell);
            if (batch) batch.push(...parts);
            else target.set(cell, parts.slice());
            parts.length = 0;
          }
        }
      } finally {
        child.disposePending();
      }
      return true;
    }
    const levels = details.map((detail, index) => {
      const group = new Group();
      if (index < minimum) return group;
      const builder = new LandBuilder({
        cellSize: this.options.cellSize,
        cellOrigin: this.options.cellOrigin,
        detail,
        tubeCache: this.tubeCache,
        cacheStats: this.cacheStats,
      });
      build(builder, detail);
      builder.flush(group);
      return group;
    });
    const shadow = new Group();
    levels[Math.max(1, minimum)]!.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const mesh = new Mesh(object.geometry, object.material);
      mesh.name = 'land-lod-shadow';
      mesh.castShadow = true;
      mesh.layers.set(LAND_RENDER.layers.shadow);
      shadow.add(mesh);
    });
    for (const level of levels)
      level.traverse((object) => {
        if (object instanceof Mesh) object.castShadow = false;
      });
    const config = LAND_RENDER.lod[kind];
    this.objects.push(
      new DistanceLod(levels, point, radius, config.distances, config.hysteresis, minimum),
      shadow,
    );
    return true;
  }

  /** 与 lod() 输出相同，但在细节级构建/合批间暴露可取消的安全让出点。 */
  *lodSteps(
    point: Point,
    radius: number,
    kind: 'roof' | 'sculpture',
    best: LandDetail,
    build: (builder: LandBuilder, detail: LandDetail) => Generator<void, void, void>,
  ): Generator<void, boolean, void> {
    if (!this.options.dynamicLod) return false;
    const details = ['near', 'middle', 'far'] as const;
    const minimum = details.indexOf(best);
    if (best === 'far') {
      const child = new LandBuilder({
        cellSize: this.options.cellSize,
        cellOrigin: this.options.cellOrigin,
        detail: best,
        tubeCache: this.tubeCache,
        cacheStats: this.cacheStats,
      });
      try {
        yield* build(child, best);
        for (const [material, cells] of child.batches) {
          let target = this.batches.get(material);
          if (!target) {
            target = new Map();
            this.batches.set(material, target);
          }
          for (const [cell, parts] of cells) {
            const batch = target.get(cell);
            if (batch) batch.push(...parts);
            else target.set(cell, parts.slice());
            parts.length = 0;
          }
        }
      } finally {
        child.abort();
      }
      return true;
    }

    const levels = details.map(() => new Group());
    let completed = false;
    try {
      for (let index = minimum; index < details.length; index++) {
        const detail = details[index]!,
          group = levels[index]!,
          builder = new LandBuilder({
            cellSize: this.options.cellSize,
            cellOrigin: this.options.cellOrigin,
            detail,
            tubeCache: this.tubeCache,
            cacheStats: this.cacheStats,
          });
        let levelComplete = false;
        try {
          yield* build(builder, detail);
          yield* builder.flushSteps(group);
          levelComplete = true;
        } finally {
          if (!levelComplete) builder.abort();
        }
      }

      const shadow = new Group();
      levels[Math.max(1, minimum)]!.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const mesh = new Mesh(object.geometry, object.material);
        mesh.name = 'land-lod-shadow';
        mesh.castShadow = true;
        mesh.layers.set(LAND_RENDER.layers.shadow);
        shadow.add(mesh);
      });
      for (const level of levels)
        level.traverse((object) => {
          if (object instanceof Mesh) object.castShadow = false;
        });
      const config = LAND_RENDER.lod[kind];
      this.objects.push(
        new DistanceLod(levels, point, radius, config.distances, config.hysteresis, minimum),
        shadow,
      );
      completed = true;
      return true;
    } finally {
      if (!completed) disposeObjectGeometries(levels);
    }
  }

  shape(
    geometry: BufferGeometry,
    material: Material,
    point: Point = [0, 0, 0],
    size: Point = [1, 1, 1],
    yaw = 0,
  ): void {
    this.position.fromArray(point);
    if (yaw === 0) this.rotation.identity();
    else this.rotation.setFromAxisAngle(this.up, yaw);
    this.scale.fromArray(size);
    this.transform.compose(this.position, this.rotation, this.scale);
    const cell = this.options.cellSize ?? 0;
    const originX = this.options.cellOrigin?.[0] ?? 0;
    const originZ = this.options.cellOrigin?.[1] ?? 0;
    const copy = geometry.clone().applyMatrix4(this.transform);
    copy.computeBoundingBox();
    copy.boundingBox!.getCenter(this.center);
    const key =
      cell > 0
        ? `${Math.floor((this.center.x - originX) / cell)},${Math.floor((this.center.z - originZ) / cell)}`
        : 'all';
    let cells = this.batches.get(material);
    if (!cells) {
      cells = new Map();
      this.batches.set(material, cells);
    }
    const batch = cells.get(key);
    if (batch) batch.push(copy);
    else cells.set(key, [copy]);
  }

  box(material: Material, point: Point, size: Point, yaw = 0): void {
    this.boxGeometry ??= new BoxGeometry(1, 1, 1);
    this.shape(this.boxGeometry, material, point, size, yaw);
  }

  cylinder(material: Material, point: Point, radius: number, height: number): void {
    this.cylinderGeometry ??= new CylinderGeometry(1, 1, 1, 12);
    this.shape(this.cylinderGeometry, material, point, [radius, height, radius]);
  }

  sphere(material: Material, point: Point, size: Point): void {
    if (!this.sphereGeometry) {
      const segments = LAND_RENDER.lod.sphereSegments[this.options.detail ?? 'near'];
      this.sphereGeometry = new SphereGeometry(1, ...segments);
    }
    this.shape(this.sphereGeometry, material, point, size);
  }

  ring(material: Material, point: Point, radius: number, tube: number): void {
    const geometry = new TorusGeometry(radius, tube, 6, 72);
    this.shape(geometry, material, point);
    geometry.dispose();
  }

  tube(material: Material, points: readonly Point[], radius: number, segments = 12): void {
    // 以首点为原点缓存完整曲线网格。相同屋顶的平移副本复用 Frenet 标架和弧长表，
    // 不减少曲线采样或三角形；微米级键精度只消除世界坐标相减的浮点尾差。
    const origin = points[0]!;
    const local = points.map(
      (point) => new Vector3(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]),
    );
    const key =
      `${radius}/${segments}/` +
      local.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`).join('/');
    let geometry = this.tubeCache.get(key);
    if (!geometry) {
      geometry = new TubeGeometry(new CatmullRomCurve3(local), segments, radius, 5, false);
      this.tubeCache.set(key, geometry);
      this.cacheStats.misses++;
      this.cacheStats.bytes +=
        (geometry.index?.array.byteLength ?? 0) +
        Object.values(geometry.attributes).reduce((sum, a) => sum + a.array.byteLength, 0);
    } else this.cacheStats.hits++;
    this.shape(geometry, material, origin);
  }

  rod(material: Material, from: Point, to: Point, radius: number): void {
    const start = new Vector3(...from);
    const end = new Vector3(...to);
    const direction = end.clone().sub(start);
    this.cylinderGeometry ??= new CylinderGeometry(1, 1, 1, 12);
    const geometry = this.cylinderGeometry.clone();
    geometry.scale(radius, direction.length(), radius);
    geometry.applyQuaternion(
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()),
    );
    geometry.translate((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    this.shape(geometry, material);
    geometry.dispose();
  }

  flush(parent: Group): void {
    const steps = this.flushSteps(parent);
    while (!steps.next().done) {
      // The synchronous API consumes the same deterministic steps without yielding.
    }
  }

  /** 合批并按 cell 暴露安全让出点；迭代器 return() 会释放尚未挂载的输出。 */
  *flushSteps(parent: Group): Generator<void, void, void> {
    let completed = false;
    try {
      for (const [material, cells] of this.batches) {
        const meshes: Mesh<BufferGeometry, Material>[] = [];
        let attached = false;
        try {
          for (const [cell, parts] of cells) {
            // mergeGeometries 可以混合不同形状，但索引存在性必须一致。
            // 保留原索引，避免球体/管线展开成三倍逐面顶点；不按位置焊接，保留法线与 UV 接缝。
            for (const part of parts) {
              if (part.index) continue;
              const count = part.getAttribute('position').count;
              // 非索引输入只补顺序索引；65535 是 WebGL2 的 16 位 primitive-restart 保留值。
              const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
              for (let i = 0; i < count; i++) indices[i] = i;
              part.setIndex(new BufferAttribute(indices, 1));
            }
            const geometry = mergeGeometries(parts, false);
            if (!geometry) throw new Error(`静态构件合批失败：${material.name || material.type}`);
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            const mesh = new Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.name = 'land-static-batch';
            mesh.userData['cell'] = cell;
            mesh.layers.enable(LAND_RENDER.layers.reflection);
            mesh.layers.enable(LAND_RENDER.layers.shadow);
            meshes.push(mesh);
            // 每批完成就释放自己的中间副本，降低大场景构建时的峰值驻留。
            for (const part of parts) part.dispose();
            parts.length = 0;
            yield;
          }
          // 子 LOD 构建器不传 multiDraw，保留独立选级及共享中档阴影几何。
          const batch = this.options.multiDraw ? batchStaticCells(meshes) : null;
          if (batch) parent.add(batch);
          else parent.add(...meshes);
          attached = true;
        } finally {
          // 取消/失败时，已合并但还没挂到 parent 的 cell 输出不在 scene dispose 树中。
          if (!attached) for (const mesh of meshes) mesh.geometry.dispose();
        }
      }
      for (const object of this.objects) parent.add(object);
      this.objects.length = 0;
      completed = true;
    } catch (error) {
      this.disposeDetachedObjects();
      throw error;
    } finally {
      if (!completed) this.disposeDetachedObjects();
      this.disposePending();
    }
  }

  /** 取消尚未 flush 的构建，释放 builder 独占的几何与游离 LOD 输出。 */
  abort(): void {
    this.disposeDetachedObjects();
    this.disposePending();
  }

  private disposeDetachedObjects(): void {
    const detached = this.objects.slice();
    this.objects.length = 0;
    disposeObjectGeometries(detached);
  }

  private disposePending(): void {
    // 失败路径也清理尚未合并的副本；输入原型与最终输出几何的生命周期仍归调用方。
    for (const cells of this.batches.values())
      for (const parts of cells.values()) for (const part of parts) part.dispose();
    this.batches.clear();
    this.boxGeometry?.dispose();
    this.cylinderGeometry?.dispose();
    this.sphereGeometry?.dispose();
    this.boxGeometry = undefined;
    this.cylinderGeometry = undefined;
    this.sphereGeometry = undefined;
    if (!this.options.tubeCache) {
      for (const geometry of this.tubeCache.values()) geometry.dispose();
      this.tubeCache.clear();
    }
  }
}
