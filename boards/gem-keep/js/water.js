// Water surface: one sheet over the whole map, visible only where the land boxes do not cover it.
// The wave function is adapted from "Very fast procedural ocean" by afl_ext
// (https://www.shadertoy.com/view/MdXyzX), used under the MIT License:
//   Copyright (c) 2017-2024 afl_ext
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
//   files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
//   modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice
//   shall be included in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
//   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
//   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
//   ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
// Changes: used only for surface normals (no raymarch), scaled for small lakes and rivers. Sky reflection, sun glint,
// shallow/deep color, transparency and shore foam are our own code.
import * as THREE from "../lib/three.module.min.js";

// Tuning: all in one place.
const WAVE_SCALE = 2.4;          // wave pattern repeats per world unit (one tile = one unit)
const WAVE_SPEED = 0.9;          // animation speed of the waves
const NORMAL_STRENGTH = 1.3;     // how strongly the waves bend reflections
const DEEP_TILES = 0.8;          // distance from shore (tiles) at which the water is fully deep
const SUN_GLINT = 220;           // sun highlight sharpness
const FOAM_WIDTH = 0.1;          // foam band: mask values from 0.5 (the shoreline) up to 0.5 + this

const VERTEX = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform sampler2D uMask;      // r = water (1) or land (0), g = depth (0 at the shore .. 1 deep)
uniform vec4 uGrid;           // world -> mask uv: (x offset, z offset, grid width, grid height)
uniform vec3 uSkyTop, uSkyBottom, uSunDir, uSunColor, uDeep, uShallow;
varying vec3 vWorld;

vec2 wavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
  float x = dot(direction, position) * frequency + timeshift;
  float wave = exp(sin(x) - 1.0);
  return vec2(wave, -wave * cos(x));
}
float getwaves(vec2 position) {
  float wavePhaseShift = length(position) * 0.1;
  float iter = 0.0, frequency = 1.0, timeMultiplier = 2.0, weight = 1.0, sumOfValues = 0.0, sumOfWeights = 0.0;
  for (int i = 0; i < 12; i++) {
    vec2 p = vec2(sin(iter), cos(iter));
    vec2 res = wavedx(position, p, frequency, uTime * timeMultiplier + wavePhaseShift);
    position += p * res.y * weight * 0.38;
    sumOfValues += res.x * weight;
    sumOfWeights += weight;
    weight = mix(weight, 0.0, 0.2);
    frequency *= 1.18;
    timeMultiplier *= 1.07;
    iter += 1232.399963;
  }
  return sumOfValues / sumOfWeights;
}

void main() {
  vec2 maskUv = (vWorld.xz + uGrid.xy) / uGrid.zw;
  vec4 mask = texture2D(uMask, maskUv);
  if (mask.r < 0.02) discard;

  vec2 p = vWorld.xz * ${WAVE_SCALE.toFixed(2)};
  float e = 0.04;
  float h = getwaves(p);
  vec3 N = normalize(vec3((h - getwaves(p + vec2(e, 0.0))) * ${NORMAL_STRENGTH.toFixed(2)}, e, (h - getwaves(p + vec2(0.0, e))) * ${NORMAL_STRENGTH.toFixed(2)}));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);

  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 sky = mix(uSkyBottom, uSkyTop, clamp(R.y * 1.4, 0.0, 1.0));
  float depth = mask.g;
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 1.0, depth)) * (0.85 + 0.3 * h);
  vec3 color = mix(body, sky, clamp(fresnel * 1.1 + 0.03, 0.0, 1.0));
  color += uSunColor * pow(max(dot(R, uSunDir), 0.0), ${SUN_GLINT.toFixed(1)}) * 2.5;

  // Foam: a broken, moving line along the shore.
  float shore = smoothstep(0.5 + ${FOAM_WIDTH.toFixed(2)}, 0.5, mask.r);
  float foamNoise = getwaves(vWorld.xz * 5.0 + vec2(uTime * 0.2, 0.0));
  float foam = shore * smoothstep(0.5, 0.75, foamNoise + shore * 0.15) * 0.75;
  color = mix(color, vec3(0.94, 0.97, 1.0), foam * 0.85);

  float alpha = mix(0.62, 0.93, depth) + fresnel * 0.2;
  gl_FragColor = vec4(color, clamp(max(alpha, foam), 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// isWater(gridX, gridZ) over the full grid (map plus margin); origin: world position of grid cell (0, 0).
export function createWater({ gridWidth, gridHeight, isWater, originX, originZ, level, env, sunDirection }) {
  // Distance (in tiles) from each water cell to the nearest land cell, by repeated relaxation.
  const size = gridWidth * gridHeight;
  const distance = new Float32Array(size).fill(0);
  for (let i = 0; i < size; i++) distance[i] = isWater(i % gridWidth, Math.floor(i / gridWidth)) ? Infinity : 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 0; z < gridHeight; z++) for (let x = 0; x < gridWidth; x++) relax(x, z, pass ? 1 : -1);
    for (let z = gridHeight - 1; z >= 0; z--) for (let x = gridWidth - 1; x >= 0; x--) relax(x, z, pass ? -1 : 1);
  }
  function relax(x, z) {
    const i = z * gridWidth + x;
    if (!distance[i]) return;
    let best = distance[i];
    for (const [dx, dz, cost] of [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [1, 1, 1.41]]) {
      const nx = x + dx, nz = z + dz;
      const d = nx < 0 || nz < 0 || nx >= gridWidth || nz >= gridHeight ? Infinity : distance[nz * gridWidth + nx] + cost;
      if (d < best) best = d;
    }
    distance[i] = best;
  }
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const water = distance[i] > 0;
    data[i * 4] = water ? 255 : 0;
    data[i * 4 + 1] = water ? Math.round(Math.min(1, (distance[i] - 0.5) / DEEP_TILES) * 255) : 0;
    data[i * 4 + 3] = 255;
  }
  const mask = new THREE.DataTexture(data, gridWidth, gridHeight, THREE.RGBAFormat);
  mask.magFilter = mask.minFilter = THREE.LinearFilter;
  mask.needsUpdate = true;

  const linear = (hex) => new THREE.Color(hex);
  // Colors: env.waterDeep / env.waterShallow when an environment sets them, else derived from env.water.
  const deep = env.waterDeep != null ? linear(env.waterDeep) : linear(env.water).multiplyScalar(0.45);
  const shallow = env.waterShallow != null ? linear(env.waterShallow) : linear(env.water).lerp(new THREE.Color(0x5ac8c0), 0.3);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uMask: { value: null },
      uGrid: { value: new THREE.Vector4(-originX + 0.5, -originZ + 0.5, gridWidth, gridHeight) },
      uSkyTop: { value: linear(env.skyTop) }, uSkyBottom: { value: linear(env.skyBottom) },
      uSunDir: { value: sunDirection.clone().normalize() }, uSunColor: { value: linear(env.sun) },
      uDeep: { value: deep }, uShallow: { value: shallow },
    }]),
  });
  material.uniforms.uMask.value = mask;   // set after merge: UniformsUtils.merge clones textures
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(gridWidth, gridHeight, 1, 1).rotateX(-Math.PI / 2), material);
  mesh.position.set(originX + (gridWidth - 1) / 2, 0, originZ + (gridHeight - 1) / 2);
  mesh.renderOrder = 1;

  return {
    mesh,
    update(dt) { material.uniforms.uTime.value += dt * WAVE_SPEED; },
    dispose() { mask.dispose(); },
  };
}
