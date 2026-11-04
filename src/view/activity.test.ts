import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionEvent } from "../events";
import { activityRows } from "./activity";
import { initialState, reduce, type State } from "./state";

// Each call goes through the reducer as Claude Code's messages bring it, shaped as recorded
// sessions have them, and the line is read back as `verb | target | result`.

const T = 1_000_000;
const sdk = (message: Record<string, unknown>, at?: number): SessionEvent => ({ kind: "sdk", message: message as unknown as SDKMessage, at });
const use = (id: string, name: string, input: Record<string, unknown>, at = T) =>
  sdk({ type: "assistant", uuid: `a-${id}`, session_id: "s", parent_tool_use_id: null, message: { id: `m-${id}`, model: "claude-opus-5-5", role: "assistant", content: [{ type: "tool_use", id, name, input }] } }, at);
const result = (id: string, content: string, output?: unknown, { at = T + 2000, error = false } = {}) =>
  sdk({ type: "user", uuid: `u-${id}`, session_id: "s", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: error }] }, ...(output !== undefined && { tool_use_result: output }) }, at);
const progress = (id: string, seconds: number) => sdk({ type: "tool_progress", uuid: "p", session_id: "s", parent_tool_use_id: null, tool_use_id: id, tool_name: "Bash", elapsed_time_seconds: seconds });
const ask = (id: string, toolName: string, input: Record<string, unknown>): SessionEvent => ({ kind: "permission", request: { id, toolName, input } });
const answer = (id: string, outcome: "allow" | "deny" | "withdrawn" | "cancelled"): SessionEvent => ({ kind: "resolved", id, outcome });
/** Esc: Claude Code ends the turn early, and whatever still runs won't report back. */
const stopped = (at: number) => sdk({ type: "result", subtype: "error_during_execution", uuid: "r", session_id: "s", terminal_reason: "aborted_tools", duration_ms: at - T, num_turns: 1, is_error: true }, at);

function play(...events: SessionEvent[]): State {
  return events.reduce(reduce, initialState("/work", "/home"));
}

function lines(state: State) {
  const calls = state.items.flatMap((item) => (item.kind === "tool" ? [item.call] : []));
  const waiting = new Set(state.pending.map((request) => request.id));
  return activityRows(calls, waiting, "/work", "/home").map((row) =>
    [row.verb, row.target.map((part) => part.text).join(""), row.result.map((part) => part.text).join("")].join(" | "),
  );
}

const line = (...events: SessionEvent[]) => lines(play(...events))[0];

const read = { file_path: "/work/src/retry.ts" };
const edit = { file_path: "/work/src/cache.ts", old_string: "const now = Date.now();", new_string: "const now = clock.now();", replace_all: false };
const write = { file_path: "/work/src/clock.ts", content: "export type Clock = {\n  now(): number;\n};" };
const tests = { command: "bun test", description: "Run the test suite" };
const patch = [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ["-const now = Date.now();", "+const now = clock.now();"] }];

test("a Read says what it's doing, asks, and says what it did", () => {
  expect(line(use("r", "Read", read))).toBe("Reading | src/retry.ts | ");
  expect(line(use("r", "Read", read), ask("r", "Read", read))).toBe("Read | src/retry.ts | ");
  const file = { filePath: "/work/src/retry.ts", content: "…", numLines: 47, startLine: 1, totalLines: 47 };
  expect(line(use("r", "Read", read), result("r", "     1\t…", { type: "text", file }))).toBe("Read | src/retry.ts | 47 lines");
});

test("an edit asks with the change it would make, and isn't edited until it's done", () => {
  expect(line(use("e", "Edit", edit), ask("e", "Edit", edit))).toBe("Edit | src/cache.ts | +1 −1");
  expect(line(use("e", "Edit", edit), ask("e", "Edit", edit), answer("e", "allow"))).toBe("Editing | src/cache.ts | ");
  const done = result("e", "The file /work/src/cache.ts has been updated successfully.", { filePath: "/work/src/cache.ts", oldString: edit.old_string, newString: edit.new_string, structuredPatch: patch });
  expect(line(use("e", "Edit", edit), done)).toBe("Edited | src/cache.ts | +1 −1");
});

test("a new file says new before its size", () => {
  expect(line(use("w", "Write", write))).toBe("Writing | src/clock.ts | ");
  const created = result("w", "File created successfully at: /work/src/clock.ts", { type: "create", filePath: "/work/src/clock.ts", content: write.content, structuredPatch: [] });
  expect(line(use("w", "Write", write), created)).toBe("Wrote | src/clock.ts | new +3");
});

test("a file's last newline doesn't count as a line", () => {
  const ended = { ...write, content: `${write.content}\n` };
  expect(line(use("w", "Write", ended), ask("w", "Write", ended))).toBe("Write | src/clock.ts | +3");
  const created = result("w", "File created successfully at: /work/src/clock.ts", { type: "create", filePath: "/work/src/clock.ts", content: ended.content, structuredPatch: [] });
  expect(line(use("w", "Write", ended), created)).toBe("Wrote | src/clock.ts | new +3");
});

test("a command says Claude's description in the tense of where it is", () => {
  expect(line(use("b", "Bash", tests))).toBe("Running | the test suite | ");
  expect(line(use("b", "Bash", tests), progress("b", 12))).toBe("Running | the test suite | 12s");
  expect(line(use("b", "Bash", tests), ask("b", "Bash", tests))).toBe("Run | the test suite | ");
  const done = result("b", "4 pass\n0 fail", { stdout: "4 pass\n0 fail", stderr: "", interrupted: false, isImage: false, noOutputExpected: false });
  expect(line(use("b", "Bash", tests), done)).toStartWith("Ran | the test suite | ✓");
  expect(line(use("b", "Bash", { command: "bun test" }))).toBe("Running | $ bun test | ");
});

test("a command in the background is still running", () => {
  const moved = result("b", "Command running in background with ID: b1", { stdout: "", stderr: "", interrupted: false, isImage: false, backgroundTaskId: "b1" });
  expect(line(use("b", "Bash", { command: "sleep 90 && echo warmed", description: "Wait for the cache to warm" }), moved)).toBe("Waiting | for the cache to warm | ◌ in the background");
});

test("a call you said no to reads Not run, with the request it made", () => {
  const remove = { command: "rm -rf dist", description: "Delete the dist folder" };
  expect(line(use("b", "Bash", remove), ask("b", "Bash", remove), answer("b", "deny"))).toBe("Not run | Delete the dist folder | you said no");
  expect(line(use("r", "Read", read), ask("r", "Read", read), answer("r", "deny"))).toBe("Not run | Read src/retry.ts | you said no");
  expect(line(use("b", "Bash", { command: "rm -rf dist" }), ask("b", "Bash", { command: "rm -rf dist" }), answer("b", "deny"))).toBe("Not run | $ rm -rf dist | you said no");
});

/** What Claude Code writes as the result of a call you said no to, and of one Esc stopped as it ran. */
const REFUSED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

test("a saved conversation's refused call reads Not run, as it can't say more", () => {
  const remove = { command: "rm -rf dist", description: "Delete the dist folder" };
  const history: SessionEvent = { kind: "history", events: [use("b", "Bash", remove), result("b", REFUSED, "User rejected tool use", { error: true })] } as unknown as SessionEvent;
  expect(line(history)).toBe("Not run | Delete the dist folder | you said no");
});

test("a call Esc stopped as it ran says Stopped, though Claude Code writes it up as refused", () => {
  const refused = result("b", REFUSED, "User rejected tool use", { at: T + 26_000, error: true });
  expect(line(use("b", "Bash", tests), ask("b", "Bash", tests), answer("b", "allow"), refused, stopped(T + 26_100))).toBe("Stopped | running the test suite | after 26s");
  expect(line(use("b", "Bash", tests), refused, stopped(T + 26_100))).toBe("Stopped | running the test suite | after 26s");
  const withdrawn = result("e", REFUSED, "User rejected tool use", { error: true });
  expect(line(use("e", "Edit", edit), ask("e", "Edit", edit), answer("e", "withdrawn"), withdrawn, stopped(T + 5000))).toBe("Not run | Edit src/cache.ts | stopped");
});

test("a call something else said no to says who", () => {
  const ruled = sdk({ type: "system", subtype: "permission_denied", uuid: "d", session_id: "s", tool_use_id: "b", decision_reason_type: "rule" });
  expect(line(use("b", "Bash", tests), ruled)).toBe("Not run | Run the test suite | denied by a rule");
  const unknown = sdk({ type: "system", subtype: "permission_denied", uuid: "d", session_id: "s", tool_use_id: "b" });
  expect(line(use("b", "Bash", tests), unknown)).toBe("Not run | Run the test suite | denied by Claude Code");
});

test("a call stopped while it waited on you never ran", () => {
  expect(line(use("e", "Edit", edit), ask("e", "Edit", edit), answer("e", "withdrawn"), stopped(T + 5000))).toBe("Not run | Edit src/cache.ts | stopped");
});

test("a call stopped as it ran says what it was doing and for how long", () => {
  expect(line(use("b", "Bash", tests), stopped(T + 12_000))).toBe("Stopped | running the test suite | after 12s");
  expect(line(use("r", "Read", read), stopped(T + 50))).toBe("Stopped | reading src/retry.ts | ");
  // Five seconds or less says nothing worth a number.
  expect(line(use("b", "Bash", tests), stopped(T + 4000))).toBe("Stopped | running the test suite | ");
  expect(line(use("b", "Bash", tests), progress("b", 3))).toBe("Running | the test suite | ");
});

test("searches, subagents and MCP tools follow their state too", () => {
  const grep = { pattern: "Date.now", path: "/work/src" };
  expect(line(use("g", "Grep", grep))).toBe("Searching | Date.now in src | ");
  const found = result("g", "Found 2 files", { mode: "files_with_matches", filenames: ["src/a.ts", "src/b.ts"], numFiles: 2 });
  expect(line(use("g", "Grep", grep), found)).toBe("Searched | Date.now in src | 2 files");
  const explore = { subagent_type: "Explore", description: "Find Date.now and setTimeout uses", prompt: "…" };
  expect(line(use("a", "Agent", explore))).toBe("Exploring | Find Date.now and setTimeout uses | ◌ starting");
  expect(line(use("a", "Agent", { ...explore, subagent_type: "general-purpose" }))).toBe("Delegating | general-purpose  Find Date.now and setTimeout uses | ◌ starting");
  expect(line(use("m", "mcp__github__get_issue", { issue_number: 12 }))).toStartWith("Calling | get_issue (github)");
});

test("a notebook edit doesn't claim no change it can't know", () => {
  const cell = { notebook_path: "/work/nb.ipynb", cell_id: "c1", new_source: "x = 1\ny = 2" };
  // While it asks, the cell's old source isn't known, so neither is the size.
  expect(line(use("n", "NotebookEdit", cell), ask("n", "NotebookEdit", cell))).toBe("Edit | nb.ipynb | ");
  const done = result("n", "Updated cell c1", { new_source: cell.new_source, old_source: "x = 1", cell_id: "c1", cell_type: "code", language: "python", edit_mode: "replace" });
  expect(line(use("n", "NotebookEdit", cell), done)).toBe("Edited | nb.ipynb | +1");
});

// What runners and commands really printed, captured from real runs (src/view/fixtures/runners).
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "runners", `${name}.txt`), "utf8");

/** A command that failed, as Claude Code reports one: its exit code, then what it printed. */
function failed(command: string, printed: string, code: number | null = 1) {
  const text = code === null ? printed : `Exit code ${code}\n${printed}`;
  const row = activityRows(play(use("b", "Bash", { command }), result("b", text, `Error: ${text}`, { error: true })).items.flatMap((item) => (item.kind === "tool" ? [item.call] : [])), new Set(), "/work", "/home")[0]!;
  return { result: row.result.map((part) => part.text).join(""), failure: row.failure };
}

/** A command that succeeded, with what it printed. */
const succeeded = (command: string, stdout: string) =>
  line(use("b", "Bash", { command }), result("b", stdout, { stdout, stderr: "", interrupted: false, isImage: false, noOutputExpected: false }));

test("a failed test run says its runner's counts and the assertion that failed", () => {
  expect(failed("bun test", fixture("bun"))).toEqual({ result: "✕ exit 1 · 2 passed, 2 failed", failure: "Expected: 3, Received: 4" });
  expect(failed("pytest -q", fixture("pytest"))).toEqual({ result: "✕ exit 1 · 1 passed, 1 failed", failure: "assert 4 == 3" });
  expect(failed("cargo test -q", fixture("cargo"), 101)).toEqual({ result: "✕ exit 101 · 1 passed, 1 failed", failure: "assertion `left == right` failed, left: 4, right: 3" });
  expect(failed("go test ./...", fixture("go"))).toEqual({ result: "✕ exit 1 · 1 failed", failure: "retry_test.go:5: expected 3 calls, got 4" });
  expect(failed("npx vitest run", fixture("vitest"))).toEqual({ result: "✕ exit 1 · 1 passed, 1 failed", failure: "AssertionError: expected 4 to be 3 // Object.is equality" });
  expect(failed("npx jest", fixture("jest"))).toEqual({ result: "✕ exit 1 · 1 passed, 1 failed", failure: "Expected: 3, Received: 4" });
});

test("a thrown error's line is its message, not the source line that threw it", () => {
  const thrown = fixture("bun").split("(fail) tries exactly attempts times")[1]!;
  expect(failed("bun test", `bun test v1.4.4\n${thrown}`).failure).toBe("error: down");
  expect(failed("python3 serve.py", fixture("python")).failure).toBe("ValueError: bad port: 99999");
  expect(failed("node serve.js", fixture("node")).failure).toBe("Error: connect ECONNREFUSED 127.0.0.1:5432");
  expect(failed("ls nope", "ls: cannot access 'nope': No such file or directory", 2)).toEqual({ result: "✕ exit 2", failure: "ls: cannot access 'nope': No such file or directory" });
});

test("only a runner's summary gives test counts", () => {
  expect(succeeded("git log --oneline -3", fixture("git-log"))).toBe("Ran | $ git log --oneline -3 | ✓");
  expect(failed("git log --oneline -3 && false", fixture("git-log")).result).toBe("✕ exit 1");
});

test("a command shows no count of the lines it printed", () => {
  const many = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  expect(succeeded("seq 200", many)).toBe("Ran | $ seq 200 | ✓");
  expect(succeeded("git rev-parse --short HEAD", "f535656")).toBe("Ran | $ git rev-parse --short HEAD | ✓ f535656");
  expect(succeeded("true", "")).toBe("Ran | $ true | ✓ no output");
});

test("a command Claude Code refused to run says why, without its tags", () => {
  const blocked = "<tool_use_error>Blocked: sleep 25 followed by: echo warmed. To wait for a condition, use Monitor with an until-loop.</tool_use_error>";
  expect(failed("sleep 25 && echo warmed", blocked, null)).toEqual({ result: "✕ failed", failure: "Blocked: sleep 25 followed by: echo warmed. To wait for a condition, use Monitor with an until-loop." });
});
