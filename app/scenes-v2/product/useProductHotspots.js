import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import hotspotIcon from "../../assets/icons/hotspot-dot.svg";
import {
  DEFAULT_HOTSPOT_OFFSET,
  HOTSPOT_BTN_CLASS,
  HOTSPOT_FADE_DURATION,
  HOTSPOT_HOVER_CLASS,
  HOTSPOT_OFFSCREEN_MARGIN_PX,
  HOTSPOT_OFFSET_OVERRIDES,
  HOTSPOT_REVEAL_AT_SCRUB_PROGRESS,
  HOTSPOT_SELF_HOVER_CLASS,
  HOTSPOT_STAGGER_DELAY,
} from "./constants";

// The "+" hotspot overlay — one DOM button per clickable bottle node, ported
// from Product.jsx's own hotspot block. Kept as imperative DOM (a plain layer
// appended next to the canvas) rather than drei's <Html>, for the same reason
// Product.jsx built it that way: these are positioned by projecting each
// bottle's bounding box every frame, so they'd re-render React on every frame
// as JSX, and there are up to nine of them.
//
// Lifecycle, in one place:
//   * hidden entirely until scroll has scrubbed the flythrough past
//     HOTSPOT_REVEAL_AT_SCRUB_PROGRESS (see useCameraFlythrough's
//     scrubProgressRef) AND product is actually the on-screen scene,
//   * then faded in ONCE as a staggered sequence — deliberately not a
//     scrub-linked fade that tracks scroll continuously,
//   * force-hidden immediately (no stagger) whenever a bottle goes
//     mid-reveal, or scroll leaves the hold zone in either direction,
//   * faded back in once a revealed bottle returns to rest.
export function useProductHotspots({
  assetsRef,
  ready,
  activeCameraRef,
  activeRevealedNodeRef,
  hoveredNodeRef,
  scrubProgressRef,
  activeRef,
  // node.name -> { x, y } screen-pixel nudge. Owned by the caller (see
  // ProductSceneV2) so the reveal hook's GUI can bind sliders to the same
  // objects this reads back every frame.
  offsetByNode,
}) {
  const { gl, size } = useThree();
  const layerRef = useRef(null);
  const buttonsRef = useRef(new Map()); // revealNode -> its "+" button element
  const fadeTweensRef = useRef(new Map()); // revealNode -> its current fade tween
  const enabledRef = useRef(false);
  const lastHoveredRef = useRef(null);
  const lastRevealedRef = useRef(null);
  // "Change Is Your Choice" heading — same visibility lifecycle as the "+"
  // buttons (fades in/out alongside them, see fadeAllIn/hideAllImmediately
  // and the settled/revealed checks in the useFrame below).
  const titleCharsRef = useRef([]);
  const titleFadeTweenRef = useRef(null);
  const titleVisibleRef = useRef(false);
  // Scratch vectors — this runs every frame, so nothing is allocated in it.
  const scratch = useRef({
    corner: new THREE.Vector3(),
    box: new THREE.Box3(),
    center: new THREE.Vector3(),
    camPos: new THREE.Vector3(),
    camDir: new THREE.Vector3(),
  }).current;

  const killFade = (node) => {
    fadeTweensRef.current.get(node)?.kill();
    fadeTweensRef.current.delete(node);
  };

  const forceHide = (btn, node) => {
    killFade(node);
    btn.classList.remove(HOTSPOT_HOVER_CLASS);
    btn.style.opacity = "0";
    btn.style.pointerEvents = "none";
    btn.disabled = true;
  };

  const killTitleFade = () => {
    titleFadeTweenRef.current?.kill();
    titleFadeTweenRef.current = null;
  };

  const forceHideTitle = () => {
    titleVisibleRef.current = false;
    killTitleFade();
    const chars = titleCharsRef.current;
    if (chars.length) {
      gsap.set(chars, { opacity: 0, filter: "blur(14px)", y: 10 });
    }
  };

  const fadeTitleIn = () => {
    titleVisibleRef.current = true;
    killTitleFade();
    const chars = titleCharsRef.current;
    if (!chars.length) return;
    titleFadeTweenRef.current = gsap.to(chars, {
      opacity: 1,
      filter: "blur(0px)",
      y: 0,
      duration: HOTSPOT_FADE_DURATION,
      stagger: 0.02,
      ease: "power2.out",
    });
  };

  // Instantly hides every hotspot with no animation — for when something else
  // needs visual priority right away (a reveal starting, scrolling out of the
  // section) rather than a graceful fade.
  const hideAllImmediately = () => {
    buttonsRef.current.forEach(forceHide);
    forceHideTitle();
  };

  // Fades every hotspot in one-by-one, staggered. Each button gets its own
  // tween rather than one shared timeline, so a mid-stagger interruption
  // (the user immediately clicking a bottle) only has to kill each button's
  // own small tween, not unwind a shared timeline.
  const fadeAllIn = () => {
    let index = 0;
    buttonsRef.current.forEach((btn, node) => {
      killFade(node);
      const tween = gsap.to(btn, {
        opacity: 1,
        duration: HOTSPOT_FADE_DURATION,
        delay: index * HOTSPOT_STAGGER_DELAY,
        ease: "power2.out",
        onStart: () => {
          btn.style.pointerEvents = "auto";
          btn.disabled = false;
        },
      });
      fadeTweensRef.current.set(node, tween);
      index++;
    });
    fadeTitleIn();
  };

  // --- build the layer + one button per node, once assets are loaded ---
  useEffect(() => {
    if (!ready) return undefined;
    // R3F wraps the canvas in its own positioned container div (the one
    // carrying `.scene-v2__canvas`, which is `position: absolute; inset: 0`)
    // — the natural parent for an overlay that must track canvas pixels.
    const container = gl.domElement.parentElement;
    if (!container) return undefined;

    const layer = document.createElement("div");
    layer.className = "pointer-events-none absolute inset-0 z-[9]";
    container.appendChild(layer);
    layerRef.current = layer;

    // "Change Is\nYour Choice" heading — same DOM-overlay approach as the "+"
    // buttons below, faded via titleCharsRef (see fadeTitleIn/forceHideTitle).
    // Forced two-line break (rather than letting width force an awkward
    // mid-word wrap) so it always reads "Change Is" / "Your Choice".
    const HOTSPOT_TITLE_LINES = ["Change Is", "Your Choice"];
    const title = document.createElement("h2");
    title.className =
      "pointer-events-none absolute left-1/2 top-[9%] z-[9] m-0 w-[min(90%,44rem)] -translate-x-1/2 text-center uppercase leading-[0.94] tracking-[-0.05em] text-white [font-family:var(--font-title)] text-[clamp(2rem,6vw,5.5rem)] font-bold";
    title.setAttribute("aria-label", HOTSPOT_TITLE_LINES.join(" "));
    title.innerHTML = HOTSPOT_TITLE_LINES.map(
      (line) =>
        `<span class="block">${[...line]
          .map((char) => {
            const glyph = char === " " ? "&nbsp;" : char;
            return `<span class="inline-block" style="opacity:0;filter:blur(14px);transform:translateY(10px)">${glyph}</span>`;
          })
          .join("")}</span>`,
    ).join("");
    layer.appendChild(title);
    titleCharsRef.current = Array.from(title.querySelectorAll(":scope > span > span"));

    const buttons = buttonsRef.current;
    assetsRef.current.revealNodes.forEach((node) => {
      const override = HOTSPOT_OFFSET_OVERRIDES[node.name];
      offsetByNode[node.name] = {
        x: override?.x ?? DEFAULT_HOTSPOT_OFFSET.x,
        y: override?.y ?? DEFAULT_HOTSPOT_OFFSET.y,
      };

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${HOTSPOT_BTN_CLASS} ${HOTSPOT_SELF_HOVER_CLASS}`;
      btn.setAttribute("aria-label", "View product");
      btn.dataset.node = node.name;
      btn.style.left = "-9999px";
      btn.style.top = "-9999px";
      btn.style.opacity = "0";
      btn.style.pointerEvents = "none";
      btn.disabled = true;

      const icon = document.createElement("img");
      icon.src = hotspotIcon;
      icon.alt = "";
      icon.draggable = false;
      icon.className = "pointer-events-none block h-full w-full";
      btn.appendChild(icon);

      // stopPropagation so this doesn't also reach the canvas-level click
      // handler (see useBottleReveal), which would read a click while
      // nothing is revealed yet, miss the raycast, and do nothing — or
      // worse, immediately return the node this click just revealed.
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (activeRevealedNodeRef.current || node.userData.isRevealed) return;
        node.userData.revealRequest?.();
      });

      layer.appendChild(btn);
      buttons.set(node, btn);
    });

    return () => {
      buttons.forEach((btn, node) => killFade(node));
      buttons.clear();
      killTitleFade();
      titleCharsRef.current = [];
      layer.remove();
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, gl]);

  useFrame(() => {
    const buttons = buttonsRef.current;
    if (!buttons.size) return;

    // --- settled-state edge detection ---
    // Flipped ONLY on an actual edge, never redundantly, so entering the
    // hold zone triggers the staggered reveal exactly once instead of
    // restarting it on every scroll tick inside the zone.
    const settled =
      !!activeRef.current &&
      scrubProgressRef.current >= HOTSPOT_REVEAL_AT_SCRUB_PROGRESS;
    if (settled !== enabledRef.current) {
      enabledRef.current = settled;
      if (settled) fadeAllIn();
      else hideAllImmediately();
    }

    // --- bring hotspots back once a revealed bottle has returned to rest ---
    const revealed = activeRevealedNodeRef.current;
    if (revealed !== lastRevealedRef.current) {
      const justCleared = !revealed && lastRevealedRef.current;
      lastRevealedRef.current = revealed;
      if (justCleared && enabledRef.current) fadeAllIn();
    }

    // --- sync the 3D hover state onto the matching button ---
    const hovered = hoveredNodeRef.current;
    if (hovered !== lastHoveredRef.current) {
      const previous = lastHoveredRef.current;
      if (previous) {
        buttons.get(previous)?.classList.remove(HOTSPOT_HOVER_CLASS);
      }
      lastHoveredRef.current = hovered;
      if (hovered) buttons.get(hovered)?.classList.add(HOTSPOT_HOVER_CLASS);
    }

    // Hidden the instant ANY bottle is flying/resting/returning — the
    // selective-blur pass already makes every other bottle unreadable then,
    // so a "+" hint on top of the blur would be misleading. Checked before
    // any projection work, since this is the common case for most of the
    // section's scroll range.
    if (!enabledRef.current || revealed) {
      buttons.forEach((btn, node) => {
        if (btn.style.opacity !== "0") forceHide(btn, node);
      });
      if (titleVisibleRef.current) forceHideTitle();
      return;
    }

    const camera = activeCameraRef.current;
    const width = size.width;
    const height = size.height;
    if (!camera || !width || !height) return;

    camera.getWorldPosition(scratch.camPos);
    camera.getWorldDirection(scratch.camDir);

    buttons.forEach((btn, node) => {
      scratch.box.setFromObject(node);
      if (scratch.box.isEmpty()) return;

      scratch.box.getCenter(scratch.center);
      scratch.center.sub(scratch.camPos);
      if (scratch.center.dot(scratch.camDir) <= 0.1) {
        // Behind (or right on top of) the camera — not part of the current
        // framing, e.g. the other bottle model's nodes.
        if (btn.style.opacity !== "0") forceHide(btn, node);
        return;
      }

      // Screen-space TOP-LEFT of the projected bounding box: project all 8
      // corners and take min X / min Y (screen Y grows downward, so min Y is
      // "top"). Robust to whatever angle the camera looks from, unlike
      // picking a single world-space corner up front.
      let minScreenX = Infinity;
      let minScreenY = Infinity;
      for (let i = 0; i < 8; i++) {
        scratch.corner.set(
          i & 1 ? scratch.box.max.x : scratch.box.min.x,
          i & 2 ? scratch.box.max.y : scratch.box.min.y,
          i & 4 ? scratch.box.max.z : scratch.box.min.z,
        );
        scratch.corner.project(camera);
        const screenX = (scratch.corner.x * 0.5 + 0.5) * width;
        const screenY = (-scratch.corner.y * 0.5 + 0.5) * height;
        if (screenX < minScreenX) minScreenX = screenX;
        if (screenY < minScreenY) minScreenY = screenY;
      }

      // Per-node nudge, applied BEFORE the on-screen test so a hotspot
      // deliberately pushed just past the frame edge is culled on where it
      // actually ends up, not where it would have been.
      const offset = offsetByNode[node.name];
      if (offset) {
        minScreenX += offset.x;
        minScreenY += offset.y;
      }

      const onScreen =
        minScreenX > -HOTSPOT_OFFSCREEN_MARGIN_PX &&
        minScreenX < width + HOTSPOT_OFFSCREEN_MARGIN_PX &&
        minScreenY > -HOTSPOT_OFFSCREEN_MARGIN_PX &&
        minScreenY < height + HOTSPOT_OFFSCREEN_MARGIN_PX;

      if (!onScreen) {
        if (btn.style.opacity !== "0") forceHide(btn, node);
        return;
      }

      btn.style.left = `${minScreenX}px`;
      btn.style.top = `${minScreenY}px`;
      // Opacity/pointer-events deliberately NOT set here — owned by the fade
      // tweens in fadeAllIn.
    });
  });

  return { buttonsRef };
}
