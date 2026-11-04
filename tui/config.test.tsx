import { expect, test } from "bun:test";
import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import { ConfigMenu, type ConfigValues } from "./config";

const values: ConfigValues = { ultracode: false, thinking: true, mode: "default", todos: "auto", fullscreen: true, notify: "off", usage: "auto", keepWarm: false, agentSummaries: false, remoteControl: false, follow: true };

test("Follow Claude's note says where its panel is: above the message box, at every width", () => {
  const drawn = stripVTControlCharacters(renderToString(<ConfigMenu models={[]} initial={values} path="/p" ultracodeAvailable={false} width={240} onClose={() => {}} />, { columns: 240 }));
  const line = drawn.split("\n").find((one) => one.includes("Follow Claude"));
  expect(line).toContain("above the message box");
  expect(line).not.toContain("beside");
});
