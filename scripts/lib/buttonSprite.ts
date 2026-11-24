/**
 * Button sheet (`sprites/traps/button.png`): 2 frames of 24×8 sitting on the floor. Frame 0 is
 * the button up (off, red cap standing 6 px tall), frame 1 pressed down (on, green cap flush with
 * the 3 px base plate, with a lit dot). The simulation body (14×3, `TRAP_TUNING.button`: the
 * pressed cap, solid) sits at (5, 5) inside a frame, so the frame's bottom row is on the floor.
 */
export const BUTTON_FRAME = { width: 24, height: 8, frames: 2 } as const;

type Rgba = readonly [number, number, number, number];

const OUTLINE: Rgba = [33, 31, 48, 255];
const BASE_TOP: Rgba = [141, 150, 167, 255];
const BASE_BOTTOM: Rgba = [80, 87, 104, 255];
const BOLT: Rgba = [214, 221, 232, 255];

const OFF_LIGHT: Rgba = [255, 138, 120, 255];
const OFF: Rgba = [222, 72, 64, 255];
const OFF_DARK: Rgba = [150, 40, 52, 255];
const ON_LIGHT: Rgba = [184, 246, 132, 255];
const ON_DARK: Rgba = [46, 128, 64, 255];
const GLOW: Rgba = [255, 255, 214, 255];

export function paintButtonSprite(): { width: number; height: number; data: Uint8ClampedArray } {
  const { width: fw, height: fh, frames } = BUTTON_FRAME;
  const width = fw * frames;
  const data = new Uint8ClampedArray(width * fh * 4);
  const set = (x: number, y: number, c: Rgba) => data.set(c, (y * width + x) * 4);
  const row = (ox: number, y: number, x0: number, x1: number, c: Rgba) => {
    for (let x = x0; x <= x1; x++) set(ox + x, y, c);
  };

  for (let f = 0; f < frames; f++) {
    const ox = f * fw;
    const on = f === 1;

    // Metal base plate on the floor: rows 5–7, outlined, with a bolt at each end.
    row(ox, 5, 2, 21, OUTLINE);
    for (const y of [6, 7]) {
      set(ox + 1, y, OUTLINE);
      set(ox + 22, y, OUTLINE);
    }
    row(ox, 6, 2, 21, BASE_TOP);
    row(ox, 7, 2, 21, BASE_BOTTOM);
    set(ox + 3, 6, BOLT);
    set(ox + 20, 6, BOLT);

    if (on) {
      // Pressed: the cap sits in the plate, its top flush with the plate's (3 px up).
      set(ox + 5, 5, OUTLINE);
      set(ox + 18, 5, OUTLINE);
      row(ox, 5, 6, 17, ON_LIGHT);
      row(ox, 6, 5, 18, OUTLINE);
      row(ox, 6, 6, 17, ON_DARK);
      set(ox + 11, 5, GLOW);
      set(ox + 12, 5, GLOW);
    } else {
      // Up: the cap stands 3 px proud of the plate (6 px up), rounded at the top.
      row(ox, 2, 6, 17, OUTLINE);
      for (let y = 3; y <= 6; y++) {
        set(ox + 5, y, OUTLINE);
        set(ox + 18, y, OUTLINE);
        row(ox, y, 6, 17, y === 3 ? OFF_LIGHT : y === 6 ? OFF_DARK : OFF);
      }
      set(ox + 7, 3, GLOW);
      set(ox + 6, 4, OFF_LIGHT);
    }
  }
  return { width, height: fh, data };
}
