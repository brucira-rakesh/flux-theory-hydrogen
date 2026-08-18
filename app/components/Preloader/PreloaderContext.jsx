import { createContext, useContext } from 'react'

/**
 * Preload state shared with the rest of the app. `manager` is the shared
 * THREE.LoadingManager instance — later work can register loaders against
 * it (GLTFLoader(manager), TextureLoader(manager), ...) and the preloader
 * will hold the boot animation until those assets resolve.
 */
export const PreloaderContext = createContext({
  ready: false,
  // True the instant the boot animation starts handing off (shade going
  // transparent, logo fading) — before the overlay itself starts exiting.
  // This is the cue other components should use to start playing on-page
  // media in sync with the loader's fade, instead of waiting for `ready`.
  handoff: false,
  progress: 0,
  animationDone: false,
  assetsReady: false,
  manager: null,
  // The sequenceLoader created for the `sequence` prop (if any) — reuse
  // this instead of preloading the same frames again elsewhere. It already
  // holds every decoded Image() by the time `assetsReady`/`handoff` flips.
  sequenceLoader: null,
})

export function usePreloader() {
  return useContext(PreloaderContext)
}
