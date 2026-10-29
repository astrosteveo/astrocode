import { expect, test } from "bun:test";
import { renderToString } from "ink";
import type { ModNode } from "../src/session";
import { ModTree } from "./mod-tree";

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g, "");
const draw = (node: ModNode, width = 60) => plain(renderToString(<ModTree node={node} width={width} onPress={() => {}} />, { columns: width }));

test("draws a mod's boxes, text and buttons as the terminal lays them out", () => {
  const band: ModNode = {
    type: "Box",
    props: { flexDirection: "column" },
    children: [
      { type: "Text", props: { bold: true }, children: ["review"] },
      {
        type: "Box",
        props: { flexDirection: "row", gap: 1 },
        children: [
          { type: "Text", props: { color: "warning" }, children: ["2 findings open"] },
          { type: "Button", props: { key: "go", label: "Review again" }, press: { plugin: "p", handle: 1 } },
        ],
      },
      { type: "engine", ref: 1 },
    ],
  };
  expect(draw(band).split("\n")).toEqual(["review", "2 findings open [ Review again ]"]);
});

test("nests text and links inside text, and draws a picture by its words", () => {
  const node: ModNode = {
    type: "Box",
    props: { flexDirection: "column" },
    children: [
      { type: "Text", children: ["see ", { type: "Link", props: { href: "https://example.com", label: "the docs" } }, " now"] },
      { type: "Svg", props: { source: "<svg/>", alt: "a chart of rounds" } },
      { type: "Client", props: { module: "./x.tsx" } },
    ],
  };
  expect(draw(node).split("\n")).toEqual(["see the docs now", "a chart of rounds"]);
});
