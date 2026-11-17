/**
 * Colour math for the Color Picker view — no dependencies.
 *
 * Pipeline (all float until the very last step):
 *   sRGB 8-bit → linear sRGB → XYZ (D65) → OKLab → OKLCH
 *   OKLCH → OKLab → linear sRGB → sRGB (gamut-mapped by chroma reduction)
 *
 * Rounding happens only when a value becomes 8-bit RGB (the state boundary)
 * or when a string is formatted for display. Intermediates are never rounded,
 * so conversions do not drift.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** h 0–360, s/l 0–100 */
export interface HSL {
  h: number;
  s: number;
  l: number;
}

/** h 0–360, s/v 0–100 */
export interface HSV {
  h: number;
  s: number;
  v: number;
}

/** l 0–1, c 0–~0.4, h 0–360 */
export interface OKLCH {
  l: number;
  c: number;
  h: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Round to `decimals` — presentation only, never used mid-pipeline. */
export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const channel = (value: number): number => clamp(Math.round(value), 0, 255);

/** Clamp + round into the 8-bit domain. This is the only RGB boundary. */
export function normalizeRgb(rgb: RGB): RGB {
  return {
    r: channel(rgb.r),
    g: channel(rgb.g),
    b: channel(rgb.b),
  };
}

export function rgbEquals(a: RGB, b: RGB): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/* -------------------------------- HEX ---------------------------------- */

const HEX_PATTERN = /^[0-9a-f]{3}$|^[0-9a-f]{6}$/;

export function hexToRgb(input: string): RGB | null {
  const body = input.trim().replace(/^#/, "").toLowerCase();
  if (!HEX_PATTERN.test(body)) return null;
  const expanded =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function rgbToHex(rgb: RGB): string {
  const part = (v: number) => channel(v).toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`.toUpperCase();
}

/* -------------------------------- HSL ---------------------------------- */

export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l: l * 100 };

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let h: number;
  if (max === r) h = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  return { h: (h * 60) % 360, s: s * 100, l: l * 100 };
}

/** Returns unrounded 0–255 channels; caller normalizes. */
export function hslToRgb(hsl: HSL): RGB {
  const h = (((hsl.h % 360) + 360) % 360) / 360;
  const s = clamp(hsl.s, 0, 100) / 100;
  const l = clamp(hsl.l, 0, 100) / 100;

  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const hueToChannel = (t: number): number => {
    let tint = t;
    if (tint < 0) tint += 1;
    if (tint > 1) tint -= 1;
    if (tint < 1 / 6) return p + (q - p) * 6 * tint;
    if (tint < 1 / 2) return q;
    if (tint < 2 / 3) return p + (q - p) * (2 / 3 - tint) * 6;
    return p;
  };

  return {
    r: hueToChannel(h + 1 / 3) * 255,
    g: hueToChannel(h) * 255,
    b: hueToChannel(h - 1 / 3) * 255,
  };
}

/* -------------------------------- HSV ---------------------------------- */

export function rgbToHsv(rgb: RGB): HSV {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60) % 360;
  }

  return { h, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
}

export function hsvToRgb(hsv: HSV): RGB {
  const h = (((hsv.h % 360) + 360) % 360) / 60;
  const s = clamp(hsv.s, 0, 100) / 100;
  const v = clamp(hsv.v, 0, 100) / 100;

  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));

  const table: [number, number, number][] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  const [r, g, b] = table[i % 6];
  return { r: r * 255, g: g * 255, b: b * 255 };
}

/* ------------------------------ sRGB ⇄ linear --------------------------- */

export function srgbToLinear(value: number): number {
  const c = clamp(value, 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

/* ------------------------------ OKLab / OKLCH -------------------------- */

interface LinearRGB {
  r: number;
  g: number;
  b: number;
}

function linearRgbToOklab(lin: LinearRGB): { L: number; a: number; b: number } {
  // Ottosson's direct linear-sRGB → LMS matrix (no intermediate XYZ step).
  const l = 0.4122214708 * lin.r + 0.5363325363 * lin.g + 0.0514459929 * lin.b;
  const m = 0.2119034982 * lin.r + 0.6806995451 * lin.g + 0.1073969566 * lin.b;
  const s = 0.0883024619 * lin.r + 0.2817188376 * lin.g + 0.6299787005 * lin.b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearRgb(lab: { L: number; a: number; b: number }): LinearRGB {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function rgbToOklch(rgb: RGB): OKLCH {
  const lin: LinearRGB = {
    r: srgbToLinear(rgb.r),
    g: srgbToLinear(rgb.g),
    b: srgbToLinear(rgb.b),
  };
  const lab = linearRgbToOklab(lin);
  const c = Math.hypot(lab.a, lab.b);
  const h = c < 1e-6 ? 0 : ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
  return { l: lab.L, c, h };
}

function oklchToSrgbFloat(lch: OKLCH): LinearRGB {
  const rad = (lch.h * Math.PI) / 180;
  const lab = { L: lch.l, a: Math.cos(rad) * lch.c, b: Math.sin(rad) * lch.c };
  const lin = oklabToLinearRgb(lab);
  return { r: linearToSrgb(lin.r), g: linearToSrgb(lin.g), b: linearToSrgb(lin.b) };
}

function inGamut(rgb: LinearRGB): boolean {
  const eps = 1e-4;
  return (
    rgb.r >= -eps && rgb.r <= 1 + eps && rgb.g >= -eps && rgb.g <= 1 + eps && rgb.b >= -eps && rgb.b <= 1 + eps
  );
}

/**
 * OKLCH → 8-bit sRGB with perceptual gamut mapping: if the requested chroma is
 * outside sRGB, chroma is reduced by bisection at constant lightness and hue.
 * Lightness is never clipped to fake a match.
 */
export function oklchToRgb(lch: OKLCH): RGB {
  const l = clamp(lch.l, 0, 1);
  const hue = ((lch.h % 360) + 360) % 360;
  const c = Math.max(0, lch.c);

  if (l <= 0) return { r: 0, g: 0, b: 0 };
  if (l >= 1) return { r: 255, g: 255, b: 255 };

  let candidate = oklchToSrgbFloat({ l, c, h: hue });

  if (!inGamut(candidate) && c > 0) {
    let low = 0;
    let high = c;
    for (let i = 0; i < 28; i += 1) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToSrgbFloat({ l, c: mid, h: hue }))) low = mid;
      else high = mid;
    }
    candidate = oklchToSrgbFloat({ l, c: low, h: hue });
  }

  return normalizeRgb({ r: candidate.r * 255, g: candidate.g * 255, b: candidate.b * 255 });
}

/* ------------------------------- Contrast ------------------------------ */

/** WCAG 2.x relative luminance from 8-bit sRGB. */
export function relativeLuminance(rgb: RGB): number {
  const lin = (value: number): number => {
    const c = clamp(value, 0, 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Black or white — whichever is more legible on the given colour. */
export function bestTextOn(rgb: RGB): "#000000" | "#FFFFFF" {
  return contrastRatio(rgb, { r: 255, g: 255, b: 255 }) >= contrastRatio(rgb, { r: 0, g: 0, b: 0 })
    ? "#FFFFFF"
    : "#000000";
}

/* -------------------------------- Ramp --------------------------------- */

export interface RampStep {
  step: number;
  hex: string;
  rgb: RGB;
  /** OKLCH lightness 0–1, useful for ordering / labels. */
  l: number;
}

/**
 * Nine tint/shade steps derived from the active colour: hue is held, lightness
 * sweeps from near-white to near-black, chroma tapers at both ends so the ramp
 * stays inside sRGB without hue shifts.
 */
export function tonalRamp(base: RGB, steps = 9): RampStep[] {
  const { c: baseC, h: baseH } = rgbToOklch(base);
  const top = 0.965;
  const bottom = 0.235;

  return Array.from({ length: steps }, (_, index) => {
    const t = steps === 1 ? 0 : index / (steps - 1);
    const l = top + (bottom - top) * t;
    const taper = 0.34 + 0.66 * Math.sin(Math.PI * clamp(l, 0, 1));
    const c = Math.max(baseC, 0.012) * taper;
    const rgb = oklchToRgb({ l, c, h: baseH });
    return { step: (index + 1) * 100, hex: rgbToHex(rgb), rgb, l };
  });
}

/* ------------------------------ Formatting ----------------------------- */

export function cssRgb(rgb: RGB): string {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
}

export function cssHsl(rgb: RGB): string {
  const { h, s, l } = rgbToHsl(rgb);
  return `hsl(${round(h)} ${round(s, 1)}% ${round(l, 1)}%)`;
}

export function cssHsv(rgb: RGB): string {
  const { h, s, v } = rgbToHsv(rgb);
  return `hsv(${round(h)} ${round(s, 1)}% ${round(v, 1)}%)`;
}

export function cssOklch(rgb: RGB): string {
  const { l, c, h } = rgbToOklch(rgb);
  return `oklch(${round(l * 100, 1)}% ${round(c, 3)} ${round(h, 1)})`;
}
