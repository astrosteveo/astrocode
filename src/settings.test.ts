import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { scratchConfig } from "../tui/scratch-config";
import { loadSettings, settingsPath } from "./settings";

const config = scratchConfig();
beforeEach(config.start);
afterEach(config.stop);

test("a settings file from before Follow Claude retired loads the rest, without following", async () => {
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify({ follow: true, mode: "acceptEdits", keepWarm: true }));
  const loaded = await loadSettings();
  expect(loaded).toEqual({ mode: "acceptEdits", keepWarm: true });
  expect("follow" in loaded).toBe(false);
});
