/**
 * Placeholder fan sheet (`sprites/traps/fan.png`): 5 frames of 24×8, blowing up. Frame 0 is
 * the fan switched off, frames 1–4 spin. Drop real art over the file; the game reads the frame
 * count from the image width.
 */
export const FAN_FRAME = { width: 24, height: 8, frames: 5 } as const;

type Rgba = readonly [number, number, number, number];

const HOUSING_TOP: Rgba = [107, 115, 133, 255];
const HOUSING: Rgba = [74, 81, 97, 255];
const HOUSING_BOTTOM: Rgba = [44, 49, 60, 255];
const BOLT: Rgba = [201, 209, 222, 255];
const RIM: Rgba = [93, 101, 117, 255];
const BLADE_LIGHT: Rgba = [201, 209, 222, 255];
const BLADE_DARK: Rgba = [125, 134, 150, 255];
const BLADE_OFF_LIGHT: Rgba = [150, 158, 172, 255];
const BLADE_OFF_DARK: Rgba = [98, 106, 121, 255];

export function paintFanPlaceholder(): { width: number; height: number; data: Uint8ClampedArray } {
  const { width: fw, height: fh, frames } = FAN_FRAME;
  const width = fw * frames;
  const data = new Uint8ClampedArray(width * fh * 4);
  const set = (x: number, y: number, c: Rgba) => data.set(c, (y * width + x) * 4);

  for (let f = 0; f < frames; f++) {
    const ox = f * fw;
    // Housing: rows 5–7, bolts at both ends.
    for (let x = 0; x < fw; x++) {
      set(ox + x, 5, HOUSING_TOP);
      set(ox + x, 6, HOUSING);
      set(ox + x, 7, HOUSING_BOTTOM);
    }
    set(ox + 1, 6, BOLT);
    set(ox + fw - 2, 6, BOLT);
    // Rim around the blades.
    for (let x = 2; x < fw - 2; x++) set(ox + x, 1, RIM);
    for (let y = 1; y < 5; y++) {
      set(ox + 2, y, RIM);
      set(ox + fw - 3, y, RIM);
    }
    // Blades: stripes that shift each frame, so the loop reads as spinning.
    const off = f === 0;
    const shift = off ? 0 : (f - 1) * 2;
    for (let y = 2; y < 5; y++) {
      for (let x = 3; x < fw - 3; x++) {
        const light = (x + shift) % 6 < 2;
        set(ox + x, y, off ? (light ? BLADE_OFF_LIGHT : BLADE_OFF_DARK) : light ? BLADE_LIGHT : BLADE_DARK);
      }
    }
  }
  return { width, height: fh, data };
}
