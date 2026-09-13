import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

// Pays the GPU's first-use cost for this canvas in the background, instead
// of on the frame each thing first appears.
//
// Deliberately NOT registered on PreloaderV2's LoadingManager. The boot
// overlay is the intro hero — holding it open for shader compiles and
// texture uploads the user can't see until they scroll to the carousel made
// the first paint wait on GPU work that has a whole autoplay reel + scroll
// to finish in. Warmup still runs (same compileAsync / initTexture path),
// it just no longer gates the overlay.
//
//   1. GLSL program compile + link. Blocking, and there are a lot of
//      distinct programs here.
//   2. Texture upload to the GPU. This is the big one for product:
//      bathroom_bottle.glb carries five 2000x3750 labels and one 4096x4096
//      normal map — roughly 276MB of RGBA + mipmaps to hand over, all of it
//      landing on the first frame the shelf is drawn.
//
// Both are exactly what `Seawave.jsx` already warms up with its own
// `compileAsync` calls; this is the same trick applied to the carousel and
// the product room.

// Every texture-bearing slot a material in this app can populate. Read off
// the material rather than walking glTF's own texture list because the
// materials here are rebuilt after load (see useProductAssets'
// rebuildStandardMaterial), so the loader's list and what actually gets
// drawn are not the same set.
const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "alphaMap",
  "lightMap",
  "bumpMap",
  "displacementMap",
  "specularMap",
  "envMap",
];

// Textures uploaded per animation frame. Used to be a trickle of 2 so the
// boot overlay stayed smooth while this ran under it; now that warmup no
// longer gates the overlay, finishing before the carousel arrives is the
// whole point.
const UPLOADS_PER_FRAME = 8;

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

// A texture is worth uploading early only if it has something to upload NOW
// and will not simply be re-uploaded on the next frame anyway.
//
// Video textures are the case to skip: VideoPlaneV2's planes re-upload from
// the <video> element every frame by design, and at boot those elements have
// no decoded frame yet — so there is nothing to warm and a real chance of
// handing the driver an empty source. Compressed (KTX2) textures carry
// `mipmaps` rather than an `image`, hence the second half of the check.
const isUploadable = (texture) =>
  texture?.isTexture &&
  !texture.isVideoTexture &&
  Boolean(texture.image || texture.mipmaps?.length);

const collectTextures = (root, out) => {
  root.traverse((child) => {
    const material = child.material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = entry[slot];
        if (isUploadable(texture)) out.add(texture);
      }
    }
  });
};

export default function ScenePrewarm({ assetsRef, ready }) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;

    // Restores whatever this warmup borrowed. Collected as it goes rather
    // than computed up front, so an early bail can only undo what it
    // actually did.
    const restores = [];

    const run = async () => {
      // Every VideoPlaneV2 (and its intro/outro clips) starts out with
      // `map: null` — the real THREE.VideoTexture only reaches the material
      // a tick later, via a setState inside useVideoPlaneTexture/
      // useOneShotVideoTexture's own mount effect (see those files). Those
      // sibling effects fire in the SAME commit as this one, just after it
      // (this component sits earlier in Scene.v2.jsx's JSX than the SCENES
      // map, and sibling effects run in document order) — so calling
      // compileAsync synchronously here would warm the no-map variant of the
      // shared video-plane program, not the one actually drawn. The real
      // recompile (triggered by `material.map` flipping from null to a
      // texture, which changes the USE_MAP define) would then only happen
      // lazily on the first frame each scene's plane is actually rendered —
      // i.e. the first time it swings into view — which is exactly the
      // stutter this component exists to avoid. Waiting a couple of frames
      // gives those effects' state updates time to commit and land on the
      // real mesh materials before compiling.
      await nextFrame();
      await nextFrame();
      if (cancelled) return;

      const assets = assetsRef.current;

      // Product's room and bottles are NOT in the scene graph yet — they
      // only mount once the carousel reaches its last scene (`roomVisible`,
      // see ProductSceneV2), which is the whole reason their first draw is
      // the expensive one. compile() walks the graph, so they have to be
      // parked in it to be seen at all.
      //
      // Parked hidden, and only if nothing else already owns them: `visible`
      // is irrelevant to the compile itself (three collects materials with a
      // plain traverse, only LIGHTS use traverseVisible) but it guarantees
      // this can't put a half-configured room on screen if a frame does get
      // drawn while we're parked.
      const park = (object) => {
        if (!object || object.parent) return;
        const wasVisible = object.visible;
        object.visible = false;
        scene.add(object);
        restores.push(() => {
          object.visible = wasVisible;
          // Only if we're still the owner — by the time this runs, R3F may
          // legitimately have reparented it onto the alignment group.
          if (object.parent === scene) scene.remove(object);
        });
      };
      park(assets.roomModel);
      park(assets.bottleGroup);

      // --- 1. Texture uploads -------------------------------------------
      const textures = new Set();
      collectTextures(scene, textures);
      const list = [...textures];
      for (let i = 0; i < list.length; i += 1) {
        if (cancelled) return;
        // initTexture is the only way to force the upload early — compile()
        // deliberately does not touch textures, it only builds programs.
        // Per-texture try/catch so one source the driver rejects costs its
        // own warmup only, not every upload queued behind it.
        try {
          gl.initTexture(list[i]);
        } catch {
          // Falls back to being uploaded on first draw, as it was before.
        }
        if ((i + 1) % UPLOADS_PER_FRAME === 0) await nextFrame();
      }
      if (cancelled) return;

      // --- 2. Shader programs -------------------------------------------
      // Best-effort by nature: three keys a program partly on the LIGHT
      // counts in scope at compile time (NUM_DIR_LIGHTS and friends), and
      // this app genuinely changes those between the carousel and the
      // product room — the product rig toggles its own lights via .visible
      // (see ProductLights) and BottleRigV2's are inside a <HideWhile>. So
      // some materials will still recompile at that transition. Everything
      // whose program does not depend on the lighting state — the video
      // planes, the room's own unlit MeshBasicMaterial, every fullscreen
      // pass — is fully covered, and that is the bulk of them.
      //
      // compileAsync (not compile) so KHR_parallel_shader_compile can do the
      // linking off the main thread where the driver supports it, which is
      // the same reason Seawave.jsx uses it.
      await gl.compileAsync(scene, camera);
    };

    run()
      .catch((error) => {
        // A warmup that fails is a slower first frame, never a broken page —
        // so this is logged and swallowed rather than surfaced.
        console.warn("[SceneV2] prewarm skipped", error);
      })
      .finally(() => {
        restores.forEach((restore) => restore());
      });

    return () => {
      cancelled = true;
    };
  }, [ready, assetsRef, gl, scene, camera]);

  return null;
}
