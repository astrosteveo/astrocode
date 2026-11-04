import { afterEach, expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { Decision, PermissionRequest } from "../src/events";
import { DecisionPrompt } from "./decision";

const KEYS = { up: "\x1b[A", down: "\x1b[B", enter: "\r", esc: "\x1b", tab: "\t", shiftTab: "\x1b[Z", backspace: "\x7f" };

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
/** Past the half second in which Enter, digits and clicks are ignored. */
const grace = () => settle(550);

let quit: (() => void) | null = null;
afterEach(() => {
  quit?.();
  quit = null;
});

/** The prompt for `request` on a fake terminal: the last frame, keys to press, and what it decided. */
async function ask(request: PermissionRequest, { mode = "auto" as const, rows = 40, width = 100 } = {}) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: width, rows });
  let drawn = "";
  stdout.on("data", (chunk: Buffer) => {
    drawn += chunk.toString();
  });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const decided: Decision[] = [];
  const app = render(
    <DecisionPrompt request={request} cwd="/tmp/ac" home="/home/u" width={width} rows={rows} pictureRows={10} mode={mode} modes={{ bypass: true, auto: true }} onDecide={(one) => decided.push(one)} />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false, debug: true },
  );
  quit = () => app.unmount();
  await settle();
  const screen = () => {
    const frames = stripVTControlCharacters(drawn).split(/(?=▁{20})/);
    return frames.at(-1) ?? "";
  };
  const press = async (keys: string) => {
    stdin.write(keys);
    await settle();
  };
  return { screen, press, decided };
}

const BASH: PermissionRequest = {
  id: "b",
  toolName: "Bash",
  input: { command: "rm -rf build", description: "Clean the build" },
  alwaysAllow: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "rm -rf build" }], behavior: "allow", destination: "localSettings" }],
};

test("Bash: Tab on No opens a comment, which goes to Claude as the reason for no", async () => {
  const { screen, press, decided } = await ask(BASH);
  expect(screen()).toContain("Bash command");
  expect(screen()).toMatch(/waiting \d+s/);
  expect(screen()).toContain("$ rm -rf build");
  // Tab does nothing on Yes, and doesn't move the selection.
  expect(screen()).toMatch(/Esc to cancel\s*\n/);
  await press(KEYS.tab);
  expect(screen()).toMatch(/› 1 {2}Yes/);
  await press(KEYS.down + KEYS.down);
  expect(screen()).toMatch(/› 3 {2}No/);
  expect(screen()).toContain("Esc to cancel · Tab to amend");
  await press(KEYS.tab);
  expect(screen()).toContain("3  No, and tell Claude what to do differently");
  expect(screen()).not.toContain("Tab to amend");
  await grace();
  await press("use git clean -fdx2");
  await press(KEYS.backspace);
  expect(screen()).toContain("3  No, use git clean -fdx");
  await press(KEYS.enter);
  expect(decided).toEqual([{ allow: false, comment: "use git clean -fdx" }]);
});

test("Bash: a comment typed on No still goes with it when No is picked by its number from another row", async () => {
  const { press, decided } = await ask(BASH);
  await press(KEYS.down + KEYS.down + KEYS.tab);
  await grace();
  await press("not the build folder");
  await press(KEYS.up);
  await press("3");
  expect(decided).toEqual([{ allow: false, comment: "not the build folder" }]);
});

test("Bash: Enter on a row sends what the row says, and Esc says no without a comment", async () => {
  const first = await ask(BASH);
  await grace();
  await first.press(KEYS.down + KEYS.enter);
  expect(first.decided).toEqual([{ allow: true, updates: BASH.alwaysAllow }]);
  quit?.();
  const second = await ask(BASH);
  await second.press(KEYS.esc);
  expect(second.decided).toEqual([{ allow: false }]);
});

test("a prompt that mustn't be approved by one key starts on No, and its numbers don't say yes", async () => {
  const { screen, press, decided } = await ask({ ...BASH, defaultToNo: true });
  expect(screen()).toMatch(/› 3 {2}No/);
  await grace();
  await press("1");
  expect(decided).toEqual([]);
  await press("3");
  expect(decided).toEqual([{ allow: false }]);
});

test("Write: Shift+Tab picks the row that names it, which switches to accept edits", async () => {
  const write: PermissionRequest = {
    id: "w",
    toolName: "Write",
    input: { file_path: "/tmp/ac-not-there/note.txt", content: "hi\n" },
    alwaysAllow: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
  };
  const { screen, press, decided } = await ask(write);
  expect(screen()).toContain("Create file");
  expect(screen()).toContain("Do you want to create note.txt?");
  expect(screen().replace(/\s+/g, " ")).toContain("for this session (shift+tab)");
  await grace();
  await press(KEYS.shiftTab);
  expect(decided).toEqual([{ allow: true, updates: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] }]);
});

test("WebFetch: no comment and no hint line; its last row says no", async () => {
  const fetch: PermissionRequest = { id: "f", toolName: "WebFetch", input: { url: "https://example.com", prompt: "title?" } };
  const { screen, press, decided } = await ask(fetch);
  expect(screen()).toContain("Claude wants to fetch content from example.com");
  expect(screen()).not.toContain("Esc to cancel");
  await press(KEYS.down + KEYS.tab);
  expect(screen()).toContain("2  No, and tell Claude what to do differently (esc)");
  await grace();
  await press("2");
  expect(decided).toEqual([{ allow: false }]);
});

test("a plan: its last row is what to change, which Enter sends only once something's typed", async () => {
  const plan: PermissionRequest = { id: "p", toolName: "ExitPlanMode", input: { plan: "1. Create hello.txt.", planFilePath: "/home/u/.claude/plans/hello.md" } };
  const { screen, press, decided } = await ask(plan);
  expect(screen()).toContain("Ready to code?");
  expect(screen()).toContain("1  Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session");
  expect(screen()).toContain("3  Tell Claude what to change");
  // The plan's file, where `claude` puts its hint line.
  expect(screen()).toContain("~/.claude/plans/hello.md");
  await grace();
  await press("3");
  await press(KEYS.enter);
  expect(decided).toEqual([]);
  await press("make it say hello");
  expect(screen()).toContain("3  make it say hello");
  await press(KEYS.enter);
  expect(decided).toEqual([{ allow: false, comment: "make it say hello" }]);
  quit?.();
  const approve = await ask(plan);
  await grace();
  await approve.press(KEYS.enter);
  expect(approve.decided).toEqual([{ allow: true, updates: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }] }]);
});

test("an MCP server's tool is asked about by its name and its server", async () => {
  const mcp: PermissionRequest = { id: "m", toolName: "mcp__hello__greet", input: { name: "Ada" }, displayName: "Greet", server: "hello" };
  const { screen } = await ask(mcp);
  expect(screen()).toContain("Tool use");
  expect(screen()).toContain("hello — Greet Tool: (MCP)");
  expect(screen()).toContain("Do you want to proceed?");
});

test("a row whose label wraps keeps two spaces after its number, and goes on under its own label", async () => {
  const plan: PermissionRequest = { id: "p", toolName: "ExitPlanMode", input: { plan: "1. Create hello.txt.", planFilePath: "/home/u/.claude/plans/hello.md" } };
  const { screen } = await ask(plan, { width: 80 });
  const lines = screen().split("\n");
  const first = lines.findIndex((line) => line.includes("Yes, and switch to BYPASS"));
  expect(lines[first]).toMatch(/› 1 {2}Yes, and switch to BYPASS/);
  const label = lines[first]!.indexOf("Yes");
  expect(lines[first + 1]!.indexOf("session")).toBe(label);
  expect(lines[first + 2]!.indexOf("Yes, manually")).toBe(label);
});
