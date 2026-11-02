import { expect, test } from "bun:test";
import { rowWidth, spans, width, wrapSpans, type Span } from "./markdown";

const code = (text: string): Span => ({ text, style: "code" });
const plain = (text: string): Span => ({ text, style: "plain" });

test("counts the cell of padding on each side of inline code", () => {
  expect(width("run `bun test` now")).toBe(4 + 1 + 8 + 1 + 4);
  expect(rowWidth([plain("run "), code("bun"), plain(" now")])).toBe(4 + 1 + 3 + 1 + 4);
});

test("wraps before inline code that fits only without its padding", () => {
  expect(wrapSpans(spans("ab `cd`"), 6)).toEqual([[plain("ab")], [code("cd")]]);
  expect(wrapSpans(spans("ab `cd`"), 7)).toEqual([[plain("ab "), code("cd")]]);
});

test("pads each row's piece of inline code", () => {
  expect(wrapSpans(spans("`aaa bbb`"), 9)).toEqual([[code("aaa bbb")]]);
  expect(wrapSpans(spans("`aaa bbb`"), 8)).toEqual([[code("aaa")], [code("bbb")]]);
});

test("cuts inline code longer than a row to leave room for its padding", () => {
  expect(wrapSpans(spans("`abcdefgh`"), 6)).toEqual([[code("abcd")], [code("efgh")]]);
});

test("keeps every row within its room, padding and all", () => {
  const text = "Run `bun test --watch` in `tui/` or `src/`, then `git status` to see what changed.";
  for (let room = 4; room <= 40; room++) {
    for (const row of wrapSpans(spans(text), room)) expect(rowWidth(row)).toBeLessThanOrEqual(room);
  }
});
