import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Box3, Material, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAND_RENDER } from '@/01-shared';
import type { LandDetail } from '@/01-shared';
import { DistanceLod } from '@/04-engine';
import type { LandContact } from './ContactShadows';
import { batchStaticCells } from './CellBatch';

type Point = readonly [number, number, number];
const MERGE_GEOMETRY_PARTS_PER_STEP = 16;
const SHAPE_VERTICES_PER_STEP = 256;
const SHAPE_TIMING_SAMPLE_INTERVAL = 16;

interface BuilderGeometryPart {
  geometry: BufferGeometry;
  /** 未烘焙的实例变换；只用于 builder 缓存/TubeGeometry 等稳定共享源。 */
  transform?: Matrix4;
  /** Builder 是否拥有并负责 dispose 几何源。 */
  owned: boolean;
}

function canMergeIncrementally(parts: readonly BufferGeometry[]): boolean {
  const first = parts[0];
  if (!first || Object.keys(first.morphAttributes).length > 0) return false;
  const names = Object.keys(first.attributes);
  return parts.every((geometry) => {
    if (
      geometry.index === null ||
      geometry.morphTargetsRelative !== first.morphTargetsRelative ||
      Object.keys(geometry.morphAttributes).length > 0
    )
      return false;
    const keys = Object.keys(geometry.attributes);
    if (keys.length !== names.length || keys.some((name) => !names.includes(name))) return false;
    return names.every((name) => {
      const expected = first.getAttribute(name),
        actual = geometry.getAttribute(name);
      return (
        expected instanceof BufferAttribute &&
        actual instanceof BufferAttribute &&
        expected.array.constructor === actual.array.constructor &&
        expected.itemSize === actual.itemSize &&
        expected.normalized === actual.normalized &&
        expected.gpuType === actual.gpuType
      );
    });
  });
}

/** 合并静态 cell 几何时分批让帧，最终仍只产生与旧复制路径等价的网格。 */
function* mergeGeometrySteps(
  parts: readonly BuilderGeometryPart[],
  onStage?: (stage: string) => void,
): Generator<void, BufferGeometry | null, void> {
  const geometries = parts.map((part) => part.geometry);
  if (!canMergeIncrementally(geometries)) {
    if (!parts.some((part) => part.transform)) return mergeGeometries(geometries, false);
    const materialized: BufferGeometry[] = [],
      temporary: BufferGeometry[] = [];
    try {
      for (const part of parts) {
        if (!part.transform) {
          materialized.push(part.geometry);
          continue;
        }
        const copy = part.geometry.clone().applyMatrix4(part.transform);
        materialized.push(copy);
        temporary.push(copy);
      }
      return mergeGeometries(materialized, false);
    } finally {
      for (const geometry of temporary) geometry.dispose();
    }
  }
  const first = geometries[0]!;
  const attributeNames = Object.keys(first.attributes),
    vertexCount = geometries.reduce(
      (sum, geometry) => sum + geometry.getAttribute('position').count,
      0,
    ),
    indexCount = geometries.reduce((sum, geometry) => sum + geometry.index!.count, 0),
    merged = new BufferGeometry();
  let completed = false;
  try {
    merged.morphTargetsRelative = first.morphTargetsRelative;
    const outputAttributes = new Map<
      string,
      { attribute: BufferAttribute; array: BufferAttribute['array'] }
    >();
    for (const name of attributeNames) {
      const source = first.getAttribute(name) as BufferAttribute,
        Constructor = source.array.constructor as {
          new (length: number): BufferAttribute['array'];
        },
        array = new Constructor(
          parts.reduce(
            (sum, part) => sum + (part.geometry.getAttribute(name) as BufferAttribute).array.length,
            0,
          ),
        ),
        attribute = new BufferAttribute(array, source.itemSize, source.normalized);
      attribute.gpuType = source.gpuType;
      merged.setAttribute(name, attribute);
      outputAttributes.set(name, { attribute, array });
    }

    const useUint32 = vertexCount > 65536;
    const indices = useUint32 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let vertexOffset = 0,
      indexOffset = 0,
      maxIndex = 0;
    const attributeOffsets = new Map(attributeNames.map((name) => [name, 0]));
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex]!,
        geometry = part.geometry;
      for (const name of attributeNames) {
        const source = geometry.getAttribute(name) as BufferAttribute,
          target = outputAttributes.get(name)!,
          offset = attributeOffsets.get(name)!;
        target.array.set(source.array, offset);
        attributeOffsets.set(name, offset + source.array.length);
      }
      if (part.transform) {
        const transform = part.transform,
          position = geometry.getAttribute('position') as BufferAttribute,
          normal = geometry.getAttribute('normal') as BufferAttribute | undefined,
          tangent = geometry.getAttribute('tangent') as BufferAttribute | undefined,
          normalMatrix = normal ? new Matrix3().getNormalMatrix(transform) : undefined,
          vertexTotal = Math.max(position.count, normal?.count ?? 0, tangent?.count ?? 0);
        for (let start = 0; start < vertexTotal; start += SHAPE_VERTICES_PER_STEP) {
          const end = Math.min(start + SHAPE_VERTICES_PER_STEP, vertexTotal);
          for (const name of ['position', 'normal', 'tangent']) {
            const source = geometry.getAttribute(name) as BufferAttribute | undefined,
              target = outputAttributes.get(name);
            if (!source || !target) continue;
            const offset = attributeOffsets.get(name)! - source.array.length,
              array = target.array.subarray(
                offset + start * source.itemSize,
                offset + Math.min(end, source.count) * source.itemSize,
              ) as BufferAttribute['array'],
              view = new BufferAttribute(array, source.itemSize, source.normalized);
            view.gpuType = source.gpuType;
            if (name === 'position') view.applyMatrix4(transform);
            else if (name === 'normal' && normalMatrix) view.applyNormalMatrix(normalMatrix);
            else if (name === 'tangent') view.transformDirection(transform);
          }
          if (vertexTotal > SHAPE_VERTICES_PER_STEP) {
            onStage?.(`transform:${geometry.type}:${end}/${vertexTotal}`);
            yield;
          }
        }
      }
      const sourceIndex = geometry.index!;
      for (let index = 0; index < sourceIndex.count; index++) {
        const value = sourceIndex.getX(index) + vertexOffset;
        indices[indexOffset + index] = value;
        if (value > maxIndex) maxIndex = value;
      }
      vertexOffset += geometry.getAttribute('position').count;
      indexOffset += sourceIndex.count;
      if ((partIndex + 1) % MERGE_GEOMETRY_PARTS_PER_STEP === 0) {
        onStage?.(`merge-copy:${partIndex + 1}/${parts.length}`);
        yield;
      }
    }

    if (useUint32 && maxIndex <= 65535) {
      const compact = new Uint16Array(indices.length);
      for (let start = 0; start < indices.length; start += 16384) {
        compact.set(indices.subarray(start, Math.min(start + 16384, indices.length)), start);
        onStage?.(
          `merge-index-compact:${Math.min(start + 16384, indices.length)}/${indices.length}`,
        );
        yield;
      }
      merged.setIndex(new BufferAttribute(compact, 1));
    } else merged.setIndex(new BufferAttribute(indices, 1));
    completed = true;
    return merged;
  } finally {
    if (!completed) merged.dispose();
  }
}

interface BuilderOptions {
  cellSize?: number;
  cellOrigin?: readonly [number, number];
  dynamicLod?: boolean;
  multiDraw?: boolean;
  detail?: LandDetail;
  tubeCache?: Map<string, TubeGeometry>;
  cacheStats?: { hits: number; misses: number; bytes: number };
  onStage?: (stage: string) => void;
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
  private readonly batches = new Map<Material, Map<string, BuilderGeometryPart[]>>();
  private readonly objects: Object3D[] = [];
  private readonly retainedGeometrySources = new Set<BufferGeometry>();
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
  private shapeTimingCalls = 0;

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
        onStage: this.options.onStage,
      });
      try {
        build(child, best);
        this.absorbBatches(child);
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
        onStage: this.options.onStage,
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
        onStage: this.options.onStage,
      });
      try {
        yield* build(child, best);
        this.absorbBatches(child);
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
            onStage: this.options.onStage,
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
    const onStage = this.options.onStage;
    if (!onStage) {
      const copy = geometry.clone().applyMatrix4(this.shapeTransform(point, size, yaw));
      this.storeCopy(copy, material);
      return;
    }

    const stagePrefix = this.shapeStagePrefix(geometry);
    onStage(stagePrefix);
    if (++this.shapeTimingCalls % SHAPE_TIMING_SAMPLE_INTERVAL !== 0) {
      const copy = geometry.clone().applyMatrix4(this.shapeTransform(point, size, yaw));
      this.storeCopy(copy, material);
      return;
    }

    const measurements: string[] = [];
    let started = performance.now();
    const transform = this.shapeTransform(point, size, yaw);
    measurements.push(`matrix=${(performance.now() - started).toFixed(2)}ms`);
    started = performance.now();
    const copy = geometry.clone();
    measurements.push(`clone=${(performance.now() - started).toFixed(2)}ms`);
    started = performance.now();
    copy.applyMatrix4(transform);
    measurements.push(`apply=${(performance.now() - started).toFixed(2)}ms`);
    this.storeCopy(copy, material, (stage, durationMs) => {
      measurements.push(`${stage}=${durationMs.toFixed(2)}ms`);
    });
    onStage(`${stagePrefix}:timing:${measurements.join(':')}`);
  }

  /** 立即接管仅供一次写入的临时几何，避免先克隆再由调用方释放。 */
  shapeOwned(
    geometry: BufferGeometry,
    material: Material,
    point: Point = [0, 0, 0],
    size: Point = [1, 1, 1],
    yaw = 0,
  ): void {
    let stored = false;
    try {
      this.options.onStage?.(`${this.shapeStagePrefix(geometry)}:owned`);
      geometry.boundingBox = null;
      geometry.boundingSphere = null;
      geometry.applyMatrix4(this.shapeTransform(point, size, yaw));
      this.storeCopy(geometry, material);
      stored = true;
    } finally {
      if (!stored) geometry.dispose();
    }
  }

  /** 转移调用方拥有的临时几何；取消/失败时释放，成功后由 builder/flush 接管。 */
  *shapeOwnedSteps(
    geometry: BufferGeometry,
    material: Material,
    point: Point = [0, 0, 0],
    size: Point = [1, 1, 1],
    yaw = 0,
  ): Generator<void, void, void> {
    let delegated = false;
    try {
      const transform = this.shapeTransform(point, size, yaw),
        stagePrefix = this.shapeStagePrefix(geometry);
      delegated = true;
      yield* this.transformShapeSteps(geometry, material, transform, stagePrefix);
    } finally {
      if (!delegated) geometry.dispose();
    }
  }

  private *transformShapeSteps(
    geometry: BufferGeometry,
    material: Material,
    transform: Matrix4,
    stagePrefix: string,
  ): Generator<void, void, void> {
    let stored = false;
    try {
      // Bounds are only used for cell placement; recompute the transformed box once below.
      geometry.boundingBox = null;
      geometry.boundingSphere = null;
      const positions = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal'),
        tangents = geometry.getAttribute('tangent'),
        normalMatrix = normals ? new Matrix3().getNormalMatrix(transform) : undefined,
        vertexCount = Math.max(positions.count, normals?.count ?? 0, tangents?.count ?? 0),
        vector = new Vector3();
      for (let start = 0; start < vertexCount; start += SHAPE_VERTICES_PER_STEP) {
        const end = Math.min(start + SHAPE_VERTICES_PER_STEP, vertexCount);
        for (let index = start; index < Math.min(end, positions.count); index++) {
          vector.fromBufferAttribute(positions, index).applyMatrix4(transform);
          positions.setXYZ(index, vector.x, vector.y, vector.z);
        }
        if (normals && normalMatrix)
          for (let index = start; index < Math.min(end, normals.count); index++) {
            vector.fromBufferAttribute(normals, index).applyNormalMatrix(normalMatrix);
            normals.setXYZ(index, vector.x, vector.y, vector.z);
          }
        if (tangents)
          for (let index = start; index < Math.min(end, tangents.count); index++) {
            vector.fromBufferAttribute(tangents, index).transformDirection(transform);
            tangents.setXYZ(index, vector.x, vector.y, vector.z);
          }
        this.options.onStage?.(`${stagePrefix}:transform:${end}/${vertexCount}`);
        yield;
      }
      positions.needsUpdate = true;
      if (normals) normals.needsUpdate = true;
      if (tangents) tangents.needsUpdate = true;
      this.options.onStage?.(`${stagePrefix}:bounds`);
      this.storeCopy(geometry, material);
      stored = true;
    } finally {
      if (!stored) geometry.dispose();
    }
  }

  private shapeTransform(point: Point, size: Point, yaw: number): Matrix4 {
    this.position.fromArray(point);
    if (yaw === 0) this.rotation.identity();
    else this.rotation.setFromAxisAngle(this.up, yaw);
    this.scale.fromArray(size);
    this.transform.compose(this.position, this.rotation, this.scale);
    return this.transform.clone();
  }

  /** 将子构建器的批次转交给父构建器；共享源只克隆一次并由父级释放。 */
  private absorbBatches(child: LandBuilder): void {
    const sharedCopies = new Map<BufferGeometry, BufferGeometry>();
    for (const [material, cells] of child.batches) {
      let target = this.batches.get(material);
      if (!target) {
        target = new Map();
        this.batches.set(material, target);
      }
      for (const [cell, parts] of cells) {
        let batch = target.get(cell);
        if (!batch) {
          batch = [];
          target.set(cell, batch);
        }
        for (const part of parts) {
          if (part.owned) {
            batch.push(part);
            continue;
          }
          let copy = sharedCopies.get(part.geometry);
          if (!copy) {
            copy = part.geometry.clone();
            sharedCopies.set(part.geometry, copy);
            this.retainedGeometrySources.add(copy);
          }
          batch.push({
            ...part,
            geometry: copy,
            owned: false,
          });
        }
        parts.length = 0;
      }
      cells.clear();
    }
    child.batches.clear();
  }

  private shapeStagePrefix(geometry: BufferGeometry): string {
    return this.options.onStage
      ? `builder:shape:${geometry.type}:v${geometry.getAttribute('position').count}:i${geometry.index?.count ?? 0}`
      : '';
  }

  private storeCopy(
    copy: BufferGeometry,
    material: Material,
    onMeasure?: (stage: string, durationMs: number) => void,
  ): void {
    let started = onMeasure ? performance.now() : 0;
    copy.computeBoundingBox();
    if (onMeasure) {
      const now = performance.now();
      onMeasure('bounds', now - started);
      started = now;
    }
    this.routePart(
      { geometry: copy, owned: true },
      copy.boundingBox!,
      material,
      onMeasure,
      started,
    );
  }

  private storeShared(geometry: BufferGeometry, material: Material, transform: Matrix4): void {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!.clone().applyMatrix4(transform);
    this.routePart({ geometry, transform, owned: false }, bounds, material);
  }

  private routePart(
    part: BuilderGeometryPart,
    bounds: Box3,
    material: Material,
    onMeasure?: (stage: string, durationMs: number) => void,
    started = 0,
  ): void {
    const cell = this.options.cellSize ?? 0;
    const originX = this.options.cellOrigin?.[0] ?? 0;
    const originZ = this.options.cellOrigin?.[1] ?? 0;
    bounds.getCenter(this.center);
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
    if (batch) batch.push(part);
    else cells.set(key, [part]);
    if (onMeasure) onMeasure('route', performance.now() - started);
  }

  private shapeShared(
    geometry: BufferGeometry,
    material: Material,
    point: Point,
    size: Point = [1, 1, 1],
    yaw = 0,
  ): void {
    const transform = this.shapeTransform(point, size, yaw);
    this.options.onStage?.(`${this.shapeStagePrefix(geometry)}:deferred`);
    this.storeShared(geometry, material, transform);
  }

  private shapeSharedTransform(
    geometry: BufferGeometry,
    material: Material,
    transform: Matrix4,
  ): void {
    this.options.onStage?.(`${this.shapeStagePrefix(geometry)}:deferred`);
    this.storeShared(geometry, material, transform.clone());
  }

  box(material: Material, point: Point, size: Point, yaw = 0): void {
    this.boxGeometry ??= new BoxGeometry(1, 1, 1);
    this.shapeShared(this.boxGeometry, material, point, size, yaw);
  }

  cylinder(material: Material, point: Point, radius: number, height: number): void {
    this.cylinderGeometry ??= new CylinderGeometry(1, 1, 1, 12);
    this.shapeShared(this.cylinderGeometry, material, point, [radius, height, radius]);
  }

  sphere(material: Material, point: Point, size: Point): void {
    if (!this.sphereGeometry) {
      const segments = LAND_RENDER.lod.sphereSegments[this.options.detail ?? 'near'];
      this.sphereGeometry = new SphereGeometry(1, ...segments);
    }
    this.shapeShared(this.sphereGeometry, material, point, size);
  }

  ring(material: Material, point: Point, radius: number, tube: number): void {
    const geometry = new TorusGeometry(radius, tube, 6, 72);
    this.shapeOwned(geometry, material, point);
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
    this.shapeShared(geometry, material, origin);
  }

  rod(material: Material, from: Point, to: Point, radius: number): void {
    const start = new Vector3(...from);
    const end = new Vector3(...to);
    const direction = end.clone().sub(start);
    const length = direction.length();
    this.cylinderGeometry ??= new CylinderGeometry(1, 1, 1, 12);
    this.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    this.rotation.setFromUnitVectors(this.up, direction.normalize());
    this.scale.set(radius, length, radius);
    this.transform.compose(this.position, this.rotation, this.scale);
    this.shapeSharedTransform(this.cylinderGeometry, material, this.transform);
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
            const stagePrefix = this.options.onStage
              ? `static-flush:${material.name || material.type}:${cell}:parts${parts.length}`
              : '';
            this.options.onStage?.(`${stagePrefix}:prepare`);
            // mergeGeometries 可以混合不同形状，但索引存在性必须一致。
            // 保留原索引，避免球体/管线展开成三倍逐面顶点；不按位置焊接，保留法线与 UV 接缝。
            for (const part of parts) {
              const geometry = part.geometry;
              if (geometry.index) continue;
              const count = geometry.getAttribute('position').count;
              // 非索引输入只补顺序索引；65535 是 WebGL2 的 16 位 primitive-restart 保留值。
              const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
              for (let i = 0; i < count; i++) indices[i] = i;
              geometry.setIndex(new BufferAttribute(indices, 1));
            }
            if (this.options.onStage) {
              const vertices = parts.reduce(
                (sum, part) => sum + part.geometry.getAttribute('position').count,
                0,
              );
              const indices = parts.reduce((sum, part) => sum + part.geometry.index!.count, 0);
              this.options.onStage?.(`${stagePrefix}:v${vertices}:i${indices}:merge-start`);
            }
            const geometry = yield* mergeGeometrySteps(
              parts,
              this.options.onStage
                ? (stage) => this.options.onStage?.(`${stagePrefix}:${stage}`)
                : undefined,
            );
            if (!geometry) throw new Error(`静态构件合批失败：${material.name || material.type}`);
            this.options.onStage?.(`${stagePrefix}:bounds`);
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
            for (const part of parts) if (part.owned) part.geometry.dispose();
            parts.length = 0;
            this.options.onStage?.(`${stagePrefix}:attached-ready`);
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
    // 失败路径只释放 builder 拥有的输入；共享原型在合并完成后由其缓存拥有者释放。
    for (const cells of this.batches.values())
      for (const parts of cells.values())
        for (const part of parts) if (part.owned) part.geometry.dispose();
    this.batches.clear();
    for (const geometry of this.retainedGeometrySources) geometry.dispose();
    this.retainedGeometrySources.clear();
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
