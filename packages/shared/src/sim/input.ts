/** Player input as a compact bitmask: one frame per simulation tick. */
export const Button = {
  LEFT: 1 << 0,
  RIGHT: 1 << 1,
  JUMP: 1 << 2,
  DOWN: 1 << 3,
  ATTACK: 1 << 4,
} as const;

export type ButtonName = keyof typeof Button;

export const NEUTRAL_INPUT = 0;
export const ALL_BUTTONS = Button.LEFT | Button.RIGHT | Button.JUMP | Button.DOWN | Button.ATTACK;

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
  return mask;
}
