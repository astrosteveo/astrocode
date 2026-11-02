import { expect, test } from "bun:test";
import { renderToString } from "ink";
import { Markdown } from "./markdown-view";

const drawn = (text: string, width: number) =>
  renderToString(<Markdown text={text} width={width} />, { columns: width })
    .split("\n")
    .map((line) => line.trimEnd());

test("draws inline code as a chip, a cell of padding on each side", () => {
  expect(drawn("Run `bun test` now.", 40)).toEqual(["Run  bun test  now."]);
});

test("pads each row's piece of inline code it wraps", () => {
  expect(drawn("Run `bun test --watch` now.", 14)).toEqual(["Run  bun test", " --watch  now."]);
});

test("lines up table columns with the chips in them", () => {
  const table = ["| Key | Does |", "| --- | --- |", "| `a` | one |", "| b | two |"].join("\n");
  expect(drawn(table, 40)).toEqual(["Key   Does", "───   ────", " a    one", "b     two"]);
});
