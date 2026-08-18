var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as WebGL from "./webgl.js";
class GL {
  constructor(canvas, options, vert, frag) {
    __publicField(this, "canvas", null);
    __publicField(this, "gl", null);
    __publicField(this, "program", null);
    __publicField(this, "width", 0);
    __publicField(this, "height", 0);
    this.init(canvas, options, vert, frag);
  }
  init(canvas, options, vert, frag) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    this.gl = WebGL.getContext(canvas, options);
    if (!this.gl) throw new Error("WebGL not supported");
    this.program = this.createProgram(vert, frag);
    if (!this.program) throw new Error("Failed to create WebGL program");
    this.useProgram(this.program);
  }
  createProgram(vert, frag) {
    return WebGL.createProgram(this.gl, vert, frag);
  }
  useProgram(program) {
    this.program = program;
    this.gl.useProgram(program);
  }
  createTexture(source, i) {
    return WebGL.createTexture(this.gl, source, i);
  }
  createUniform(type, name, ...v) {
    WebGL.createUniform(this.gl, this.program, type, name, ...v);
  }
  activeTexture(i) {
    WebGL.activeTexture(this.gl, i);
  }
  updateTexture(source) {
    WebGL.updateTexture(this.gl, source);
  }
  draw() {
    WebGL.setRectangle(this.gl, -1, -1, 2, 2);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }
}
export {
  GL as default
};
