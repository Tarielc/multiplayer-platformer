/**
 * The game's controls, one row per action, for each way to play: keyboard, gamepad, the touch
 * controls on a phone, and the pocket handheld's pad. Shown on the home page, the How to play
 * screen and in the pause menu.
 */
export interface ControlRow {
  action: string;
  /** Extra how-to for the action. */
  detail?: string;
  /** Keys, each shown as a keycap. */
  keys: string[];
  /** Words after the keycaps (mouse, modifiers). */
  keysNote?: string;
  pad: string;
  touch: string;
  pocket: string;
}

export const CONTROL_ROWS: readonly ControlRow[] = [
  {
    action: 'Move',
    keys: ['←', '→', 'A', 'D'],
    pad: 'Left stick, D-pad',
    touch: 'Walk stick (left)',
    pocket: 'D-pad',
  },
  {
    action: 'Jump',
    detail: 'hold for higher, again in mid-air to double jump',
    keys: ['Space', '↑', 'W', 'Z', 'K'],
    pad: 'A / B',
    touch: 'Jump button',
    pocket: 'A',
  },
  {
    action: 'Drop through planks',
    keys: ['↓'],
    keysNote: '+ jump',
    pad: 'Down + A',
    touch: 'Walk stick down + Jump',
    pocket: 'Down + A',
  },
  {
    action: 'Attack',
    detail: 'shoves players, breaks boxes',
    keys: ['J', 'X'],
    pad: 'X / □',
    touch: 'Attack stick: lift to swing, drag first to aim',
    pocket: 'B',
  },
  {
    action: 'Special ability',
    detail: 'fruit recharges it',
    keys: ['L', 'C'],
    keysNote: 'right-click · aim with arrows or mouse',
    pad: 'Y / RB · aim with the right stick',
    touch: 'Special stick: drag to aim, lift to fire',
    pocket: 'S stick: drag to aim, let go to fire',
  },
  {
    action: 'Menu',
    detail: 'F3 toggles the debug overlay',
    keys: ['Esc', 'F3'],
    pad: 'Start',
    touch: 'Menu button (top right)',
    pocket: 'Start',
  },
];

/** A row's keyboard keys as keycaps, then its note. */
export function ControlKeys({ row, className }: { row: ControlRow; className?: string }) {
  return (
    <span className={className}>
      {row.keys.map((key, i) => (
        <span key={key}>
          {i > 0 && ' '}
          <kbd>{key}</kbd>
        </span>
      ))}
      {row.keysNote && ` ${row.keysNote}`}
    </span>
  );
}
