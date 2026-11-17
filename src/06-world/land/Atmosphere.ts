import {
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Material, Scene, Texture, WebGLRenderer } from 'three';
import type { QualityTier, TimeOfDayId } from '@/00-types';
import {
  LAND_ATMOSPHERE,
  LAND_GARDEN,
  LAND_LIGHT,
  LAND_LIGHT_QUALITY,
  LAND_TIMES,
  LAND_RENDER,
  PURE_LAND,
} from '@/01-shared';
import { LandLightTransition } from '@/02-core';
import { applyLandAtmosphere, LAND_HAZE_GLSL } from '@/05-materials';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { budgetReflection } from './LandReflection';
import { createLandAtlasEnvironment, createLandEnvironmentSteps } from './LandEnvironment';
import type { LandEnvironmentHandle } from './LandEnvironment';
import type { LandPmremAtlasHandle } from './LandPmremAtlas';

/** 输入已由 Color 转到线性空间，逐通道累加避免逐帧创建临时 Color。 */
function addWeightedColor(target: Color, source: Color, weight: number): void {
  target.r += source.r * weight;
  target.g += source.g * weight;
  target.b += source.b * weight;
}

const SKY_VERTEX = `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = `
  uniform vec3 topColor, horizonColor, hazeColor, sunDirection;
  uniform float cloudTime;
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
    float clouds=fbm(p+vec2(2.1+cloudTime,0.4+cloudTime*0.23));
    float coverage=smoothstep(0.47,0.72,clouds)*smoothstep(0.01,0.16,h);
    vec3 cloudColor=mix(horizonColor*0.7,vec3(1.03,0.96,0.8),smoothstep(0.5,0.8,clouds));
    sky=mix(sky,cloudColor,coverage*${LAND_ATMOSPHERE.sky.cloudStrength.toFixed(4)});
    sky=mix(hazeColor,sky,smoothstep(-0.015,0.22,d.y));
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
  uniform float time;
  varying vec4 vReflection;
  varying vec3 vWorld;
  ${LAND_HAZE_GLSL}
  void main() {
    vec2 p=vWorld.xz;
    float a=sin(p.x*0.62+p.y*0.21+time*0.55);
    float b=sin(p.x*0.27-p.y*0.49-time*0.42);
    vec2 ripple=vec2(a,b)*${LAND_GARDEN.water.distortion.toFixed(5)};
    vec2 uv=vReflection.xy/vReflection.w;
    vec3 reflected=texture2D(tDiffuse,uv+ripple).rgb;
    vec3 normal=normalize(vec3(a*${LAND_GARDEN.water.normalScale.toFixed(4)},1.0,b*${LAND_GARDEN.water.normalScale.toFixed(4)}));
    vec3 viewDirection=normalize(cameraPosition-vWorld);
    float fresnel=pow(1.0-max(0.0,dot(viewDirection,normal)),3.0);
    float caustic=pow(0.5+0.5*sin(p.x*1.4+sin(p.y*1.3+time*0.3))*sin(p.y*1.7-time*0.15),12.0);
    vec3 water=mix(color*(0.52+caustic*${LAND_GARDEN.water.caustic.toFixed(4)}),reflected,${LAND_ATMOSPHERE.water.reflection.toFixed(4)}+fresnel*${LAND_ATMOSPHERE.water.fresnel.toFixed(4)});
    vec3 halfDirection=normalize(sunDirection+viewDirection);
    water+=vec3(1.0,0.85,0.54)*pow(max(0.0,dot(normal,halfDirection)),260.0)*${LAND_ATMOSPHERE.water.highlight.toFixed(4)};
    water=mix(water,fogColor,landHaze(vWorld));
    gl_FragColor=vec4(water,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface LandAtmosphereHandle {
  stats: {
    transition: LandLightTransition;
    environment: LandEnvironmentHandle['stats'];
    shadowRequests: number;
  };
  setTime(id: TimeOfDayId): void;
  reflection: ReturnType<typeof budgetReflection>;
  update(seconds: number, deltaMs: number): void;
  dispose(): void;
}

export function* createLandAtmosphereSteps(
  scene: Scene,
  renderer: WebGLRenderer,
  quality: QualityTier,
  initial: TimeOfDayId,
  reducedMotion = false,
  onStage?: (stage: string) => void,
  prebakedEnvironment?: LandPmremAtlasHandle,
): Generator<void, LandAtmosphereHandle, void> {
  const previous = {
    fog: scene.fog,
    environment: scene.environment,
    environmentIntensity: scene.environmentIntensity,
    shadowMapType: renderer.shadowMap.type,
    shadowMapAutoUpdate: renderer.shadowMap.autoUpdate,
    shadowMapNeedsUpdate: renderer.shadowMap.needsUpdate,
  };
  let waterForCleanup: Reflector | undefined;
  let sunForCleanup: DirectionalLight | undefined;
  let environmentForCleanup: LandEnvironmentHandle | undefined;
  let completed = false;

  try {
    onStage?.('atmosphere:setup');
    const config = LAND_ATMOSPHERE;
    const transition = new LandLightTransition(initial, reducedMotion);
    const presets = LAND_TIMES.map((id) => ({
      ...LAND_LIGHT[id],
      topColor: new Color(LAND_LIGHT[id].top),
      horizonColor: new Color(LAND_LIGHT[id].horizon),
      hazeColor: new Color(LAND_LIGHT[id].fog),
      sunColor: new Color(LAND_LIGHT[id].sun),
      position: new Vector3().fromArray(LAND_LIGHT[id].sunPosition),
    }));
    const fog = new FogExp2(LAND_LIGHT[initial].fog, config.haze.density);
    scene.fog = fog;
    const uniforms = {
      topColor: { value: new Color() },
      horizonColor: { value: new Color() },
      hazeColor: { value: fog.color },
      sunDirection: { value: new Vector3() },
      cloudTime: { value: 0 },
    };
    const skyMaterial = new ShaderMaterial({
      uniforms,
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: BackSide,
      depthWrite: false,
    });
    const sky = new Mesh(new SphereGeometry(config.sky.radius, 32, 16), skyMaterial);
    sky.name = 'land-sky';
    sky.frustumCulled = false;
    scene.add(sky);
    const sun = new DirectionalLight();
    sunForCleanup = sun;
    sun.castShadow = quality === 'high' || quality === 'ultra';
    sun.shadow.mapSize.setScalar(quality === 'ultra' ? 4096 : 2048);
    const span = config.shadow.span;
    Object.assign(sun.shadow.camera, {
      left: -span,
      right: span,
      top: span,
      bottom: -span,
      near: config.shadow.near,
      far: config.shadow.far,
    });
    sun.shadow.bias = config.shadow.bias;
    sun.shadow.normalBias = config.shadow.normalBias;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.camera.layers.set(LAND_RENDER.layers.shadow);
    renderer.shadowMap.type = PCFSoftShadowMap;
    // 稳态缓存；过渡时光源方向与阴影拍摄同频更新，避免新光源配旧阴影的漂移。
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    const ambient = new HemisphereLight(config.fill.sky, config.fill.ground);
    const fill = new DirectionalLight(config.fill.color);
    fill.position.fromArray(config.fill.position);
    const interior = new PointLight(
      config.interior.color,
      config.interior.intensity,
      config.interior.distance,
      2,
    );
    interior.position.fromArray(config.interior.position);
    sun.name = 'land-sun';
    fill.name = 'land-front-fill';
    interior.name = 'land-interior-light';
    scene.add(sun, ambient, fill, interior);
    const reflectionSize = PURE_LAND.rendering.reflectionSize[quality];
    const water = new Reflector(new PlaneGeometry(config.water.extent, config.water.extent), {
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
          sunDirection: { value: new Vector3() },
        },
        vertexShader: WATER_VERTEX,
        fragmentShader: WATER_FRAGMENT,
      },
    });
    waterForCleanup = water;
    water.rotation.x = -Math.PI / 2;
    water.position.y = PURE_LAND.waterY;
    water.name = 'seven-jewel-water';
    scene.add(water);
    const reflection = budgetReflection(water, quality, reducedMotion);
    const waterUniforms = (water.material as ShaderMaterial).uniforms;
    // Reflector 克隆 shader uniforms，必须显式连回共同的线性雾色。
    waterUniforms['fogColor']!.value = fog.color;
    onStage?.('atmosphere:environment-prepare');
    yield;
    let environment: LandEnvironmentHandle;
    if (prebakedEnvironment) {
      environment = createLandAtlasEnvironment(prebakedEnvironment);
    } else {
      environment = yield* createLandEnvironmentSteps(
        renderer,
        sky,
        (index) => {
          const preset = presets[index]!;
          uniforms.topColor.value.copy(preset.topColor);
          uniforms.horizonColor.value.copy(preset.horizonColor);
          fog.color.copy(preset.hazeColor);
          uniforms.sunDirection.value.copy(preset.position).normalize();
        },
        (stage) => onStage?.(`atmosphere:${stage}`),
      );
    }
    environmentForCleanup = environment;
    scene.environment = environment.targets[0]?.texture ?? null;
    scene.environmentIntensity = config.environment.intensity;
    const environmentMaps: Texture[] =
      environment.atlases.length > 0
        ? environment.atlases
        : environment.targets.map((target) => target.texture);
    const materialUniforms = {
      landHazeColor: { value: fog.color },
      landLightWeights: { value: transition.weights },
      landEnvDawn: { value: environmentMaps[0]! },
      landEnvNoon: { value: environmentMaps[1]! },
      landEnvDusk: { value: environmentMaps[2]! },
    };
    const materials = new Set<Material>();
    scene.traverse((object) => {
      const material = (object as Mesh).material;
      if (!material) return;
      for (const entry of Array.isArray(material) ? material : [material]) {
        if (entry instanceof ShaderMaterial || materials.has(entry)) continue;
        materials.add(entry);
        applyLandAtmosphere(
          entry,
          materialUniforms,
          environment.stats.source === 'prebaked-atlas' ? 'atlas' : 'cube',
        );
      }
    });
    const stats = { transition, environment: environment.stats, shadowRequests: 0 };
    const desiredSun = new Vector3();
    let shadowElapsed = 0;
    function applyLighting(forceShadow: boolean): void {
      uniforms.topColor.value.setRGB(0, 0, 0);
      uniforms.horizonColor.value.setRGB(0, 0, 0);
      fog.color.setRGB(0, 0, 0);
      sun.color.setRGB(0, 0, 0);
      desiredSun.set(0, 0, 0);
      sun.intensity = ambient.intensity = fill.intensity = renderer.toneMappingExposure = 0;
      for (let i = 0; i < presets.length; i++) {
        const preset = presets[i]!,
          weight = transition.weights[i]!;
        addWeightedColor(uniforms.topColor.value, preset.topColor, weight);
        addWeightedColor(uniforms.horizonColor.value, preset.horizonColor, weight);
        addWeightedColor(fog.color, preset.hazeColor, weight);
        addWeightedColor(sun.color, preset.sunColor, weight);
        desiredSun.addScaledVector(preset.position, weight);
        sun.intensity += preset.sunIntensity * weight;
        ambient.intensity += preset.ambient * weight;
        fill.intensity += preset.fill * weight;
        renderer.toneMappingExposure += preset.exposure * weight;
      }
      uniforms.sunDirection.value.copy(desiredSun).normalize();
      (waterUniforms['sunDirection']!.value as Vector3).copy(uniforms.sunDirection.value);
      if (
        !sun.castShadow ||
        forceShadow ||
        !transition.active ||
        shadowElapsed >= 1000 / LAND_LIGHT_QUALITY[quality].shadowHz
      ) {
        sun.position.copy(desiredSun);
        shadowElapsed = 0;
        if (sun.castShadow) {
          renderer.shadowMap.needsUpdate = true;
          stats.shadowRequests++;
        }
      }
      // 连续变化由既有 15–30 Hz 反射预算采样；起止点立即同步。
      // 每个逻辑步都 invalidate 会绕过预算，在 120 Hz 显示器上重复提交整片世界。
      if (forceShadow || !transition.active) reflection.invalidate();
    }
    applyLighting(true);
    let disposed = false;
    completed = true;
    return {
      stats,
      setTime(id: TimeOfDayId): void {
        if (!transition.request(id)) return;
        if (reducedMotion) applyLighting(true);
        reflection.invalidate();
      },
      reflection,
      update(seconds: number, deltaMs: number): void {
        waterUniforms['time']!.value = reducedMotion ? 0 : seconds;
        uniforms.cloudTime.value = reducedMotion ? 0 : seconds * config.sky.cloudSpeed;
        shadowElapsed += deltaMs;
        if (transition.update(deltaMs)) applyLighting(false);
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        scene.environment = null;
        environment.dispose();
        water.dispose();
        water.geometry.dispose();
        for (const material of Array.isArray(water.material) ? water.material : [water.material])
          material.dispose();
        scene.remove(water);
        sun.shadow.dispose();
      },
    };
  } finally {
    if (!completed) {
      environmentForCleanup?.dispose();
      prebakedEnvironment?.dispose();
      waterForCleanup?.dispose();
      sunForCleanup?.shadow.dispose();
      scene.fog = previous.fog;
      scene.environment = previous.environment;
      scene.environmentIntensity = previous.environmentIntensity;
      renderer.shadowMap.type = previous.shadowMapType;
      renderer.shadowMap.autoUpdate = previous.shadowMapAutoUpdate;
      renderer.shadowMap.needsUpdate = previous.shadowMapNeedsUpdate;
    }
  }
}

export function createLandAtmosphere(
  scene: Scene,
  renderer: WebGLRenderer,
  quality: QualityTier,
  initial: TimeOfDayId,
  reducedMotion = false,
): LandAtmosphereHandle {
  const steps = createLandAtmosphereSteps(scene, renderer, quality, initial, reducedMotion);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
