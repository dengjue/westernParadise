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

type Point = readonly [number, number, number];
interface BuilderOptions {
  cellSize?: number;
  dynamicLod?: boolean;
  detail?: LandDetail;
}

/** 静态细构件按材质合批。数千栏杆、斗拱、窗格只占少量 draw call。 */
export class LandBuilder {
  readonly contacts: LandContact[] = [];
  private readonly batches = new Map<Material, Map<string, BufferGeometry[]>>();
  private readonly objects: Object3D[] = [];
  private readonly boxGeometry = new BoxGeometry(1, 1, 1);
  private readonly cylinderGeometry = new CylinderGeometry(1, 1, 1, 12);
  private readonly sphereGeometry: SphereGeometry;
  private readonly transform = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3();
  private readonly center = new Vector3();

  constructor(private readonly options: BuilderOptions = {}) {
    const segments = LAND_RENDER.lod.sphereSegments[options.detail ?? 'near'];
    this.sphereGeometry = new SphereGeometry(1, ...segments);
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
      const child = new LandBuilder({ cellSize: this.options.cellSize, detail: best });
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
      const builder = new LandBuilder({ detail });
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

  shape(
    geometry: BufferGeometry,
    material: Material,
    point: Point = [0, 0, 0],
    size: Point = [1, 1, 1],
    yaw = 0,
  ): void {
    this.position.fromArray(point);
    this.rotation.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    this.scale.fromArray(size);
    this.transform.compose(this.position, this.rotation, this.scale);
    const copy = geometry.clone().applyMatrix4(this.transform);
    copy.computeBoundingBox();
    copy.boundingBox!.getCenter(this.center);
    const cell = this.options.cellSize ?? 0;
    const key =
      cell > 0 ? `${Math.floor(this.center.x / cell)},${Math.floor(this.center.z / cell)}` : 'all';
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
    this.shape(this.boxGeometry, material, point, size, yaw);
  }

  cylinder(material: Material, point: Point, radius: number, height: number): void {
    this.shape(this.cylinderGeometry, material, point, [radius, height, radius]);
  }

  sphere(material: Material, point: Point, size: Point): void {
    this.shape(this.sphereGeometry, material, point, size);
  }

  ring(material: Material, point: Point, radius: number, tube: number): void {
    const geometry = new TorusGeometry(radius, tube, 6, 72);
    this.shape(geometry, material, point);
    geometry.dispose();
  }

  tube(material: Material, points: readonly Point[], radius: number, segments = 12): void {
    const curve = new CatmullRomCurve3(points.map((point) => new Vector3(...point)));
    const geometry = new TubeGeometry(curve, segments, radius, 5, false);
    this.shape(geometry, material);
    geometry.dispose();
  }

  rod(material: Material, from: Point, to: Point, radius: number): void {
    const start = new Vector3(...from);
    const end = new Vector3(...to);
    const direction = end.clone().sub(start);
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
    try {
      for (const [material, cells] of this.batches)
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
          parent.add(mesh);
          // 每批完成就释放自己的中间副本，降低大场景构建时的峰值驻留。
          for (const part of parts) part.dispose();
          parts.length = 0;
        }
      for (const object of this.objects) parent.add(object);
      this.objects.length = 0;
    } finally {
      this.disposePending();
    }
  }

  private disposePending(): void {
    // 失败路径也清理尚未合并的副本；输入原型与最终输出几何的生命周期仍归调用方。
    for (const cells of this.batches.values())
      for (const parts of cells.values()) for (const part of parts) part.dispose();
    this.batches.clear();
    this.boxGeometry.dispose();
    this.cylinderGeometry.dispose();
    this.sphereGeometry.dispose();
  }
}
