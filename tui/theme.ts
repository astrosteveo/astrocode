// astrocode's palette: the Hubble palette, the gold and teal of narrowband space photographs.
// Gold is you: your messages, whatever waits on you, your cursor and selection. Teal is Claude.
// Everything else stays quiet so those two read at a glance.
/** ASTROCODE_ACCENT, when it's a hex color: shades of it are mixed for the mirror and the selection. */
const chosen = /^#[0-9a-f]{6}$/i.test(process.env.ASTROCODE_ACCENT?.trim() ?? "") ? process.env.ASTROCODE_ACCENT?.trim() : undefined;

export const PALETTE = {
  /** You. Set ASTROCODE_ACCENT to a hex color to change it. */
  gold: chosen || "#F0B85A",
  /** The mirror's deeper segments. */
  goldDeep: "#B07E2C",
  /** Claude: its replies, its tools, and work that went well. */
  teal: "#56C6B6",
  /** Code strings and inline code, a lighter teal. */
  tealLight: "#93D9CD",
  /** Errors and failures. */
  rose: "#F2707E",
  /** Stopped, denied, and warnings. */
  ember: "#F0975E",
  /** Links, plan mode, and keywords in code. */
  sky: "#86A8F0",
  /** Bright text: headings and values. */
  star: "#E8ECF4",
  /** Secondary text, readable. */
  haze: "#9097AB",
  /** The rail, panel edges and other lines. */
  dust: "#6A7290",
  /** Panels: code, output, the message box and the cards that ask you things. */
  surface: "#222737",
  /** A selected row, inline code and other raised marks on a panel. */
  raised: "#30374D",
  /** Text on a gold or teal chip. */
  ink: "#141722",
} as const;

/** Lines a diff added and removed: the panel, tinted toward teal or rose. */
export const TINT = {
  added: mix(PALETTE.surface, PALETTE.teal, 0.16),
  removed: mix(PALETTE.surface, PALETTE.rose, 0.16),
};

/** A share's color: calm, getting full, nearly out. */
export function tone(share: number) {
  return share < 0.6 ? PALETTE.teal : share < 0.85 ? PALETTE.ember : PALETTE.rose;
}

/** `a` blended toward `b` by `amount` (0 to 1). */
export function mix(a: string, b: string, amount: number) {
  const from = rgb(a);
  const to = rgb(b);
  const channel = (i: number) => Math.round((from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * amount);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

export function rgb(hex: string) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A terminal color code for a hex color, foreground or background. */
export function sgr(hex: string, background = false) {
  const [r, g, b] = rgb(hex);
  return `\x1b[${background ? 48 : 38};2;${r};${g};${b}m`;
}
