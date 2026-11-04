import { afterAll, beforeAll, expect, test } from "bun:test";
import { render, renderToString } from "ink";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { version } from "../package.json";
import type { AgentSession } from "../src/session";
import { initialState, type State } from "../src/view/state";
import { App } from "./app";
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
const draw = (state: State, width = 120, keymap: Keymap = DEFAULT_KEYMAP, branch = "feat/cache-clock") =>
  stripVTControlCharacters(renderToString(<StartScreen start={startOf(state, branch, keymap, NOW)} width={width} />, { columns: width })).split("\n");

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

test("says only what it knows: nothing from Claude Code before it reports, not even the mode, and no counts of none", () => {
  const before = draw(fresh({ loaded: undefined, model: undefined, effort: undefined, recent: [] }));
  expect(before[1]).toBe(`  astrocode  ${version}`);
  expect(before[2]).toBe("  ~/retrykit · feat/cache-clock");
  expect(lineWith(before, "From Claude Code")).toBeUndefined();
  // With no sessions here yet, there's nothing to list.
  expect(lineWith(before, "Recent sessions")).toBeUndefined();

  const some = draw(fresh({ loaded: { version: "2.1.318", claudeMd: 2, plugins: 1, mcpServers: 0, skills: undefined }, effort: undefined }));
  expect(some[2]).toBe("  ~/retrykit · feat/cache-clock · Opus 5.5 · ask first");
  expect(some[3]).toBe("  From Claude Code: 2 CLAUDE.md files · 1 plugin");
});

test("keeps the folder's name when the rest of where you are fills the line, and cuts a long branch first", () => {
  const state = fresh({ cwd: "/home/u/Projects/work/clients/retrykit", mode: "auto" });
  const where = (width: number, branch: string) => draw(state, width, DEFAULT_KEYMAP, branch)[2];

  const long = where(80, "dependabot/npm_and_yarn/anthropic-ai/claude-agent-sdk-0.3.302");
  expect(long).toStartWith("  …/retrykit · dependabot/");
  expect(long).toContain("…");
  expect(long).toEndWith(" · Opus 5.5 xhigh · auto");
  expect(cellWidth(long)).toBeLessThanOrEqual(78);

  // With no room to spare, the line is cut at its end, after the folder and the branch.
  const narrow = where(40, "main");
  expect(narrow).toStartWith("  …/retrykit · main · Opus 5.5");
  expect(cellWidth(narrow)).toBeLessThanOrEqual(38);

  // With room enough, all of it.
  expect(where(120, "main")).toBe("  ~/Projects/work/clients/retrykit · main · Opus 5.5 xhigh · auto");
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

test("a new screen waits for the sessions here again, and keeps what Claude Code loaded", () => {
  const store = new Store("/home/u/retrykit", "/home/u");
  store.emit({ kind: "loaded", loaded: { version: "2.1.318", skills: 3 } });
  store.emit({ kind: "recent", sessions: [{ id: "a", title: "Earlier", modified: NOW }] });
  expect(startReady(store.getSnapshot())).toBe(true);
  store.reset();
  expect(store.getSnapshot().loaded).toEqual({ version: "2.1.318", skills: 3 });
  expect(store.getSnapshot().recent).toBeUndefined();
});

// A Claude Code config folder of its own, with two sessions saved in a project.
const root = mkdtempSync(join(tmpdir(), "astrocode-start-"));
const project = join(root, "retrykit");
const RESUMED = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const configDir = process.env.CLAUDE_CONFIG_DIR;

beforeAll(() => {
  process.env.CLAUDE_CONFIG_DIR = root;
  mkdirSync(project);
  const saved = join(root, "projects", project.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(saved, { recursive: true });
  for (const [id, text] of [
    [RESUMED, "Make retries back off"],
    [OTHER, "Give retries a deadline"],
  ]) {
    const line = { type: "user", message: { role: "user", content: text }, sessionId: id, cwd: project, uuid: id, timestamp: new Date().toISOString() };
    writeFileSync(join(saved, `${id}.jsonl`), `${JSON.stringify(line)}\n`);
  }
});

afterAll(() => {
  if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = configDir;
  rmSync(root, { recursive: true, force: true });
});

/** astrocode in scrollback on a fake terminal, short enough that a start screen drawn live would fill it, and all it wrote. */
function launch(store: Store, knownId?: string) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 16 });
  let drawn = "";
  stdout.on("data", (chunk: Buffer) => {
    drawn += chunk.toString();
  });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  // A stand-in Claude Code session: whatever's asked of it does nothing.
  const known: Record<string, unknown> = { knownId, id: knownId, watchMods: () => () => {}, then: undefined };
  const session = new Proxy(known, { get: (target, name) => (typeof name === "string" && name in target ? target[name] : () => Promise.resolve(undefined)) });
  const app = render(<App store={store} session={session as unknown as AgentSession} fullscreen={false} onToggleFullscreen={() => {}} onAgents={() => {}} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { app, written: () => stripVTControlCharacters(drawn) };
}

const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const copies = (text: string) => text.split(`astrocode  ${version}`).length - 1;
/** Claude Code starting: its mode, then what it loaded. */
const started = (store: Store) => {
  store.emit({ kind: "mode", mode: "auto" });
  store.emit({ kind: "loaded", loaded: { version: "2.1.318", skills: 3 } });
};

test("in scrollback, the start screen is written once, when all it says is known", async () => {
  const store = new Store(project, "/home/u");
  const { app, written } = launch(store);
  try {
    await settle();
    // Nothing above the box yet: written now it would guess, and drawn live it could fill a short terminal, which then writes a copy on every frame.
    expect(copies(written())).toBe(0);
    started(store);
    await settle();
    store.emit({ kind: "context", percentage: 2, tokens: 4000, max: 200000 });
    store.emit({ kind: "notice", tone: "info", text: "Something to say." });
    await settle();
  } finally {
    app.unmount();
  }
  const text = written();
  expect(copies(text)).toBe(1);
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.includes(`astrocode  ${version}`));
  expect(lines[first]).toContain("Claude Code 2.1.318 underneath");
  expect(lines[first + 1]).toEndWith(" · auto");
  expect(lines[first + 2]).toContain("From Claude Code: 3 skills");
  expect(text).toContain("Give retries a deadline");
  expect(text.indexOf("Something to say.")).toBeGreaterThan(text.indexOf(`astrocode  ${version}`));
});

test("a resumed conversation waits for the start screen, which lists the other sessions here", async () => {
  const store = new Store(project, "/home/u");
  store.emit({ kind: "history", events: [{ kind: "prompt", text: "Make retries back off" }], title: "Make retries back off" });
  const { app, written } = launch(store, RESUMED);
  try {
    await settle();
    expect(copies(written())).toBe(0);
    expect(written()).not.toContain("Make retries back off");
    started(store);
    await settle();
  } finally {
    app.unmount();
  }
  const text = written();
  expect(copies(text)).toBe(1);
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.includes(`astrocode  ${version}`));
  expect(lines[first + 1]).toEndWith(" · auto");
  // The session on screen isn't one to pick.
  const recent = lines.findIndex((line) => line.includes("Recent sessions here"));
  expect(recent).toBeGreaterThan(first);
  expect(lines[recent + 1]).toContain("Give retries a deadline");
  expect(lines[recent + 2]).not.toContain("Make retries back off");
  // Its history follows the start screen.
  const keys = lines.findIndex((line) => line.trim() === "Keys");
  expect(lines.findIndex((line) => line.includes("Make retries back off") && !line.includes("Resumed"))).toBeGreaterThan(keys);
});
