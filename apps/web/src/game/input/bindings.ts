/**
 * Default control bindings. Keyboard entries are Phaser key names
 * (`Phaser.Input.Keyboard.KeyCodes`); gamepad entries are standard-mapping button indices.
 */
export interface InputBindings {
  keyboard: {
    left: readonly string[];
    right: readonly string[];
    jump: readonly string[];
    down: readonly string[];
  };
  gamepad: {
    /** Stick deflection needed to count as left/right. */
    stickDeadzone: number;
    /** Stick deflection needed to count as down (drop-through). */
    downThreshold: number;
    jumpButtons: readonly number[];
    menuButton: number;
  };
}

export const DEFAULT_BINDINGS: Readonly<InputBindings> = {
  keyboard: {
    left: ['LEFT', 'A'],
    right: ['RIGHT', 'D'],
    jump: ['SPACE', 'UP', 'W', 'Z', 'K'],
    down: ['DOWN', 'S'],
  },
  gamepad: {
    stickDeadzone: 0.35,
    downThreshold: 0.6,
    jumpButtons: [0, 1], // A / Cross, B / Circle
    menuButton: 9, // Start / Options
  },
};
