import {
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { WebGLRenderer } from 'three';
import type { QualityTier, TimeOfDayId } from '@/00-types';
import { LAND_LIGHT, PURE_LAND } from '@/01-shared';
import { Reflector } from 'three/addons/objects/Reflector.js';

const SKY_VERTEX = `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = `
  uniform vec3 topColor, horizonColor, sunDirection;
  varying vec3 vDirection;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
  }
  float fbm(vec2 p) {
    float n=0.0, a=0.5;
    for(int i=0;i<5;i++){n+=noise(p)*a;p=p*2.03+vec2(8.4,2.1);a*=0.5;}
    return n;
  }
  void main() {
    vec3 d=normalize(vDirection);
    float h=max(0.0,d.y);
    vec3 sky=mix(horizonColor,topColor,pow(smoothstep(0.0,0.85,h),0.55));
    float sunDot=max(0.0,dot(d,sunDirection));
    sky+=vec3(1.0,0.68,0.31)*pow(sunDot,16.0)*0.38;
    sky+=vec3(4.0,2.6,1.25)*smoothstep(0.99955,0.9998,sunDot);
    vec2 p=d.xz/(h+0.18)*2.2;
    float clouds=fbm(p+vec2(2.1,0.4));
    float coverage=smoothstep(0.47,0.72,clouds)*smoothstep(0.01,0.16,h);
    vec3 cloudColor=mix(horizonColor*0.7,vec3(1.03,0.96,0.8),smoothstep(0.5,0.8,clouds));
    sky=mix(sky,cloudColor,coverage*0.82);
    sky=mix(horizonColor,sky,smoothstep(-0.04,0.08,d.y));
    gl_FragColor=vec4(sky,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const WATER_VERTEX = `
  uniform mat4 textureMatrix;
  varying vec4 vReflection;
  varying vec3 vWorld;
  void main() {
    vReflection=textureMatrix*vec4(position,1.0);
    vWorld=(modelMatrix*vec4(position,1.0)).xyz;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  }
`;

const WATER_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform vec3 color, fogColor, sunDirection;
  uniform float time, fogDensity;
  varying vec4 vReflection;
  varying vec3 vWorld;
  void main() {
    vec2 p=vWorld.xz;
    float a=sin(p.x*0.62+p.y*0.21+time*0.55);
    float b=sin(p.x*0.27-p.y*0.49-time*0.42);
    vec2 ripple=vec2(a,b)*0.0013;
    vec2 uv=vReflection.xy/vReflection.w;
    vec3 reflected=texture2D(tDiffuse,uv+ripple).rgb;
    vec3 normal=normalize(vec3(a*0.04,1.0,b*0.04));
    vec3 viewDirection=normalize(cameraPosition-vWorld);
    float fresnel=pow(1.0-max(0.0,dot(viewDirection,normal)),3.0);
    float caustic=pow(0.5+0.5*sin(p.x*1.4+sin(p.y*1.3+time*0.3))*sin(p.y*1.7-time*0.15),12.0);
    vec3 water=mix(color*(0.52+caustic*0.22),reflected,0.32+fresnel*0.52);
    vec3 halfDirection=normalize(sunDirection+viewDirection);
    water+=vec3(1.0,0.85,0.54)*pow(max(0.0,dot(normal,halfDirection)),260.0)*1.6;
    float distanceToCamera=length(cameraPosition-vWorld);
    float fog=1.0-exp(-fogDensity*fogDensity*distanceToCamera*distanceToCamera);
    water=mix(water,fogColor,clamp(fog,0.0,1.0));
    gl_FragColor=vec4(water,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createLandAtmosphere(
  scene: Scene,
  renderer: WebGLRenderer,
  quality: QualityTier,
  initial: TimeOfDayId,
) {
  const uniforms = {
    topColor: { value: new Color() },
    horizonColor: { value: new Color() },
    sunDirection: { value: new Vector3() },
  };
  const skyMaterial = new ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthWrite: false,
  });
  const sky = new Mesh(new SphereGeometry(1200, 32, 16), skyMaterial);
  sky.name = 'land-sky';
  sky.frustumCulled = false;
  scene.add(sky);
  const sun = new DirectionalLight();
  sun.castShadow = quality === 'high' || quality === 'ultra';
  sun.shadow.mapSize.setScalar(quality === 'ultra' ? 4096 : 2048);
  const span = PURE_LAND.rendering.shadowSpan;
  Object.assign(sun.shadow.camera, {
    left: -span,
    right: span,
    top: span,
    bottom: -span,
    near: 1,
    far: 650,
  });
  sun.shadow.bias = PURE_LAND.rendering.shadowBias;
  sun.shadow.normalBias = 0.05;
  sun.shadow.camera.updateProjectionMatrix();
  renderer.shadowMap.type = PCFSoftShadowMap;
  // 建筑不运动：阴影生成一次，时段切换才重新提交，避免反射相机重复绘制阴影。
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const ambient = new HemisphereLight(0xe9e5d1, 0x456b68, 1.6);
  const fill = new DirectionalLight(0xdcefeb, 0.75);
  fill.position.set(50, 70, 120);
  const interior = new PointLight(0xffd192, 65, 40, 2);
  interior.position.set(0, 11, -46);
  scene.add(sun, ambient, fill, interior);
  const fog = new FogExp2(0xdacdb5, 0.0018);
  scene.fog = fog;
  const reflectionSize = PURE_LAND.rendering.reflectionSize[quality];
  const water = new Reflector(new PlaneGeometry(1500, 1500), {
    textureWidth: reflectionSize,
    textureHeight: reflectionSize,
    clipBias: 0.003,
    multisample: 0,
    color: PURE_LAND.palette.water,
    shader: {
      name: 'LotusWater',
      uniforms: {
        color: { value: new Color(PURE_LAND.palette.water) },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        time: { value: 0 },
        fogColor: { value: fog.color },
        fogDensity: { value: fog.density },
        sunDirection: { value: new Vector3() },
      },
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
    },
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = PURE_LAND.waterY;
  water.name = 'seven-jewel-water';
  scene.add(water);
  const waterUniforms = (water.material as ShaderMaterial).uniforms;
  const generator = new PMREMGenerator(renderer);
  const environmentScene = new Scene();
  const environmentSky = new Mesh(sky.geometry, skyMaterial);
  environmentScene.add(environmentSky);
  let environment: ReturnType<PMREMGenerator['fromScene']> | null = null;

  function setTime(id: TimeOfDayId): void {
    const light = LAND_LIGHT[id];
    uniforms.topColor.value.setHex(light.top);
    uniforms.horizonColor.value.setHex(light.horizon);
    sun.position.fromArray(light.sunPosition);
    uniforms.sunDirection.value.copy(sun.position).normalize();
    (waterUniforms['sunDirection']!.value as Vector3).copy(uniforms.sunDirection.value);
    sun.color.setHex(light.sun);
    sun.intensity = light.sunIntensity;
    ambient.intensity = light.ambient;
    fog.color.setHex(light.fog);
    renderer.toneMappingExposure = light.exposure;
    environment?.dispose();
    environment = generator.fromScene(environmentScene, 0.05, 0.1, 1600);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.46;
    renderer.shadowMap.needsUpdate = true;
  }
  setTime(initial);
  return {
    setTime,
    update(seconds: number): void {
      waterUniforms['time']!.value = seconds;
    },
    dispose(): void {
      scene.environment = null;
      environment?.dispose();
      generator.dispose();
      water.dispose();
      scene.remove(water);
      sun.shadow.dispose();
    },
  };
}
