import { useEffect, useState } from "react";
import GUI from "lil-gui";

// Extracted from Scene.v2.jsx's own GUI-creation effect so more than one
// section (SceneV2, ProductV2) can share a single lil-gui panel instead of
// each spawning its own floating one. Built fresh inside the effect (not a
// lazily-created ref) so React 19 StrictMode's dev-only double-invoke
// (effect -> cleanup -> effect) works correctly — each invocation gets its
// own real GUI instance rather than the second invocation reusing (and
// fighting over) one already destroyed by the first's cleanup. `gui` is
// state, not a frozen ref/useMemo, so consumers that read it via context
// (once their own async asset loads resolve, well after this settles)
// always see the final, live panel.
//
// `title` is falsy for a caller that's being handed an externally-supplied
// panel instead (see Scene.v2.jsx's `gui` prop) — in that case this hook is
// a no-op, returning null forever, so no second/orphaned panel is created.
export function useDebugGui(title) {
  const [gui, setGui] = useState(null);

  useEffect(() => {
    if (!title) return undefined;
    const panel = new GUI({ title, closeFolders: true });
    panel.open();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGui(panel);
    return () => {
      panel.destroy();
      setGui((current) => (current === panel ? null : current));
    };
  }, [title]);

  return gui;
}
