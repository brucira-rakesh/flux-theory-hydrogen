// =============================================================================
//  oceanHeight.js  —  CPU mirror of the sea height field (NEW)
// -----------------------------------------------------------------------------
//  So the bottle can "query the actual displaced wave height" (not the flat
//  plane) to decide exactly when it breaks the surface, this mirrors the
//  Gerstner swell from seawave/vertex.glsl's getDisplacement() on the CPU.
//
//  It reproduces the four crossing Gerstner waves (the terms that carry real
//  amplitude). It intentionally omits the sub-centimetre perlin shimmer: that
//  term can't feed back into the GPU field, and at its ~0.07 amplitude it only
//  shifts the break-through *timing* by a few milliseconds. Keeping the swell
//  exact means the splash still tracks the waves if the big-wave amplitude is
//  turned up in the GUI.
// =============================================================================

// One Gerstner wave's vertical (Y) contribution — matches gerstnerWave() in the
// vertex shader (which returns amplitude * sin(phase) for its Y component).
function gerstnerY(dirX, dirZ, freq, speed, amp, px, pz, time) {
  const len = Math.hypot(dirX, dirZ) || 1
  const dx = dirX / len
  const dz = dirZ / len
  const phase = (dx * px + dz * pz) * freq + time * speed
  return amp * Math.sin(phase)
}

// Displaced sea height at world (x, z). `u` is the sea material's uniforms map.
export function sampleOceanHeight(x, z, u, time) {
  const A = u.uBigWavesElevation.value
  const fx = u.uBigWavesFrequency.value.x
  const fy = u.uBigWavesFrequency.value.y
  const s = u.uBigWavesSpeed.value

  let y = 0
  // Same four directions / frequency / speed / amplitude ratios as getDisplacement().
  y += gerstnerY(1.0, 0.3, fx, s, A, x, z, time)
  y += gerstnerY(-0.4, 1.0, fy, s * 0.9, A * 0.7, x, z, time)
  y += gerstnerY(0.7, -0.8, fx * 1.7, s * 1.15, A * 0.45, x, z, time)
  y += gerstnerY(-1.0, -0.2, fy * 2.3, s * 0.8, A * 0.3, x, z, time)
  return y
}
