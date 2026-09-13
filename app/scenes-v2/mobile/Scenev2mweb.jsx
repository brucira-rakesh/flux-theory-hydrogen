import { useScenev2mweb } from "./useScenev2mweb";
import Scenev2mwebOverlay from "./Scenev2mwebOverlay";
import "./Scenev2mweb.css";

/**
 * Swipe-controlled hero image sequence for mobile — 5 bottle-variant scenes
 * baked into one continuous frame sequence (see data/mwebHeroSequence.js).
 * Each scene idles on its own short loop; a vertical swipe past threshold
 * commits to the next/previous scene, playing the baked whip-pan transition
 * between them. See useScenev2mweb for the full state machine.
 *
 * Scenev2mwebOverlay lays the nav pill + animated per-scene heading/copy on
 * top (Figma node 3013:3276) — see its own module comment for where its
 * content actually comes from.
 *
 * `showHeader` defaults on (this section owns its own nav pill when used
 * standalone) — pass `false` when mounting it somewhere that already has a
 * persistent site header on screen (e.g. HomeV3Page's fixed HeaderV2), so
 * the two don't stack on top of each other.
 */
export default function Scenev2mweb({ className, showHeader = true }) {
  const {
    containerRef,
    canvasRef,
    ready,
    activeSceneIndex,
    scenes,
    pinned,
    scrollPastSection,
  } = useScenev2mweb();

  return (
    <div
      ref={containerRef}
      // --pinned only while the section actually holds the page: the rest
      // of the time this is ordinary scrolling content and must not eat the
      // gesture, or there would be no way to scroll back INTO it from
      // ProductV3 below. See useScenev2mweb.
      className={`scenev2mweb${ready ? " scenev2mweb--ready" : ""}${
        pinned ? " scenev2mweb--pinned" : ""
      }${className ? ` ${className}` : ""}`}
    >
      <canvas ref={canvasRef} className="scenev2mweb__canvas" />
      <Scenev2mwebOverlay
        scenes={scenes}
        activeSceneIndex={activeSceneIndex}
        ready={ready}
        showHeader={showHeader}
        onDiscover={scrollPastSection}
      />
    </div>
  );
}
