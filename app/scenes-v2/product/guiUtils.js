// Adds a "Copy values" button to `folder` that dumps whatever `getValues()`
// currently returns as JSON to the console + clipboard, so hand-tuned
// values can be pasted back in as new defaults. Reads live (called only on
// click), so it always reflects what's on screen. Ported from Product.jsx,
// shared by ProductLights/SelectiveBlurRenderer/useBottleReveal's own GUI
// folders (Product.jsx had one private copy per call site; those three now
// import this single one).
export const addCopyValuesButton = (folder, getValues, logLabel = "[ProductV2]") => {
  let copyController;
  const copyValues = () => {
    const json = JSON.stringify(getValues(), null, 2);
    console.log(`${logLabel} Copied values:\n` + json);
    navigator.clipboard?.writeText(json).catch(() => {});
    if (copyController) {
      copyController.name("Copied to clipboard ✓");
      setTimeout(() => copyController.name("Copy values"), 1200);
    }
  };
  copyController = folder.add({ copy: copyValues }, "copy").name("Copy values");
};
