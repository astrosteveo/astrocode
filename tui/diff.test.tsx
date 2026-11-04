import { expect, test } from "bun:test";
import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import { Diff, diffLines } from "./diff";

test("a diff on a panel 140 wide or wider shows the old lines beside the new", () => {
  const lines = diffLines("const a = 1;\nconst b = 2;", "const a = 1;\nconst b = 3;");
  const drawn = (width: number) => stripVTControlCharacters(renderToString(<Diff lines={lines} width={width} limit={10} path="a.ts" framed={false} />, { columns: width }));
  expect(drawn(139)).not.toContain("│");
  expect(drawn(150)).toMatch(/const b = 2;.*│.*const b = 3;/);
});
