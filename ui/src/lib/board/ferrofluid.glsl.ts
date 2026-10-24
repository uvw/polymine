/** Shaders for the ferrofluid board effect, in GLSL ES 3.0. */

/** A unit quad scaled to the host; `vUV` runs 0 to 1 across it. */
export const FERROFLUID_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

/**
 * Reads the field as a height map and lights it. The red channel is how full
 * of fluid each point is, blurred so cells become domes. Green holds the seeds
 * of flag spikes, and blue the seeds of cell spikes, which rise toward the
 * magnet and lean into it. Everything is in CSS pixels.
 */
export const FERROFLUID_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uField;
uniform vec2 uSize;
uniform vec2 uPan;
uniform vec2 uMagnet;
// The magnet's velocity in pixels a second, which spikes trail.
uniform vec2 uMagnetVelocity;
// The perspective camera's distance from the board, in pixels, for shading.
uniform float uFocal;
// One device pixel in CSS pixels, for spreading the edges' samples.
uniform float uPixel;
uniform float uPull;
uniform float uSpacing;
uniform float uReach;
uniform float uDome;
uniform float uSpike;
uniform float uFlagHeight;
// A blurred seed's value at its cell's center, and 1 when the board has a flag.
uniform float uSeedPeak;
uniform float uHasFlags;
// The game's end, all around uCenter: up to four rings, each radius negative
// for none, with their heights; how strongly the first one reflects off the
// board's edges, uBounds; the crater's depth and width; the crown's radius and
// height; the jet's height and radius; and the falling droplet's height and
// radius, 0 once it has landed.
uniform vec2 uCenter;
uniform vec4 uRings;
uniform vec4 uRingHeights;
uniform float uWavelength;
uniform float uReflect;
uniform vec4 uBounds;
uniform vec2 uCrater;
uniform vec2 uCrown;
uniform vec2 uJet;
uniform vec2 uDrop;
// Spikes raised everywhere at once, apart from the magnet, as a loss throws them up.
uniform float uSurge;
uniform vec3 uLight;
uniform vec3 uFluid;
uniform vec3 uGloss;
uniform vec3 uRim;
uniform vec3 uTip;

// The field and its slope along x and y, per CSS pixel.
struct Field {
  vec4 value;
  vec4 dx;
  vec4 dy;
};

vec4 bspline(float t) {
  float s = 1.0 - t;
  return vec4(s * s * s, 3.0 * t * t * t - 6.0 * t * t + 4.0,
              -3.0 * t * t * t + 3.0 * t * t + 3.0 * t + 1.0, t * t * t) / 6.0;
}

vec4 bsplineSlope(float t) {
  float s = 1.0 - t;
  return vec4(-s * s, 3.0 * t * t - 4.0 * t, -3.0 * t * t + 2.0 * t + 1.0, t * t) / 2.0;
}

// A cubic B-spline over the 4 by 4 texels around px, weighed in full float.
// Hardware filtering weighs texels with about 8 bits, which steps the slope
// of a magnified field into a grid of facets.
Field fieldAt(vec2 px) {
  vec2 size = vec2(textureSize(uField, 0));
  vec2 scale = size / uSize;
  vec2 p = px * scale - 0.5;
  vec2 base = floor(p);
  vec2 t = p - base;
  vec4 wx = bspline(t.x);
  vec4 wy = bspline(t.y);
  vec4 sx = bsplineSlope(t.x);
  vec4 sy = bsplineSlope(t.y);
  ivec2 last = ivec2(size) - 1;
  Field f = Field(vec4(0.0), vec4(0.0), vec4(0.0));
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec4 texel = texelFetch(uField, clamp(ivec2(base) + ivec2(i - 1, j - 1), ivec2(0), last), 0);
      f.value += wx[i] * wy[j] * texel;
      f.dx += sx[i] * wy[j] * texel;
      f.dy += wx[i] * sy[j] * texel;
    }
  }
  f.dx *= scale.x;
  f.dy *= scale.y;
  return f;
}

// smoothstep and its slope.
vec2 ease(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return vec2(t * t * (3.0 - 2.0 * t), 6.0 * t * (1.0 - t) / (edge1 - edge0));
}

// The field between its four nearest texels, weighed in full float: the
// spikes' high powers would turn hardware filtering's coarse weights into steps.
vec4 bilinear(vec2 px) {
  vec2 size = vec2(textureSize(uField, 0));
  vec2 p = px * size / uSize - 0.5;
  vec2 base = floor(p);
  vec2 t = p - base;
  ivec2 c = ivec2(base);
  ivec2 last = ivec2(size) - 1;
  vec4 a = texelFetch(uField, clamp(c, ivec2(0), last), 0);
  vec4 b = texelFetch(uField, clamp(c + ivec2(1, 0), ivec2(0), last), 0);
  vec4 d = texelFetch(uField, clamp(c + ivec2(0, 1), ivec2(0), last), 0);
  vec4 e = texelFetch(uField, clamp(c + ivec2(1, 1), ivec2(0), last), 0);
  return mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
}

// How much of a rectangular light, a half-size wide and high in units of the
// distance to it, the reflected ray r sees in direction dir.
float softbox(vec3 r, vec3 dir, vec2 halfSize) {
  float facing = dot(r, dir);
  if (facing <= 0.0) return 0.0;
  vec3 side = normalize(cross(dir, vec3(0.0, 0.0, 1.0)) + vec3(1e-5, 0.0, 0.0));
  vec3 up = cross(side, dir);
  vec2 w = abs(vec2(dot(r, side), dot(r, up)) / facing);
  return (1.0 - smoothstep(0.8 * halfSize.x, halfSize.x, w.x))
    * (1.0 - smoothstep(0.6 * halfSize.y, halfSize.y, w.y));
}

// The camera looks down with a slight tilt toward the bottom of the screen, so
// a raised point shows this many pixels up the screen per pixel of height.
const float TILT = 0.45;

// A ring's profile d pixels from its crest: a crest with a trough each side.
float wave(float d) {
  return cos(6.2831853 * d / uWavelength) * exp(-d * d / (uWavelength * uWavelength));
}

float ringsAt(vec2 px) {
  float h = 0.0;
  float d = length(px - uCenter);
  for (int i = 0; i < 4; i++) {
    if (uRings[i] >= 0.0) h += uRingHeights[i] * wave(d - uRings[i]);
  }
  if (uReflect > 0.0 && uRings.x >= 0.0) {
    // The edges reflect the ring as if it came from the center's mirror images.
    vec2 c = uCenter;
    h += uReflect * uRingHeights.x * (
      wave(length(px - vec2(2.0 * uBounds.x - c.x, c.y)) - uRings.x) +
      wave(length(px - vec2(2.0 * uBounds.z - c.x, c.y)) - uRings.x) +
      wave(length(px - vec2(c.x, 2.0 * uBounds.y - c.y)) - uRings.x) +
      wave(length(px - vec2(c.x, 2.0 * uBounds.w - c.y)) - uRings.x));
  }
  return h;
}

// The win's splash where the droplet landed: a crater, the crown of spikes
// around it, and the jet that rises from it.
const float CROWN_SPIKES = 14.0;

float splashAt(vec2 px) {
  vec2 d = px - uCenter;
  float r = length(d);
  float h = -uCrater.x * exp(-r * r / (uCrater.y * uCrater.y));
  if (uCrown.y > 0.0) {
    float sector = 6.2831853 / CROWN_SPIKES;
    float a = floor(atan(d.y, d.x) / sector + 0.5) * sector;
    vec2 tip = uCenter + uCrown.x * vec2(cos(a), sin(a));
    float c = clamp(1.0 - length(px - tip) / (uSpacing * 0.42), 0.0, 1.0);
    float rim = (r - uCrown.x) / (uSpacing * 0.55);
    h += uCrown.y * (pow(c * c * (3.0 - 2.0 * c), 1.3) + 0.3 * exp(-rim * rim));
  }
  if (uJet.x > 0.0) {
    float c = clamp(1.0 - r / uJet.y, 0.0, 1.0);
    h += uJet.x * c * c * (3.0 - 2.0 * c);
  }
  return h;
}

// Whether a point z above px lies inside the falling droplet.
bool inDrop(vec2 px, float z) {
  return uDrop.y > 0.0 && length(vec3(px - uCenter, z - uDrop.x)) < uDrop.y;
}

// A closed cell's spike under the magnet, from the seed at its center in the
// field's blue channel: a power of the blurred seed peaks at the center. The
// spike's height follows the magnet's pull at its foot, so cells far from the
// magnet stay flat.
const float CELL_POWER = 9.0;

float cellSpike(vec2 foot, vec4 here) {
  vec2 toMagnet = uMagnet - foot;
  float pull = max(uPull * exp(-dot(toMagnet, toMagnet) / (2.0 * uReach * uReach)), uSurge)
    * smoothstep(0.3, 0.75, here.r);
  if (pull < 0.01) return 0.0;
  // A weak pull leaves the fluid calm rather than dimpled.
  return pull * smoothstep(0.01, 0.08, pull) * uSpike * pow(clamp(here.b / uSeedPeak, 0.0, 1.0), CELL_POWER);
}

// How far a spike leans per unit of its height: toward the magnet, more the
// farther out it stands and upright right under it, and against the magnet's
// motion, so needles trail a fast pointer and swing back once it stops.
const float LEAN = 0.95;
const float WHIP = 0.0014;
const float MOST_LEAN = 1.4;

vec2 shearAt(vec2 px) {
  vec2 toMagnet = uMagnet - px;
  float d = length(toMagnet);
  vec2 toward = d > 1.0 ? toMagnet / d : vec2(0.0);
  vec2 shear = toward * LEAN * smoothstep(0.0, 1.6 * uReach, d) - uMagnetVelocity * WHIP;
  float k = length(shear);
  return k > MOST_LEAN ? shear * (MOST_LEAN / k) : shear;
}

// A flag's spike from its blurred seed: the seed is a Gaussian around the
// flag's center, so a high power of it is a narrow spire there.
const float FLAG_POWER = 10.0;

float flagSpike(float seed) {
  return uFlagHeight * pow(clamp(seed / uSeedPeak, 0.0, 1.0), FLAG_POWER);
}

// Everything standing on the surface but the cells' spikes, where the field reads here.
float restAt(vec2 px, vec4 here) {
  return ringsAt(px) * smoothstep(0.1, 0.3, here.r) + splashAt(px) + flagSpike(here.g);
}

// How high the surface stands at px, as a ray z high sees it: a leaning
// spike's point that high stands z times the shear from its foot. Rough
// lookups are enough to find where a ray goes in.
float roughHeight(vec2 px, float z) {
  vec2 foot = px - shearAt(px) * z;
  return cellSpike(foot, bilinear(foot)) + restAt(px, bilinear(px));
}

// The same, finely, for shading.
float fineSpike(vec2 foot) {
  return cellSpike(foot, fieldAt(foot).value);
}

float fineRest(vec2 px) {
  return restAt(px, fieldAt(px).value);
}

// The fluid's color at a point, premultiplied, and whether a ray hit something standing there.
vec4 shade(vec2 px, out float solid) {
  solid = 0.0;
  Field f = fieldAt(px);
  float depth = f.value.r;

  // The ray from the tilted camera through this pixel meets the ground at
  // px and is z high at px + (0, z * TILT). March it down from the tallest
  // anything can be and stop at the first point inside the surface or the
  // falling droplet.
  vec2 q = px;
  float qz = 0.0;
  bool hit = false;
  float top = max(max(uSpike * min(max(uPull, uSurge), 1.5), uHasFlags * uFlagHeight),
                  max(uDrop.x + uDrop.y, 1.3 * uCrown.y + uJet.x));
  if (top > 0.5) {
    float above = top;
    for (int i = 1; i <= 32; i++) {
      float z = top * (1.0 - float(i) / 32.0);
      vec2 at = vec2(px.x, px.y + z * TILT);
      if ((roughHeight(at, z) >= z && z > 0.25) || inDrop(at, z)) {
        // The ray went in between this step and the last one above it; halve
        // that span a few times to find where.
        float lo = z;
        float hi = above;
        for (int j = 0; j < 5; j++) {
          float mid = 0.5 * (lo + hi);
          vec2 m = vec2(px.x, px.y + mid * TILT);
          if (roughHeight(m, mid) >= mid || inDrop(m, mid)) lo = mid;
          else hi = mid;
        }
        qz = 0.5 * (lo + hi);
        q = vec2(px.x, px.y + qz * TILT);
        hit = true;
        break;
      }
      above = z;
    }
  }
  bool onDrop = hit && inDrop(q, qz - 0.5);

  // The droplet's shadow lies under it, softer and fainter the higher it is.
  float shadow = 0.0;
  if (uDrop.y > 0.0) {
    float spread = uDrop.y * (1.0 + uDrop.x / (5.0 * uDrop.y));
    float r = length(px - uCenter) / spread;
    shadow = 0.8 * exp(-r * r) * exp(-(uDrop.x - uDrop.y) / (10.0 * uDrop.y));
  }

  // A spike may stand out past the fluid's edge; everything else ends with the fluid.
  float alpha = hit ? 1.0 : smoothstep(0.05, 0.16, depth);
  if (alpha <= 0.0) {
    return vec4(0.0, 0.0, 0.0, 0.6 * shadow);
  }
  vec2 dx = vec2(1.0, 0.0);
  vec2 dy = vec2(0.0, 1.0);
  // Calm fluid lies flat; only its edge, where it meets a drained cell,
  // rounds down like a meniscus.
  // WebGL allows no ternary on a struct.
  Field ground = f;
  if (hit) ground = fieldAt(q);
  float edge = ease(0.04, 0.2, ground.value.r).y * uDome;
  vec2 slope = onDrop ? vec2(0.0) : edge * vec2(ground.dx.r, ground.dy.r);
  float lift = 1.0;
  float flag = 0.0;
  if (hit) {
    // A leaning spike's surface: its slope at the foot of the point hit, and a
    // normal tipped by the shear, since height there runs along the lean.
    vec2 shear = shearAt(q);
    vec2 foot = q - shear * qz;
    vec2 spike = 0.5 * vec2(fineSpike(foot + dx) - fineSpike(foot - dx), fineSpike(foot + dy) - fineSpike(foot - dy));
    slope += spike + 0.5 * vec2(fineRest(q + dx) - fineRest(q - dx), fineRest(q + dy) - fineRest(q - dy));
    lift += dot(spike, shear);
    if (!onDrop) flag = flagSpike(ground.value.g) / uFlagHeight;
  } else {
    slope += 0.5 * vec2(roughHeight(px + dx, 0.0) - roughHeight(px - dx, 0.0),
                        roughHeight(px + dy, 0.0) - roughHeight(px - dy, 0.0));
  }
  vec3 n = onDrop ? normalize(vec3(q - uCenter, qz - uDrop.x)) : normalize(vec3(-slope, lift));
  // The march looks along one direction, but shading takes a camera over the
  // middle of the board, so flat fluid mirrors a different part of the room
  // at each point.
  vec2 offset = (0.5 * uSize - px) / uFocal;
  vec3 view = normalize(vec3(offset.x, TILT + offset.y, 1.0));
  vec3 light = normalize(uLight);
  float nh = max(dot(n, normalize(light + view)), 0.0);
  float specular = pow(nh, 220.0) * 1.2;

  // The fluid is a black mirror, so its look is what it reflects: a dark
  // room with a softbox where the light is, a wide strip low behind the
  // camera that lays a line across the front of every spike and dome, and a
  // faint horizon in the rim color. Steep flanks reflect the black pool.
  vec3 r = reflect(-view, n);
  float key = softbox(r, light, vec2(0.26, 0.15));
  float strip = softbox(r, normalize(vec3(0.0, 1.0, 0.28)), vec2(1.1, 0.05));
  // A large window high up toward the light, which the calm fluid mirrors.
  float window = softbox(r, normalize(vec3(0.3 * normalize(light.xy), 1.0)), vec2(0.12, 0.07));
  // A spike's steep flank would only mirror the black pool, so the flank on the
  // light's side gets an edge light of its own: a streak down every spike. The
  // camera sees spikes from the front, so the light comes from straight across.
  vec2 across = vec2(light.x < 0.0 ? -1.0 : 1.0, 0.0);
  float flank = hit && !onDrop
    ? pow(max(dot(normalize(n.xy + 1e-5), across), 0.0), 3.0) * smoothstep(0.25, 0.75, 1.0 - n.z)
    : 0.0;
  float horizon = exp(-r.z * r.z * 14.0) * (r.z < 0.0 ? 0.35 : 1.0);
  float rim = pow(1.0 - max(dot(n, view), 0.0), 4.0);
  float occlusion = hit ? 1.0 : mix(0.3, 1.0, smoothstep(0.05, 0.2, depth));

  occlusion *= onDrop ? 1.0 : 1.0 - 0.7 * shadow;
  vec3 color = uFluid * occlusion;
  color += uGloss * (specular + 0.9 * key + 0.5 * strip + 1.1 * flank + 0.07 * window) * occlusion;
  color += uRim * (0.08 * horizon + 0.25 * rim) * occlusion;
  // A flag's spike glows in the flag's color, dim at its foot and white-hot
  // at its tip, with a rim of that color. Its light pools on the fluid around
  // its foot, so even a short spike shows from across the board.
  float spike = smoothstep(0.02, 0.12, flag);
  vec3 hot = mix(uTip, vec3(1.0), 0.55 * pow(flag, 8.0));
  color = mix(color, color * 0.4, spike);
  color += hot * spike * (0.22 + 0.5 * pow(flag, 2.0) + 1.3 * pow(flag, 7.0));
  color += uTip * spike * rim * 1.6;
  float near = clamp(f.value.g / uSeedPeak, 0.0, 1.0);
  color += uTip * 0.32 * pow(near, 1.5) * (1.0 - spike);
  solid = hit ? 1.0 : 0.0;
  return vec4(color * alpha, alpha);
}

// Pixels where a spike's outline or a sharp highlight crosses their 2 by 2
// group are shaded again at four points of a rotated grid and averaged, so
// edges are smooth while flat fluid costs one sample.
const float SHARP = 0.12;

void main() {
  vec2 px = vUV * uSize;
  float solid;
  vec4 color = shade(px, solid);
  float luma = dot(color.rgb, vec3(0.3, 0.6, 0.1));
  if (fwidth(solid) > 0.0 || fwidth(luma) > SHARP || fwidth(color.a) > 0.25) {
    float ignored;
    vec2 a = vec2(0.125, 0.375) * uPixel;
    vec2 b = vec2(0.375, -0.125) * uPixel;
    color = 0.25 * (shade(px + a, ignored) + shade(px - a, ignored)
                  + shade(px + b, ignored) + shade(px - b, ignored));
  }
  fragColor = color;
}
`;

/** One direction of a Gaussian blur with a sigma of six texels: 37 taps, \`uStep\` apart in UV. */
export const BLUR_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uStep;

void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -18; i <= 18; i++) {
    float x = float(i);
    float w = exp(-0.5 * x * x / 36.0);
    sum += texture(uSource, vUV + uStep * x) * w;
    total += w;
  }
  fragColor = sum / total;
}
`;
