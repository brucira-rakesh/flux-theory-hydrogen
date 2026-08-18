import * as THREE from "three";

/**
 * Small mutable registry shared (via React context, see SceneEngineContext)
 * by every mounted scene component — the R3F equivalent of the plain arrays
 * Scene.jsx kept in useEffect closures (animatedMaterials, the four
 * seaReflectorN/waterMeshN/waterMaterialN trios). Deliberately NOT React
 * state: this is written to every frame (reflection matrices, uTime) and
 * read once per registration, so making it reactive would just cause
 * needless re-renders.
 */
export const createSceneEngine = () => {
  const water = new Set(); // { mesh, material, reflector }
  const animated = new Set(); // ShaderMaterial with a uTime uniform

  const cullFrustum = new THREE.Frustum();
  const cullProjScreenMatrix = new THREE.Matrix4();
  const cullSphere = new THREE.Sphere();
  const reflectionTextureMatrix = new THREE.Matrix4();
  const TEXTURE_MATRIX_BASE = [
    0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0,
    1.0,
  ];
  // Re-rendering every registered water reflection is the most expensive
  // part of this update — updating every other frame instead of every frame
  // halves that cost with no visible lag (reflections don't need 1:1 frame
  // sync with the main render, and the projection matrix below still tracks
  // the camera every frame regardless).
  let frameParity = 0;

  const isWaterOnScreen = (mesh) => {
    for (let o = mesh; o; o = o.parent) {
      if (!o.visible) return false;
    }
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    cullSphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
    return cullFrustum.intersectsSphere(cullSphere);
  };

  return {
    registerWater(entry) {
      water.add(entry);
      return () => water.delete(entry);
    },
    registerAnimated(material) {
      animated.add(material);
      return () => animated.delete(material);
    },

    // Called once per frame (see PostFX.jsx) — advances uTime, then updates
    // every registered water surface's planar reflection, frustum-culling
    // any that are currently hidden/off-screen so a disabled scene's
    // reflection pass is skipped entirely. Ported from Scene.jsx's animate().
    update(renderer, scene, camera, elapsed) {
      for (const mat of animated) mat.uniforms.uTime.value = elapsed;

      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
      cullProjScreenMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      cullFrustum.setFromProjectionMatrix(cullProjScreenMatrix);
      frameParity ^= 1;

      for (const { mesh, material, reflector } of water) {
        if (!reflector || !isWaterOnScreen(mesh)) continue;

        if (frameParity === 0) {
          reflector.forceUpdate = true;
          const wasVisible = mesh.visible;
          mesh.visible = false;
          reflector.onBeforeRender(renderer, scene, camera);
          mesh.visible = wasVisible;
          reflector.visible = false;
        }

        const reflectionCamera = reflector.getReflectionCamera(camera);
        reflectionTextureMatrix.set(...TEXTURE_MATRIX_BASE);
        reflectionTextureMatrix.multiply(reflectionCamera.projectionMatrix);
        reflectionTextureMatrix.multiply(reflectionCamera.matrixWorldInverse);
        material.uniforms.uTextureMatrix.value.copy(reflectionTextureMatrix);
      }
    },
  };
};
