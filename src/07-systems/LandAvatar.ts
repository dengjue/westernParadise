import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Material, Object3D, Vector3 } from 'three';
import { LAND_AVATAR, companionColor } from '@/01-shared';
import { shortestAngle } from './turn';

const FULL_TURN = Math.PI * 2;
const MODEL = LAND_AVATAR.appearance;

/**
 * 第三人称漫游角色（低多边形程序化访客）。
 *
 * 姿势骨架只负责视觉表现，不承载玩法数值；
 * 根节点原点位于脚底，y 由地面采样决定。相比旧庭院 `Character`，这里只负责
 * 「视觉表现 + 朝向缓动」，移动与碰撞仍由 LandCamera 的步行分支统一处理，
 * 保证第一人称/第三人称使用同一条移动、贴地与步频逻辑。
 */
export class LandAvatar {
  readonly root: Group;

  private yawRad = 0;
  private disposed = false;

  constructor(parent: Object3D) {
    this.root = this.createVisual();
    this.root.name = 'land-avatar';
    this.root.visible = false;
    parent.add(this.root);
  }

  get yaw(): number {
    return this.yawRad;
  }

  /** 放置到脚底位置并立即对齐朝向；用于进入步行瞬间的落位，不做缓动。 */
  place(position: Vector3, yawRad: number): void {
    this.root.position.copy(position);
    this.yawRad = yawRad;
    this.root.rotation.y = yawRad;
    this.root.visible = true;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  setRoomColor(id?: string): void {
    const body = this.root.getObjectByName('player-body');
    if (body instanceof Mesh && body.material instanceof MeshStandardMaterial)
      body.material.color.setHex(id ? companionColor(id).hex : LAND_AVATAR.appearance.bodyColor);
  }

  /** 从场景移除并释放此角色独占的几何与材质；重复调用安全。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<Mesh['geometry']>();
    const materials = new Set<Material>();
    this.root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      geometries.add(node.geometry);
      if (Array.isArray(node.material))
        node.material.forEach((material) => materials.add(material));
      else materials.add(node.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.root.removeFromParent();
  }

  /** 朝向缓动：角色面向移动方向；静止时不转动。返回实际转过的角度（供测试断言）。 */
  faceYaw(targetYaw: number, deltaSeconds: number): number {
    const difference = shortestAngle(targetYaw - this.yawRad);
    if (difference === 0) return 0;
    const maxStep = LAND_AVATAR.turnSpeed * Math.max(deltaSeconds, 0);
    if (Math.abs(difference) <= maxStep) {
      this.yawRad += difference;
    } else {
      this.yawRad += Math.sign(difference) * maxStep;
    }
    // 保持角度在 [-π, π) 区间，避免长期累计浮点漂移。
    this.yawRad = ((((this.yawRad + Math.PI) % FULL_TURN) + FULL_TURN) % FULL_TURN) - Math.PI;
    this.root.rotation.y = this.yawRad;
    return difference;
  }

  private createVisual(): Group {
    const group = new Group();
    const material = (color: number) =>
      new MeshStandardMaterial({ color, roughness: MODEL.roughness, flatShading: true });
    const coat = material(MODEL.bodyColor);
    const skin = material(MODEL.headColor);
    const hairMaterial = material(MODEL.hairColor);
    const trousers = material(MODEL.trouserColor);
    const shoes = material(MODEL.shoeColor);
    const packMaterial = material(MODEL.packColor);
    const accent = material(MODEL.accentColor);
    const features = material(MODEL.featureColor);
    const add = (mesh: Mesh, name: string, parent: Group = group) => {
      mesh.name = name;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      parent.add(mesh);
      return mesh;
    };

    // 收肩、略收腰的短行旅外衣，避免原胶囊轮廓；步态骨骼后续可围绕躯干混合。
    const torso = new Mesh(
      new CylinderGeometry(MODEL.torso.topRadius, MODEL.torso.bottomRadius, MODEL.torso.height, 9),
      coat,
    );
    torso.position.y = MODEL.torso.centerY;
    add(torso, 'player-body');

    const collar = new Mesh(new TorusGeometry(0.13, 0.033, 5, 10), accent);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.455;
    add(collar, 'player-collar');

    const head = new Mesh(new SphereGeometry(MODEL.head.radius, 12, 9), skin);
    head.position.y = MODEL.head.centerY;
    add(head, 'player-head');
    const hair = new Mesh(
      new SphereGeometry(MODEL.head.radius * 1.04, 12, 7, 0, FULL_TURN, 0, Math.PI / 2),
      hairMaterial,
    );
    hair.position.y = MODEL.head.centerY + 0.015;
    add(hair, 'player-hair');
    const face = new Group();
    face.position.set(0, MODEL.head.centerY, 0.13);
    face.name = 'player-face';
    group.add(face);
    const eyeGeometry = new SphereGeometry(0.018, 6, 5);
    for (const side of [-1, 1]) {
      const eye = new Mesh(eyeGeometry, features);
      eye.position.set(side * 0.052, 0.012, 0.025);
      add(eye, `player-eye-${side}`, face);
    }
    const nose = new Mesh(new ConeGeometry(0.027, 0.065, 5), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.012, 0.045);
    add(nose, 'player-nose', face);

    // 肩部与髋部各自作为旋转枢轴，为后续真实步态保留层级。
    const armGeometry = new CapsuleGeometry(
      MODEL.shoulder.limbRadius,
      MODEL.shoulder.limbLength,
      2,
      7,
    );
    const handGeometry = new SphereGeometry(0.062, 8, 6);
    for (const side of [-1, 1]) {
      const arm = new Group();
      arm.position.set(side * MODEL.shoulder.x, MODEL.shoulder.y, 0);
      arm.name = `player-arm-pivot-${side}`;
      group.add(arm);
      const sleeve = new Mesh(armGeometry, coat);
      sleeve.position.y = -0.19;
      add(sleeve, `player-arm-${side}`, arm);
      const hand = new Mesh(handGeometry, skin);
      hand.position.y = -0.4;
      add(hand, `player-hand-${side}`, arm);

      const leg = new Group();
      leg.position.set(side * MODEL.hip.x, MODEL.hip.y, 0);
      leg.name = `player-leg-pivot-${side}`;
      group.add(leg);
      const trousersLeg = new Mesh(
        new CapsuleGeometry(MODEL.hip.limbRadius, MODEL.hip.limbLength, 2, 7),
        trousers,
      );
      trousersLeg.position.y = -0.27;
      add(trousersLeg, `player-leg-${side}`, leg);
      const boot = new Mesh(
        new BoxGeometry(MODEL.foot.width, MODEL.foot.height, MODEL.foot.depth),
        shoes,
      );
      boot.position.set(0, -0.72, MODEL.foot.forward);
      add(boot, `player-boot-${side}`, leg);
    }

    const strap = new Mesh(new BoxGeometry(0.045, 0.58, 0.025), accent);
    strap.position.set(-0.105, 1.15, 0.205);
    strap.rotation.z = -0.28;
    add(strap, 'player-sash');
    const pack = new Mesh(
      new CapsuleGeometry(MODEL.backpack.radius, MODEL.backpack.height, 2, 8),
      packMaterial,
    );
    pack.position.set(0, MODEL.backpack.y, MODEL.backpack.z);
    add(pack, 'player-pack');

    // 服装局部与关节统一关闭阴影，既保持轻量，也避免多人角色放大阴影成本。
    return group;
  }
}
