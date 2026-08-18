import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import AnimatedTitle from "../components/AnimatedTitle/AnimatedTitle";
import AnimatedDescription from "../components/AnimatedDescription/AnimatedDescription";

// Outgoing pair fades out over this long BEFORE the incoming one fades in —
// see the leaving/displayId dance below. Must stay in sync with EXIT_SEC,
// which is what the exit tween itself actually runs for.
const EXIT_MS = 320;
const EXIT_SEC = EXIT_MS / 1000;
const ENTER_SEC = 0.2;

// Real per-scene copy — ports Figma nodes 1089:267 (heading) / 1089:268
// (paragraph), one pair per scene. Not sourced from products.js: this is
// its own voice, not the PDP's.
const SCENE_CAPTIONS = {
  one: {
    title: "Own Every Moment",
    description:
      "Every room has an energy. Every entrance leaves an impression. Be the one they remember.",
  },
  five: {
    title: "Break the Expected",
    description:
      "Not every path is meant to be followed. Some are meant to be created.",
  },
  two: {
    title: "The One Who Sees Beyond",
    description:
      "Every breakthrough begins as a thought. Every possibility starts with imagination.",
  },
  three: {
    title: "Find Your Center",
    description:
      "Silence sharpens instinct. Clarity shapes every decision before the world notices.",
  },
  four: {
    title: "Leave Them Wanting More",
    description:
      "Confidence isn’t always loud. Sometimes it’s remembered in the moments after you’ve gone.",
  },
};
const SCENE_IDS = Object.keys(SCENE_CAPTIONS);

// One heading + one paragraph, permanently mounted (not swapped in/out of a
// shared element) and pinned to a fixed left/right position each — see
// .scene-v2__caption-heading / -desc in Scene.v2.css. Only opacity ever
// changes; the heading's own position never moves, so it can't ever land
// somewhere else on screen depending on which scene it's showing.
//
// `phase` is three-state, NOT a boolean, and that distinction is the whole
// point: AnimatedTitle's `play={false}` branch does a hard
// `gsap.set(chars, { opacity: 0, filter: blur(20px) })` the instant it
// flips — no tween. Driving `play` straight off "is this the active scene"
// therefore snapped every character invisible on the same frame the scene
// changed, which is why the copy appeared to vanish with no transition no
// matter what the container was doing. So `play` (and `blurSweep`, whose
// own dep change reverts and restarts the reveal tween mid-fade) stays true
// for the whole "exit" phase, and only drops at "idle" — by which point the
// container is already fully faded out and nothing is visible to snap.
//   enter — replay the per-character reveal, fade the container in
//   exit  — hold the revealed characters exactly as they are, fade out
//   idle  — off-screen, fully hidden, reveals disarmed
//
// `enterKey` bumps on every enter, forcing AnimatedTitle/AnimatedDescription's
// reveal to replay (they'd otherwise only reveal once, on this permanent
// mount, invisibly).
function CaptionPair({ id, caption, phase }) {
  const rootRef = useRef(null);
  const enterCountRef = useRef(0);
  const [enterKey, setEnterKey] = useState(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;

    // Opacity is tweened inline by GSAP here rather than by a CSS
    // transition, so a phase flip mid-fade can be killed and retargeted
    // from wherever it actually got to (fast scrolling flips scenes well
    // inside EXIT_MS) instead of restarting from a class-driven end state.
    gsap.killTweensOf(el);

    if (phase === "enter") {
      enterCountRef.current += 1;
      // Bumping this replays the child reveals — it's the entrance
      // animation itself, and it has to be a state write to reach them.
      setEnterKey(enterCountRef.current);
      gsap.set(el, { visibility: "visible" });
      gsap.to(el, { opacity: 1, duration: ENTER_SEC, ease: "power2.out" });
      return undefined;
    }

    if (phase === "exit") {
      gsap.to(el, {
        opacity: 0,
        duration: EXIT_SEC,
        ease: "power2.in",
      });
      return undefined;
    }

    gsap.set(el, { opacity: 0, visibility: "hidden" });
    return undefined;
  }, [phase]);

  const replayKey = `${id}-${enterKey}`;
  const isEntering = phase === "enter";
  const isOnscreen = phase !== "idle";

  return (
    <div
      ref={rootRef}
      className="scene-v2__caption-pair"
      aria-hidden={!isEntering}
    >
      <AnimatedTitle
        as="h2"
        className="scene-v2__caption-heading"
        replayKey={replayKey}
        play={isOnscreen}
        blurSweep={isOnscreen}
      >
        {caption.title}
      </AnimatedTitle>
      <AnimatedDescription
        as="p"
        className="scene-v2__caption-desc"
        replayKey={replayKey}
      >
        {caption.description}
      </AnimatedDescription>
    </div>
  );
}

// Bottom-of-screen caption — ports Figma node 1089:267 (heading) / 1089:268
// (paragraph). All 5 scenes' pairs are mounted at once (see SCENE_IDS
// below); `displayId`/`leaving` gate which single one is "active" at a
// time, so the outgoing pair fully fades out before the incoming one fades
// in and replays — never both fully visible together.
export default function SceneCaption({ sceneId }) {
  const [displayId, setDisplayId] = useState(sceneId);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (sceneId === displayId) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setDisplayId(sceneId);
      setLeaving(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [sceneId, displayId]);

  return (
    <div className="scene-v2__caption" aria-live="polite">
      {SCENE_IDS.map((id) => (
        <CaptionPair
          key={id}
          id={id}
          caption={SCENE_CAPTIONS[id]}
          phase={
            // `displayId` stays on the OUTGOING scene for the whole EXIT_MS
            // window above, so "the pair being displayed, while leaving" is
            // exactly the one that should be running its fade-out — and no
            // pair is in `enter` during that window, which is what serializes
            // fade-out-then-fade-in rather than crossfading the two.
            id !== displayId ? "idle" : leaving ? "exit" : "enter"
          }
        />
      ))}
    </div>
  );
}
