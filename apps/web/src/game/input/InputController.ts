import { Button } from '@platformer/shared';
import * as Phaser from 'phaser';
import { DEFAULT_BINDINGS, type InputBindings } from './bindings';

type Keys = Phaser.Input.Keyboard.Key[];

/**
 * Turns keyboard + gamepad state into the shared `Button` bitmask, once per fixed step.
 *
 * Jump presses are latched until a simulation step consumes them, so a quick tap between two
 * steps (high refresh rates, low frame rates) is never lost.
 */
export class InputController {
  private readonly left: Keys;
  private readonly right: Keys;
  private readonly jump: Keys;
  private readonly down: Keys;
  private readonly keyboard: Phaser.Input.Keyboard.KeyboardPlugin | null;
  private readonly gamepad: Phaser.Input.Gamepad.GamepadPlugin | null;
  private readonly gameEvents: Phaser.Events.EventEmitter;
  private jumpLatched = false;
  private menuWasDown = false;
  private enabled = true;
  private readonly onPadDown = (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
    if (this.bindings.gamepad.jumpButtons.includes(button.index)) this.jumpLatched = true;
  };
  private readonly onBlur = () => this.keyboard?.resetKeys();

  constructor(
    scene: Phaser.Scene,
    private readonly onMenu: () => void,
    private readonly bindings: Readonly<InputBindings> = DEFAULT_BINDINGS,
  ) {
    this.keyboard = scene.input.keyboard;
    this.gamepad = scene.input.gamepad;
    this.gameEvents = scene.game.events;
    const add = (names: readonly string[]) => names.map((name) => this.keyboard!.addKey(name, true, false));
    const kb = bindings.keyboard;
    this.left = this.keyboard ? add(kb.left) : [];
    this.right = this.keyboard ? add(kb.right) : [];
    this.jump = this.keyboard ? add(kb.jump) : [];
    this.down = this.keyboard ? add(kb.down) : [];
    for (const key of this.jump) key.on(Phaser.Input.Keyboard.Events.DOWN, this.latchJump);
    this.gamepad?.on(Phaser.Input.Gamepad.Events.BUTTON_DOWN, this.onPadDown);
    this.gameEvents.on(Phaser.Core.Events.BLUR, this.onBlur);
  }

  private readonly latchJump = () => {
    if (this.enabled) this.jumpLatched = true;
  };

  /** While a menu is open keys are not captured (page shortcuts and buttons work normally). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.jumpLatched = false;
    if (!this.keyboard) return;
    if (enabled) this.keyboard.enableGlobalCapture();
    else {
      this.keyboard.disableGlobalCapture();
      this.keyboard.resetKeys();
    }
  }

  /** Current buttons (held + latched jump); 0 while disabled. Call once per fixed step. */
  sample(): number {
    if (!this.enabled) return 0;
    let buttons = 0;
    const held = (keys: Keys) => keys.some((key) => key.isDown);
    if (held(this.left)) buttons |= Button.LEFT;
    if (held(this.right)) buttons |= Button.RIGHT;
    if (held(this.down)) buttons |= Button.DOWN;
    if (held(this.jump) || this.jumpLatched) buttons |= Button.JUMP;

    const pad = this.firstPad();
    if (pad) {
      const { stickDeadzone, downThreshold, jumpButtons } = this.bindings.gamepad;
      const stick = pad.leftStick;
      if (pad.left || stick.x < -stickDeadzone) buttons |= Button.LEFT;
      if (pad.right || stick.x > stickDeadzone) buttons |= Button.RIGHT;
      if (pad.down || stick.y > downThreshold) buttons |= Button.DOWN;
      if (jumpButtons.some((i) => pad.buttons[i]?.pressed)) buttons |= Button.JUMP;
    }
    return buttons;
  }

  /** Edge-detects the gamepad menu button. Call once per rendered frame, even while paused. */
  pollMenu(): void {
    const pad = this.firstPad();
    const down = pad?.buttons[this.bindings.gamepad.menuButton]?.pressed ?? false;
    if (down && !this.menuWasDown) this.onMenu();
    this.menuWasDown = down;
  }

  /** Call after a simulation step used the sampled buttons. */
  consumeLatch(): void {
    this.jumpLatched = false;
  }

  /**
   * Releases keys and listeners; call on scene SHUTDOWN. Also safe after the game started
   * destroying itself: the keyboard plugin is then already gone (`manager` is null) and has
   * released its keys.
   */
  destroy(): void {
    for (const key of this.jump) key.off(Phaser.Input.Keyboard.Events.DOWN, this.latchJump);
    const keyboard = this.keyboard;
    if (keyboard?.manager) {
      for (const key of [...this.left, ...this.right, ...this.jump, ...this.down]) keyboard.removeKey(key, true);
      keyboard.enableGlobalCapture();
    }
    this.gamepad?.off(Phaser.Input.Gamepad.Events.BUTTON_DOWN, this.onPadDown);
    this.gameEvents.off(Phaser.Core.Events.BLUR, this.onBlur);
  }

  private firstPad(): Phaser.Input.Gamepad.Gamepad | null {
    const plugin = this.gamepad;
    if (!plugin || plugin.total === 0) return null;
    return plugin.getPad(0) ?? null;
  }
}
