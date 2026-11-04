(() => {
  // 3D ocean for the Instruments effect, rendered with WebGL 2 into an OffscreenCanvas that the effect draws onto its 2D canvas.
  // The wave, raymarch, normal, sky and tonemap code is adapted from "Very fast procedural ocean" by afl_ext
  // (https://www.shadertoy.com/view/MdXyzX, copy in xscreensaver hacks/glx/glsl/prococean.glsl), used under the MIT License:
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
  // Changes: the daytime sky is not drawn (it is only reflected); instead the sky shows our own cloud deck (below), fixed sun and camera,
  // a fixed sea level, per-band wave heights and speeds (uGain / uPhase), drag and tint uniforms, a reflection flash for lightning, and a distance fade at the horizon.
  // Cloud deck and note lights are our own code: a perspective cloud layer of domain-warped value-noise FBM, with 12 coloured
  // lights behind it (dimmed where the cloud is thick, lighting the cloud body and its thin edges); also reflected in the sea.
  const VERTEX = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;
  const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float uGain[5];
uniform float uPhase[5];
uniform float uSlab;
uniform float uAmp;
uniform float uDrag;
uniform float uPitch;
uniform float uSky;
uniform float uFade;
uniform vec3 uTint;
uniform vec3 uFlash;
uniform vec3 uLights[12];
uniform vec3 uLightColors[12];
uniform vec2 uCloudWind;
uniform float uCloudCover;
uniform vec3 uCloudAmbient;
uniform float uLightSea;
uniform vec3 uDeepPos[5];
uniform vec3 uDeepColors[5];
out vec4 fragColor;
#define CAMERA_HEIGHT 1.5
// Waves come in octaves (each 18% higher in frequency, 20% lighter). Octaves are grouped into 5 bands, each driven by one
// instrument group: 0 = kick (big swells), 1 = bass, 2 = vocals, 3 = other, 4 = hats (fine chop, mostly in the normals).
// uGain[band] multiplies that band's height and uPhase[band] is its own clock, so each band grows and speeds up on its own.
// Every wave is centred on its mean (WAVE_MEAN) so the sea level stays at y = 0 however much any band grows.
// uSlab = 1 + the largest gain; it sizes the raymarch slab so the tallest possible crest stays inside it.
#define WAVE_MEAN 0.466
int bandOf(int i) { return i < 2 ? 0 : i < 4 ? 1 : i < 7 ? 2 : i < 11 ? 3 : 4; }
#define ITERATIONS_RAYMARCH 12
#define ITERATIONS_NORMAL 30

vec2 wavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
  float x = dot(direction, position) * frequency + timeshift;
  float wave = exp(sin(x) - 1.0);
  float dx = wave * cos(x);
  return vec2(wave, -dx);
}

float getwaves(vec2 position, int iterations) {
  float wavePhaseShift = length(position) * 0.1;
  float iter = 0.0;
  float frequency = 1.0;
  float timeMultiplier = 2.0;
  float weight = 1.0;
  float sumOfValues = 0.0;
  float sumOfWeights = 0.0;
  for (int i = 0; i < iterations; i++) {
    vec2 p = vec2(sin(iter), cos(iter));
    int band = bandOf(i);
    vec2 res = wavedx(position, p, frequency, uPhase[band] * timeMultiplier + wavePhaseShift);
    position += p * res.y * weight * uDrag;
    sumOfValues += (res.x - WAVE_MEAN) * weight * (1.0 + uGain[band]);
    sumOfWeights += weight;
    weight = mix(weight, 0.0, 0.2);
    frequency *= 1.18;
    timeMultiplier *= 1.07;
    iter += 1232.399963;
  }
  return sumOfValues / sumOfWeights;
}

float raymarchwater(vec3 camera, vec3 start, vec3 end, float amp) {
  vec3 pos = start;
  vec3 dir = normalize(end - start);
  for (int i = 0; i < 64; i++) {
    float height = getwaves(pos.xz, ITERATIONS_RAYMARCH) * amp;
    if (height + 0.01 > pos.y) return distance(pos, camera);
    pos += dir * (pos.y - height);
  }
  return distance(start, camera);
}

vec3 normal(vec2 pos, float e, float amp) {
  vec2 ex = vec2(e, 0);
  float H = getwaves(pos.xy, ITERATIONS_NORMAL) * amp;
  vec3 a = vec3(pos.x, H, pos.y);
  return normalize(cross(
    a - vec3(pos.x - e, getwaves(pos.xy - ex.xy, ITERATIONS_NORMAL) * amp, pos.y),
    a - vec3(pos.x, getwaves(pos.xy + ex.yx, ITERATIONS_NORMAL) * amp, pos.y + e)));
}

vec3 extra_cheap_atmosphere(vec3 raydir, vec3 sundir) {
  float special_trick = 1.0 / (raydir.y * 1.0 + 0.1);
  float special_trick2 = 1.0 / (sundir.y * 11.0 + 1.0);
  float raysundt = pow(abs(dot(sundir, raydir)), 2.0);
  float sundt = pow(max(0.0, dot(sundir, raydir)), 8.0);
  float mymie = sundt * special_trick * 0.2;
  vec3 suncolor = mix(vec3(1.0), max(vec3(0.0), vec3(1.0) - vec3(5.5, 13.0, 22.4) / 22.4), special_trick2);
  vec3 bluesky = vec3(5.5, 13.0, 22.4) / 22.4 * suncolor;
  vec3 bluesky2 = max(vec3(0.0), bluesky - vec3(5.5, 13.0, 22.4) * 0.002 * (special_trick + -6.0 * sundir.y * sundir.y));
  bluesky2 *= special_trick * (0.24 + raysundt * 0.24);
  return bluesky2 * (1.0 + 1.0 * pow(1.0 - raydir.y, 3.0));
}

const vec3 SUN = vec3(-0.0773502691896258, 0.28, 0.5773502691896258);

vec3 getAtmosphere(vec3 dir) { return extra_cheap_atmosphere(dir, normalize(SUN)) * 0.5; }
float getSun(vec3 dir) { return pow(max(0.0, dot(dir, normalize(SUN))), 720.0) * 210.0; }

vec3 aces_tonemap(vec3 color) {
  mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * color;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return pow(clamp(m2 * (a / b), 0.0, 1.0), vec3(1.0 / 2.2));
}

// ---- Cloud deck and note lights ----
#define CLOUD_HEIGHT 25.0
#define CLOUD_SCALE 0.035
#define CLOUD_OPACITY 0.85
#define LIGHT_ABSORB 2.5
#define LIGHT_SCATTER 0.9
#define LIGHT_SILVER 2.0
#define LIGHT_GLOW 0.25

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }
  return v;
}

// Sky for a view direction, premultiplied (rgb, alpha). The direction is mapped back to screen coordinates so the lights,
// which the effect places in screen space, line up with the pixels and also appear in reflections.
vec4 skyAt(vec3 dir) {
  float c = cos(uPitch), s = sin(uPitch);
  vec3 cam = vec3(dir.x, c * dir.y + s * dir.z, -s * dir.y + c * dir.z);
  vec2 suv = cam.xy * 1.5 / max(cam.z, 0.05);
  float up = max(dir.y, 0.01);
  vec2 q = dir.xz * (CLOUD_HEIGHT / up) * CLOUD_SCALE + uCloudWind;
  float shape = fbm(q + vec2(fbm(q * 0.7 + 3.1), fbm(q * 0.7 - 1.7)) * 1.2);
  float d = smoothstep(uCloudCover, uCloudCover + 0.3, shape) * smoothstep(0.02, 0.2, dir.y);
  vec3 light = vec3(0.0);
  for (int n = 0; n < 12; n++) {
    vec3 L = uLights[n];
    if (L.z < 0.01) continue;
    vec2 dd = suv - L.xy;
    float r = 0.02 + L.z * 0.06, dd2 = dot(dd, dd), core = exp(-dd2 / (r * r)), halo = exp(-dd2 / (9.0 * r * r));
    light += uLightColors[n] * L.z * (core * exp(-LIGHT_ABSORB * d) * 1.2 + halo * LIGHT_GLOW + halo * d * LIGHT_SCATTER + halo * d * (1.0 - d) * LIGHT_SILVER);
  }
  vec3 rgb = uCloudAmbient * d * CLOUD_OPACITY + light + uFlash * d * 0.6;
  float alpha = clamp(max(d * CLOUD_OPACITY, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 1.0);
  return vec4(min(rgb, vec3(alpha)), alpha);
}

// ---- Underwater lights (our own code) ----
// Each light sits at a 3D point under the sea. The view ray is refracted into the water at the hit point; the light shows by how
// close that refracted ray passes it, dimmed by the water it travels through (red is absorbed fastest) and by the share of light
// that crosses the surface (1 - Fresnel). The refraction follows the moving surface normal, so the glow ripples with the waves.
#define DEEP_RADIUS 0.7
#define DEEP_RADIUS_GROW 1.4
#define DEEP_HALO 0.35
const vec3 DEEP_ABSORB = vec3(0.16, 0.09, 0.06);

vec3 deepLights(vec3 hit, vec3 ray, vec3 N, float fresnel) {
  vec3 refr = refract(ray, N, 1.0 / 1.33);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float level = max(uDeepColors[i].r, max(uDeepColors[i].g, uDeepColors[i].b));
    if (level < 0.01) continue;
    vec3 toLight = uDeepPos[i] - hit;
    float along = max(dot(toLight, refr), 0.0), miss = length(toLight - refr * along), path = length(toLight);
    float r = DEEP_RADIUS + level * DEEP_RADIUS_GROW;
    float glow = exp(-miss * miss / (r * r)) + DEEP_HALO * exp(-miss / (r * 3.0));
    sum += uDeepColors[i] * glow * exp(-DEEP_ABSORB * path);
  }
  return sum * (1.0 - fresnel);
}

float intersectPlane(vec3 origin, vec3 direction, vec3 point, vec3 normal) {
  return clamp(dot(point - origin, normal) / dot(direction, normal), -1.0, 9991999.0);
}

void main() {
  vec2 uv = ((gl_FragCoord.xy / iResolution.xy) * 2.0 - 1.0) * vec2(iResolution.x / iResolution.y, 1.0);
  vec3 ray = normalize(vec3(uv.x, uv.y, 1.5));
  float c = cos(uPitch), s = sin(uPitch);
  ray = vec3(ray.x, c * ray.y - s * ray.z, s * ray.y + c * ray.z);
  if (ray.y >= -0.001) { fragColor = skyAt(ray); return; }

  vec3 origin = vec3(0.0, CAMERA_HEIGHT, 0.0);
  float highPlaneHit = intersectPlane(origin, ray, vec3(0.0, uAmp * (1.0 - WAVE_MEAN) * uSlab, 0.0), vec3(0.0, 1.0, 0.0));
  float lowPlaneHit = intersectPlane(origin, ray, vec3(0.0, -uAmp * WAVE_MEAN * uSlab, 0.0), vec3(0.0, 1.0, 0.0));
  vec3 highHitPos = origin + ray * highPlaneHit;
  vec3 lowHitPos = origin + ray * lowPlaneHit;
  float dist = raymarchwater(origin, highHitPos, lowHitPos, uAmp);
  vec3 waterHitPos = origin + ray * dist;

  vec3 N = normal(waterHitPos.xz, 0.01, uAmp);
  N = mix(N, vec3(0.0, 1.0, 0.0), 0.8 * min(1.0, sqrt(dist * 0.01) * 1.1));
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(-N, ray)), 5.0);
  vec3 R = normalize(reflect(ray, N));
  R.y = abs(R.y);

  vec3 reflection = (getAtmosphere(R) + getSun(R)) * uSky + uFlash;
  // The note lights and their clouds, mirrored in the water. A small floor under the Fresnel term lets them also show on the
  // steeper water near the camera, so lights highlight the sea without lifting its overall brightness.
  vec3 skyLight = skyAt(R).rgb * uLightSea;
  float crest = 0.2 + (waterHitPos.y + uAmp * WAVE_MEAN) / max(uAmp, 0.05);
  vec3 scattering = (vec3(0.0293, 0.0698, 0.1717) * 0.1 + uTint) * crest;
  vec3 deep = deepLights(waterHitPos, ray, N, fresnel);
  vec3 color = aces_tonemap((fresnel * reflection + scattering + skyLight * (fresnel + 0.12) + deep) * 2.0);
  float alpha = 1.0 - smoothstep(uFade * 0.25, uFade, dist);
  fragColor = vec4(color * alpha, alpha);
}`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { console.error("ocean shader:", gl.getShaderInfoLog(shader)); return null; }
    return shader;
  }

  function create() {
    const canvas = new OffscreenCanvas(1, 1), gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX), fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return null;
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { console.error("ocean program:", gl.getProgramInfoLog(program)); return null; }
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = Object.fromEntries(["iResolution", "uGain", "uPhase", "uSlab", "uAmp", "uDrag", "uPitch", "uSky", "uFade", "uTint", "uFlash", "uLights", "uLightColors", "uCloudWind", "uCloudCover", "uCloudAmbient", "uLightSea", "uDeepPos", "uDeepColors"].map((name) => [name, gl.getUniformLocation(program, name)]));
    return {
      canvas,
      // p: { gains: [5], phases: [5] (bands kick, bass, vocals, other, hats), amp, drag, pitch, sky, fade, tint: [r,g,b], flash: [r,g,b],
      //    lights: 12 x (screen x, screen y, level) in shader uv units, lightColors: 12 x rgb, cloudWind: [x, y], cloudCover, cloudAmbient: rgb, lightSea,
      //    deepPositions: 5 x world xyz (y < 0 is under the sea), deepColors: 5 x rgb already scaled by level }
      render(width, height, p) {
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height); }
        gl.uniform2f(uniform.iResolution, width, height); gl.uniform1fv(uniform.uGain, p.gains); gl.uniform1fv(uniform.uPhase, p.phases); gl.uniform1f(uniform.uSlab, 1 + Math.max(...p.gains)); gl.uniform1f(uniform.uAmp, p.amp); gl.uniform1f(uniform.uDrag, p.drag);
        gl.uniform1f(uniform.uPitch, p.pitch); gl.uniform1f(uniform.uSky, p.sky); gl.uniform1f(uniform.uFade, p.fade); gl.uniform3fv(uniform.uTint, p.tint); gl.uniform3fv(uniform.uFlash, p.flash);
        gl.uniform3fv(uniform.uLights, p.lights); gl.uniform3fv(uniform.uLightColors, p.lightColors); gl.uniform2fv(uniform.uCloudWind, p.cloudWind); gl.uniform1f(uniform.uCloudCover, p.cloudCover); gl.uniform3fv(uniform.uCloudAmbient, p.cloudAmbient); gl.uniform1f(uniform.uLightSea, p.lightSea); gl.uniform3fv(uniform.uDeepPos, p.deepPositions); gl.uniform3fv(uniform.uDeepColors, p.deepColors);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 6);
        return canvas;
      },
      dispose() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
    };
  }
  window.AudioOceanGL = { create };
})();
