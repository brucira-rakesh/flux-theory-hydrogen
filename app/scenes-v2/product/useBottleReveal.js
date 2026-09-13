import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import {
  DEFAULT_SPIN_DEGREES,
  SPIN_DEGREES_OVERRIDES,
  DEFAULT_FINAL_ROTATION_DEGREES,
  FINAL_ROTATION_OVERRIDES,
} from "./constants";
import { addCopyValuesButton } from "./guiUtils";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
// Scratch for the raycast prefilter below — module-level so a pointer
// sample allocates nothing.
const localRay = new THREE.Ray();
const localMatrix = new THREE.Matrix4();

// Click-to-reveal bottle interaction, ported verbatim from Product.jsx's
// revealNode/returnNode/handleClick/handlePointerMove block (see that
// file's own extensive docblock for the full math derivation — world/
// parent-local quaternion conversion, the whole/fractional-turn spin
// correction that guarantees an exact landing angle for any spin amount).
// Reads the currently active flythrough camera from `activeCameraRef`
// (useCameraFlythrough) rather than a single fixed camera, and locks page
// scroll via the app's own shared Lenis instance (`lenis`, from
// `useLenis()` inside <ReactLenis> in HomeV2Page) instead of a private one.
export function useBottleReveal({
  assetsRef,
  ready,
  activeCameraRef,
  lenis,
  gui,
  blurParamsRef,
  activeRef,
  hoveredNodeRef,
  // node.name -> { x, y } screen-pixel nudge table owned by
  // useProductHotspots — surfaced here purely so its sliders can live
  // alongside the rest of the bottle-reveal controls.
  hotspotOffsetByNode,
  // Owned by the caller (see ProductSceneV2) because the "+" overlay reads
  // it too — it hides every button for as long as a bottle is out.
  activeRevealedNodeRef,
  // Raised/lowered as a bottle flies out and back, so the DOM product
  // overlay (ProductOverlayV2, which lives outside the Canvas) can fade in
  // and out alongside the flight itself.
  onRevealedChange,
}) {
  const { gl } = useThree();
  const revealParamsRef = useRef({
    distanceFromCamera: 5.28, // world units in front of the camera — bathroom_bottle.glb nodes
    duration: 0.75, // seconds
    scaleMultiplier: 1.55, // revealed size relative to the node's authored rest scale
    spinDegreesByNode: {}, // keyed by node.name, seeded once revealNodes is known — see the GUI effect below
    finalRotationByNode: {},
  });
  const lenisRef = useRef(lenis);
  lenisRef.current = lenis;
  // Mirrored into a ref so revealNode/returnNode — captured once by the
  // mount-only pointer effect and by each node's revealRequest — always
  // call the CURRENT callback rather than the one from first render.
  const onRevealedChangeRef = useRef(onRevealedChange);
  onRevealedChangeRef.current = onRevealedChange;
  // Blocks handleClick while a reveal/return tween is mid-flight, so
  // spam-clicking the bottle can't kill/restart the tween every frame and
  // send it into a jittery, overlapping-animation state.
  const isAnimatingRef = useRef(false);

  // Flies ONE clicked node to a fixed distance in front of whichever camera
  // is currently active. See Product.jsx's revealNode docblock for the full
  // derivation of every step below — ported unchanged.
  const revealNode = (node) => {
    const revealParams = revealParamsRef.current;
    const relativeQuaternion = node.userData.revealRelativeQuaternion;
    if (!relativeQuaternion) return; // clicked before load-time capture finished for this node
    const activeCamera = activeCameraRef.current;
    if (!activeCamera) return;

    const parent = node.parent;
    parent.updateWorldMatrix(true, false);
    const parentWorldQuatInv = parent
      .getWorldQuaternion(new THREE.Quaternion())
      .invert();

    const camWorldPos = activeCamera.getWorldPosition(new THREE.Vector3());
    const camWorldQuat = activeCamera.getWorldQuaternion(
      new THREE.Quaternion(),
    );
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camWorldQuat);

    const worldTargetPos = camWorldPos.addScaledVector(
      forward,
      revealParams.distanceFromCamera,
    );
    const worldTargetQuat = camWorldQuat.clone().multiply(relativeQuaternion);

    const targetPosition = parent.worldToLocal(worldTargetPos.clone());
    const targetQuaternion = parentWorldQuatInv
      .clone()
      .multiply(worldTargetQuat);

    const localSpinAxis = WORLD_UP.clone()
      .applyQuaternion(parentWorldQuatInv)
      .normalize();

    const finalRotationDegrees =
      revealParams.finalRotationByNode[node.name] ??
      DEFAULT_FINAL_ROTATION_DEGREES;
    if (finalRotationDegrees !== 0) {
      const finalRotationOffset = new THREE.Quaternion().setFromAxisAngle(
        localSpinAxis,
        THREE.MathUtils.degToRad(finalRotationDegrees),
      );
      targetQuaternion.premultiply(finalRotationOffset);
    }

    const spinDegrees =
      revealParams.spinDegreesByNode[node.name] ?? DEFAULT_SPIN_DEGREES;
    const spinTurns = spinDegrees / 360;
    const fractionalSpinTurns = spinTurns - Math.trunc(spinTurns);
    const fractionalCorrection = new THREE.Quaternion().setFromAxisAngle(
      localSpinAxis,
      -fractionalSpinTurns * Math.PI * 2,
    );
    const adjustedTargetQuaternion =
      fractionalCorrection.multiply(targetQuaternion);

    const startPosition = node.position.clone();
    const startQuaternion = node.quaternion.clone();
    const startScale = node.scale.clone();
    const restScale = node.userData.restScale ?? startScale;
    const targetScale = restScale
      .clone()
      .multiplyScalar(revealParams.scaleMultiplier);

    node.userData.revealTween?.kill();
    node.userData.isRevealed = true;
    activeRevealedNodeRef.current = node;
    isAnimatingRef.current = true;
    lenisRef.current?.stop();
    onRevealedChangeRef.current?.(true, node.name); // fades the product overlay in alongside the flight, and tells it which bottle

    const spinQuaternion = new THREE.Quaternion();
    const blurParams = blurParamsRef.current;
    // `blur` rides the SAME tween/ease as the flight itself (start value is
    // whatever blurParams.amount currently is, in case a fresh reveal
    // interrupts an in-flight return) so the rest of the scene blurs in at
    // exactly the pace the clicked node flies toward the camera — see
    // SelectiveBlurRenderer's shader pipeline.
    const anim = { t: 0, spinDegrees: 0, blur: blurParams.amount };
    node.userData.revealTween = gsap.to(anim, {
      t: 1,
      spinDegrees,
      blur: blurParams.maxRadius,
      duration: revealParams.duration,
      ease: "power3.inOut",
      onUpdate: () => {
        node.position.lerpVectors(startPosition, targetPosition, anim.t);
        node.quaternion.slerpQuaternions(
          startQuaternion,
          adjustedTargetQuaternion,
          anim.t,
        );
        node.scale.lerpVectors(startScale, targetScale, anim.t);
        spinQuaternion.setFromAxisAngle(
          localSpinAxis,
          THREE.MathUtils.degToRad(anim.spinDegrees),
        );
        node.quaternion.premultiply(spinQuaternion);
        blurParams.amount = anim.blur;
      },
      onComplete: () => {
        node.userData.revealTween = null;
        isAnimatingRef.current = false;
      },
    });
  };

  // Flies an already-revealed node back to its authored resting pose — see
  // Product.jsx's returnNode docblock.
  const returnNode = (node) => {
    const revealParams = revealParamsRef.current;
    const restPosition = node.userData.restPosition;
    const restQuaternion = node.userData.restQuaternion;
    if (!restPosition || !restQuaternion) return;

    const parent = node.parent;
    parent.updateWorldMatrix(true, false);
    const parentWorldQuatInv = parent
      .getWorldQuaternion(new THREE.Quaternion())
      .invert();
    const localSpinAxis = WORLD_UP.clone()
      .applyQuaternion(parentWorldQuatInv)
      .normalize();

    const spinDegrees =
      revealParams.spinDegreesByNode[node.name] ?? DEFAULT_SPIN_DEGREES;
    const spinTurns = spinDegrees / 360;
    const fractionalSpinTurns = spinTurns - Math.trunc(spinTurns);
    const fractionalCorrection = new THREE.Quaternion().setFromAxisAngle(
      localSpinAxis,
      -fractionalSpinTurns * Math.PI * 2,
    );
    const adjustedRestQuaternion =
      fractionalCorrection.multiply(restQuaternion);

    const startPosition = node.position.clone();
    const startQuaternion = node.quaternion.clone();
    const startScale = node.scale.clone();
    const restScale = node.userData.restScale ?? startScale;

    node.userData.revealTween?.kill();
    node.userData.isRevealed = false;
    isAnimatingRef.current = true;
    onRevealedChangeRef.current?.(false); // fades the product overlay out alongside the flight back

    const spinQuaternion = new THREE.Quaternion();
    const blurParams = blurParamsRef.current;
    // Mirrors revealNode's blur wiring, tweening back down to 0.
    const anim = { t: 0, spinDegrees: 0, blur: blurParams.amount };
    node.userData.revealTween = gsap.to(anim, {
      t: 1,
      spinDegrees,
      blur: 0,
      duration: revealParams.duration,
      ease: "power3.inOut",
      onUpdate: () => {
        node.position.lerpVectors(startPosition, restPosition, anim.t);
        node.quaternion.slerpQuaternions(
          startQuaternion,
          adjustedRestQuaternion,
          anim.t,
        );
        node.scale.lerpVectors(startScale, restScale, anim.t);
        spinQuaternion.setFromAxisAngle(
          localSpinAxis,
          THREE.MathUtils.degToRad(anim.spinDegrees),
        );
        node.quaternion.premultiply(spinQuaternion);
        blurParams.amount = anim.blur;
      },
      onComplete: () => {
        node.userData.revealTween = null;
        isAnimatingRef.current = false;
        if (activeRevealedNodeRef.current === node) {
          activeRevealedNodeRef.current = null;
          lenisRef.current?.start();
        }
      },
    });
  };

  // Re-runs revealNode() for currently-revealed nodes matching `predicate` —
  // lets a GUI tweak reflect live on an already-revealed bottle, without
  // retriggering nodes the tweak doesn't apply to. Wired to `onFinishChange`
  // (fires once, on release), not `onChange` — see Product.jsx's own note on
  // why continuous mid-drag retargeting looks "stuck".
  const retargetNodesIf = (predicate) => {
    assetsRef.current.revealNodes.forEach((node) => {
      if (node.userData.isRevealed && predicate(node)) revealNode(node);
    });
  };
  // While a node is flying toward the camera, resting revealed, or flying
  // back, every OTHER node is excluded from raycasting — only one bottle
  // part can ever be mid-interaction at a time.
  const getInteractiveTargets = () => {
    const interactiveMeshes = assetsRef.current.interactiveMeshes;
    if (!activeRevealedNodeRef.current) return interactiveMeshes;
    return interactiveMeshes.filter(
      (mesh) => mesh.userData.revealNode === activeRevealedNodeRef.current,
    );
  };

  // Node-local bounding box, unioned from the node's own meshes' geometry
  // boxes. Computed once per node and cached: it is expressed in the node's
  // OWN space, so it stays valid however the node is later moved, spun or
  // scaled by the reveal tween — only the node's matrixWorld changes, and
  // the ray is brought into local space to meet it (see pickInteractive).
  const getLocalBox = (node) => {
    if (node.userData.localBox) return node.userData.localBox;
    const box = new THREE.Box3();
    const toLocal = new THREE.Matrix4();
    const childBox = new THREE.Box3();
    node.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(node.matrixWorld).invert();
    node.traverse((child) => {
      if (!child.isMesh) return;
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      childBox.copy(child.geometry.boundingBox);
      childBox.applyMatrix4(toLocal.multiplyMatrices(inverse, child.matrixWorld));
      box.union(childBox);
    });
    node.userData.localBox = box;
    return box;
  };

  // Bounding-box prefilter in front of the real triangle raycast.
  //
  // bathroom_bottle.glb is ~1.62M triangles across 25 primitives (one part
  // alone is 299k tris PER bottle), and three.js's Mesh.raycast falls
  // through to a full per-triangle loop for every mesh whose bounding
  // SPHERE the ray clips. On a shelf of five bottles standing side by side
  // those spheres overlap generously, so a single pointer sample was
  // routinely testing several hundred thousand triangles on the main
  // thread. At pointermove rate (120Hz+ on a high-refresh mouse) that alone
  // can own the frame budget.
  //
  // Boxes are far tighter than spheres for an upright bottle, so this
  // usually leaves one node — or none at all, which is the common case
  // while the pointer is anywhere but directly on a bottle. The real
  // raycast still runs on whatever survives, so the hit test stays
  // triangle-exact: a box-only pick would fire on the large empty corners
  // of a bottle's AABB and pop the "+" while the cursor is beside it.
  const pickInteractive = (raycaster) => {
    const targets = getInteractiveTargets();
    if (!targets.length) return null;
    const candidateNodes = new Set();
    for (const mesh of targets) {
      const node = mesh.userData.revealNode;
      if (!node || candidateNodes.has(node)) continue;
      node.updateWorldMatrix(true, false);
      localRay.copy(raycaster.ray).applyMatrix4(
        localMatrix.copy(node.matrixWorld).invert(),
      );
      if (localRay.intersectsBox(getLocalBox(node))) candidateNodes.add(node);
    }
    if (!candidateNodes.size) return null;
    const narrowed = targets.filter((mesh) =>
      candidateNodes.has(mesh.userData.revealNode),
    );
    const [hit] = raycaster.intersectObjects(narrowed, false);
    return hit ?? null;
  };

  // Pointer listeners: attached once at mount (not gated on `ready`) — the
  // handlers themselves no-op gracefully while interactiveMeshes is still
  // empty, same as Product.jsx.
  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const pointerNDC = new THREE.Vector2();

    const pointerToNDC = (event) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      return pointerNDC;
    };

    // pointermove fires per input sample, not per frame — 120Hz+ on a
    // high-refresh mouse, and coalesced bursts higher still. Nothing
    // downstream of the hover test can be observed more than once per
    // frame (a cursor style and a ref the "+" overlay reads in its own
    // useFrame), so the event only records where the pointer is and the
    // actual raycast runs at most once per rAF against the latest sample.
    let pendingMove = null;
    let moveFrame = 0;

    const runHoverPick = () => {
      moveFrame = 0;
      const event = pendingMove;
      pendingMove = null;
      if (!event) return;
      if (!activeRef.current) return; // carousel owns pointer input right now
      const interactiveMeshes = assetsRef.current.interactiveMeshes;
      const activeCamera = activeCameraRef.current;
      if (!interactiveMeshes.length || !activeCamera) return;
      raycaster.setFromCamera(pointerToNDC(event), activeCamera);
      const hit = pickInteractive(raycaster);
      gl.domElement.style.cursor = hit ? "pointer" : "";
      // Published for the "+" overlay, which scales the matching button up
      // in sync with the bottle under the pointer (see useProductHotspots).
      if (hoveredNodeRef) {
        hoveredNodeRef.current = hit
          ? (hit.object.userData.revealNode ?? null)
          : null;
      }
    };

    const handlePointerMove = (event) => {
      if (!activeRef.current) return; // carousel owns pointer input right now
      // Only the coordinates are read later, and `event` is not reused by
      // the browser after dispatch, so holding the object itself is safe
      // and cheaper than copying.
      pendingMove = event;
      if (!moveFrame) moveFrame = requestAnimationFrame(runHoverPick);
    };

    // The canvas stops firing pointermove once the pointer leaves it —
    // including when it moves onto a "+" button, which sits in the overlay
    // layer above. Without this the last-hovered bottle would stay stuck
    // scaled up. (The button's own `hover:` variant keeps it scaled while
    // the pointer is actually on it — see HOTSPOT_SELF_HOVER_CLASS.)
    const handlePointerLeave = () => {
      // Drop any sample still queued for this frame, or it would land after
      // the leave and re-assert a hover the pointer has already left.
      pendingMove = null;
      if (hoveredNodeRef) hoveredNodeRef.current = null;
      gl.domElement.style.cursor = "";
    };

    // Clicking a not-yet-revealed node flies it toward the camera. Once ANY
    // node is out, a click ANYWHERE sends it back — see Product.jsx's own
    // note on why precise re-hitting isn't the point once blurred.
    const handleClick = (event) => {
      if (!activeRef.current) return; // carousel owns pointer input right now
      if (isAnimatingRef.current) return; // ignore clicks mid fly-out/fly-back so spam-clicking can't retrigger the tween
      const interactiveMeshes = assetsRef.current.interactiveMeshes;
      const activeCamera = activeCameraRef.current;
      if (!interactiveMeshes.length || !activeCamera) return;
      if (activeRevealedNodeRef.current) {
        returnNode(activeRevealedNodeRef.current);
        return;
      }
      raycaster.setFromCamera(pointerToNDC(event), activeCamera);
      const hit = pickInteractive(raycaster);
      if (!hit) return;
      const node = hit.object.userData.revealNode;
      if (!node) return;
      revealNode(node);
    };

    const el = gl.domElement;
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerleave", handlePointerLeave);
    el.addEventListener("click", handleClick);
    return () => {
      if (moveFrame) cancelAnimationFrame(moveFrame);
      pendingMove = null;
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerleave", handlePointerLeave);
      el.removeEventListener("click", handleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  // Hands each node its own "reveal me" trigger, so the "+" hotspot button
  // belonging to it can start the exact same flight as clicking the bottle
  // mesh (see useProductHotspots). Published on userData rather than passed
  // as a callback because the hotspot layer is keyed by node and built in a
  // separate hook — this keeps the two from having to agree on ordering.
  // The closure only ever reads refs, so it can't go stale.
  useEffect(() => {
    if (!ready) return undefined;
    const nodes = assetsRef.current.revealNodes;
    nodes.forEach((node) => {
      node.userData.revealRequest = () => revealNode(node);
    });
    return () => {
      nodes.forEach((node) => {
        delete node.userData.revealRequest;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // "Bottle Reveal" GUI folder + per-mesh spin/final-rotation sub-folders —
  // added once revealNodes is actually known (assets finished loading).
  useEffect(() => {
    if (!ready || !gui) return undefined;
    const revealNodes = assetsRef.current.revealNodes;
    const revealParams = revealParamsRef.current;

    // Seed each node's spin/final-rotation entry from the *_OVERRIDES tables
    // (or the shared default) the moment its controls become GUI-tweakable.
    revealNodes.forEach((node) => {
      revealParams.spinDegreesByNode[node.name] =
        SPIN_DEGREES_OVERRIDES[node.name] ?? DEFAULT_SPIN_DEGREES;
      revealParams.finalRotationByNode[node.name] =
        FINAL_ROTATION_OVERRIDES[node.name] ?? DEFAULT_FINAL_ROTATION_DEGREES;
    });

    const revealFolder = gui.addFolder("Bottle Reveal");
    revealFolder
      .add(revealParams, "distanceFromCamera", 0.5, 8, 0.1)
      .name("Distance from camera")
      .onFinishChange(() => retargetNodesIf(() => true));
    revealFolder
      .add(revealParams, "duration", 0.2, 3, 0.05)
      .name("Duration (s)");
    revealFolder
      .add(revealParams, "scaleMultiplier", 0.5, 3, 0.05)
      .name("Reveal scale")
      .onFinishChange(() => retargetNodesIf(() => true));
    addCopyValuesButton(
      revealFolder,
      () => ({ ...revealParams }),
      "[ProductV2]",
    );

    const spinDegreesFolder = revealFolder.addFolder("Per-mesh spin degrees");
    revealNodes.forEach((node) => {
      spinDegreesFolder
        .add(revealParams.spinDegreesByNode, node.name, 0, 1440, 1)
        .name(node.name)
        .onFinishChange(() => retargetNodesIf((n) => n === node));
    });

    const finalRotationFolder = revealFolder.addFolder(
      "Per-mesh final rotation",
    );
    revealNodes.forEach((node) => {
      finalRotationFolder
        .add(revealParams.finalRotationByNode, node.name, -180, 180, 1)
        .name(node.name)
        .onFinishChange(() => retargetNodesIf((n) => n === node));
    });

    // Live X/Y nudge per "+" button, off the screen-space bounding-box corner
    // they're auto-placed at (see HOTSPOT_OFFSET_OVERRIDES / useProductHotspots).
    // No onChange handler needed, unlike the folders above: the hotspot
    // updater re-reads these every frame, so a drag is visible immediately
    // with nothing to retarget. Note the buttons are only ON SCREEN once
    // scroll reaches the hold zone, so scroll to the end of the section
    // before tuning or there'll be nothing to see move.
    if (hotspotOffsetByNode) {
      const hotspotOffsetFolder = revealFolder.addFolder(
        "Per-mesh hotspot offset",
      );
      revealNodes.forEach((node) => {
        const offset = hotspotOffsetByNode[node.name];
        if (!offset) return;
        hotspotOffsetFolder
          .add(offset, "x", -120, 120, 1)
          .name(`${node.name} X`);
        hotspotOffsetFolder
          .add(offset, "y", -120, 120, 1)
          .name(`${node.name} Y`);
      });
      // Dumps the whole table in exactly the shape HOTSPOT_OFFSET_OVERRIDES
      // expects, so tuned values paste straight back into the constant.
      addCopyValuesButton(
        hotspotOffsetFolder,
        () => hotspotOffsetByNode,
        "[ProductV2]",
      );
    }

    return () => revealFolder.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, gui, hotspotOffsetByNode]);

  return { activeRevealedNodeRef };
}
