import { BufferGeometry, Color, Float32BufferAttribute, Points, ShaderMaterial } from 'three';
import type { Group } from 'three';
import { Rng } from '@/02-core';

/** 轻缓天华全部在顶点着色器中移动，固定实例数量、无需逐帧上传坐标。 */
export function createFlowerDrift(parent: Group, seed: number, count: number) {
  const rng = new Rng(seed ^ 0x46574c52);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = rng.range(-90, 90);
    positions[i * 3 + 1] = rng.range(0, 45);
    positions[i * 3 + 2] = rng.range(-95, 110);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const uniforms = { time: { value: 0 }, tint: { value: new Color(0xffe1ba) } };
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      uniform float time;
      varying float vAngle;
      void main() {
        vec3 p=position;
        p.y=mod(p.y-time*0.34+45.0,45.0);
        p.x+=sin(time*0.24+position.z)*1.4;
        p.z+=cos(time*0.18+position.x)*0.7;
        vAngle=time*0.2+position.x;
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(85.0/-mv.z,1.0,5.0);
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      varying float vAngle;
      void main() {
        vec2 p=gl_PointCoord-0.5;
        p=mat2(cos(vAngle),-sin(vAngle),sin(vAngle),cos(vAngle))*p;
        float r=length(p*vec2(1.0,1.8));
        float alpha=(1.0-smoothstep(0.25,0.5,r))*0.55;
        if(alpha<0.01)discard;
        gl_FragColor=vec4(tint,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new Points(geometry, material);
  points.name = 'flower-drift';
  parent.add(points);
  return {
    update: (seconds: number) => {
      uniforms.time.value = seconds;
    },
  };
}
