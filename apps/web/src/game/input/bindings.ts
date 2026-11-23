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
    /** Aims the special ability upward (these keys may also jump). */
    up: readonly string[];
    attack: readonly string[];
    /** Special ability (aim with the arrow keys, the mouse or the right stick). */
    special: readonly string[];
  };
  mouse: {
    /** Left button swings, right button uses the special ability (aimed at the pointer). */
    enabled: boolean;
    /** The pointer aims for this long after it last moved. */
    aimHoldMs: number;
  };
  gamepad: {
    /** Stick deflection needed to count as left/right. */
    stickDeadzone: number;
    /** Stick deflection needed to count as down (drop-through). */
    downThreshold: number;
    jumpButtons: readonly number[];
    attackButtons: readonly number[];
    specialButtons: readonly number[];
    /** Right-stick deflection that aims the special ability. */
    aimDeadzone: number;
    menuButton: number;
  };
  /** On-screen joysticks (see `TouchInput`). Stick positions are fractions of the stick radius. */
  touch: {
    /** Walk-stick deflection needed to count as left/right. */
    walkDeadzone: number;
    /** Walk-stick deflection needed to count as down (drop-through with Jump). */
    downThreshold: number;
    /** Walk-stick deflection that flies the drone up (only while piloting it). */
    upThreshold: number;
    /** A special stick released closer to its centre than this fires straight ahead. */
    aimDeadzone: number;
    /** Horizontal drag that turns an attack-stick release into a swing to that side. */
    attackSideThreshold: number;
  };
}

export const DEFAULT_BINDINGS: Readonly<InputBindings> = {
  keyboard: {
    left: ['LEFT', 'A'],
    right: ['RIGHT', 'D'],
    jump: ['SPACE', 'UP', 'W', 'Z', 'K'],
    down: ['DOWN', 'S'],
    up: ['UP', 'W'],
    attack: ['J', 'X'],
    special: ['L', 'C'],
  },
  mouse: {
    enabled: true,
    aimHoldMs: 4000,
  },
  gamepad: {
    stickDeadzone: 0.35,
    downThreshold: 0.6,
    jumpButtons: [0, 1], // A / Cross, B / Circle
    attackButtons: [2], // X / Square
    specialButtons: [3, 5], // Y / Triangle, RB / R1
    aimDeadzone: 0.4,
    menuButton: 9, // Start / Options
  },
  touch: {
    walkDeadzone: 0.3,
    downThreshold: 0.6,
    upThreshold: 0.5,
    aimDeadzone: 0.3,
    attackSideThreshold: 0.35,
  },
};
