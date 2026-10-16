// The terminal palette. Named colors follow your terminal's theme; the accent and the nebula
// gradient are astrocode's own, from nebula-ui's presets (Catppuccin Mocha's pastels).
const PRESETS: Record<string, string> = {
  nebula: "#b4befe",
  ember: "#fab387",
  mint: "#94e2d5",
  rose: "#f5c2e7",
  gold: "#f9e2af",
};

const chosen = process.env.ASTROCODE_ACCENT?.trim();

/** Set ASTROCODE_ACCENT to a preset, a hex color or a terminal color name. */
export const ACCENT = (chosen && (PRESETS[chosen] ?? chosen)) || "#b4befe";

export const COLOR = {
  muted: "gray",
  success: "green",
  error: "red",
  warning: "yellow",
  info: "blue",
} as const;

/** Lavender, mauve, pink, peach: the colors of a nebula, for the wordmark and the activity shimmer. */
export const NEBULA = ["#b4befe", "#cba6f7", "#f5c2e7", "#fab387"];

/** A share's color: calm, getting full, nearly out (as nebula-ui's dashboard). */
export function tone(share: number) {
  return share < 0.6 ? COLOR.success : share < 0.85 ? COLOR.warning : COLOR.error;
}

/** The color at `t` (0 to 1) along a gradient through `stops`. */
export function gradient(stops: string[], t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  const span = (stops.length - 1) * clamped;
  const at = Math.min(stops.length - 2, Math.floor(span));
  return mix(stops[at] ?? "#ffffff", stops[at + 1] ?? "#ffffff", span - at);
}

/** `a` blended toward `b` by `amount` (0 to 1). */
export function mix(a: string, b: string, amount: number) {
  const from = rgb(a);
  const to = rgb(b);
  const channel = (i: number) => Math.round((from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * amount);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

function rgb(hex: string) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
