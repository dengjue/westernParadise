import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Group, Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Point = readonly [number, number, number];

/** 静态细构件按材质合批。数千栏杆、斗拱、窗格只占少量 draw call。 */
export class LandBuilder {
  private readonly batches = new Map<Material, BufferGeometry[]>();
  private readonly boxGeometry = new BoxGeometry(1, 1, 1);
  private readonly cylinderGeometry = new CylinderGeometry(1, 1, 1, 12);
  private readonly sphereGeometry = new SphereGeometry(1, 16, 12);
  private readonly transform = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3();

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
    const batch = this.batches.get(material);
    if (batch) batch.push(copy);
    else this.batches.set(material, [copy]);
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
    for (const [material, parts] of this.batches) {
      // 所有构件都含 position/normal/uv；非索引化后可合并不同来源的曲面。
      const normalized = parts.map((part) => (part.index ? part.toNonIndexed() : part));
      const geometry = mergeGeometries(normalized, false);
      if (geometry) {
        const mesh = new Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = 'land-static-batch';
        parent.add(mesh);
      }
      for (const part of new Set([...parts, ...normalized])) part.dispose();
    }
    this.batches.clear();
    this.boxGeometry.dispose();
    this.cylinderGeometry.dispose();
    this.sphereGeometry.dispose();
  }
}
