import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Key } from "ink";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_CODE_DEFAULTS } from "./fixtures/claude-code-keybindings";
import { ACTIONS, DEFAULT_KEYMAP, keyLabel, loadKeymap, parseChord, strokeOf } from "./keys";
import { scratchConfig } from "./scratch-config";

/** Claude Code's default bindings, each chord in the spelling astrocode matches keys by. */
const claude = Object.values(CLAUDE_CODE_DEFAULTS).flatMap((bindings) => Object.entries(bindings).map(([written, action]) => [parseChord(written), action] as const));

const listed = (bindings: readonly (readonly [string | null, string])[]) => bindings.map(([chord, action]) => `${chord} ${action}`).sort();

/** A key as Ink reports it, with only the flags given set. */
const pressed = (input: string, flags: Partial<Key>) => strokeOf(input, flags as Key);

// keybindings.json is read from the scratch folder's Claude Code config, never yours.
const config = scratchConfig();
beforeEach(config.start);
afterEach(config.stop);

/** Keymap and notices from a keybindings.json with these Chat bindings. */
async function bound(bindings: Record<string, string | null>) {
  const folder = join(config.folder(), "claude");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "keybindings.json"), JSON.stringify({ bindings: [{ context: "Chat", bindings }] }));
  return loadKeymap();
}

test("astrocode's default keys are Claude Code's, for each action both have, and none of its own", () => {
  const shared = claude.filter(([, action]) => action in ACTIONS);
  expect(listed([...DEFAULT_KEYMAP])).toEqual(listed(shared));
});

test("chat:followClaude is retired: a keybindings.json that binds it hears what took its place, and the key does nothing", async () => {
  const { keymap, problems } = await bound({ "meta+l": "chat:followClaude", "meta+m": "chat:cycleMode" });
  expect(keymap.get("meta+l")).toBeUndefined();
  expect(keymap.get("meta+m")).toBe("chat:cycleMode");
  expect(problems).toHaveLength(1);
  expect(problems[0]!.tone).toBe("info");
  expect(problems[0]!.text).toContain("chat:followClaude");
  expect(problems[0]!.text).toContain("retired");
  expect(problems[0]!.text).toContain("running call");
  expect(problems[0]!.text).not.toContain("doesn't have");
  expect(problems[0]!.text).toContain("Ctrl+O, then Enter");
  // It names the key that goes to the transcript as you've bound it.
  const rebound = await bound({ "meta+l": "chat:followClaude", "ctrl+o": null, "ctrl+x o": "app:toggleTranscript" });
  expect(rebound.problems[0]!.text).toContain("Ctrl+X O, then Enter");
});

test("an action astrocode never had is named as one it doesn't have", async () => {
  const { problems } = await bound({ "ctrl+k": "chat:somethingElse" });
  expect(problems.map((one) => one.text)).toEqual([expect.stringContaining("doesn't have chat:somethingElse")]);
});

test("Ctrl+L is chat:clearInput, which redraws as in claude rather than clearing the box", () => {
  const stroke = pressed("l", { ctrl: true });
  expect(stroke).toBe("ctrl+l");
  expect(DEFAULT_KEYMAP.get(stroke!)).toBe("chat:clearInput");
  expect(ACTIONS["chat:clearInput"]).toBe("redraw");
});

test("Ctrl+D is app:exit", () => {
  const stroke = pressed("d", { ctrl: true });
  expect(stroke).toBe("ctrl+d");
  expect(DEFAULT_KEYMAP.get(stroke!)).toBe("app:exit");
});

test("Shift+↑ and Shift+↓ step the effort", () => {
  expect(DEFAULT_KEYMAP.get(pressed("", { upArrow: true, shift: true })!)).toBe("chat:increaseEffort");
  expect(DEFAULT_KEYMAP.get(pressed("", { downArrow: true, shift: true })!)).toBe("chat:decreaseEffort");
  // The bare arrows stay the box's own: lines, then history.
  expect(DEFAULT_KEYMAP.get(pressed("", { upArrow: true })!)).toBeUndefined();
});

test("Esc is the box's own, which stops Claude, clears the box or rewinds", () => {
  expect(DEFAULT_KEYMAP.get(pressed("", { escape: true })!)).toBeUndefined();
});

test("keys read in prose, arrows as arrows", () => {
  expect(keyLabel("shift+up")).toBe("Shift+↑");
  expect(keyLabel("ctrl+x ctrl+k")).toBe("Ctrl+X Ctrl+K");
});
