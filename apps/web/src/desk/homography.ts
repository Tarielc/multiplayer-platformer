import type { ScreenQuad } from './deskScene';

/**
 * CSS transform that maps a `width`×`height` box (origin top-left) onto `quad` (top-left,
 * top-right, bottom-right, bottom-left). When the quad is just the box moved, it returns a
 * whole-pixel translate so the content stays crisp.
 */
export function quadTransform(width: number, height: number, quad: ScreenQuad): string {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = quad;
  if (
    Math.abs(x1 - x0 - width) < 1.5 &&
    Math.abs(y3 - y0 - height) < 1.5 &&
    Math.abs(y1 - y0) < 0.5 &&
    Math.abs(x3 - x0) < 0.5 &&
    Math.abs(x2 - x1) < 0.5 &&
    Math.abs(y2 - y3) < 0.5
  ) {
    return `translate(${Math.round(x0)}px, ${Math.round(y0)}px)`;
  }
  // Unit square -> quad (Heckbert), then scaled down to the box.
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, d: number, e: number, g: number, h: number;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0;
    b = x2 - x1;
    d = y1 - y0;
    e = y2 - y1;
    g = 0;
    h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
  }
  const m = [a / width, d / width, 0, g / width, b / height, e / height, 0, h / height, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map((n) => +n.toFixed(8)).join(',')})`;
}
