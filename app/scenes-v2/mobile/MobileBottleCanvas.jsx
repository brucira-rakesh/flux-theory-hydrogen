import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import BottleRigV2, {
  BOTTLE_CENTER_OFFSET_Y,
  BOTTLE_OFFSET_Z,
} from "../scenes/BottleRigV2";
import BottleStudioLights from "../product/BottleStudioLights";

// Mirrors Scene.v2.jsx's own CANVAS_EXPOSURE — the bottle rig's materials
// and BottleStudioLights' light rig are both authored against
// STUDIO_TUNED_EXPOSURE and rescale themselves relative to whatever this is
// set to (see studioExposure.js). Kept identical to the desktop carousel's
// value so the mobile bottle reads the same, not a second look to maintain.
const CANVAS_EXPOSURE = 1.8;

// Same full-turn ease the desktop swing carousel commits a step transition
// with (see swingCarousel.js's COMMIT_DURATION/EASE) — duration is 50%
// longer than that desktop value (0.77s), slowed down for mobile so the
// spin reads clearly on a swipe-driven slide change.
const SPIN_DURATION = 1.155;
const SPIN_EASE = "power2.out";
// Same fraction of the transition swingCarousel.js flips `frontIndex` at
// (FLAVOR_SWAP_FRAC) — the point BottleRigV2's cap-swap logic adopts the
// new persona.
const FRONT_INDEX_SWAP_T = 0.75;

// Same 50% stretch as SPIN_DURATION above, applied to BottleRigV2's own
// dreamer/shared cap swap (CAP_SINK_DURATION/CAP_RISE_DURATION/
// CAP_RISE_DELAY) via its capDurationScale prop — desktop keeps its default
// (scale 1), only this mobile rig runs the cap swap slower.
const CAP_DURATION_SCALE = 1.5;

// No ring/carousel geometry on mobile — just the one bottle, parked at the
// origin and offset onto camera by BOTTLE_OFFSET_Z (added inside BottleRigV2
// itself, see its own `position` handling). A small fixed turn off dead-on
// (rather than 0, flat-on) reads as an actual product shot with some depth
// to the label/cap instead of a flat cutout — static, not touch-driven (see
// `enableCursorTilt={false}` below, and BottleRigV2's own comment on why
// live cursor/touch tilt caused the wrong-rotation-on-first-touch bug).
const BOTTLE_POSITION = [0, 0, 0];
const BOTTLE_ROTATION_Y = -0.45;
// Positive tips the bottle's top back toward the camera (base tucks away) —
// reads as a slight "looking up at it" hero angle rather than flat-on.
const BOTTLE_ROTATION_X = -0.3;

// Tuned against a 375x812 mobile viewport so the bottle lands where the
// video's own bottle sits — centered, filling roughly the middle third of
// the frame. fov/position trade off together; z is what actually frames the
// bottle since BOTTLE_OFFSET_Z anchors its world Z.
const CAMERA_FOV = 30;
const CAMERA_POSITION = [0, 0.15, 9];

// Idle sway while resting between slide changes — a slow +/-10deg yaw drift,
// matching the reference scene videos' own bottle idle (see e.g.
// src/assets/mobile-1080/dreamer-mobile.mp4). Amplitude is HALF the total swing (10deg
// each way from center), and the period is deliberately slow/lazy, not a
// snappy oscillation.
const IDLE_SWAY_AMPLITUDE = THREE.MathUtils.degToRad(10);
const IDLE_SWAY_PERIOD_SEC = 6;
const IDLE_SWAY_SPEED = (Math.PI * 2) / IDLE_SWAY_PERIOD_SEC;
// How fast the sway fades out once a slide-change spin starts, and fades
// back in once it's landed — short enough that it doesn't visibly fight the
// spin, long enough not to pop.
const IDLE_SWAY_FADE_PER_SEC = 3;

// Renders ONLY the bottle rig + its studio light rig — no scene groups, no
// video planes, no swing-carousel background geometry (see this file's own
// module comment in the caller). Kept deliberately minimal so this second,
// always-mounted Canvas stays cheap on mobile hardware: no water/fog
// materials, no engine.update() tick, no postprocessing, just R3F's own
// default automatic render loop.
function BottleOnly({ scenes, enabled, progressRef, isAnimatingRef }) {
  const swayRef = useRef(0);
  return (
    <>
      <IdleSway isAnimatingRef={isAnimatingRef} swayRef={swayRef} />
      <BottleStudioLights
        enabled
        position={[0, BOTTLE_CENTER_OFFSET_Y, BOTTLE_OFFSET_Z]}
        // Same static turn/tilt as the bottle itself (see BOTTLE_ROTATION_Y/X
        // above) so the rig keeps lighting the bottle's actual front, not
        // the direction it would be facing dead-on.
        rotationY={BOTTLE_ROTATION_Y}
        rotationX={BOTTLE_ROTATION_X}
        canvasExposure={CANVAS_EXPOSURE}
        sceneIds={scenes.map((s) => s.id)}
        progressRef={progressRef}
        // Same DEV-only gate Scene.v2.jsx uses for the desktop rig — was
        // left off the `showHelpers` prop entirely here, which defaults to
        // false (see BottleStudioLights' own `showHelpersProp`), so the
        // light gizmos never appeared on mobile even in dev.
        showHelpers={import.meta.env.DEV}
      />
      <BottleRigV2
        scenes={scenes}
        enabled={enabled}
        position={BOTTLE_POSITION}
        rotationY={BOTTLE_ROTATION_Y}
        rotationX={BOTTLE_ROTATION_X}
        idleSwayRef={swayRef}
        progressRef={progressRef}
        canvasExposure={CANVAS_EXPOSURE}
        // No real cursor on a touch device — see BottleRigV2's own
        // useCursorRaw comment for why leaving this on caused the bottle's
        // rotation to look wrong until the next touch's compat mousemove.
        enableCursorTilt={false}
        capDurationScale={CAP_DURATION_SCALE}
      />
    </>
  );
}

// Drives progressRef.step/frontIndex from `activeIndex` (the swiper's own
// active slide) via one gsap tween per change — the same "single tween
// retargeted, never a hand-rolled lerp" approach swingCarousel.js uses for
// its own `t` proxy (see its module comment), just triggered by a slide
// index instead of a wheel/touch gesture. BottleRigV2 reads step/frontIndex
// every frame (see its own useFrame) so this is the only thing that needs to
// change for the exact same spin/label-swap/cap-swap animation to play.
function useIndexDrivenSpin(activeIndex) {
  const progressRef = useRef({ step: 0, frontIndex: 0 });
  const tweenRef = useRef(null);
  const mountedRef = useRef(false);
  // Mirrors whether a spin tween is currently in flight — read (not
  // subscribed to) by IdleSway below every frame so the idle drift can fade
  // itself out while a real slide-change spin is playing, without either one
  // needing to know about the other's internals.
  const isAnimatingRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      // First paint: land directly on the initial slide, no spin-up from a
      // phantom previous index.
      mountedRef.current = true;
      progressRef.current.step = activeIndex;
      progressRef.current.frontIndex = activeIndex;
      return;
    }

    const base = progressRef.current.frontIndex;
    const target = activeIndex;
    if (base === target) return;

    const proxy = { t: 0 };
    tweenRef.current?.kill();
    isAnimatingRef.current = true;
    tweenRef.current = gsap.to(proxy, {
      t: 1,
      duration: SPIN_DURATION,
      ease: SPIN_EASE,
      onUpdate: () => {
        progressRef.current.step = THREE.MathUtils.lerp(base, target, proxy.t);
        progressRef.current.frontIndex =
          proxy.t >= FRONT_INDEX_SWAP_T ? target : base;
      },
      onComplete: () => {
        progressRef.current.step = target;
        progressRef.current.frontIndex = target;
        tweenRef.current = null;
        isAnimatingRef.current = false;
      },
    });

    return () => tweenRef.current?.kill();
  }, [activeIndex]);

  return { progressRef, isAnimatingRef };
}

// Slow +/-IDLE_SWAY_AMPLITUDE yaw drift while the bottle is resting between
// slide changes (see this file's own module comment) — a sine wave written
// straight into `swayRef` every frame, the same "ref BottleRigV2 reads
// itself, no React re-render" pattern progressRef already uses. Fades its
// own amplitude down to 0 while `isAnimatingRef` is true (a slide-change
// spin is in flight) and back up once it lands, rather than hard-cutting,
// so it never fights or pops against that motion.
function IdleSway({ isAnimatingRef, swayRef }) {
  const clockRef = useRef(0);
  const ampRef = useRef(1);
  useFrame((_, dt) => {
    const targetAmp = isAnimatingRef.current ? 0 : 1;
    const fadeStep = IDLE_SWAY_FADE_PER_SEC * dt;
    ampRef.current +=
      Math.sign(targetAmp - ampRef.current) *
      Math.min(fadeStep, Math.abs(targetAmp - ampRef.current));

    clockRef.current += dt;
    swayRef.current =
      Math.sin(clockRef.current * IDLE_SWAY_SPEED) *
      IDLE_SWAY_AMPLITUDE *
      ampRef.current;
  });
  return null;
}

// Simple IntersectionObserver gate — 'always' only while the canvas is
// actually near the viewport, 'never' otherwise, so this second Canvas
// doesn't keep rendering 60fps while scrolled far away on the rest of the
// page (footer, product shelf, ...).
function useNearViewport(ref) {
  const [near, setNear] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: "50% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return near;
}

// Mounted as a transparent, pointer-events-none overlay on top of
// MwebProductShowcase's own swiper — see that component. `slides` is its
// SLIDES array (each entry's `id` IS the bottle persona, see
// MwebProductShowcase's own comment on SLIDES), `activeIndex` its current
// swiper.activeIndex.
export default function MobileBottleCanvas({ slides, activeIndex, className }) {
  const containerRef = useRef(null);
  const nearViewport = useNearViewport(containerRef);

  const scenes = useMemo(
    () => slides.map((s) => ({ id: s.sceneId, bottlePersona: s.id })),
    [slides],
  );
  const enabled = useMemo(
    () => Object.fromEntries(scenes.map((s) => [s.id, true])),
    [scenes],
  );

  const { progressRef, isAnimatingRef } = useIndexDrivenSpin(activeIndex);

  return (
    <div ref={containerRef} className={className} aria-hidden="true">
      <Canvas
        // R3F's own Canvas sets `pointer-events: auto` inline on its
        // internal wrapper div by default — the CSS `pointer-events: none`
        // on this component's own container (see .mweb-showcase__bottle-canvas)
        // never actually reaches the canvas because of that inline override,
        // which is what was swallowing the swiper's swipe gestures. Has to
        // be set here, not just in CSS, to actually win.
        style={{ width: "100%", height: "100%", pointerEvents: "none" }}
        frameloop={nearViewport ? "always" : "never"}
        // Capped at 1.5, not left uncapped — this canvas is mounted
        // PERMANENTLY underneath MwebProductShowcase's swiper on every phone
        // that loads the page (see the caller), so its fill rate is pure tax
        // on every mobile session, not a desktop-only cost. dpr 1 was too
        // soft on retina phones, so this trades a bit of that fragment-work
        // budget back for sharpness without paying full device pixel ratio.
        dpr={[1, 1.5]}
        camera={{
          fov: CAMERA_FOV,
          near: 0.1,
          far: 1000,
          position: CAMERA_POSITION,
        }}
        gl={{
          // MSAA off for the same reason dpr is pinned above: this is an
          // always-mounted mobile canvas, and multisample cost is pure
          // fragment-work tax on hardware that has the least of it to spare.
          // alpha:true means edges DO show some aliasing against the video
          // behind them, but at dpr 1 that's the better trade than paying
          // multisample cost on every phone that loads the page.
          antialias: false,
          alpha: true,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = CANVAS_EXPOSURE;
        }}
      >
        <BottleOnly
          scenes={scenes}
          enabled={enabled}
          progressRef={progressRef}
          isAnimatingRef={isAnimatingRef}
        />
      </Canvas>
    </div>
  );
}
