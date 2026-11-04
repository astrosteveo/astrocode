import { expect, test } from "bun:test";
import { cursorOn, findIn, hasContent, plain, selectedText } from "./selection";
import { PALETTE, rgb } from "./theme";

const fg = (hex: string) => `\x1b[38;2;${rgb(hex).join(";")}m`;
const bg = (hex: string) => `\x1b[48;2;${rgb(hex).join(";")}m`;

/** `run `bun test` now` as full screen draws it: the code on its raised background, with a cell of it on each side. */
const line = `run ${bg(PALETTE.raised)}${fg(PALETTE.tealLight)} bun test \x1b[39m\x1b[49m now`;
const across = { row: 0, col: 0 };
const toEnd = { row: 0, col: 20 };

test("copies inline code without the padding around it", () => {
  expect(plain(line)).toBe("run  bun test  now");
  expect(selectedText([{ text: line, inset: 0 }], across, toEnd)).toBe("run bun test now");
});

test("finds words that run into inline code", () => {
  expect(findIn(line, "run bun")).toEqual([[0, 8]]);
  expect(findIn(line, "test now")).toEqual([[9, 18]]);
});

test("keeps the spaces of the text itself", () => {
  const spaced = `a  b  ${bg(PALETTE.raised)} c d \x1b[49m`;
  expect(selectedText([{ text: spaced, inset: 0 }], across, toEnd)).toBe("a  b  c d");
});

test("the cursor's row has a gold mark in the gutter and is raised to the edge, a panel's cells keeping their own", () => {
  const row = `${fg(PALETTE.dust)}│\x1b[39m see ${bg(PALETTE.surface)}code\x1b[49m after`;
  const drawn = cursorOn(row, 1, 24);
  expect(plain(drawn)).toBe("│›see code after        ");
  expect(drawn).toContain(`${bg(PALETTE.raised)}${fg(PALETTE.gold)}›`);
  // The panel's own background stays on its cells, and the raise comes back after it.
  expect(drawn).toContain(`${bg(PALETTE.surface)}code\x1b[49m${bg(PALETTE.raised)} after`);
});

test("the cursor stops on rows with something past the rail, not on blank rows, panels' edges or pictures", () => {
  expect(hasContent(`${fg(PALETTE.dust)}│\x1b[39m`, 2)).toBe(false);
  expect(hasContent("│   Read  a.ts", 2)).toBe(true);
  expect(hasContent(`│ ${fg(PALETTE.surface)}▄▄▄▄\x1b[39m`, 2)).toBe(false);
  expect(hasContent(`│ ${bg(PALETTE.surface)}      \x1b[49m`, 2)).toBe(false);
  expect(hasContent("│ \u{10EEEE}\u{10EEEE}", 2)).toBe(false);
});
