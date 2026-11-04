import { expect, test } from "bun:test";
import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import { version } from "../package.json";
import { initialState, type State } from "../src/view/state";
import { cellWidth } from "./markdown";
import { DEFAULT_KEYMAP, type Keymap } from "./keys";
import { StartScreen, startOf, startReady } from "./start";
import { Store } from "./store";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const MINUTE = 60_000;

/** A fresh screen in a project, once Claude Code has said what it loaded and the sessions here are listed. */
const fresh = (more: Partial<State> = {}): State => ({
  ...initialState("/home/u/retrykit", "/home/u"),
  model: "claude-opus-5-5",
  effort: "xhigh",
  loaded: { version: "2.1.318", claudeMd: 1, plugins: 8, mcpServers: 3, skills: 41 },
  recent: [
    { id: "a", title: "Retry tries exactly attempts times", modified: NOW - 12 * MINUTE },
    { id: "b", title: "Plan getText's clock", modified: NOW - 120 * MINUTE },
    { id: "c", title: "Retry gets a deadline", modified: NOW - 26 * 60 * MINUTE },
  ],
  ...more,
});

/** The start screen as plain lines, `width` columns wide. */
const draw = (state: State, width = 120, keymap: Keymap = DEFAULT_KEYMAP) =>
  stripVTControlCharacters(renderToString(<StartScreen start={startOf(state, "feat/cache-clock", keymap, NOW)} width={width} />, { columns: width })).split("\n");

const lineWith = (lines: string[], text: string) => lines.find((line) => line.includes(text));

test("says where you are, what came from Claude Code, the recent sessions here and eight keys", () => {
  const lines = draw(fresh());
  expect(lines[0]).toBe("");
  expect(lines[1]).toBe(`  astrocode  ${version} · Claude Code 2.1.318 underneath`);
  expect(lines[2]).toBe("  ~/retrykit · feat/cache-clock · Opus 5.5 xhigh · ask first");
  expect(lines[3]).toBe("  From Claude Code: CLAUDE.md · 8 plugins · 3 MCP servers · 41 skills");
  expect(lineWith(lines, "Recent sessions here")).toBe("  Recent sessions here   /resume picks one · astrocode -c continues the last");
  const recent = lines.indexOf(lineWith(lines, "Recent sessions here")!);
  expect(lines.slice(recent + 1, recent + 4).map((line) => line.trim().replace(/ {2,}/, " | "))).toEqual([
    "Retry tries exactly attempts times | 12m ago",
    "Plan getText's clock | 2h ago",
    "Retry gets a deadline | 1d ago",
  ]);
  expect(lineWith(lines, "Keys")?.trim()).toBe("Keys");
  const keys = lines.indexOf(lineWith(lines, "Keys")!);
  expect(lines.slice(keys + 1, keys + 3).map((line) => line.trim().split(/ {2,}/))).toEqual([
    ["/ commands", "@ files", "! shell command", "/help keys and commands"],
    ["shift+tab mode", "ctrl+o tool output", "← agents", "esc stop Claude"],
  ]);
  // Nothing is drawn large, and the mirror is gone.
  expect(lines.join("\n")).not.toMatch(/[⬢▄█▀]/);
});

test("fits 80 columns with the keys two across, and keeps to the measure at 200", () => {
  const narrow = draw(fresh(), 80);
  for (const line of narrow) expect(cellWidth(line)).toBeLessThanOrEqual(78);
  // The age ends at the right edge: two columns in from the side.
  expect(lineWith(narrow, "Retry tries exactly")).toEndWith("12m ago");
  expect(cellWidth(lineWith(narrow, "Retry tries exactly")!)).toBe(78);
  const keys = narrow.indexOf(lineWith(narrow, "Keys")!);
  expect(narrow.slice(keys + 1, keys + 5).map((line) => line.trim().split(/ {2,}/))).toEqual([
    ["/ commands", "@ files"],
    ["! shell command", "/help keys and commands"],
    ["shift+tab mode", "ctrl+o tool output"],
    ["← agents", "esc stop Claude"],
  ]);

  const wide = draw(fresh(), 200);
  for (const line of wide) expect(cellWidth(line)).toBeLessThanOrEqual(112);
  expect(cellWidth(lineWith(wide, "Retry tries exactly")!)).toBe(112);
});

test("a long title is cut to leave room for its age", () => {
  const title = "Make the retry loop honour the deadline and the attempts limit at the same time, everywhere";
  const lines = draw(fresh({ recent: [{ id: "a", title, modified: NOW - 12 * MINUTE }] }), 80);
  const row = lineWith(lines, "Make the retry")!;
  expect(row).toContain("…");
  expect(row).toEndWith("12m ago");
  expect(cellWidth(row)).toBe(78);
});

test("says only what it knows: nothing from Claude Code before it reports, and no counts of none", () => {
  const before = draw(fresh({ loaded: undefined, model: undefined, effort: undefined, recent: [] }));
  expect(before[1]).toBe(`  astrocode  ${version}`);
  expect(before[2]).toBe("  ~/retrykit · feat/cache-clock · ask first");
  expect(lineWith(before, "From Claude Code")).toBeUndefined();
  // With no sessions here yet, there's nothing to list.
  expect(lineWith(before, "Recent sessions")).toBeUndefined();

  const some = draw(fresh({ loaded: { version: "2.1.318", claudeMd: 2, plugins: 1, mcpServers: 0, skills: undefined }, effort: undefined }));
  expect(some[2]).toBe("  ~/retrykit · feat/cache-clock · Opus 5.5 · ask first");
  expect(some[3]).toBe("  From Claude Code: 2 CLAUDE.md files · 1 plugin");
});

test("names keys as you've bound them, and your keybindings as loaded", () => {
  const keymap = new Map(DEFAULT_KEYMAP);
  keymap.delete("shift+tab");
  keymap.set("meta+m", "chat:cycleMode");
  keymap.delete("ctrl+o");
  const lines = draw(fresh(), 120, keymap);
  expect(lines[3]).toBe("  From Claude Code: CLAUDE.md · 8 plugins · 3 MCP servers · 41 skills · your keybindings");
  expect(lines.join("\n")).toContain("alt+m mode");
  // A key bound to nothing isn't offered.
  expect(lines.join("\n")).not.toContain("tool output");
});

test("is ready once Claude Code has said what it loaded and the sessions here are listed", () => {
  expect(startReady(fresh())).toBe(true);
  expect(startReady(fresh({ loaded: undefined }))).toBe(false);
  expect(startReady(fresh({ recent: undefined }))).toBe(false);
});

test("a new screen lists the sessions again, and keeps what Claude Code loaded", () => {
  const store = new Store("/home/u/retrykit", "/home/u");
  store.emit({ kind: "loaded", loaded: { version: "2.1.318", skills: 3 } });
  store.emit({ kind: "recent", sessions: [{ id: "a", title: "Earlier", modified: NOW }] });
  expect(startReady(store.getSnapshot())).toBe(true);
  store.reset();
  expect(store.getSnapshot().loaded).toEqual({ version: "2.1.318", skills: 3 });
  expect(store.getSnapshot().recent).toBeUndefined();
});
