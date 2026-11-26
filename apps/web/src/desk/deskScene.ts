/**
 * The desk scene behind the site: the Blender room (public/scene/desk.glb, exported by
 * scripts/blender/export_desk_scene.py) rendered with Three.js, and a camera that moves between
 * a wide shot of the room and a close-up where the CRT fills the window.
 *
 * The page itself is not drawn in WebGL: the shell lays the live site over the CRT glass, using
 * the screen corners this module reports every frame (`onScreen`).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { createWeather } from './weather';

export type DeskView = 'screen' | 'room';

/** The CRT glass on the page, in CSS pixels: top-left, top-right, bottom-right, bottom-left. */
export type ScreenQuad = readonly [x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number];

export interface DeskSceneOptions {
  assetsUrl?: string;
  /** Skip the camera moves and the pointer drift. */
  reducedMotion?: boolean;
  onProgress?: (fraction: number) => void;
  /** Every rendered frame: where the glass is now. */
  onScreen?: (quad: ScreenQuad) => void;
  /** The glass's size in CSS pixels in the close-up (the size the site is laid out at). */
  onLayout?: (width: number, height: number) => void;
  /** A camera move finished. */
  onSettled?: (view: DeskView) => void;
  /** Start with the computer switched off (its glow on the room dark) until `setPower(true)`. */
  startOff?: boolean;
  /** A held item has been put back down (see `DeskScene.inspect`). */
  onPutBack?: () => void;
  /** The camera moved and something else is under the (still) pointer now (see `DeskScene.hover`). */
  onHoverChange?: (hit: DeskHit | null) => void;
}

/** What is under the pointer: something on the desk to pick up, or one of the computer's power switches. */
export type DeskHit = { kind: 'item'; id: string; label: string } | { kind: 'power'; label: string };

export interface DeskScene {
  setView(view: DeskView, instant?: boolean): void;
  readonly view: DeskView;
  /** Switch the computer on or off: its screen's glow on the room and its LEDs fade in or out. */
  setPower(on: boolean): void;
  /** What is at this point of the window (client px); with an item held, only that item counts. */
  hitTest(clientX: number, clientY: number): DeskHit | null;
  /** Like `hitTest`, and lights up what is under the pointer. `null` clears it. */
  hover(clientX: number | null, clientY?: number): DeskHit | null;
  /** Lift an item up in front of the camera (the room darkens behind it), or put it back (`null`). */
  inspect(id: string | null): void;
  /** Turn the held item (radians, around the view's vertical and horizontal axes). */
  turnItem(yaw: number, pitch: number): void;
  /** Bring the held item closer (> 1) or further (< 1). */
  zoomItem(factor: number): void;
  dispose(): void;
}

interface SceneLight {
  name: string;
  type: 'area' | 'spot' | 'point' | 'sun';
  watts: number;
  color: [number, number, number];
  position: [number, number, number];
  direction: [number, number, number];
  quaternion: [number, number, number, number];
  width?: number;
  height?: number;
  angle?: number;
  blend?: number;
}

interface SceneConfig {
  camera: { position: [number, number, number]; hfovDeg: number; near: number; far: number };
  screen: { center: [number, number, number]; width: number; height: number };
  lights: SceneLight[];
  background: [number, number, number];
  floaters: string[];
  lavaBlobs: string[];
  loopSeconds: number;
  bobMetres: number;
  neonMaterial: string;
  /** Things on the desk a visitor can pick up: a node each, and what to hide while it is held. */
  pickables?: { node: string; label: string; hide?: string[] }[];
  /** The computer's power switches, and the LEDs that go dark while it is off. */
  power?: { buttons: string[]; leds: string[] };
  /** Per light: how to rebuild it, and `gain`, a multiplier on its brightness. */
  lightHints: Record<string, { as?: string; angleDeg?: number; penumbra?: number; shadow?: boolean; mapSize?: number; gain?: number }>;
  tuning: {
    exposure?: number;
    area?: number;
    point?: number;
    spot?: number;
    ambient?: number;
    bloom?: { strength?: number; radius?: number; threshold?: number };
  };
}

/** In the close-up the glass takes this share of the window's height (and at most `FIT_W` of its width). */
const FIT_H = 0.66;
const FIT_W = 0.74;
/** Camera move between the two shots. */
const MOVE_SECONDS = 1.7;
/** How long the CRT takes to warm up (or fade) when the computer is switched on (or off). */
const POWER_SECONDS = 0.7;
/** Settled on the screen only the floaters and the lava lamp move: redraw the room at this rate. */
const IDLE_FPS = 20;
/**
 * Looking around: with the pointer at the edge of the window the camera turns that way, up to
 * these angles, and turns back once the pointer leaves the edge. The edge is this share of the
 * window on each side (the CRT glass ends well inside it, so playing never brushes it).
 */
const LOOK_YAW_DEG = 14;
const LOOK_PITCH_DEG = 7;
const LOOK_EDGE_X = 0.045;
const LOOK_EDGE_Y = 0.06;
/** How quickly the camera turns toward where it should look (per second). */
const LOOK_RATE = 1.6;
/** In the close-up the room around the screen dims by this share, so the game stands out. */
const FOCUS_DIM = 0.42;
/** Picking an item up (or putting it back) takes this long. */
const LIFT_SECONDS = 0.55;
/** A held item's bounding sphere fills this share of the window's half-height (before zooming). */
const HOLD_FILL = 0.42;
/** The room behind a held item darkens to this opacity (tone mapping lifts it back a fair way). */
const BACKDROP_OPACITY = 0.965;
/** How a held item first turns to the viewer: its top tipped forward, a quarter-turn sideways. */
const HOLD_TILT = new THREE.Euler(0.38, -0.32, 0, 'YXZ');
/** Added to an item's glow while the pointer is on it. */
const HOVER_GLOW = new THREE.Color().setRGB(0.05, 0.075, 0.035, THREE.LinearSRGBColorSpace);

interface Pickable {
  id: string;
  label: string;
  /** Parent of the item's own node, at its centre: it moves and turns around its middle. */
  pivot: THREE.Group;
  rest: THREE.Vector3;
  radius: number;
  meshes: THREE.Mesh[];
  /** The item's own (cloned) materials and their glow at rest. */
  glow: { material: THREE.MeshStandardMaterial; emissive: THREE.Color }[];
  /** Hidden while the item is held (the gamepad's cable). */
  hide: THREE.Object3D[];
}

const linear = (rgb: readonly number[]) => new THREE.Color().setRGB(rgb[0]!, rgb[1]!, rgb[2]!, THREE.LinearSRGBColorSpace);
/**
 * How far into the edge band a pointer coordinate (-1..1 across the window) is, signed: 0 short
 * of the band, easing up to ±1 at the window's edge. `band` is the band's width in those units.
 */
const edgePull = (p: number, band: number) => {
  const t = THREE.MathUtils.clamp((Math.abs(p) - (1 - band)) / band, 0, 1);
  return Math.sign(p) * t * t * (3 - 2 * t);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export async function createDeskScene(container: HTMLElement, options: DeskSceneOptions = {}): Promise<DeskScene> {
  const base = options.assetsUrl ?? '/scene/';
  const reduced = options.reducedMotion ?? false;
  const cfg = (await (await fetch(`${base}scene.json`)).json()) as SceneConfig;
  const tune = cfg.tuning ?? {};

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = tune.exposure ?? 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = linear(cfg.background);
  if (tune.ambient) scene.add(new THREE.AmbientLight(0x8890ff, tune.ambient));

  // ---------------------------------------------------------------- lights (rebuilt from Blender's)
  RectAreaLightUniformsLib.init();
  for (const L of cfg.lights) {
    const hint = cfg.lightHints?.[L.name] ?? {};
    const kind = hint.as ?? L.type;
    const color = linear(L.color);
    let light: THREE.Light;
    if (kind === 'area') {
      const w = L.width ?? 1;
      const h = L.height ?? w;
      const area = new THREE.RectAreaLight(color, (L.watts / (Math.PI * w * h)) * (tune.area ?? 1), w, h);
      area.position.fromArray(L.position);
      area.quaternion.fromArray(L.quaternion);
      light = area;
    } else if (kind === 'spot') {
      const angle = hint.angleDeg ? THREE.MathUtils.degToRad(hint.angleDeg) : (L.angle ?? 0.6);
      const spot = new THREE.SpotLight(color, (L.watts / (4 * Math.PI)) * (tune.spot ?? 1), 0, angle, hint.penumbra ?? L.blend ?? 0.5, 2);
      spot.position.fromArray(L.position);
      spot.target.position.fromArray(L.position).add(new THREE.Vector3().fromArray(L.direction));
      scene.add(spot.target);
      light = spot;
    } else {
      const point = new THREE.PointLight(color, (L.watts / (4 * Math.PI)) * (tune.point ?? 1), 0, 2);
      point.position.fromArray(L.position);
      light = point;
    }
    if (hint.shadow && (light instanceof THREE.SpotLight || light instanceof THREE.PointLight)) {
      light.castShadow = true;
      light.shadow.mapSize.setScalar(hint.mapSize ?? 1024);
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.01;
      light.shadow.radius = 3;
      const cam = light.shadow.camera;
      cam.near = 0.1;
      cam.far = 6;
    }
    light.intensity *= hint.gain ?? 1;
    light.name = L.name;
    scene.add(light);
  }

  // ---------------------------------------------------------------- model
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(`${base}desk.glb`, (e) => {
      if (options.onProgress && e.total) options.onProgress(e.loaded / e.total);
    });
  const root = gltf.scene;
  scene.add(root);
  root.updateMatrixWorld(true);

  let neon: THREE.MeshStandardMaterial | null = null;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]) as THREE.MeshPhysicalMaterial[];
    for (const m of mats) {
      if (m.name === cfg.neonMaterial) neon = m;
      if (m.transmission > 0) {
        // Real transmission costs an extra scene render per frame; tinted glass reads the same here.
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.45;
        m.depthWrite = false;
        m.roughness = Math.min(m.roughness, 0.15);
      }
      if (m.emissiveIntensity > 1 || m.transparent) o.castShadow = false;
    }
  });

  const find = (name: string) => root.getObjectByName(name);
  const still = (o: THREE.Object3D) => o.traverse((c) => (c.castShadow = false));
  const floaters = cfg.floaters
    .map(find)
    .filter((o): o is THREE.Object3D => Boolean(o))
    .map((o) => (still(o), { o, pos: o.position.clone(), quat: o.quaternion.clone() }));
  const blobs = cfg.lavaBlobs
    .map(find)
    .filter((o): o is THREE.Object3D => Boolean(o))
    .map((o, i) => (still(o), { o, pos: o.position.clone(), i }));
  // The storm outside (weather.ts) replaces the model's still night sky and moon.
  for (const name of ['Night_Sky', 'Moon']) find(name)?.removeFromParent();
  // The handheld's screen lies exactly on its bezel's front face; from across the room the two
  // fought for each pixel (a flickering diagonal mess). Draw the screen just in front, and let
  // its light-grey picture glow softer so it reads as a picture instead of a white patch.
  const pocketScreen = find('Handheld_Screen');
  if (pocketScreen instanceof THREE.Mesh) {
    const material = pocketScreen.material as THREE.MeshStandardMaterial;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    material.emissiveIntensity *= 0.45;
  }
  const weather = createWeather(scene, { reducedMotion: reduced, windowLight: scene.getObjectByName('Moon_Key') as THREE.Light | undefined });

  // Things to pick up: each moves to a pivot at its centre (outside `root`, so the merge below
  // leaves it alone), with materials of its own to light up under the pointer.
  const keep = new Set([...cfg.floaters, ...cfg.lavaBlobs]);
  const pickables: Pickable[] = [];
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  for (const entry of cfg.pickables ?? []) {
    const node = find(entry.node);
    if (!node) continue;
    for (const name of entry.hide ?? []) keep.add(name);
    box.setFromObject(node);
    const pivot = new THREE.Group();
    box.getCenter(pivot.position);
    scene.add(pivot);
    pivot.updateMatrixWorld();
    pivot.attach(node);
    const item: Pickable = {
      id: entry.node,
      label: entry.label,
      pivot,
      rest: pivot.position.clone(),
      radius: Math.max(0.02, box.getBoundingSphere(sphere).radius),
      meshes: [],
      glow: [],
      hide: (entry.hide ?? []).map(find).filter((o): o is THREE.Object3D => Boolean(o)),
    };
    node.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const own = (Array.isArray(o.material) ? o.material : [o.material]).map((m: THREE.Material) => m.clone());
      o.material = Array.isArray(o.material) ? own : own[0]!;
      for (const m of own) {
        if (m instanceof THREE.MeshStandardMaterial && !m.emissiveMap) item.glow.push({ material: m, emissive: m.emissive.clone() });
      }
      o.userData.pick = pickables.length;
      item.meshes.push(o);
    });
    pickables.push(item);
  }
  // The power switches, and the LEDs that follow the power (each with its own material).
  const powerButtons = (cfg.power?.buttons ?? [])
    .map(find)
    .filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
    .map((o) => {
      keep.add(o.name);
      return { o, rest: o.position.clone() };
    });
  const leds = (cfg.power?.leds ?? [])
    .map(find)
    .filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
    .map((o) => {
      keep.add(o.name);
      const material = (o.material as THREE.MeshStandardMaterial).clone();
      o.material = material;
      return { name: o.name, material, color: material.color.clone(), emissive: material.emissiveIntensity };
    });
  mergeStaticMeshes(root, keep);
  // Nothing else moves: draw the shadow maps once.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  // ---------------------------------------------------------------- post
  const composer = new EffectComposer(renderer);
  const camera = new THREE.PerspectiveCamera(40, 1, cfg.camera.near, cfg.camera.far);
  composer.addPass(new RenderPass(scene, camera));
  const bloomCfg = tune.bloom ?? {};
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), bloomCfg.strength ?? 0.3, bloomCfg.radius ?? 0.5, bloomCfg.threshold ?? 1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------------------------------------------------------------- camera rig
  // Both shots look straight at the glass, so the site on it stays an upright rectangle.
  const glass = new THREE.Vector3().fromArray(cfg.screen.center);
  const halfW = cfg.screen.width / 2;
  const halfH = cfg.screen.height / 2;
  const corners = [
    new THREE.Vector3(glass.x - halfW, glass.y + halfH, glass.z),
    new THREE.Vector3(glass.x + halfW, glass.y + halfH, glass.z),
    new THREE.Vector3(glass.x + halfW, glass.y - halfH, glass.z),
    new THREE.Vector3(glass.x - halfW, glass.y - halfH, glass.z),
  ];
  const hero = new THREE.Vector3().fromArray(cfg.camera.position);
  const roomDistance = hero.z - glass.z;
  const hfov = THREE.MathUtils.degToRad(cfg.camera.hfovDeg);
  let width = 1;
  let height = 1;
  let screenDistance = roomDistance * 1;

  let view: DeskView = 'room';
  let from = roomDistance;
  let to = roomDistance;
  let moveStart = -1;
  let distance = roomDistance;
  const drift = new THREE.Vector2();
  const pointer = new THREE.Vector2();
  let pointerIn = false;
  // -1..1 each way: how far the camera is turned toward the left/right and top/bottom edge.
  const look = new THREE.Vector2();
  const lookGoal = new THREE.Vector2();
  const yawMax = THREE.MathUtils.degToRad(LOOK_YAW_DEG);
  const pitchMax = THREE.MathUtils.degToRad(LOOK_PITCH_DEG);

  const resize = () => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    camera.aspect = aspect;
    // Blender's horizontal framing on wide windows; stop widening on narrow ones.
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / Math.max(aspect, 1.25)));
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.resolution.set(width, height);
    const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    screenDistance = Math.max(cfg.screen.height / (FIT_H * k), cfg.screen.width / (FIT_W * k * aspect));
    if (moveStart < 0) distance = view === 'screen' ? screenDistance : roomDistance;
    if (view === 'screen') to = screenDistance;
    const pxPerMetre = height / (k * screenDistance);
    options.onLayout?.(Math.round(cfg.screen.width * pxPerMetre), Math.round(cfg.screen.height * pxPerMetre));
    dirty = true;
  };

  const placeCamera = () => {
    camera.position.set(glass.x + drift.x, glass.y + drift.y, glass.z + distance);
    camera.lookAt(glass.x + drift.x * 0.25, glass.y + drift.y * 0.25, glass.z);
    // then turn the head: right edge looks right, top edge looks up
    camera.rotateY(-look.x * yawMax);
    camera.rotateX(-look.y * pitchMax);
    camera.updateMatrixWorld();
  };

  const v = new THREE.Vector3();
  const quad: number[] = new Array(8).fill(0);
  const reportScreen = () => {
    for (let i = 0; i < 4; i++) {
      v.copy(corners[i]!).project(camera);
      quad[i * 2] = ((v.x + 1) / 2) * width;
      quad[i * 2 + 1] = ((1 - v.y) / 2) * height;
    }
    options.onScreen?.(quad as unknown as ScreenQuad);
  };

  // ---------------------------------------------------------------- loop
  let dirty = true;
  // The CRT's glow on the room follows the power switch (0 off … 1 on), warming up over POWER_SECONDS.
  const crtGlow = scene.getObjectByName('CRT_Glow') as THREE.Light | undefined;
  const crtGlowFull = crtGlow?.intensity ?? 0;
  let power = options.startOff ? 0 : 1;
  let powerGoal = power;
  // Seconds since the computer was switched on (the drive light chatters while it boots).
  let boot = Infinity;
  let press = 0; // a power switch pushed in: 1 … 0
  const applyPower = () => {
    // A tube warming up: a quick flash, then settling to its glow.
    const flash = powerGoal > 0 && !reduced ? Math.sin(power * Math.PI) * 0.8 : 0;
    if (crtGlow) crtGlow.intensity = crtGlowFull * (power + flash);
    const chatter = boot < 1.8 ? (Math.sin(boot * 53) * Math.sin(boot * 31) > 0.1 ? 1 : 0.15) : 1;
    for (const led of leds) {
      const level = power * (led.name === 'PC_LED_1' ? chatter : 1);
      led.material.emissiveIntensity = led.emissive * level;
      led.material.color.copy(led.color).multiplyScalar(0.22 + 0.78 * level);
    }
    for (const b of powerButtons) b.o.position.z = b.rest.z - 0.0025 * press;
  };
  applyPower();

  // Holding an item: it rides up to the camera while a dark backdrop fades in behind it, lit by
  // a light of its own.
  let held: Pickable | null = null;
  let hovered: Pickable | null = null;
  let hoverAt: { x: number; y: number; key: string } | null = null;
  let lift = 0;
  let liftGoal = 0;
  const turnGoal = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  let zoomGoal = 1;
  let zoom = 1;
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x010204, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  backdrop.visible = false;
  backdrop.renderOrder = 10;
  scene.add(backdrop);  const holdLight = new THREE.DirectionalLight(0xfff0dc, 0);
  scene.add(holdLight, holdLight.target);
  const holdPos = new THREE.Vector3();
  const holdQuat = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const nudge = new THREE.Quaternion();
  const setGlow = (item: Pickable | null, on: boolean) => {
    if (!item) return;
    for (const g of item.glow) {
      g.material.emissive.copy(g.emissive);
      if (on) g.material.emissive.add(HOVER_GLOW);
    }
  };
  const setShadows = (item: Pickable, cast: boolean) => {
    for (const m of item.meshes) m.castShadow = cast;
    for (const o of item.hide) o.visible = cast;
    renderer.shadowMap.needsUpdate = true;
  };
  const placeHeld = () => {
    if (!held) return;
    const e = ease(lift);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const d = Math.max(held.radius / (tanHalf * HOLD_FILL) / zoom, held.radius * 1.7 + 0.05);
    holdPos.set(0, 0, -d).applyQuaternion(camera.quaternion).add(camera.position);
    holdQuat.copy(camera.quaternion).multiply(turn);
    held.pivot.position.lerpVectors(held.rest, holdPos, e);
    held.pivot.position.y += Math.sin(e * Math.PI) * 0.05;
    held.pivot.quaternion.slerpQuaternions(identity, holdQuat, e);
    // the backdrop: just behind the item, filling the view
    const back = d + held.radius * 1.2 + 0.05;
    const h = 2 * tanHalf * back * 1.25;
    backdrop.position.set(0, 0, -back).applyQuaternion(camera.quaternion).add(camera.position);
    backdrop.quaternion.copy(camera.quaternion);
    backdrop.scale.set(h * camera.aspect, h, 1);
    (backdrop.material as THREE.MeshBasicMaterial).opacity = BACKDROP_OPACITY * e;
    backdrop.visible = e > 0.001;
    holdLight.intensity = 2.4 * e;
    holdLight.position.set(-0.5, 0.7, 0.6).applyQuaternion(camera.quaternion).add(held.pivot.position);
    holdLight.target.position.copy(held.pivot.position);
    holdLight.target.updateMatrixWorld();
  };

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const targets: THREE.Object3D[] = [...pickables.flatMap((p) => p.meshes), ...powerButtons.map((b) => b.o)];
  const hitAt = (clientX: number, clientY: number): DeskHit | null => {
    const rect = container.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const list = held ? held.meshes : targets;
    const hit = raycaster.intersectObjects(list, false)[0];
    if (!hit) return null;
    const index = hit.object.userData.pick as number | undefined;
    if (index !== undefined) {
      const item = pickables[index]!;
      return { kind: 'item', id: item.id, label: item.label };
    }
    return { kind: 'power', label: powerGoal > 0.5 ? 'Switch off' : 'Switch on' };
  };
  const hitKey = (hit: DeskHit | null) => (hit ? `${hit.kind}:${hit.kind === 'item' ? hit.id : hit.label}` : '');
  const setHovered = (hit: DeskHit | null) => {
    const item = !held && hit?.kind === 'item' ? (pickables.find((p) => p.id === hit.id) ?? null) : null;
    if (item === hovered) return;
    setGlow(hovered, false);
    setGlow(item, true);
    hovered = item;
    dirty = true;
  };
  let raf = 0;
  let last = 0;
  let lastDraw = 0;
  let elapsed = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const spin = new THREE.Quaternion();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    elapsed += dt;
    const t = elapsed;

    // camera move
    let moving = false;
    if (moveStart >= 0) {
      const p = Math.min(1, (now - moveStart) / 1000 / MOVE_SECONDS);
      distance = from + (to - from) * ease(p);
      moving = true;
      if (p >= 1) {
        moveStart = -1;
        distance = to;
        options.onSettled?.(view);
      }
    }
    if (power !== powerGoal || boot < 1.8 || press > 0) {
      const step = reduced ? 1 : dt / POWER_SECONDS;
      power = powerGoal > power ? Math.min(powerGoal, power + step) : Math.max(powerGoal, power - step);
      boot += dt;
      press = Math.max(0, press - dt / 0.18);
      applyPower();
      moving = true;
    }

    // an item on its way up or down, or being turned
    if (held) {
      if (lift !== liftGoal) {
        const step = reduced ? 1 : dt / LIFT_SECONDS;
        lift = liftGoal > lift ? Math.min(liftGoal, lift + step) : Math.max(liftGoal, lift - step);
        moving = true;
      }
      const k = reduced ? 1 : Math.min(1, dt * 12);
      if (turn.angleTo(turnGoal) > 1e-4) {
        turn.slerp(turnGoal, k);
        moving = true;
      }
      if (Math.abs(zoom - zoomGoal) > 1e-4) {
        zoom += (zoomGoal - zoom) * k;
        moving = true;
      }
    }

    // in the wide shot the camera drifts a little after the pointer
    const goal = view === 'room' && !reduced && !held ? pointer : null;
    const gx = goal ? goal.x * 0.09 : 0;
    const gy = goal ? -goal.y * 0.04 : 0;
    if (Math.abs(gx - drift.x) > 1e-5 || Math.abs(gy - drift.y) > 1e-5) {
      drift.x += (gx - drift.x) * Math.min(1, dt * 2.5);
      drift.y += (gy - drift.y) * Math.min(1, dt * 2.5);
      moving = true;
    }

    // at the edge of the window the camera looks around
    if (reduced || !pointerIn || held) lookGoal.set(0, 0);
    else lookGoal.set(edgePull(pointer.x, LOOK_EDGE_X * 2), edgePull(pointer.y, LOOK_EDGE_Y * 2));
    if (Math.abs(lookGoal.x - look.x) > 1e-4 || Math.abs(lookGoal.y - look.y) > 1e-4) {
      const k = Math.min(1, dt * LOOK_RATE);
      look.x += (lookGoal.x - look.x) * k;
      look.y += (lookGoal.y - look.y) * k;
      moving = true;
    } else if (look.x !== lookGoal.x || look.y !== lookGoal.y) {
      look.copy(lookGoal);
      moving = true;
    }

    // settled on the screen: the room only needs a slow redraw
    if (!moving && !dirty && view === 'screen' && now - lastDraw < 1000 / IDLE_FPS) return;
    lastDraw = now;
    dirty = false;

    const u = (t % cfg.loopSeconds) / cfg.loopSeconds;
    for (const f of floaters) {
      f.o.position.copy(f.pos);
      f.o.position.y += cfg.bobMetres * (0.5 - 0.5 * Math.cos(u * Math.PI * 2));
      spin.setFromAxisAngle(up, u * Math.PI * 2);
      f.o.quaternion.copy(spin).multiply(f.quat);
    }
    for (const b of blobs) {
      b.o.position.copy(b.pos);
      b.o.position.y += Math.sin(t * 0.35 + b.i * 1.7) * 0.022;
    }
    if (neon) (neon as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 0.7) > 0.995 ? 2.4 : 7;

    weather.update(t);
    placeCamera();
    // Closer to the screen, the room around it dims (and blooms less) so the game stands out.
    const span = roomDistance - screenDistance;
    const focus = span > 0 ? THREE.MathUtils.clamp((roomDistance - distance) / span, 0, 1) : 0;
    renderer.toneMappingExposure = (tune.exposure ?? 1) * (1 - FOCUS_DIM * focus);
    bloom.strength = (bloomCfg.strength ?? 0.3) * (1 - 0.5 * focus);
    // the camera turned under a still pointer: what is under it now?
    if (moving && hoverAt && !held) {
      const hit = hitAt(hoverAt.x, hoverAt.y);
      const key = hitKey(hit);
      if (key !== hoverAt.key) {
        hoverAt.key = key;
        setHovered(hit);
        options.onHoverChange?.(hit);
      }
    }
    if (held) {
      placeHeld();
      if (lift === 0 && liftGoal === 0) {
        // back on the desk
        const item = held;
        held = null;
        item.pivot.position.copy(item.rest);
        item.pivot.quaternion.identity();
        backdrop.visible = false;
        holdLight.intensity = 0;
        setShadows(item, true);
        options.onPutBack?.();
      }
    }
    composer.render();
    reportScreen();
  };

  const onPointerMove = (e: PointerEvent) => {
    // A mouse or pen; and not on one of the shell's own buttons, which sit near the edge.
    const onControl = e.target instanceof Element && e.target.closest('button, a') !== null;
    pointerIn = (e.pointerType === 'mouse' || e.pointerType === 'pen') && !onControl;
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };
  // The pointer left the page (out of the window, or into the site on the screen, whose moves
  // this page does not see), or the window lost focus: look back.
  const onPointerOut = (e: MouseEvent) => {
    if (!e.relatedTarget || e.relatedTarget instanceof HTMLIFrameElement) pointerIn = false;
  };
  const onBlur = () => {
    pointerIn = false;
  };
  const onVisibility = () => {
    last = 0; // no jump in the animations after a hidden tab
  };
  window.addEventListener('pointermove', onPointerMove);
  document.addEventListener('mouseout', onPointerOut);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  placeCamera();
  raf = requestAnimationFrame(frame);

  return {
    get view() {
      return view;
    },
    setView(next, instant = false) {
      if (next === view && moveStart < 0) return;
      view = next;
      from = distance;
      to = next === 'screen' ? screenDistance : roomDistance;
      if (instant || reduced) {
        moveStart = -1;
        distance = to;
        dirty = true;
        options.onSettled?.(view);
      } else {
        moveStart = performance.now();
      }
    },
    setPower(on) {
      const goal = on ? 1 : 0;
      if (goal === powerGoal) return;
      powerGoal = goal;
      boot = on && !reduced ? 0 : Infinity;
      press = 1;
      dirty = true;
    },
    hitTest: hitAt,
    hover(clientX, clientY = 0) {
      const hit = clientX === null ? null : hitAt(clientX, clientY);
      hoverAt = clientX === null ? null : { x: clientX, y: clientY, key: hitKey(hit) };
      setHovered(hit);
      return hit;
    },
    inspect(id) {
      if (id === null) {
        if (held) liftGoal = 0;
        dirty = true;
        return;
      }
      if (held) return;
      const item = pickables.find((p) => p.id === id);
      if (!item) return;
      setGlow(hovered, false);
      hovered = null;
      held = item;
      lift = 0;
      liftGoal = 1;
      turnGoal.setFromEuler(HOLD_TILT);
      turn.copy(turnGoal);
      zoom = zoomGoal = 1;
      setShadows(item, false);
      dirty = true;
    },
    turnItem(yaw, pitch) {
      if (!held) return;
      // around the view's own axes, whichever way the item already faces
      turnGoal.premultiply(nudge.setFromAxisAngle(axis.set(0, 1, 0), yaw));
      turnGoal.premultiply(nudge.setFromAxisAngle(axis.set(1, 0, 0), pitch));
      turnGoal.normalize();
      dirty = true;
    },
    zoomItem(factor) {
      if (!held) return;
      zoomGoal = THREE.MathUtils.clamp(zoomGoal * factor, 0.6, 2.6);
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      weather.dispose();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseout', onPointerOut);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        for (const m of mats) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
          m.dispose();
        }
      });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** Bakes world transforms into the geometry and merges static meshes that share a material. */
function mergeStaticMeshes(root: THREE.Object3D, keep: ReadonlySet<string>) {
  const kept = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (keep.has(p.name)) return true;
    return false;
  };
  const groups = new Map<string, { material: THREE.Material; geoms: THREE.BufferGeometry[]; sources: THREE.Mesh[]; shadow: boolean }>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || kept(o) || Array.isArray(o.material)) return;
    const g = (o.geometry as THREE.BufferGeometry).clone();
    if (Object.values(g.attributes).some((a) => (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)) {
      BufferGeometryUtils.deinterleaveGeometry(g); // in place
    }
    g.applyMatrix4(o.matrixWorld);
    const material = o.material as THREE.Material;
    const key = `${material.uuid}|${Object.keys(g.attributes).sort().join(',')}|${g.index ? 'i' : 'n'}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { material, geoms: [], sources: [], shadow: o.castShadow }));
    group.geoms.push(g);
    group.sources.push(o);
  });
  for (const { material, geoms, sources, shadow } of groups.values()) {
    if (geoms.length < 2) continue;
    const merged = BufferGeometryUtils.mergeGeometries(geoms, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `merged:${material.name}`;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    for (const o of sources) o.parent?.remove(o);
  }
  root.updateMatrixWorld(true);
}
