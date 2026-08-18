import * as THREE from "three";
import { usePreloader } from "../components/Preloader/PreloaderContext";

/**
 * Resolves the THREE.LoadingManager every loader in scenes-v2 should share.
 *
 * Falls back to THREE.DefaultLoadingManager — the instance drei's <Loader />
 * (mounted in Scene.v2.jsx) already tracks via useProgress — so /scene2 shows
 * a working progress UI with zero extra wiring today. If this route is later
 * mounted under <PreloaderV2>, PreloaderContext starts providing its own real
 * manager instead, and every loader here picks it up automatically (no
 * changes needed in the scene components) — that's the seamless hand-off.
 */
export function useLoaderManager() {
  const { manager } = usePreloader();
  return manager || THREE.DefaultLoadingManager;
}
