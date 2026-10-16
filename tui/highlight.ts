// Syntax colors from astrocode's palette, so code reads as part of the same picture: keywords in
// sky, strings in light teal, functions in soft gold, numbers in ember, comments in italic haze.
import { highlight, supportsLanguage, type Theme } from "cli-highlight";
import { mix, PALETTE, sgr } from "./theme";

const ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  yml: "yaml",
  md: "markdown",
};

const SOFT_GOLD = mix(PALETTE.gold, PALETTE.star, 0.3);
const LIGHT_SKY = mix(PALETTE.sky, PALETTE.star, 0.35);

/**
 * A color for a kind of token. Highlighted spans nest, so an inner span's closing code would end
 * the outer color early; the outer color is opened again after each one, as chalk does.
 */
function paint(hex: string, style: { italic?: boolean; bold?: boolean } = {}) {
  const open = `${sgr(hex)}${style.italic ? "\x1b[3m" : ""}${style.bold ? "\x1b[1m" : ""}`;
  const close = `${style.bold ? "\x1b[22m" : ""}${style.italic ? "\x1b[23m" : ""}\x1b[39m`;
  return (text: string) => `${open}${text.replaceAll("\x1b[39m", `\x1b[39m${open}`)}${close}`;
}

const plain = (text: string) => text;

/** Whether to color at all: NO_COLOR or FORCE_COLOR=0 turns it off, as it does for the rest of the interface. */
const colors = !process.env.NO_COLOR && process.env.FORCE_COLOR !== "0";

const THEME: Theme = {
  keyword: paint(PALETTE.sky),
  built_in: paint(LIGHT_SKY),
  type: paint(LIGHT_SKY),
  literal: paint(PALETTE.ember),
  number: paint(PALETTE.ember),
  regexp: paint(PALETTE.rose),
  string: paint(PALETTE.tealLight),
  subst: plain,
  symbol: paint(PALETTE.ember),
  class: paint(LIGHT_SKY),
  function: paint(SOFT_GOLD),
  title: paint(SOFT_GOLD),
  params: plain,
  comment: paint(PALETTE.haze, { italic: true }),
  doctag: paint(PALETTE.haze, { bold: true }),
  meta: paint(PALETTE.haze),
  "meta-keyword": paint(PALETTE.sky),
  "meta-string": paint(PALETTE.tealLight),
  section: paint(SOFT_GOLD, { bold: true }),
  tag: paint(PALETTE.haze),
  name: paint(PALETTE.sky),
  "builtin-name": paint(LIGHT_SKY),
  attr: paint(SOFT_GOLD),
  attribute: paint(SOFT_GOLD),
  variable: paint(PALETTE.star),
  bullet: paint(PALETTE.ember),
  code: paint(PALETTE.tealLight),
  emphasis: paint(PALETTE.star, { italic: true }),
  strong: paint(PALETTE.star, { bold: true }),
  formula: paint(PALETTE.tealLight),
  link: paint(PALETTE.sky),
  quote: paint(PALETTE.haze, { italic: true }),
  "selector-tag": paint(PALETTE.sky),
  "selector-id": paint(SOFT_GOLD),
  "selector-class": paint(SOFT_GOLD),
  "selector-attr": paint(SOFT_GOLD),
  "selector-pseudo": paint(PALETTE.sky),
  "template-tag": paint(PALETTE.ember),
  "template-variable": paint(PALETTE.ember),
  addition: paint(PALETTE.teal),
  deletion: paint(PALETTE.rose),
  default: plain,
};

/** Source code with terminal color codes for its syntax, or as it was for a language we can't read. */
export function highlightCode(source: string, language: string) {
  const name = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  if (!colors || !name || !supportsLanguage(name)) return source;
  try {
    return highlight(source, { language: name, ignoreIllegals: true, theme: THEME });
  } catch {
    return source;
  }
}
