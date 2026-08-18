import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

import basicVert from "../shaders/basic.vert";
import dropletsFrag from "../shaders/droplets.frag";
import seawaveVert from "../shaders/seawave.vert";
import seawaveTwoFrag from "../shaders/seawavetwo.frag";
import fogVert from "../shaders/fog.vert";
import fogFrag from "../shaders/fog.frag";
import glassEnvChunk from "../shaders/includes/glassEnv.glsl";

// Ported straight from Scene.jsx's makeDropletMaterial/makeSeaWaveMaterialTwo/
// makeFogMaterial/glassMaterial factories — only the model+material half of
// that file, none of the scroll-carousel logic.

export const makeDropletMaterial = () =>
  new THREE.ShaderMaterial({
    vertexShader: basicVert,
    fragmentShader: dropletsFrag,
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 15.18 },
      uDensity: { value: 1.5 },
      uOpacity: { value: 0.3 },
      uBaseAlpha: { value: 0.0 },
      uColor: { value: new THREE.Color(0x9fd8ff) },
    },
  });

// Shared by every scene's sea plane — tiles the ripple normal map off local
// XZ position (uLocalSize, set per-mesh once geometry bounds are known)
// instead of each mesh's own near-degenerate UV unwrap.
export const makeSeaWaveMaterialTwo = (maps) =>
  new THREE.ShaderMaterial({
    vertexShader: seawaveVert,
    fragmentShader: seawaveTwoFrag,
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uNormalMap: { value: maps.normal },
      uDisplacementMap: { value: maps.displacement },
      uAOMap: { value: maps.ao },
      uORMMap: { value: maps.orm },
      uBaseColorMap: { value: maps.baseColor },
      uTransmissionMap: { value: maps.transmission },
      uTiling: { value: new THREE.Vector2(4, 4) },
      uLocalSize: { value: new THREE.Vector2(1, 1) },
      uFlowDirection: { value: new THREE.Vector2(1, 0) },
      uFlowSpeed: { value: 0.05 },
      uNormalStrength: { value: 1.0 },
      uDisplacementStrength: { value: 0 },
      uAOStrength: { value: 1.0 },
      uDepthColor: { value: new THREE.Color(0x828282) },
      uSurfaceColor: { value: new THREE.Color(0x584646) },
      uColorOffset: { value: 0.08 },
      uColorMultiplier: { value: 5 },
      uReflectionMap: { value: null },
      uTextureMatrix: { value: new THREE.Matrix4() },
      uReflectivity: { value: 0.8 },
      uReflectionDistortion: { value: 0.2 },
      uReflectionBlur: { value: 0.0015 },
      uSpecularStrength: { value: 2.0 },
      uShininess: { value: 256 },
      uOpacity: { value: 0.6 },
      uEdgeFadeStart: { value: 0 },
      uEdgeFadeEnd: { value: 0 },
      uEdgeFadeStartX: { value: 0 },
      uEdgeFadeEndX: { value: 0 },
    },
  });

export const fogSharedDefaults = {
  flowAngleDeg: 15,
  speed: 0.006,
  tiling: [0.9, 0.9],
  color: 0xdedede,
  density: 1.84,
  edgeSoftness: 0.5,
  opacity: 0.24,
  windSpeed: 0.15,
  wobbleSpeed: 0.5,
  pulseSpeed: 0.6,
  bobSpeed: 0.35,
};

export const makeFogMaterial = (noiseMap, defaults = fogSharedDefaults) => {
  const rad = (defaults.flowAngleDeg * Math.PI) / 180;
  return new THREE.ShaderMaterial({
    vertexShader: fogVert,
    fragmentShader: fogFrag,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uNoiseMap: { value: noiseMap },
      uTiling: {
        value: new THREE.Vector2(defaults.tiling[0], defaults.tiling[1]),
      },
      uFlowDirection: {
        value: new THREE.Vector2(Math.cos(rad), Math.sin(rad)),
      },
      uFlowSpeed: { value: defaults.speed },
      uDensity: { value: defaults.density },
      uEdgeSoftness: { value: defaults.edgeSoftness },
      uGrazingBoost: { value: 1.5 },
      uWindVariation: { value: 0.5 },
      uWindVariationSpeed: { value: defaults.windSpeed },
      uWobbleAmount: { value: 0.15 },
      uWobbleSpeed: { value: defaults.wobbleSpeed },
      uPulseAmount: { value: 0.35 },
      uPulseSpeed: { value: defaults.pulseSpeed },
      uBobAmount: { value: 0.08 },
      uBobSpeed: { value: defaults.bobSpeed },
      uColor: { value: new THREE.Color(defaults.color) },
      uOpacity: { value: defaults.opacity },
    },
  });
};

// Overbright MeshBasicMaterial: pushing `color` past white (1,1,1)
// HDR-overbrightens the raw linear buffer, which UnrealBloomPass's
// luminance threshold picks up as an emissive glow — no real light needed.
export const makeOverbrightMaterial = (r, g, b) => {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
  mat.toneMapped = false;
  return mat;
};

// neon_light's overbright greenish glow (Scene Two) — reused as-is by Scene
// Four for its own ceiling/glass-strip fixtures (same node-structure replica).
export const makeNeonTwoMaterial = () =>
  makeOverbrightMaterial(1.1155770538639864, 3.964408388454503, 1.2378756912269713);

export const glassParams = {
  reflectivity: 0.5,
  fresnelPower: 3.0,
  envLow: "#000000",
  envHigh: "#fdf0ff",
};

// Cheap glass: transparency + a fresnel-driven procedural reflection
// (glassEnv.glsl), not MeshPhysicalMaterial.transmission (too expensive
// alongside four live planar water reflections + bloom).
export const makeGlassMaterial = (params = glassParams) => {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xfdf0ff),
    metalness: 0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlassEnvLow = { value: new THREE.Color(params.envLow) };
    shader.uniforms.uGlassEnvHigh = { value: new THREE.Color(params.envHigh) };
    shader.uniforms.uGlassSunDir = {
      value: new THREE.Vector3(0.4, 0.85, 0.35),
    };
    shader.uniforms.uGlassSunColor = { value: new THREE.Color(0xffffff) };
    shader.uniforms.uGlassReflectivity = { value: params.reflectivity };
    shader.uniforms.uGlassFresnelPower = { value: params.fresnelPower };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vGlassWorldPos;\nvarying vec3 vGlassWorldNormal;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vGlassWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGlassWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${glassEnvChunk}`)
      .replace(
        "#include <tonemapping_fragment>",
        "  gl_FragColor.rgb = glassShade(gl_FragColor.rgb);\n#include <tonemapping_fragment>",
      );

    material.userData.shader = shader;
  };
  return material;
};

export const pillarGlassParams = {
  reflectivity: 0.35,
  fresnelPower: 3.0,
  envLow: "#050208",
  envHigh: "#ffd9f0",
  glassOpacity: 0.12,
  maskLow: 0.02,
  maskHigh: 0.16,
};

// Refractive-looking pillar glass: reuses glassEnv.glsl's cheap fresnel sky
// reflection (see makeGlassMaterial above) rather than real
// MeshPhysicalMaterial.transmission — same reasoning, this scene already pays
// for two live water reflections. The pillar's own baked color texture
// doubles as its transparency mask: near-black texels (the baked "empty"
// background) become near-fully transparent glass, letting the fresnel
// reflection + whatever renders behind show through, while the colored
// pigment texels stay opaque so the embedded pattern still reads solid.
export const makePillarGlassMaterial = (colorTexture, params = pillarGlassParams) => {
  const material = new THREE.MeshPhysicalMaterial({
    map: colorTexture,
    metalness: 0,
    roughness: 0.08,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlassEnvLow = { value: new THREE.Color(params.envLow) };
    shader.uniforms.uGlassEnvHigh = { value: new THREE.Color(params.envHigh) };
    shader.uniforms.uGlassSunDir = {
      value: new THREE.Vector3(0.4, 0.85, 0.35),
    };
    shader.uniforms.uGlassSunColor = { value: new THREE.Color(0xffffff) };
    shader.uniforms.uGlassReflectivity = { value: params.reflectivity };
    shader.uniforms.uGlassFresnelPower = { value: params.fresnelPower };
    shader.uniforms.uPillarGlassOpacity = { value: params.glassOpacity };
    shader.uniforms.uPillarMaskLow = { value: params.maskLow };
    shader.uniforms.uPillarMaskHigh = { value: params.maskHigh };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vGlassWorldPos;\nvarying vec3 vGlassWorldNormal;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vGlassWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGlassWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${glassEnvChunk}\nuniform float uPillarGlassOpacity;\nuniform float uPillarMaskLow;\nuniform float uPillarMaskHigh;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float pillarLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float pillarMask = smoothstep(uPillarMaskLow, uPillarMaskHigh, pillarLum);
        diffuseColor.a = mix(uPillarGlassOpacity, 1.0, pillarMask);`,
      )
      .replace(
        "#include <opaque_fragment>",
        // The pigment texels must read at full brightness regardless of
        // whether this scene has real lights hitting the pillar (it may
        // not) — same trick as makeOverbrightMaterial, just masked instead
        // of global. Near-black (glass) texels are left as the naturally
        // lit/shaded result, which glassShade() below then tints.
        `outgoingLight = mix(outgoingLight, diffuseColor.rgb, pillarMask);
        #include <opaque_fragment>`,
      )
      .replace(
        "#include <tonemapping_fragment>",
        "  gl_FragColor.rgb = glassShade(gl_FragColor.rgb);\n#include <tonemapping_fragment>",
      );

    material.userData.shader = shader;
  };
  return material;
};

// Sets up a Reflector at water level + the shader's local-space tiling/edge
// fade uniforms from the mesh's own geometry bounds. Shared by every scene's
// water surface(s). Returns the Reflector (add it to the same parent as the
// water mesh, then call registerWater() — see reflection.js).
export const setupWaterReflection = (waterMesh, waterMaterial, renderer) => {
  const seaBox = new THREE.Box3().setFromObject(waterMesh);
  const seaSize = seaBox.getSize(new THREE.Vector3());
  const seaCenter = seaBox.getCenter(new THREE.Vector3());
  const dpr = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());
  // Reflection is heavily blurred/tiled by the water shader, so it doesn't
  // need full canvas resolution — half-res cuts each reflector's render
  // cost to ~1/4 with no visible loss (see engine.js's per-frame cost).
  const REFLECTION_SCALE = 0.5;

  const reflectorGeo = new THREE.PlaneGeometry(
    Math.max(seaSize.x, 1),
    Math.max(seaSize.z, 1),
  );
  const reflector = new Reflector(reflectorGeo, {
    clipBias: 0.003,
    textureWidth: Math.max(1, Math.floor(size.x * dpr * REFLECTION_SCALE)),
    textureHeight: Math.max(1, Math.floor(size.y * dpr * REFLECTION_SCALE)),
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.set(seaCenter.x, seaCenter.y, seaCenter.z);
  reflector.visible = false;

  waterMaterial.uniforms.uReflectionMap.value = reflector.getRenderTarget().texture;

  waterMesh.geometry.computeBoundingBox();
  const localBox = waterMesh.geometry.boundingBox;
  const localSize = localBox.getSize(new THREE.Vector3());
  waterMaterial.uniforms.uLocalSize.value.set(localSize.x || 1, localSize.z || 1);
  waterMaterial.uniforms.uEdgeFadeStart.value = localBox.min.z;
  waterMaterial.uniforms.uEdgeFadeEnd.value = localBox.max.z;
  waterMaterial.uniforms.uEdgeFadeStartX.value = localBox.min.x;
  waterMaterial.uniforms.uEdgeFadeEndX.value = localBox.max.x;

  return reflector;
};
