var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import createCanvas from "./createCanvas.js";
import GL from "./gl.js";
import { fragmentShader, vertexShader } from "./shaders.js";
const defaultOptions = {
  renderShadow: false,
  minRefraction: 256,
  maxRefraction: 512,
  brightness: 1,
  alphaMultiply: 20,
  alphaSubtract: 5,
  parallaxBg: 5,
  parallaxFg: 20
};
class RainRenderer {
  constructor(canvas, canvasLiquid, imageFg, imageBg, imageShine = null, options = {}) {
    __publicField(this, "canvas");
    __publicField(this, "canvasLiquid");
    __publicField(this, "imageShine");
    __publicField(this, "imageFg");
    __publicField(this, "imageBg");
    __publicField(this, "options");
    __publicField(this, "gl", null);
    __publicField(this, "programWater", null);
    __publicField(this, "textures", []);
    __publicField(this, "parallaxX", 0);
    __publicField(this, "parallaxY", 0);
    __publicField(this, "width", 0);
    __publicField(this, "height", 0);
    __publicField(this, "raf", 0);
    __publicField(this, "destroyed", false);
    __publicField(this, "draw", () => {
      if (this.destroyed || !this.gl) return;
      this.gl.useProgram(this.programWater);
      this.gl.createUniform("2f", "parallax", this.parallaxX, this.parallaxY);
      this.updateTexture();
      this.gl.draw();
      this.raf = requestAnimationFrame(this.draw);
    });
    this.canvas = canvas;
    this.canvasLiquid = canvasLiquid;
    this.imageShine = imageShine;
    this.imageFg = imageFg;
    this.imageBg = imageBg;
    this.options = { ...defaultOptions, ...options };
    this.init();
  }
  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
  }
  init() {
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.gl = new GL(this.canvas, { alpha: false }, vertexShader, fragmentShader);
    const gl = this.gl;
    this.programWater = gl.program;
    gl.createUniform("2f", "resolution", this.width, this.height);
    gl.createUniform(
      "1f",
      "textureRatio",
      this.imageBg.width / this.imageBg.height
    );
    gl.createUniform("1i", "renderShine", this.imageShine == null ? 0 : 1);
    gl.createUniform("1i", "renderShadow", this.options.renderShadow ? 1 : 0);
    gl.createUniform("1f", "minRefraction", this.options.minRefraction);
    gl.createUniform(
      "1f",
      "refractionDelta",
      this.options.maxRefraction - this.options.minRefraction
    );
    gl.createUniform("1f", "brightness", this.options.brightness);
    gl.createUniform("1f", "alphaMultiply", this.options.alphaMultiply);
    gl.createUniform("1f", "alphaSubtract", this.options.alphaSubtract);
    gl.createUniform("1f", "parallaxBg", this.options.parallaxBg);
    gl.createUniform("1f", "parallaxFg", this.options.parallaxFg);
    gl.createTexture(null, 0);
    this.textures = [
      {
        name: "textureShine",
        img: this.imageShine == null ? createCanvas(2, 2) : this.imageShine
      },
      { name: "textureFg", img: this.imageFg },
      { name: "textureBg", img: this.imageBg }
    ];
    this.textures.forEach((texture, i) => {
      gl.createTexture(texture.img, i + 1);
      gl.createUniform("1i", texture.name, i + 1);
    });
    this.draw();
  }
  updateTextures() {
    if (!this.gl) return;
    this.textures.forEach((texture, i) => {
      this.gl.activeTexture(i + 1);
      this.gl.updateTexture(texture.img);
    });
  }
  updateTexture() {
    if (!this.gl) return;
    this.gl.activeTexture(0);
    this.gl.updateTexture(this.canvasLiquid);
  }
}
export {
  RainRenderer as default
};
