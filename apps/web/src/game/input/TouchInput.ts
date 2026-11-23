import { Button } from '@platformer/shared';
import { DEFAULT_BINDINGS, type InputBindings } from './bindings';

type TouchBindings = InputBindings['touch'];

/**
 * State of the on-screen touch controls. The React overlay (`TouchControls`) writes it as thumbs
 * move; `InputController` folds it into the `Button` bitmask once per fixed step. No Phaser and
 * no React here, so it lives on the bridge and both sides can reach it.
 *
 * Stick positions are in the stick's unit circle, +y down (screen and world agree).
 *
 *  - Walk stick: left / right / down; up flies the drone (only while piloting it).
 *  - Jump button: held, and latched so a tap between two steps is not lost.
 *  - Attack stick: fires on release; a sideways drag picks the side of the swing.
 *  - Special stick: aims while held (the aim preview follows it) and fires on release; a release
 *    near the centre fires straight ahead.
 */
export class TouchInput {
  private walkX = 0;
  private walkY = 0;
  private jumpHeld = false;
  /** Where the special stick points while a thumb is on it. */
  private special: { x: number; y: number } | null = null;
  /** Presses since the last consumed step (Button.JUMP | Button.ATTACK | Button.SPECIAL). */
  private latched = 0;
  /** Aim of the latched special press (null = straight ahead). */
  private latchedAim: number | null = null;
  /** Side of the latched swing (0 = the way the player faces). */
  private latchedSide: -1 | 0 | 1 = 0;

  constructor(private readonly bindings: Readonly<TouchBindings> = DEFAULT_BINDINGS.touch) {}

  setWalk(x: number, y: number): void {
    this.walkX = x;
    this.walkY = y;
  }

  releaseWalk(): void {
    this.walkX = 0;
    this.walkY = 0;
  }

  pressJump(): void {
    this.jumpHeld = true;
    this.latched |= Button.JUMP;
  }

  releaseJump(): void {
    this.jumpHeld = false;
  }

  /** Thumb up from the attack stick at `x` (horizontal deflection): swing. */
  releaseAttack(x: number): void {
    const t = this.bindings.attackSideThreshold;
    this.latched |= Button.ATTACK;
    this.latchedSide = x < -t ? -1 : x > t ? 1 : 0;
  }

  dragSpecial(x: number, y: number): void {
    this.special = { x, y };
  }

  /** Thumb up from the special stick at (`x`, `y`): use the ability along that aim. */
  releaseSpecial(x: number, y: number): void {
    this.special = null;
    this.latched |= Button.SPECIAL;
    this.latchedAim = Math.hypot(x, y) > this.bindings.aimDeadzone ? Math.atan2(y, x) : null;
  }

  /** The browser took the touch away (system gesture): drop the aim without firing. */
  cancelSpecial(): void {
    this.special = null;
  }

  /**
   * The special ability's aim from the touch controls, or null when they have none: the latched
   * press's aim until a step used it, else where the held special stick points (straight ahead,
   * `facing`, inside its deadzone, so the aim preview shows as soon as the thumb lands).
   */
  aim(facing: 1 | -1): number | null {
    if ((this.latched & Button.SPECIAL) !== 0) return this.latchedAim;
    const s = this.special;
    if (!s) return null;
    if (Math.hypot(s.x, s.y) <= this.bindings.aimDeadzone) return facing > 0 ? 0 : Math.PI;
    return Math.atan2(s.y, s.x);
  }

  /**
   * `buttons` plus the touch controls for one step. `piloting`: the player flies the drone, which
   * goes up on Jump, so the walk stick's up counts as Jump.
   */
  apply(buttons: number, piloting = false): number {
    const t = this.bindings;
    let out = buttons | this.latched;
    if (this.walkX < -t.walkDeadzone) out |= Button.LEFT;
    else if (this.walkX > t.walkDeadzone) out |= Button.RIGHT;
    if (this.walkY > t.downThreshold) out |= Button.DOWN;
    if (piloting && this.walkY < -t.upThreshold) out |= Button.JUMP;
    if (this.jumpHeld) out |= Button.JUMP;
    // A swing turns the player on the step it starts: point them at the dragged side.
    if ((this.latched & Button.ATTACK) !== 0 && this.latchedSide !== 0) {
      out &= ~(Button.LEFT | Button.RIGHT);
      out |= this.latchedSide < 0 ? Button.LEFT : Button.RIGHT;
    }
    return out;
  }

  /** Call after a simulation step used the sampled buttons. */
  consume(): void {
    this.latched = 0;
    this.latchedAim = null;
    this.latchedSide = 0;
  }

  /** Drops everything (menu opened, controls hidden). */
  reset(): void {
    this.releaseWalk();
    this.jumpHeld = false;
    this.special = null;
    this.consume();
  }
}
