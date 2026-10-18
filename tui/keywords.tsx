// The two words Claude Code reads as requests when you type them: `ultrathink`, deeper reasoning
// for the turn, and `ultracode`, a workflow of agents for it. Claude Code finds them in the
// message itself; astrocode only shows them, letter by letter through the palette's accents, in
// the message box and in the message once it's sent.
import { Text } from "ink";
import type { ReactNode } from "react";
import { mix, PALETTE } from "./theme";

export type Keyword = { word: "ultrathink" | "ultracode"; start: number; end: number };

/** As Claude Code matches them: whole words, in any case. */
const KEYWORDS = /\b(ultrathink|ultracode)\b/gi;

export function keywordsIn(text: string): Keyword[] {
  return [...text.matchAll(KEYWORDS)].map((match) => ({
    word: match[0].toLowerCase() as Keyword["word"],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** The accents a keyword runs through, from your gold to Claude's teal. */
const STOPS = [PALETTE.gold, PALETTE.ember, PALETTE.rose, PALETTE.sky, PALETTE.teal];

/** The color of letter `i` of a word `length` letters long. */
export function keywordColor(i: number, length: number) {
  const t = length > 1 ? (i / (length - 1)) * (STOPS.length - 1) : 0;
  const at = Math.min(STOPS.length - 2, Math.floor(t));
  return mix(STOPS[at]!, STOPS[at + 1]!, t - at);
}

/**
 * `text` from `from` to `to`, with the letters of its keywords in their colors and the rest as it
 * was. An ignored `ultracode` is dimmed: the word goes as typed, but it won't start a workflow.
 */
export function paintKeywords(text: string, from: number, to: number, keywords: Keyword[], ignored = false): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = from;
  for (const keyword of keywords) {
    if (keyword.end <= from || keyword.start >= to) continue;
    const start = Math.max(from, keyword.start);
    const end = Math.min(to, keyword.end);
    if (start > at) parts.push(text.slice(at, start));
    for (let i = start; i < end; i++) {
      const letter = i - keyword.start;
      if (ignored && keyword.word === "ultracode") {
        parts.push(
          <Text key={i} color={PALETTE.dust}>
            {text[i]}
          </Text>,
        );
      } else {
        parts.push(
          <Text key={i} color={keywordColor(letter, keyword.end - keyword.start)}>
            {text[i]}
          </Text>,
        );
      }
    }
    at = end;
  }
  if (at < to) parts.push(text.slice(at, to));
  return parts;
}
