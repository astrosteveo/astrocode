// astrocode's palette: the Hubble palette, the gold and teal of narrowband space photographs.
// Gold is you: your messages, whatever waits on you, your cursor and selection. Teal is Claude.
// Everything else stays quiet so those two read at a glance.
//
// The quiet colors are shades of the terminal's own theme, from the background and text colors
// it reported as astrocode started (`colors.ts`): panels a step off the background, secondary
// text between the text color and the background. The accents keep their hues, made darker or
// lighter only where they'd be hard to read on that background, as on a light theme. A terminal
// that doesn't say gets the dark palette astrocode was drawn with.
import { terminalColors } from "./colors";

/** ASTROCODE_ACCENT, when it's a hex color: shades of it are mixed for the mirror and the selection. */
const chosen = /^#[0-9a-f]{6}$/i.test(process.env.ASTROCODE_ACCENT?.trim() ?? "") ? process.env.ASTROCODE_ACCENT?.trim() : undefined;

/** The accents as drawn on a dark background. */
const HUBBLE = {
  gold: "#F0B85A",
  goldDeep: "#B07E2C",
  teal: "#56C6B6",
  tealLight: "#93D9CD",
  rose: "#F2707E",
  ember: "#F0975E",
  sky: "#86A8F0",
};

/** The quiet colors for when the terminal doesn't say what its own are. */
const DARK = {
  star: "#E8ECF4",
  haze: "#9097AB",
  dust: "#6A7290",
  surface: "#222737",
  raised: "#30374D",
  hover: "#292F42",
  ink: "#141722",
  glint: "#FFE2A0",
  flare: "#FFF4D6",
};

export const PALETTE = palette(terminalColors.background, terminalColors.foreground);

function palette(page: string | undefined, text: string | undefined) {
  if (!page) return { ...HUBBLE, gold: chosen || HUBBLE.gold, ...DARK };
  const dark = isDark(page);
  const ink = text ?? (dark ? DARK.star : "#1E2030");
  const surface = step(page, ink, 1.2);
  const raised = step(page, ink, 1.5);
  const accent = (hex: string, ratio = 3) => readable(hex, page, ratio);
  const gold = chosen || accent(HUBBLE.gold);
  return {
    /** You. Set ASTROCODE_ACCENT to a hex color to change it. */
    gold,
    /** The mirror's deeper segments. */
    goldDeep: accent(HUBBLE.goldDeep, 2),
    /** Claude: its replies, its tools, and work that went well. */
    teal: accent(HUBBLE.teal),
    /** Code strings and inline code, a lighter teal. */
    tealLight: accent(HUBBLE.tealLight),
    /** Errors and failures. */
    rose: accent(HUBBLE.rose),
    /** Stopped, denied, and warnings. */
    ember: accent(HUBBLE.ember),
    /** Links, plan mode, and keywords in code. */
    sky: accent(HUBBLE.sky),
    /** Bright text: headings and values, past the terminal's own text color. */
    star: mix(ink, dark ? "#FFFFFF" : "#000000", 0.35),
    /** Secondary text, readable. */
    haze: readable(mix(ink, page, 0.4), page, 4.5),
    /** The rail, panel edges and other lines, and the quietest hints, so it reads at 3:1 at least. */
    dust: readable(mix(ink, page, 0.58), page, 3),
    /** Panels: code, output, the message box and the cards that ask you things. */
    surface,
    /** A selected row, inline code and other raised marks on a panel. */
    raised,
    /** Under the pointer: a row or control a click would act on, halfway from surface to raised. */
    hover: mix(surface, raised, 0.5),
    /** Text on a gold or teal chip, which is light on a dark theme and darkened on a light one. */
    ink: dark ? mix(page, "#000000", 0.4) : mix(page, "#FFFFFF", 0.6),
    /** The mirror's brightest gold, and the flare that lights a segment. A light page shows plain gold. */
    glint: dark ? DARK.glint : gold,
    flare: dark ? DARK.flare : gold,
  };
}

/** Lines a diff added and removed: the panel, tinted toward teal or rose. */
export const TINT = {
  added: mix(PALETTE.surface, PALETTE.teal, 0.16),
  removed: mix(PALETTE.surface, PALETTE.rose, 0.16),
  /** The words of a changed line that changed. */
  addedWords: mix(PALETTE.surface, PALETTE.teal, 0.34),
  removedWords: mix(PALETTE.surface, PALETTE.rose, 0.34),
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

/** Whether a background is dark: white text reads better on it than black. */
export function isDark(hex: string) {
  return contrast(hex, "#FFFFFF") > contrast(hex, "#000000");
}

/** WCAG's contrast ratio between two colors, from 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function luminance(hex: string) {
  const [r = 0, g = 0, b = 0] = rgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The background moved toward the text color until it stands at `ratio` against the background,
 * so a panel is the same visible step off any theme's background, near-black ones included.
 */
function step(page: string, text: string, ratio: number) {
  for (let amount = 0.02; amount < 1; amount += 0.01) {
    const shade = mix(page, text, amount);
    if (contrast(shade, page) >= ratio) return shade;
  }
  return text;
}

/** `hex`, moved away from the background just far enough to stand at `ratio` against it. */
function readable(hex: string, background: string, ratio: number) {
  const away = isDark(background) ? "#FFFFFF" : "#000000";
  for (let step = 0; step <= 10; step++) {
    const shade = mix(hex, away, step / 10);
    if (contrast(shade, background) >= ratio) return shade;
  }
  return away;
}

/** A terminal color code for a hex color, foreground or background. */
export function sgr(hex: string, background = false) {
  const [r, g, b] = rgb(hex);
  return `\x1b[${background ? 48 : 38};2;${r};${g};${b}m`;
}
