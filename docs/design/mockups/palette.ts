// Colors for the mockups. Directions A and B use astrocode's roles, derived as tui/theme.ts derives
// them from the terminal's own colors (here Tokyo Night, as the audit's terminal was set up).
// Direction C uses Claude Code's dark-theme colors, since its point is to look like claude.

/** `a` blended toward `b` by `amount` (0 to 1). */
export function mix(a: string, b: string, amount: number) {
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + ((y[i] ?? 0) - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

const page = "#1a1b26";
const text = "#c0caf5";
const surface = "#24273a";
const teal = "#56c6b6";
const rose = "#f2707e";

export const P = {
  page,
  text,
  /** Headings, your words, values: brighter than the terminal's text. */
  bright: "#d6dcf8",
  /** Secondary text. */
  haze: "#8188a6",
  /** Lines, hints and the quietest marks. */
  dust: "#5f6580",
  /** Panels: code, diffs, the box, prompts. */
  surface,
  /** A selected row on a panel. */
  raised: "#30344a",
  /** You: your keys, your cursor, and whatever waits on you. */
  gold: "#f0b85a",
  /** Claude at work, and work that went well. */
  teal,
  /** Code in prose. */
  code: "#93d9cd",
  /** Failed. */
  rose,
  /** Stopped, denied. */
  ember: "#f0975e",
  /** Links and plan mode. */
  sky: "#86a8f0",
  /** Text on a filled chip. */
  ink: "#101119",
  added: mix(surface, teal, 0.16),
  removed: mix(surface, rose, 0.16),
  addedWords: mix(surface, teal, 0.34),
  removedWords: mix(surface, rose, 0.34),
};

/** Claude Code 2.1's dark theme, as it draws on a dark terminal. */
export const CC = {
  page,
  text: "#e6e6e6",
  dim: "#999999",
  faint: "#6b6b6b",
  claude: "#d77757",
  permission: "#b1b9f9",
  success: "#4eba65",
  error: "#ff6b80",
  warning: "#ffc107",
  promptBg: "#373737",
  added: "#225c2b",
  removed: "#7a2936",
  addedWords: "#38a148",
  removedWords: "#b3394d",
  /** astrocode's additions, so they can be told apart in the mockup. */
  ours: "#56c6b6",
};
