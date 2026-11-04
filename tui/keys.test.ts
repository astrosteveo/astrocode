import { expect, test } from "bun:test";
import type { Key } from "ink";
import { CLAUDE_CODE_DEFAULTS } from "./fixtures/claude-code-keybindings";
import { ACTIONS, DEFAULT_KEYMAP, keyFor, keyLabel, parseChord, strokeOf } from "./keys";

/** Claude Code's default bindings, each chord in the spelling astrocode matches keys by. */
const claude = Object.values(CLAUDE_CODE_DEFAULTS).flatMap((bindings) => Object.entries(bindings).map(([written, action]) => [parseChord(written), action] as const));

const listed = (bindings: readonly (readonly [string | null, string])[]) => bindings.map(([chord, action]) => `${chord} ${action}`).sort();

/** A key as Ink reports it, with only the flags given set. */
const pressed = (input: string, flags: Partial<Key>) => strokeOf(input, flags as Key);

test("astrocode's default keys are Claude Code's, for each action both have", () => {
  const shared = claude.filter(([, action]) => action in ACTIONS);
  const ours = [...DEFAULT_KEYMAP].filter(([, action]) => action !== "chat:followClaude");
  expect(listed(ours)).toEqual(listed(shared));
});

test("astrocode's own action takes a key Claude Code leaves free", () => {
  const own = keyFor(DEFAULT_KEYMAP, "chat:followClaude");
  expect(claude.map(([chord]) => chord)).not.toContain(own);
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
