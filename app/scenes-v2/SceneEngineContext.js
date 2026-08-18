import { createContext, useContext } from "react";

// Shared by every scene component: the imperative reflection/uTime registry
// (see engine.js) and the root lil-gui panel (see GuiRoot.jsx) that each
// scene adds its own folder to once its assets finish loading. `settings` is
// the parsed scene-v2-settings.json (see Scene.v2.jsx's own import/comment)
// — each scene applies its own slice of it to the folder it just built via
// applyFolderSettings below, once the folder (and thus its controllers)
// actually exist; Scene.v2.jsx applies the rest (its own top-level folders)
// directly, since those exist synchronously.
export const SceneEngineContext = createContext({
  engine: null,
  gui: null,
  settings: null,
});

export const useSceneEngine = () => useContext(SceneEngineContext);

// Applies the `title`-keyed slice of a saved settings JSON (lil-gui's own
// `GUI.save()` shape — see Scene.v2.jsx's Export button) to a folder a scene
// component just finished building, via lil-gui's own `load()` (walks the
// folder's controllers/sub-folders recursively and fires each one's
// onChange, so this both updates the widget and applies the value to
// whatever it controls — a material uniform, a mesh transform, ...). A
// no-op whenever that folder isn't present in the JSON (fresh/empty file,
// or a folder added after the export was taken).
export function applyFolderSettings(folder, settings, title) {
  const saved = settings?.folders?.[title];
  if (saved) folder.load(saved);
}
