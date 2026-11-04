import { expect, test } from "bun:test";
import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import { Markdown } from "./markdown-view";
import { PALETTE, rgb } from "./theme";
import { inColor } from "./truecolor";

const colored = (text: string, width: number) => inColor(() => renderToString(<Markdown text={text} width={width} />, { columns: width }));
const drawn = (text: string, width: number) =>
  stripVTControlCharacters(colored(text, width))
    .split("\n")
    .map((line) => line.trimEnd());
const fg = (hex: string) => `\x1b[38;2;${rgb(hex).join(";")}m`;

test("draws inline code in the code color alone, with no fill and no padding", () => {
  expect(drawn("Run `bun test` now.", 40)).toEqual(["Run bun test now."]);
  const line = colored("Run `bun test` now.", 40);
  expect(line).toContain(`${fg(PALETTE.tealLight)}bun test`);
  expect(line).not.toContain("\x1b[48;");
});

test("wraps inline code as it wraps the words around it", () => {
  expect(drawn("Run `bun test --watch` now.", 12)).toEqual(["Run bun test", "--watch now."]);
});

test("lines up table columns with code in them", () => {
  const table = ["| Key | Does |", "| --- | --- |", "| `a` | one |", "| b | two |"].join("\n");
  expect(drawn(table, 40)).toEqual(["Key   Does", "───   ────", "a     one", "b     two"]);
});

test("an Important callout in Claude's words isn't gold, which marks only you", () => {
  const callout = colored("> [!IMPORTANT]\n> Back up first.", 40);
  expect(stripVTControlCharacters(callout)).toContain("Important");
  expect(callout).not.toContain(`38;2;${rgb(PALETTE.gold).join(";")}m`);
});
