import { CHARACTER_IDS, type CharacterId } from '@platformer/shared';

/**
 * Special-ability art as data (no Phaser import). Every sheet is a PNG plus a JSON description
 * written by the asset generator (`packages/shared/data/sprites/abilities/`):
 *
 *   { image, pivot: {x, y}, animations: { name: { rects: [[x, y, w, h]…], durationsMs, loop,
 *     loopFrom?, points?: [{ name: [x, y] }…] } } }
 *
 * `pivot` is where the character's feet (or a prop's anchor) sit inside a frame; sprites face
 * right. Frames are picked from replicated timers (`frameAt`), not Phaser animations, so what
 * everyone sees matches the simulation's phase timing exactly.
 */
export interface AbilityAnimDef {
  rects: readonly (readonly [number, number, number, number])[];
  durationsMs: readonly number[];
  loop: boolean;
  loopFrom?: number;
  points?: readonly (Readonly<Record<string, readonly [number, number] | number>> | null)[];
}

export interface AbilitySheetDef {
  image: string;
  pivot?: { x: number; y: number };
  animations: Readonly<Record<string, AbilityAnimDef>>;
}

export interface AbilitySheetFile {
  key: string;
  /** Without extension, relative to the asset base. */
  path: string;
}

const dir = 'sprites/abilities';

/** Sheet keys by name; reactions are one per character. */
export const ABILITY_SHEETS = {
  heal: { key: 'ab:heal', path: `${dir}/bunny-man/heal_caster` },
  healFx: { key: 'ab:healFx', path: `${dir}/bunny-man/heal_fx` },
  healAim: { key: 'ab:healAim', path: `${dir}/bunny-man/heal_aim` },
  healParts: { key: 'ab:healParts', path: `${dir}/bunny-man/heal_aim_parts` },
  pilot: { key: 'ab:pilot', path: `${dir}/virtual-guy/pilot` },
  drone: { key: 'ab:drone', path: `${dir}/virtual-guy/drone` },
  claw: { key: 'ab:claw', path: `${dir}/virtual-guy/claw` },
  bigForm: { key: 'ab:bigForm', path: `${dir}/mask-dude/big_form` },
  tongueAim: { key: 'ab:tongueAim', path: `${dir}/ninja-frog/tongue_aim` },
  tongueParts: { key: 'ab:tongueParts', path: `${dir}/ninja-frog/tongue_aim_parts` },
  tongueCaster: { key: 'ab:tongueCaster', path: `${dir}/ninja-frog/tongue_caster` },
  spitFx: { key: 'ab:spitFx', path: `${dir}/ninja-frog/spit_fx` },
} as const satisfies Record<string, AbilitySheetFile>;

export type AbilitySheetName = keyof typeof ABILITY_SHEETS;

export function reactionSheet(id: CharacterId): AbilitySheetFile {
  return { key: `ab:react:${id}`, path: `${dir}/reactions/${id}` };
}

export function allAbilitySheets(): AbilitySheetFile[] {
  return [...Object.values(ABILITY_SHEETS), ...CHARACTER_IDS.map(reactionSheet)];
}

/** HUD icon of a character's ability, relative to the asset base. */
export function abilityIconPath(id: CharacterId): string {
  return `${dir}/${id}/icon.png`;
}

/** Phaser texture key of a character's ability icon (loaded by the boot scene). */
export function abilityIconKey(id: CharacterId): string {
  return `ab:icon:${id}`;
}

/** Phaser texture frame name of frame `i` of `anim`. */
export const frameName = (anim: string, i: number) => `${anim}:${i}`;

export function animLengthMs(anim: AbilityAnimDef): number {
  let total = 0;
  for (const d of anim.durationsMs) total += d;
  return total;
}

/**
 * Frame index of `anim` after `ms`. One-shots hold their last frame; loops wrap (from
 * `loopFrom` after the first play). `scale` stretches the clip (e.g. to a gameplay timer).
 */
export function frameAt(anim: AbilityAnimDef, ms: number, scale = 1): number {
  const durations = anim.durationsMs;
  const n = durations.length;
  if (n <= 1) return 0;
  const total = animLengthMs(anim) * scale;
  let t = Math.max(0, ms);
  if (t >= total) {
    if (!anim.loop) return n - 1;
    const from = anim.loopFrom ?? 0;
    let loopLength = 0;
    for (let i = from; i < n; i++) loopLength += durations[i]! * scale;
    const intro = total - loopLength;
    t = intro + ((t - intro) % Math.max(1, loopLength));
  }
  for (let i = 0; i < n; i++) {
    const d = durations[i]! * scale;
    if (t < d) return i;
    t -= d;
  }
  return n - 1;
}

/** A named point of one frame (frame-local px), if the generator recorded it. */
export function framePoint(anim: AbilityAnimDef, frame: number, name: string): readonly [number, number] | null {
  const value = anim.points?.[frame]?.[name];
  return Array.isArray(value) ? (value as readonly [number, number]) : null;
}

/** Aim rows of the frog's free-aim sheet: degrees from straight ahead (0), -90 up, 90 down. */
export const AIM_ROWS: readonly { name: string; deg: number }[] = [
  { name: 'aim_m90', deg: -90 },
  { name: 'aim_m67', deg: -67.5 },
  { name: 'aim_m45', deg: -45 },
  { name: 'aim_m22', deg: -22.5 },
  { name: 'aim_0', deg: 0 },
  { name: 'aim_p22', deg: 22.5 },
  { name: 'aim_p45', deg: 45 },
  { name: 'aim_p67', deg: 67.5 },
  { name: 'aim_p90', deg: 90 },
];

/** The aim row closest to `deg` (relative to facing). */
export function nearestAimRow(deg: number): string {
  let best = AIM_ROWS[4]!;
  for (const row of AIM_ROWS) if (Math.abs(row.deg - deg) < Math.abs(best.deg - deg)) best = row;
  return best.name;
}

/** World aim angle → angle relative to `facing` (0 = straight ahead, -90 = up), in degrees. */
export function relativeAimDeg(angle: number, facing: 1 | -1): number {
  const x = Math.cos(angle) * facing;
  const y = Math.sin(angle);
  return (Math.atan2(y, Math.max(0, x)) * 180) / Math.PI;
}

/** Bunny Man's stretchy arms (`heal_aim.json` armColors): outline, front sleeve, back sleeve. */
export const ARM_COLORS = { outline: 0x211f30, sleeve: 0xf89cc0, shade: 0xda89a8 } as const;

/** Tongue colours of the generated parts sheet (outline, flesh). */
export const TONGUE_COLORS = { outline: 0x211f30, fill: 0xf89cc0 } as const;
