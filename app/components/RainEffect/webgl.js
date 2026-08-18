function getContext(canvas, options = {}) {
  const contexts = ["webgl", "experimental-webgl"];
  let context = null;
  for (const name of contexts) {
    try {
      context = canvas.getContext(name, options);
    } catch {
    }
    if (context != null) break;
  }
  return context;
}
function createProgram(gl, vertexScript, fragScript) {
  const vertexShader = createShader(gl, vertexScript, gl.VERTEX_SHADER);
  const fragShader = createShader(gl, fragScript, gl.FRAGMENT_SHADER);
  if (!vertexShader || !fragShader) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!linked) {
    console.error("Error in program linking: " + gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1,
      -1,
      1,
      -1,
      -1,
      1,
      -1,
      1,
      1,
      -1,
      1,
      1
    ]),
    gl.STATIC_DRAW
  );
  if (texCoordLocation >= 0) {
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  return program;
}
function createShader(gl, script, type) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, script);
  gl.compileShader(shader);
  const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!compiled) {
    console.error(
      "Error compiling shader '" + shader + "':" + gl.getShaderInfoLog(shader)
    );
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
function createTexture(gl, source, i) {
  const texture = gl.createTexture();
  activeTexture(gl, i);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (source == null) {
    return texture;
  }
  updateTexture(gl, source);
  return texture;
}
function createUniform(gl, program, type, name, ...args) {
  const location = gl.getUniformLocation(program, "u_" + name);
  const fn = gl["uniform" + type];
  fn.call(gl, location, ...args);
}
function activeTexture(gl, i) {
  gl.activeTexture(gl["TEXTURE" + i]);
}
function updateTexture(gl, source) {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}
function setRectangle(gl, x, y, width, height) {
  const x1 = x;
  const x2 = x + width;
  const y1 = y;
  const y2 = y + height;
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2]),
    gl.STATIC_DRAW
  );
}
export {
  activeTexture,
  createProgram,
  createShader,
  createTexture,
  createUniform,
  getContext,
  setRectangle,
  updateTexture
};
