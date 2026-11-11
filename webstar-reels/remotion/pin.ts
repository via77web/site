type Pt = [number, number];

/**
 * The CSS matrix3d that maps a w x h box (origin top-left) onto four corner points
 * (top-left, top-right, bottom-right, bottom-left): a corner pin.
 */
export function cornerPin(w: number, h: number, q: [Pt, Pt, Pt, Pt]): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const k = (dx1 * dy3 - dx3 * dy1) / det;
  // Unit square -> quad, then scaled so the box's own size maps to the unit square.
  const a = (x1 - x0 + g * x1) / w, b = (x3 - x0 + k * x3) / h, c = x0;
  const d = (y1 - y0 + g * y1) / w, e = (y3 - y0 + k * y3) / h, f = y0;
  return `matrix3d(${a},${d},0,${g / w}, ${b},${e},0,${k / h}, 0,0,1,0, ${c},${f},0,1)`;
}
