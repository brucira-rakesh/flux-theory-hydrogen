import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import logoUrl from "../../assets/brand/header/logo-artwork.svg";
import iconSearchUrl from "../../assets/brand/header/icon-search.svg";
import iconUserUrl from "../../assets/brand/header/icon-user.svg";
import iconBagUrl from "../../assets/brand/header/icon-bag.svg";
import iconScrollChevron from "../../assets/icons/icon-scroll-chevron.svg";
import AnimatedTitle from "../../components/AnimatedTitle/AnimatedTitle";
import AnimatedDescription from "../../components/AnimatedDescription/AnimatedDescription";
import { SCENE_CAPTIONS } from "../SceneCaption";
import "./Scenev2mwebOverlay.css";

// Ports Figma node 3013:3276 ("iPhone 16 - 3") — the only one of the mobile
// hero's per-scene frames actually designed there (the other 4 scene frames
// in that file are empty placeholders). That frame's own heading/paragraph
// ("Own Every Moment...") is placeholder copy for a single scene, not a
// per-scene set — so content here comes from SCENE_CAPTIONS (SceneCaption.jsx,
// the desktop carousel's real per-scene copy) instead, keyed through
// PERSONA_TO_CAPTION_ID below. Only the LAYOUT (glass nav pill, bottom
// scrim, heading + paragraph + "Discover" cue) is Figma's.
//
// Same "outgoing pair fades out before the incoming one fades in" dance as
// SceneCaption's own CaptionPair — ported rather than reused directly since
// this one keys off Scenev2mweb's activeSceneIndex (an int) instead of a
// scroll-driven sceneId string, and has no subtitle chip row (this mobile
// frame's copy block is heading + paragraph only).
//
// activeSceneIndex (see useScenev2mweb) flips the MOMENT a swipe commits,
// not once the canvas transition lands — so this fade-out starts right in
// step with the canvas beginning its own whip-pan. Kept quick (150ms, was
// 320ms) so the outgoing copy is out of the way well before that whip-pan
// even gets going, rather than lingering visibly over it.
const EXIT_MS = 150;
const EXIT_SEC = EXIT_MS / 1000;
const ENTER_SEC = 0.2;

// Staggers the block AFTER the heading's own char reveal (AnimatedTitle,
// duration 0.8s) has had a chance to get underway, rather than starting
// alongside it — same idea repeated once more for the Discover cue, which
// waits for the paragraph's own word reveal in turn.
const DESCRIPTION_DELAY_SEC = 0.4;
const DISCOVER_DELAY_SEC = 0.95;
const DISCOVER_ENTER_SEC = 0.5;

// Overrides AnimatedDescription's defaults (0.5s / 0.06s stagger) — on a
// multi-word caption those compound into a slow crawl before the last word
// even starts moving. Tightened so the whole paragraph is done revealing
// quickly instead of trickling in word by word.
const DESCRIPTION_WORD_DURATION_SEC = 0.35;
const DESCRIPTION_WORD_STAGGER_SEC = 0.025;

// Scenev2mweb's own scene ids (data/mwebHeroSequence.js) -> SCENE_CAPTIONS'
// keys (Scene.v2.jsx's SCENES ids, via each entry's own bottlePersona).
const PERSONA_TO_CAPTION_ID = {
  sport: "one",
  sage: "two",
  dreamer: "three",
  lover: "four",
  rebel: "five",
};

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 12H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 17H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HeaderIcon({ src, label, children }) {
  return (
    <button type="button" className="scenev2mweb-overlay__icon-btn" aria-label={label}>
      {children ?? <img src={src} alt="" width={17} height={16} />}
    </button>
  );
}

function OverlayHeader() {
  return (
    <div className="scenev2mweb-overlay__header">
      <img
        src={logoUrl}
        alt="Flux Theory"
        className="scenev2mweb-overlay__logo"
        width={45}
        height={44}
      />
      <div className="scenev2mweb-overlay__icons">
        <HeaderIcon src={iconSearchUrl} label="Search" />
        <HeaderIcon src={iconUserUrl} label="Account" />
        <HeaderIcon src={iconBagUrl} label="Bag" />
        <HeaderIcon label="Menu">
          <IconMenu />
        </HeaderIcon>
      </div>
    </div>
  );
}

function CaptionPair({ id, caption, phase, onDiscover }) {
  const rootRef = useRef(null);
  const discoverRef = useRef(null);
  const enterCountRef = useRef(0);
  const [enterKey, setEnterKey] = useState(0);

  useEffect(() => {
    const el = rootRef.current;
    const discoverEl = discoverRef.current;
    if (!el) return undefined;

    gsap.killTweensOf(el);
    if (discoverEl) gsap.killTweensOf(discoverEl);

    if (phase === "enter") {
      enterCountRef.current += 1;
      setEnterKey(enterCountRef.current);
      gsap.set(el, { visibility: "visible" });
      gsap.to(el, { opacity: 1, duration: ENTER_SEC, ease: "power2.out" });

      if (discoverEl) {
        gsap.fromTo(
          discoverEl,
          { opacity: 0, y: 14 },
          {
            opacity: 1,
            y: 0,
            duration: DISCOVER_ENTER_SEC,
            delay: DISCOVER_DELAY_SEC,
            ease: "power2.out",
          },
        );
      }
      return undefined;
    }

    if (phase === "exit") {
      gsap.to(el, { opacity: 0, duration: EXIT_SEC, ease: "power2.in" });
      if (discoverEl) gsap.set(discoverEl, { opacity: 0, y: 14 });
      return undefined;
    }

    gsap.set(el, { opacity: 0, visibility: "hidden" });
    if (discoverEl) gsap.set(discoverEl, { opacity: 0, y: 14 });
    return undefined;
  }, [phase]);

  const replayKey = `${id}-${enterKey}`;
  const isOnscreen = phase !== "idle";

  if (!caption) return null;

  return (
    <div
      ref={rootRef}
      className="scenev2mweb-overlay__caption-pair"
      aria-hidden={phase !== "enter"}
    >
      <AnimatedTitle
        as="h2"
        className="scenev2mweb-overlay__heading"
        replayKey={replayKey}
        play={isOnscreen}
        blurSweep={isOnscreen}
      >
        {caption.title}
      </AnimatedTitle>
      <AnimatedDescription
        as="p"
        className="scenev2mweb-overlay__desc"
        replayKey={replayKey}
        delay={DESCRIPTION_DELAY_SEC}
        duration={DESCRIPTION_WORD_DURATION_SEC}
        stagger={DESCRIPTION_WORD_STAGGER_SEC}
      >
        {caption.description}
      </AnimatedDescription>
      <button
        ref={discoverRef}
        type="button"
        className="scenev2mweb-overlay__discover"
        onClick={onDiscover}
      >
        <span className="scenev2mweb-overlay__discover-dot" />
        Discover
      </button>
      {/* Outside the button on purpose: the entrance tween above leaves a
          transform on it, which would make the BUTTON this chevron's
          containing block — and the button is only fit-content wide, so
          `right: 0` would land it next to the label instead of out at the
          copy block's right edge. */}
      <img
        src={iconScrollChevron}
        alt=""
        className="scenev2mweb-overlay__discover-chevron"
      />
    </div>
  );
}

/**
 * Overlay chrome for Scenev2mweb — glass nav pill up top, bottom scrim +
 * animated per-scene heading/description + a "Discover" cue, all mounted on
 * top of the hero's own canvas. Purely presentational: `ready` just gates
 * the caption stack on so nothing reveals over an unpainted canvas frame.
 */
export default function Scenev2mwebOverlay({
  scenes,
  activeSceneIndex,
  ready,
  showHeader = true,
  onDiscover,
}) {
  const activeScene = scenes[activeSceneIndex];
  const [displayId, setDisplayId] = useState(activeScene?.id);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const nextId = activeScene?.id;
    if (!nextId || nextId === displayId) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setDisplayId(nextId);
      setLeaving(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [activeScene?.id, displayId]);

  return (
    <div className="scenev2mweb-overlay" aria-hidden={!ready}>
      {showHeader && <OverlayHeader />}

      <div className="scenev2mweb-overlay__bottom">
        <div className="scenev2mweb-overlay__captions" aria-live="polite">
          {scenes.map((scene) => (
            <CaptionPair
              key={scene.id}
              id={scene.id}
              caption={SCENE_CAPTIONS[PERSONA_TO_CAPTION_ID[scene.id]]}
              phase={
                scene.id !== displayId
                  ? "idle"
                  : leaving
                    ? "exit"
                    : "enter"
              }
              onDiscover={onDiscover}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
