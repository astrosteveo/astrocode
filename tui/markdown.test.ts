import { expect, test } from "bun:test";
import { rowWidth, spans, width, wrapSpans, type Span } from "./markdown";

const code = (text: string): Span => ({ text, style: "code" });
const plain = (text: string): Span => ({ text, style: "plain" });

test("counts inline code as wide as its text, with no padding", () => {
  expect(width("run `bun test` now")).toBe(4 + 8 + 4);
  expect(rowWidth([plain("run "), code("bun"), plain(" now")])).toBe(4 + 3 + 4);
});

test("keeps inline code on the row where its text fits", () => {
  expect(wrapSpans(spans("ab `cd`"), 4)).toEqual([[plain("ab")], [code("cd")]]);
  expect(wrapSpans(spans("ab `cd`"), 5)).toEqual([[plain("ab "), code("cd")]]);
});

test("wraps inline code at its spaces", () => {
  expect(wrapSpans(spans("`aaa bbb`"), 7)).toEqual([[code("aaa bbb")]]);
  expect(wrapSpans(spans("`aaa bbb`"), 6)).toEqual([[code("aaa")], [code("bbb")]]);
});

test("cuts inline code longer than a row", () => {
  expect(wrapSpans(spans("`abcdefgh`"), 4)).toEqual([[code("abcd")], [code("efgh")]]);
});

test("keeps every row within its room", () => {
  const text = "Run `bun test --watch` in `tui/` or `src/`, then `git status` to see what changed.";
  for (let room = 4; room <= 40; room++) {
    for (const row of wrapSpans(spans(text), room)) expect(rowWidth(row)).toBeLessThanOrEqual(room);
  }
});
