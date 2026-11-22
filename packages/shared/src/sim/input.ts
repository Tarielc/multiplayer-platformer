/** Player input as a compact bitmask: one frame per simulation tick. */
export const Button = {
  LEFT: 1 << 0,
  RIGHT: 1 << 1,
  JUMP: 1 << 2,
  DOWN: 1 << 3,
  ATTACK: 1 << 4,
  /** The character's special ability (see `config/abilities.ts`). */
  SPECIAL: 1 << 5,
} as const;

export type ButtonName = keyof typeof Button;

/**
 * Free aim rides along in the same number: bit `AIM_FLAG` says an aim is present, bits
 * `AIM_SHIFT..AIM_SHIFT+AIM_BITS-1` hold the direction in `AIM_STEPS` steps (0 = right,
 * clockwise, since +y is down). Without the flag the aim is "straight ahead".
 */
export const AIM_SHIFT = 8;
export const AIM_BITS = 6;
export const AIM_STEPS = 1 << AIM_BITS;
export const AIM_FLAG = 1 << (AIM_SHIFT + AIM_BITS);
const AIM_MASK = (AIM_STEPS - 1) << AIM_SHIFT;

export const NEUTRAL_INPUT = 0;
export const ALL_BUTTONS =
  Button.LEFT | Button.RIGHT | Button.JUMP | Button.DOWN | Button.ATTACK | Button.SPECIAL | AIM_MASK | AIM_FLAG;

export function hasButton(buttons: number, button: number): boolean {
  return (buttons & button) !== 0;
}

/** Drops unknown bits so untrusted input can't smuggle state. */
export function sanitizeButtons(buttons: number): number {
  return buttons & ALL_BUTTONS;
}

export function buttonsFrom(state: Partial<Record<ButtonName, boolean>>): number {
  let mask = 0;
  if (state.LEFT) mask |= Button.LEFT;
  if (state.RIGHT) mask |= Button.RIGHT;
  if (state.JUMP) mask |= Button.JUMP;
  if (state.DOWN) mask |= Button.DOWN;
  if (state.ATTACK) mask |= Button.ATTACK;
  if (state.SPECIAL) mask |= Button.SPECIAL;
  return mask;
}

/** Adds an aim direction (radians, 0 = right, +π/2 = down) to a button mask. */
export function withAim(buttons: number, angle: number): number {
  const turn = angle / (Math.PI * 2);
  const step = ((Math.round(turn * AIM_STEPS) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
  return (buttons & ~(AIM_MASK | AIM_FLAG)) | (step << AIM_SHIFT) | AIM_FLAG;
}

/** The aim carried by `buttons`, or straight ahead (`facing`) when it carries none. */
export function aimFromButtons(buttons: number, facing: 1 | -1): number {
  if ((buttons & AIM_FLAG) === 0) return facing > 0 ? 0 : Math.PI;
  const step = (buttons & AIM_MASK) >> AIM_SHIFT;
  return (step / AIM_STEPS) * Math.PI * 2;
}
