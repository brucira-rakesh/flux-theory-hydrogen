import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useFBO, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import trailVertex from '../../shaders/footerGlass/vertex.glsl';
import trailFragment from '../../shaders/footerGlass/trail.glsl';
import dropletsFragment from '../../shaders/footerGlass/droplets.glsl';
import footerBg from '../../assets/footer/footer-bg.webp';

// Low-res on purpose — the trail buffer holds two soft, decaying pointer
// fields (see trail.glsl), not an image, so it doesn't need to be
// screen-resolution to look right and stays cheap to ping-pong every frame.
// Not square, though: the footer is a very wide, flat band, and the droplet
// pass differentiates the gathered channel to get the pointer water's
// surface normal — at 256 wide those texels are ~6px across and the
// resulting metaball reads as a faceted lozenge rather than a bead.
const TRAIL_WIDTH = 512;
const TRAIL_HEIGHT = 256;

// Roughly how many seconds each pointer field takes to fade out. Framed as a
// decay applied once per second so the look doesn't change with frame rate
// (see useFrame below, which raises these to the power of dt).
//
// The swept field is the fast one — condensation is back a moment after the
// cursor leaves. The gathered field is the water that sweep collected, and
// it has to outlive the sweep by a good margin: that lag is the whole
// interaction, the liquid trailing behind the cursor and beading up as it
// evaporates rather than tracking it rigidly.
const TRAIL_DECAY_PER_SECOND = 0.35;
const GATHER_DECAY_PER_SECOND = 0.75;
const TRAIL_WIPE_RADIUS = 0.11;

function DropletScene({ mouseRef }) {
  const { size, gl } = useThree();
  const background = useTexture(footerBg);
  background.colorSpace = THREE.SRGBColorSpace;
  background.wrapS = background.wrapT = THREE.ClampToEdgeWrapping;

  const fboA = useFBO(TRAIL_WIDTH, TRAIL_HEIGHT, { depthBuffer: false });
  const fboB = useFBO(TRAIL_WIDTH, TRAIL_HEIGHT, { depthBuffer: false });
  const targets = useRef([fboA, fboB]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);

  const trailUniforms = useMemo(
    () => ({
      uPrevTrail: { value: fboA.texture },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uMouseActive: { value: 0 },
      uDecay: { value: 1 },
      uGatherDecay: { value: 1 },
      uRadius: { value: TRAIL_WIPE_RADIUS },
      uAspect: { value: 1 },
    }),
    [fboA.texture],
  );

  const dropletUniforms = useMemo(
    () => ({
      uBackground: { value: background },
      uTrail: { value: fboB.texture },
      uTime: { value: 0 },
      // background-size:cover, background-position:center top equivalent —
      // see the cover-fit comment in useFrame below.
      uCoverScale: { value: new THREE.Vector2(1, 1) },
      uCoverOffset: { value: new THREE.Vector2(0, 0) },
      // One trail texel, for the gradient the droplet pass takes of the
      // gathered field to shade the pointer water.
      uTrailTexel: {
        value: new THREE.Vector2(1 / TRAIL_WIDTH, 1 / TRAIL_HEIGHT),
      },
      // Footer aspect (width/height) — droplet placement scales uv.x by
      // this so voronoi cells come out square instead of stretched into
      // ellipses by the footer's much-wider-than-tall box. See droplets.glsl.
      uAspect: { value: 1 },
    }),
    [background, fboB.texture],
  );

  // Built with useMemo, not a ref set inside an effect: useFrame below can
  // fire before an effect's setup runs (React doesn't guarantee effects
  // flush ahead of the first animation frame, especially under Suspense),
  // and gl.render() with an undefined scene/camera throws deep inside three
  // reading `matrixWorldAutoUpdate` on nothing. useMemo runs during render,
  // so these are guaranteed to exist by the time any frame callback sees them.
  const trailMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: trailVertex,
        fragmentShader: trailFragment,
        uniforms: trailUniforms,
      }),
    [trailUniforms],
  );
  // Built imperatively for the same reason the trail material is, and it is
  // not optional: <shaderMaterial uniforms={...} /> does NOT keep the object
  // you hand it. R3F's applyProps has a special case for ShaderMaterial
  // uniforms that copies each one into the material's own store
  // (`uniforms[name] = { ...uniform }`), so the material ends up holding
  // different `{ value }` objects than the ones the frame loop below mutates
  // — every per-frame uniform silently freezes at its initial value. That
  // failure is quiet and looks like a shader bug: uAspect stuck at 1 stretches
  // the droplet cells by the footer's whole aspect ratio, uCoverScale stuck at
  // (1, 1) stretches the photo instead of cover-fitting it, and uTime stuck at
  // 0 stops the rain dead.
  const dropletMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: trailVertex,
        fragmentShader: dropletsFragment,
        uniforms: dropletUniforms,
      }),
    [dropletUniforms],
  );

  const trailScene = useMemo(() => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, trailMaterial));
    return scene;
  }, [geometry, trailMaterial]);
  const trailCamera = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    [],
  );

  useEffect(() => () => trailMaterial.dispose(), [trailMaterial]);
  useEffect(() => () => dropletMaterial.dispose(), [dropletMaterial]);


  const lastFrameTime = useRef(0);

  useFrame((state) => {
    // Frame delta taken from the clock this pass already uses for uTime,
    // rather than useFrame's own delta argument: both decays below are
    // per-second rates raised to dt, so a dt in the wrong unit silently
    // turns a multi-second trail into one that is gone by the next frame.
    // Clamped so a stall (tab restore, a long GC pause) cannot wipe the
    // buffer in a single step.
    const elapsed = state.clock.elapsedTime;
    const delta = Math.min(0.1, Math.max(0, elapsed - lastFrameTime.current));
    lastFrameTime.current = elapsed;

    dropletUniforms.uTime.value = elapsed;
    const containerAspect = size.width / Math.max(1, size.height);
    trailUniforms.uAspect.value = containerAspect;
    dropletUniforms.uAspect.value = containerAspect;

    // The plane's UVs span the whole footer box 0..1, but sampling
    // uBackground with those raw UVs stretches the 2160x1350 photo to
    // whatever the footer's (much wider, flatter) aspect happens to be.
    // CSS's `background-size: cover; background-position: center top`
    // avoids that by scaling the image up until it fully covers the box
    // and cropping the overflow — reproduced here so the shader's texture
    // sampling matches the static version pixel-for-pixel instead of
    // warping it.
    const image = background.image;
    if (image?.width && image?.height) {
      const imageAspect = image.width / image.height;
      let scaleX = 1;
      let scaleY = 1;
      if (containerAspect > imageAspect) {
        scaleY = imageAspect / containerAspect;
      } else {
        scaleX = containerAspect / imageAspect;
      }
      dropletUniforms.uCoverScale.value.set(scaleX, scaleY);
      dropletUniforms.uCoverOffset.value.set((1 - scaleX) / 2, 1 - scaleY);
    }

    const mouse = mouseRef.current;
    trailUniforms.uMouse.value.set(mouse.x, mouse.y);
    trailUniforms.uMouseActive.value = mouse.active ? 1 : 0;
    trailUniforms.uDecay.value = Math.pow(TRAIL_DECAY_PER_SECOND, delta);
    trailUniforms.uGatherDecay.value = Math.pow(GATHER_DECAY_PER_SECOND, delta);

    const [read, write] = targets.current;
    trailUniforms.uPrevTrail.value = read.texture;

    gl.setRenderTarget(write);
    gl.render(trailScene, trailCamera);
    gl.setRenderTarget(null);

    dropletUniforms.uTrail.value = write.texture;
    targets.current = [write, read];
  });

  return <mesh geometry={geometry} material={dropletMaterial} />;
}

/**
 * FooterWaterGlass — GPU condensation over the footer's background photo.
 *
 * Pure shader approach (layered voronoi droplet fields + a ping-ponged
 * trail buffer for wipe/regrow state) rather than per-droplet geometries or
 * THREE.Points: droplet count and pointer proximity are evaluated per-pixel
 * on the GPU, so this stays cheap regardless of how "dense" the condensation
 * looks. Swap in for `.ftv3__surface`'s plain <img>-style div — same box,
 * same background image, just animated. See FooterV3's `USE_WEBGL_SURFACE`
 * flag for the one-line toggle back to that static version.
 *
 * Pass `pointerTargetRef` when other content paints on top of this
 * component's own box (FooterV3's nav does) — see the effect below for why.
 */
export default function FooterWaterGlass({ className, pointerTargetRef }) {
  const containerRef = useRef(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5, active: false });

  useEffect(() => {
    // UV math is always against this component's own box (it's what the
    // shader's vUv actually spans), but the *listener* goes on
    // `pointerTargetRef` when given — typically an ancestor that paints
    // other content (nav text/links) on top of this canvas. pointermove
    // bubbles, so the ancestor still sees every move even when a child
    // element is the one actually hit-tested; binding to this div directly
    // would miss all of those.
    const rectEl = containerRef.current;
    const listenEl = pointerTargetRef?.current ?? rectEl;
    if (!rectEl || !listenEl) return undefined;

    const toUv = (event) => {
      const rect = rectEl.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: 1 - (event.clientY - rect.top) / rect.height,
      };
    };

    const onMove = (event) => {
      const { x, y } = toUv(event);
      mouseRef.current.x = x;
      mouseRef.current.y = y;
      mouseRef.current.active = true;
    };
    const onLeave = () => {
      mouseRef.current.active = false;
    };

    listenEl.addEventListener('pointermove', onMove);
    listenEl.addEventListener('pointerleave', onLeave);
    return () => {
      listenEl.removeEventListener('pointermove', onMove);
      listenEl.removeEventListener('pointerleave', onLeave);
    };
  }, [pointerTargetRef]);

  return (
    <div ref={containerRef} className={className} aria-hidden="true">
      <Canvas
        gl={{ antialias: false, alpha: false }}
        dpr={[1, 1.5]}
        frameloop="always"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <Suspense fallback={null}>
          <DropletScene mouseRef={mouseRef} />
        </Suspense>
      </Canvas>
    </div>
  );
}
