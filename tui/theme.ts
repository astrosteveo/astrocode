// The terminal palette. Named colors follow your terminal's theme; the accent is astrocode's own,
// from nebula-ui's presets. Set ASTROCODE_ACCENT to a preset, a hex color or a terminal color name.
const PRESETS: Record<string, string> = {
  nebula: "#b4befe",
  ember: "#fab387",
  mint: "#94e2d5",
  rose: "#f5c2e7",
  gold: "#f9e2af",
};

const chosen = process.env.ASTROCODE_ACCENT?.trim();

export const ACCENT = (chosen && (PRESETS[chosen] ?? chosen)) || "#b4befe";

export const COLOR = {
  muted: "gray",
  success: "green",
  error: "red",
  warning: "yellow",
  info: "blue",
} as const;
