/**
 * The storm outside the desk scene's window: a cloudy sky that follows the visitor's local
 * time (night, dawn, a grey day, dusk), rain in two layers, and lightning now and then, which
 * lights up the clouds and flashes through the window into the room (the Moon_Key light).
 *
 * Everything is in world metres, behind the back wall (z < -0.75), so it only shows through the
 * window. Under reduced motion it is a still, rainy sky with no lightning.
 */
import * as THREE from 'three';

export interface Weather {
  /** Every frame, before rendering: `seconds` since the scene started. */
  update(seconds: number): void;
  dispose(): void;
}

/** Sky colours and light for one time of day (linear RGB). */
interface Palette {
  zenith: THREE.Color;
  horizon: THREE.Color;
  cloudDark: THREE.Color;
  cloudLit: THREE.Color;
  /** How much moon shows (0 by day). */
  moon: number;
  /** The light through the window, relative to the scene's moonlight. */
  light: number;
  lightTint: THREE.Color;
  /** Daylight filling the room. */
  ambient: number;
  rain: THREE.Color;
}

const c = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

const NIGHT: Palette = {
  zenith: c(0.004, 0.006, 0.016),
  horizon: c(0.02, 0.026, 0.06),
  cloudDark: c(0.004, 0.005, 0.01),
  cloudLit: c(0.05, 0.06, 0.1),
  moon: 1,
  light: 1,
  lightTint: c(1, 1, 1),
  ambient: 0,
  rain: c(0.22, 0.28, 0.4),
};
const DAWN: Palette = {
  zenith: c(0.03, 0.03, 0.07),
  horizon: c(0.36, 0.13, 0.08),
  cloudDark: c(0.04, 0.035, 0.05),
  cloudLit: c(0.24, 0.12, 0.12),
  moon: 0.25,
  light: 1.3,
  lightTint: c(1.25, 0.85, 0.7),
  ambient: 0.05,
  rain: c(0.4, 0.33, 0.35),
};
const DAY: Palette = {
  zenith: c(0.16, 0.18, 0.2),
  horizon: c(0.3, 0.32, 0.34),
  cloudDark: c(0.035, 0.04, 0.05),
  cloudLit: c(0.14, 0.155, 0.18),
  moon: 0,
  light: 1.6,
  lightTint: c(0.85, 0.92, 1.05),
  ambient: 0.12,
  rain: c(0.45, 0.5, 0.56),
};
const DUSK: Palette = {
  zenith: c(0.04, 0.03, 0.08),
  horizon: c(0.45, 0.14, 0.1),
  cloudDark: c(0.05, 0.03, 0.05),
  cloudLit: c(0.34, 0.12, 0.14),
  moon: 0.2,
  light: 1.4,
  lightTint: c(1.3, 0.8, 0.75),
  ambient: 0.06,
  rain: c(0.42, 0.32, 0.36),
};

/** Hour of the day (local, 0–24) → palette, blended between these keys. */
const KEYS: [number, Palette][] = [
  [0, NIGHT],
  [4.75, NIGHT],
  [6, DAWN],
  [7.5, DAY],
  [17.5, DAY],
  [19, DUSK],
  [20.5, NIGHT],
  [24, NIGHT],
];

function paletteAt(hour: number, out: Palette): Palette {
  let i = 0;
  while (i < KEYS.length - 2 && hour >= KEYS[i + 1]![0]) i++;
  const [h0, a] = KEYS[i]!;
  const [h1, b] = KEYS[i + 1]!;
  const t = THREE.MathUtils.clamp((hour - h0) / (h1 - h0), 0, 1);
  const k = t * t * (3 - 2 * t);
  for (const key of ['zenith', 'horizon', 'cloudDark', 'cloudLit', 'lightTint', 'rain'] as const) out[key].copy(a[key]).lerp(b[key], k);
  out.moon = THREE.MathUtils.lerp(a.moon, b.moon, k);
  out.light = THREE.MathUtils.lerp(a.light, b.light, k);
  out.ambient = THREE.MathUtils.lerp(a.ambient, b.ambient, k);
  return out;
}

/** The visitor's local time as an hour of the day. `?skyHour=13.5` overrides it (for a look). */
function localHour(): number {
  const forced = Number.parseFloat(new URLSearchParams(window.location.search).get('skyHour') ?? '');
  if (Number.isFinite(forced)) return ((forced % 24) + 24) % 24;
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

// The sky: a big plane far behind the window, so it fills the view through it from anywhere.
const SKY = { x: 3.2, y: 1.8, z: -2.6, w: 10, h: 7 };
/** Where the moon hangs: in view through the window from the wide shot and the close-up. */
const MOON_AT = new THREE.Vector2(3.3, 2.05);

const NOISE = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
`;

const WORLD_VERTEX = /* glsl */ `
  varying vec2 vXY;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vXY = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uFlash;
  uniform float uFlashX;
  uniform float uMoon;
  uniform vec2 uMoonAt;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uCloudDark;
  uniform vec3 uCloudLit;
  varying vec2 vXY;
  ${NOISE}
  void main() {
    vec2 p = vXY;
    float h = clamp((p.y - 0.6) / 3.4, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, h));

    // two cloud layers drifting with the wind, the lower one faster
    vec2 q = p * 1.1 + vec2(uTime * 0.06, 0.0);
    float c1 = fbm(q + fbm(q * 0.7 + uTime * 0.02));
    float c2 = fbm(p * 2.4 + vec2(uTime * 0.13, uTime * 0.015));
    float density = smoothstep(0.38, 0.66, c1 * 0.75 + c2 * 0.35);

    // the moon, behind the clouds
    float d = length(p - uMoonAt);
    vec3 moon = vec3(0.9, 0.95, 1.0) * uMoon;
    sky += moon * (smoothstep(0.17, 0.155, d) * 1.5 + exp(-d * 3.0) * 0.3) * (1.0 - density * 0.93);

    vec3 cloud = mix(uCloudDark, uCloudLit, smoothstep(0.35, 0.85, c2) * (1.0 - h * 0.4));
    cloud += moon * exp(-d * 1.6) * 0.05;
    vec3 col = mix(sky, cloud, density);

    // lightning: the clouds light up from inside, most around the strike
    float glow = exp(-abs(p.x - uFlashX) * 0.8);
    col += uFlash * vec3(0.5, 0.56, 0.75) * (0.2 + 0.8 * glow) * (0.35 + density);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uFlash;
  uniform float uAlpha;
  uniform float uScale;
  uniform float uSpeed;
  uniform vec3 uColor;
  varying vec2 vXY;
  float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  void main() {
    vec2 p = vXY * uScale;
    p.x += p.y * 0.24; // the wind slants it
    float column = floor(p.x * 36.0);
    float across = fract(p.x * 36.0) - 0.5;
    float r = hash1(column);
    float along = fract((p.y + uTime * uSpeed * (0.8 + r * 0.5)) * 0.8 + r * 7.0);
    float streak = smoothstep(0.0, 0.04, along) * smoothstep(0.2, 0.08, along);
    float line = smoothstep(0.14, 0.0, abs(across));
    float a = streak * line * step(0.35, hash1(column + 3.7)) * uAlpha * (1.0 + uFlash * 2.5);
    gl_FragColor = vec4(uColor * (1.0 + uFlash * 2.0), a);
  }
`;

export function createWeather(scene: THREE.Scene, options: { reducedMotion: boolean; windowLight?: THREE.Light | null }): Weather {
  const reduced = options.reducedMotion;
  const palette = paletteAt(localHour(), {
    ...NIGHT,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    cloudDark: new THREE.Color(),
    cloudLit: new THREE.Color(),
    lightTint: new THREE.Color(),
    rain: new THREE.Color(),
  });
  const group = new THREE.Group();
  group.name = 'Weather';
  scene.add(group);

  // sky
  const skyUniforms = {
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashX: { value: SKY.x },
    uMoon: { value: palette.moon },
    uMoonAt: { value: MOON_AT },
    uZenith: { value: palette.zenith },
    uHorizon: { value: palette.horizon },
    uCloudDark: { value: palette.cloudDark },
    uCloudLit: { value: palette.cloudLit },
  };
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(SKY.w, SKY.h),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: WORLD_VERTEX, fragmentShader: SKY_FRAGMENT, depthWrite: false }),
  );
  sky.position.set(SKY.x, SKY.y, SKY.z);
  sky.renderOrder = -2;
  group.add(sky);

  // rain: a near layer just outside the window and a finer, fainter one further out
  const rains = [
    { z: -1.05, scale: 1, speed: 3.2, alpha: 0.55 },
    { z: -1.8, scale: 1.7, speed: 4.4, alpha: 0.35 },
  ].map(({ z, scale, speed, alpha }) => {
    const uniforms = {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uAlpha: { value: alpha },
      uScale: { value: scale },
      uSpeed: { value: speed },
      uColor: { value: palette.rain },
    };
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SKY.w * 0.7, SKY.h * 0.8),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: WORLD_VERTEX,
        fragmentShader: RAIN_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.position.set(SKY.x - 0.4, SKY.y, z);
    mesh.renderOrder = -1;
    group.add(mesh);
    return uniforms;
  });

  // a lightning bolt, rebuilt for each strike that shows one
  const boltMaterial = new THREE.MeshBasicMaterial({
    color: c(5, 5.6, 8),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const bolt = new THREE.Mesh(new THREE.BufferGeometry(), boltMaterial);
  bolt.visible = false;
  bolt.renderOrder = -1;
  group.add(bolt);

  // the light through the window, and daylight in the room
  const windowLight = options.windowLight ?? null;
  const baseIntensity = windowLight?.intensity ?? 0;
  const baseColor = windowLight?.color.clone() ?? new THREE.Color(1, 1, 1);
  const flashTint = c(0.75, 0.85, 1.2);
  const ambient = new THREE.AmbientLight(0xb8c4dc, 0);
  group.add(ambient);

  // lightning timeline: a strike is one to three quick pulses
  let nextStrike = 2.5 + Math.random() * 4;
  let pulses: { at: number; amp: number }[] = [];
  let boltUntil = 0;
  let lastHourCheck = -Infinity;

  const strike = (t: number) => {
    const x = 1.8 + Math.random() * 3.6;
    skyUniforms.uFlashX.value = x;
    const count = 1 + Math.floor(Math.random() * 3);
    pulses = Array.from({ length: count }, (_, i) => ({
      at: t + i * (0.07 + Math.random() * 0.12),
      amp: i === 0 ? 0.7 + Math.random() * 0.3 : 0.4 + Math.random() * 0.5,
    }));
    if (Math.random() < 0.6) {
      bolt.geometry.dispose();
      bolt.geometry = boltGeometry(x);
      boltUntil = pulses[pulses.length - 1]!.at + 0.18;
    }
    nextStrike = t + 4 + Math.random() * 11;
  };

  return {
    update(seconds) {
      const t = reduced ? 0 : seconds;
      // the time of day moves slowly: look at the clock twice a minute
      if (seconds - lastHourCheck > 30) {
        lastHourCheck = seconds;
        paletteAt(localHour(), palette);
        skyUniforms.uMoon.value = palette.moon;
      }

      let flash = 0;
      if (!reduced) {
        if (seconds >= nextStrike) strike(seconds);
        for (const p of pulses) if (seconds >= p.at) flash += p.amp * Math.exp(-(seconds - p.at) * 11);
        flash = Math.min(1.2, flash);
      }
      skyUniforms.uTime.value = t;
      skyUniforms.uFlash.value = flash;
      for (const rain of rains) {
        rain.uTime.value = t;
        rain.uFlash.value = flash;
      }
      bolt.visible = seconds < boltUntil;
      boltMaterial.opacity = bolt.visible ? Math.min(1, flash * 1.4) : 0;

      if (windowLight) {
        windowLight.intensity = baseIntensity * (palette.light + flash * 5);
        windowLight.color.copy(baseColor).multiply(palette.lightTint).lerp(flashTint, Math.min(1, flash));
      }
      ambient.intensity = palette.ambient + flash * 0.22;
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      group.removeFromParent();
      if (windowLight) {
        windowLight.intensity = baseIntensity;
        windowLight.color.copy(baseColor);
      }
    },
  };
}

/** A jagged bolt from the clouds toward the horizon at `x`, with one fork, as a flat ribbon. */
function boltGeometry(x: number): THREE.BufferGeometry {
  const z = SKY.z + 0.05;
  const jag = (a: THREE.Vector2, b: THREE.Vector2, spread: number, depth: number): THREE.Vector2[] => {
    if (depth === 0) return [a, b];
    const mid = a.clone().lerp(b, 0.5);
    mid.x += (Math.random() - 0.5) * spread;
    return [...jag(a, mid, spread * 0.55, depth - 1).slice(0, -1), ...jag(mid, b, spread * 0.55, depth - 1)];
  };
  const top = new THREE.Vector2(x, 3.6);
  const bottom = new THREE.Vector2(x + (Math.random() - 0.5) * 1.2, 0.9 + Math.random() * 0.4);
  const main = jag(top, bottom, 0.9, 6);
  const from = main[Math.floor(main.length * (0.3 + Math.random() * 0.25))]!;
  const fork = jag(from, new THREE.Vector2(from.x + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6), from.y - 0.8), 0.5, 4);

  const positions: number[] = [];
  const ribbon = (points: THREE.Vector2[], width: number) => {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const n = new THREE.Vector2(-(b.y - a.y), b.x - a.x).normalize().multiplyScalar(width / 2);
      positions.push(a.x - n.x, a.y - n.y, z, a.x + n.x, a.y + n.y, z, b.x + n.x, b.y + n.y, z);
      positions.push(a.x - n.x, a.y - n.y, z, b.x + n.x, b.y + n.y, z, b.x - n.x, b.y - n.y, z);
    }
  };
  ribbon(main, 0.035);
  ribbon(fork, 0.02);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
