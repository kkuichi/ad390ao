import { colors as defaultLight } from '../theme/colors';

// Farby kruhu rozpočtu podľa spotreby (spent / budget), hodnota môže presiahnuť 1 pri prečerpaní.
// `palette` = aktuálna téma z useAppTheme().colors (alebo default svetlá).


function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return { r: 128, g: 128, b: 128 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')}`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpHex(c1, c2, t) {
  const A = hexToRgb(c1);
  const B = hexToRgb(c2);
  return rgbToHex(lerp(A.r, B.r, t), lerp(A.g, B.g, t), lerp(A.b, B.b, t));
}

// spent / budget; 0 ak nie je rozpočet

export function getBudgetUsageRatio(spent, budget) {
  const b = Math.max(0, Number(budget) || 0);
  const s = Math.max(0, Number(spent) || 0);
  if (b <= 0) return 0;
  return s / b;
}

function ringStops(palette) {
  return [
    { x: 0, c: palette.secondary },
    { x: 0.32, c: '#5EB89E' },
    { x: 0.52, c: palette.success },
    { x: 0.66, c: '#7A9E55' },
    { x: 0.76, c: palette.accent },
    { x: 0.86, c: palette.warning },
    { x: 0.94, c: '#F97316' },
    { x: 1, c: palette.error },
    { x: 1.12, c: '#DC2626' },
    { x: 1.3, c: '#991B1B' },
  ];
}


export function getBudgetRingColorFromUsage(ratio, palette = defaultLight) {
  const stops = ringStops(palette);
  const r = Math.max(0, Math.min(ratio, stops[stops.length - 1].x));
  for (let i = 0; i < stops.length - 1; i += 1) {
    const lo = stops[i];
    const hi = stops[i + 1];
    if (r <= hi.x) {
      const span = hi.x - lo.x;
      const t = span <= 0 ? 0 : (r - lo.x) / span;
      return lerpHex(lo.c, hi.c, t);
    }
  }
  return stops[stops.length - 1].c;
}


// @param {typeof defaultLight} [palette]

export function getBudgetTrackColorFromUsage(ratio, palette = defaultLight) {
  const t = Math.max(0, Math.min(1, ratio));
  const lo = palette.backgroundSecondary;
  const hi = palette.cardPink;
  return lerpHex(lo, hi, t * t);
}
