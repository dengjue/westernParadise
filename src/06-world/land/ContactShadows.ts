import { CanvasTexture, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry } from 'three';
import type { Group } from 'three';
import { LAND_ATMOSPHERE } from '@/01-shared';
import type { CanvasFactory } from '@/05-materials';

export interface LandContact {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** 一张径向 alpha 图、一次实例提交补足柱础接触；low 同样有落地感，无屏幕空间 pass。 */
export function createContactShadows(
  root: Group,
  contacts: readonly LandContact[],
  factory: CanvasFactory,
): void {
  const config = LAND_ATMOSPHERE.contact;
  const canvas = factory(config.textureSize, config.textureSize),
    ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建接触影画布');
  const half = config.textureSize / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, config.textureSize, config.textureSize);
  const material = new MeshBasicMaterial({
    map: new CanvasTexture(canvas),
    color: config.color,
    transparent: true,
    opacity: config.opacity,
    depthWrite: false,
  });
  const mesh = new InstancedMesh(new PlaneGeometry(2, 2), material, contacts.length);
  const transform = new Object3D();
  transform.rotation.x = -Math.PI / 2;
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i]!;
    transform.position.set(contact.x, contact.y + config.lift, contact.z);
    transform.scale.set(contact.radius, contact.radius, 1);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.name = 'land-column-contact-shadows';
  root.add(mesh);
}
