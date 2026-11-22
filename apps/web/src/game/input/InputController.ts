import { Button, withAim } from '@platformer/shared';
import * as Phaser from 'phaser';
import { DEFAULT_BINDINGS, type InputBindings } from './bindings';

type Keys = Phaser.Input.Keyboard.Key[];

/**
 * Turns keyboard + gamepad state into the shared `Button` bitmask, once per fixed step.
 *
 * Jump and Attack presses are latched until a simulation step consumes them, so a quick tap
 * between two steps (high refresh rates, low frame rates) is never lost.
 */
export class InputController {
  private readonly left: Keys;
  private readonly right: Keys;
  private readonly jump: Keys;
  private readonly down: Keys;
  private readonly up: Keys;
  private readonly attack: Keys;
  private readonly special: Keys;
  private readonly keyboard: Phaser.Input.Keyboard.KeyboardPlugin | null;
  private readonly gamepad: Phaser.Input.Gamepad.GamepadPlugin | null;
  private readonly gameEvents: Phaser.Events.EventEmitter;
  private readonly input: Phaser.Input.InputPlugin;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private lastMouseMove = -Infinity;
  /** Buttons pressed since the last consumed step (Button.JUMP | Button.ATTACK | Button.SPECIAL). */
  private latched = 0;
  private menuWasDown = false;
  private enabled = true;
  private readonly onPadDown = (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
    if (!this.enabled) return;
    if (this.bindings.gamepad.jumpButtons.includes(button.index)) this.latched |= Button.JUMP;
    if (this.bindings.gamepad.attackButtons.includes(button.index)) this.latched |= Button.ATTACK;
    if (this.bindings.gamepad.specialButtons.includes(button.index)) this.latched |= Button.SPECIAL;
  };
  private readonly onPointerMove = () => {
    this.lastMouseMove = performance.now();
  };
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (!this.enabled || !this.bindings.mouse.enabled) return;
    this.lastMouseMove = performance.now();
    if (pointer.rightButtonDown()) this.latched |= Button.SPECIAL;
    else if (pointer.leftButtonDown()) this.latched |= Button.ATTACK;
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
    this.input = scene.input;
    this.camera = scene.cameras.main;
    const add = (names: readonly string[]) => names.map((name) => this.keyboard!.addKey(name, true, false));
    const kb = bindings.keyboard;
    this.left = this.keyboard ? add(kb.left) : [];
    this.right = this.keyboard ? add(kb.right) : [];
    this.jump = this.keyboard ? add(kb.jump) : [];
    this.down = this.keyboard ? add(kb.down) : [];
    this.up = this.keyboard ? add(kb.up) : [];
    this.attack = this.keyboard ? add(kb.attack) : [];
    this.special = this.keyboard ? add(kb.special) : [];
    for (const key of this.jump) key.on(Phaser.Input.Keyboard.Events.DOWN, this.latchJump);
    for (const key of this.attack) key.on(Phaser.Input.Keyboard.Events.DOWN, this.latchAttack);
    for (const key of this.special) key.on(Phaser.Input.Keyboard.Events.DOWN, this.latchSpecial);
    if (bindings.mouse.enabled) {
      scene.input.mouse?.disableContextMenu();
      scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
      scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
    }
    this.gamepad?.on(Phaser.Input.Gamepad.Events.BUTTON_DOWN, this.onPadDown);
    this.gameEvents.on(Phaser.Core.Events.BLUR, this.onBlur);
  }

  private readonly latchJump = () => {
    if (this.enabled) this.latched |= Button.JUMP;
  };

  private readonly latchAttack = () => {
    if (this.enabled) this.latched |= Button.ATTACK;
  };

  private readonly latchSpecial = () => {
    if (this.enabled) this.latched |= Button.SPECIAL;
  };

  /** While a menu is open keys are not captured (page shortcuts and buttons work normally). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.latched = 0;
    if (!this.keyboard) return;
    if (enabled) this.keyboard.enableGlobalCapture();
    else {
      this.keyboard.disableGlobalCapture();
      this.keyboard.resetKeys();
    }
  }

  /**
   * Current buttons (held + latched presses) with the special ability's aim when one is given
   * (`aimAngle`); 0 while disabled. Call once per fixed step.
   */
  sample(aim: number | null = null): number {
    if (!this.enabled) return 0;
    let buttons = this.latched;
    const held = (keys: Keys) => keys.some((key) => key.isDown);
    if (held(this.left)) buttons |= Button.LEFT;
    if (held(this.right)) buttons |= Button.RIGHT;
    if (held(this.down)) buttons |= Button.DOWN;
    if (held(this.jump)) buttons |= Button.JUMP;
    if (held(this.attack)) buttons |= Button.ATTACK;
    if (held(this.special)) buttons |= Button.SPECIAL;

    const pad = this.firstPad();
    if (pad) {
      const { stickDeadzone, downThreshold, jumpButtons, attackButtons } = this.bindings.gamepad;
      const stick = pad.leftStick;
      if (pad.left || stick.x < -stickDeadzone) buttons |= Button.LEFT;
      if (pad.right || stick.x > stickDeadzone) buttons |= Button.RIGHT;
      if (pad.down || stick.y > downThreshold) buttons |= Button.DOWN;
      if (jumpButtons.some((i) => pad.buttons[i]?.pressed)) buttons |= Button.JUMP;
      if (attackButtons.some((i) => pad.buttons[i]?.pressed)) buttons |= Button.ATTACK;
      if (this.bindings.gamepad.specialButtons.some((i) => pad.buttons[i]?.pressed)) buttons |= Button.SPECIAL;
    }
    if (this.input.mouse && this.bindings.mouse.enabled && this.input.activePointer.rightButtonDown()) buttons |= Button.SPECIAL;
    return aim === null ? buttons : withAim(buttons, aim);
  }

  /**
   * Where the player aims (world angle, 0 = right, y down) from `origin` (world px), or null
   * for "straight ahead": the right stick, else the mouse pointer if it moved lately, else the
   * arrow keys (up / down, with left / right for diagonals).
   */
  aimAngle(originX: number, originY: number, facing: 1 | -1): number | null {
    if (!this.enabled) return null;
    const pad = this.firstPad();
    if (pad) {
      const stick = pad.rightStick;
      if (Math.hypot(stick.x, stick.y) > this.bindings.gamepad.aimDeadzone) return Math.atan2(stick.y, stick.x);
    }
    const held = (keys: Keys) => keys.some((key) => key.isDown);
    const up = held(this.up) || (pad ? pad.up || pad.leftStick.y < -this.bindings.gamepad.downThreshold : false);
    const down = held(this.down) || (pad ? pad.down || pad.leftStick.y > this.bindings.gamepad.downThreshold : false);
    if (up !== down) {
      const h = (held(this.right) ? 1 : 0) - (held(this.left) ? 1 : 0);
      return Math.atan2(up ? -1 : 1, h);
    }
    if (this.bindings.mouse.enabled && this.input.mouse && performance.now() - this.lastMouseMove < this.bindings.mouse.aimHoldMs) {
      const pointer = this.input.activePointer;
      const world = pointer.positionToCamera(this.camera) as Phaser.Math.Vector2;
      const dx = world.x - originX;
      const dy = world.y - originY;
      if (Math.hypot(dx, dy) > 4) return Math.atan2(dy, dx);
    }
    return null;
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
    this.latched = 0;
  }

  /**
   * Releases keys and listeners; call on scene SHUTDOWN. Also safe after the game started
   * destroying itself: the keyboard plugin is then already gone (`manager` is null) and has
   * released its keys.
   */
  destroy(): void {
    for (const key of this.jump) key.off(Phaser.Input.Keyboard.Events.DOWN, this.latchJump);
    for (const key of this.attack) key.off(Phaser.Input.Keyboard.Events.DOWN, this.latchAttack);
    for (const key of this.special) key.off(Phaser.Input.Keyboard.Events.DOWN, this.latchSpecial);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
    const keyboard = this.keyboard;
    if (keyboard?.manager) {
      for (const key of [...this.left, ...this.right, ...this.jump, ...this.down, ...this.up, ...this.attack, ...this.special]) {
        keyboard.removeKey(key, true);
      }
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
