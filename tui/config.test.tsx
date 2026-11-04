import { expect, test } from "bun:test";
import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import { ConfigMenu, type ConfigValues } from "./config";

const values: ConfigValues = { ultracode: false, thinking: true, mode: "default", todos: "auto", fullscreen: true, notify: "off", usage: "auto", keepWarm: false, agentSummaries: false, remoteControl: false };

test("/config has no Follow Claude: opening the running call's line took its place", () => {
  const drawn = stripVTControlCharacters(renderToString(<ConfigMenu models={[]} initial={values} path="/p" ultracodeAvailable={false} width={120} onClose={() => {}} />, { columns: 120 }));
  expect(drawn).toContain("Full screen");
  expect(drawn).not.toContain("Follow");
});
