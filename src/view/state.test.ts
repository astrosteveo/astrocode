import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FileChange, SessionEvent } from "../events";
import { historyEvents } from "../history";
import { ledgerLine } from "./ledger";
import { initialState, reduce, type State } from "./state";

/** One of the messages Claude Code sends a host about a mod, which the SDK's types don't list. */
const mod = (subtype: string, fields: Record<string, unknown>) =>
  ({ kind: "sdk", message: { type: "system", subtype, uuid: "u", session_id: "s", ...fields } as unknown as SDKMessage }) as const;

const start = () => initialState("/work", "/home");

test("puts a mod's logged line in the transcript under its name, as plain text", () => {
  const state = reduce(start(), mod("ui_log", { plugin: "review-gate", text: "round 2 \x1b[31mfailed\x1b[0m\x07" }));
  expect(state.items.at(-1)).toMatchObject({ kind: "notice", tone: "info", text: "review-gate: round 2 failed" });
});

test("pins one status line to a mod, replaced by its next and gone when it clears it", () => {
  let state: State = reduce(start(), mod("ui_status", { plugin: "a", text: "one" }));
  state = reduce(state, mod("ui_status", { plugin: "b", text: "other" }));
  state = reduce(state, mod("ui_status", { plugin: "a", text: "two" }));
  expect(state.modStatus).toEqual({ a: "two", b: "other" });
  state = reduce(state, mod("ui_status", { plugin: "a", text: null }));
  expect(state.modStatus).toEqual({ b: "other" });
});

test("counts a mod's toasts, so the same words again show again", () => {
  let state: State = reduce(start(), mod("ui_toast", { plugin: "a", text: "done", timeout_ms: 6000 }));
  expect(state.modToast).toEqual({ plugin: "a", text: "done", ms: 6000, count: 1 });
  state = reduce(state, mod("ui_toast", { plugin: "a", text: "done" }));
  expect(state.modToast).toEqual({ plugin: "a", text: "done", ms: 4000, count: 2 });
});

test("forgets mods' lines when a new Claude Code starts", () => {
  const state = reduce(reduce(start(), mod("ui_status", { plugin: "a", text: "one" })), { kind: "ready", models: [], commands: [] });
  expect(state.modStatus).toEqual({});
});

test("knows a command's output row, and puts a mod's drawing on it", () => {
  let state: State = reduce(start(), { kind: "prompt", text: "/review-gate status" });
  const reply = {
    type: "assistant",
    uuid: "row-1",
    session_id: "s",
    parent_tool_use_id: null,
    message: { id: "m", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "review-gate: Review round 1" }] },
  } as unknown as SDKMessage;
  state = reduce(state, { kind: "sdk", message: reply });
  expect(state.items.at(-1)).toMatchObject({ kind: "text", command: { name: "review-gate", args: "status", uuid: "row-1" } });
  const card = { type: "Text", children: ["card"] };
  state = reduce(state, { kind: "modDrawing", of: { command: "row-1" }, tree: card });
  expect(state.items.at(-1)).toMatchObject({ kind: "text", drawing: card });
  state = reduce(state, { kind: "modDrawing", of: { command: "row-1" }, tree: null });
  expect(state.items.at(-1)).not.toHaveProperty("drawing", card);
});

test("leaves Claude's own replies without a command", () => {
  let state: State = reduce(start(), { kind: "prompt", text: "/review-gate status" });
  const reply = { type: "assistant", uuid: "r", session_id: "s", parent_tool_use_id: null, message: { id: "m", model: "claude-opus-5-5", role: "assistant", content: [{ type: "text", text: "hi" }] } } as unknown as SDKMessage;
  state = reduce(state, { kind: "sdk", message: reply });
  expect(state.items.at(-1)).not.toHaveProperty("command");
});

// A turn as Claude Code's messages bring it: your message, Claude's calls and their results, and
// the result that ends the turn.
const T = 1_000_000;
const sdk = (message: Record<string, unknown>, at?: number) => ({ kind: "sdk", message: message as unknown as SDKMessage, at }) as const;
const call = (id: string, name: string, input: Record<string, unknown>) =>
  sdk({ type: "assistant", uuid: `a-${id}`, session_id: "s", parent_tool_use_id: null, message: { id: `m-${id}`, model: "claude-opus-5-5", role: "assistant", content: [{ type: "tool_use", id, name, input }] } }, T);
const answered = (id: string, content: string, output?: unknown, error = false) =>
  sdk({ type: "user", uuid: `u-${id}`, session_id: "s", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: error }] }, ...(output !== undefined && { tool_use_result: output }) }, T + 1000);
const ended = (ms = 6000) => sdk({ type: "result", subtype: "success", uuid: "r", session_id: "s", duration_ms: ms, num_turns: 3, is_error: false, result: "done" }, T + ms);
const lastTurn = (state: State) => state.items.findLast((item) => item.kind === "turn");
/** What the session's snapshots said the turn changed in git. */
const git = (files: FileChange[], commits: string[] = []): SessionEvent => ({ kind: "ledger", files, commits });

test("lists a command that failed among those the turn ran", () => {
  const state = [
    { kind: "prompt", text: "check it" } as const,
    call("t", "Bash", { command: "bun test" }),
    answered("t", "Exit code 1\n 2 pass\n 1 fail\nRan 3 tests across 1 file.", undefined, true),
    call("g", "Bash", { command: "git log --oneline -3" }),
    answered("g", "f535656 fix\nc0b6c78 init", { stdout: "f535656 fix\nc0b6c78 init", stderr: "", interrupted: false }),
    call("s", "Bash", { command: "seq 200" }),
    answered("s", "1\n2", { stdout: "1\n2", stderr: "", interrupted: false }),
    ended(),
  ].reduce(reduce, start());
  expect(lastTurn(state)).toMatchObject({ commands: ["bun test", "git log --oneline -3", "seq 200"] });
});

test("counts the calls before a message you sent while Claude worked, which it took mid-turn", () => {
  const state = [
    { kind: "prompt", text: "check it" } as const,
    call("t", "Bash", { command: "bun test" }),
    answered("t", " 3 pass\n 0 fail\nRan 3 tests across 1 file.", { stdout: " 3 pass\n 0 fail\nRan 3 tests across 1 file.", stderr: "", interrupted: false }),
    { kind: "prompt", text: "and the log", uuid: "q" } as const,
    sdk({ type: "command_lifecycle", command_uuid: "q", state: "started", uuid: "l", session_id: "s" }),
    call("g", "Bash", { command: "git log --oneline -3" }),
    answered("g", "f535656 fix", { stdout: "f535656 fix", stderr: "", interrupted: false }),
    ended(),
  ].reduce(reduce, start());
  expect(lastTurn(state)).toMatchObject({ commands: ["bun test", "git log --oneline -3"] });
});

/** The closing line as it reads. */
const closing = (state: State) => {
  const turn = lastTurn(state);
  return turn?.kind === "turn" ? ledgerLine(turn).map((part) => part.text).join("") : undefined;
};

/**
 * The audit's first side-by-side turn, as Claude Code saved it: Claude ran the tests, rewrote
 * src/retry.ts with a Python heredoc and src/retry.test.ts with cat, ran them again and committed
 * quietly, with `git commit -q`. No edit tool touched a file.
 */
const heredocTurn = readFileSync(join(import.meta.dir, "fixtures", "heredoc-turn.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { type: "user" | "assistant"; uuid: string; timestamp: string; message: { content: unknown }; toolUseResult?: unknown });
const began = Date.parse(heredocTurn[0]!.timestamp);
const finished = Date.parse(heredocTurn.at(-1)!.timestamp);

/** The turn as it came live: each message with its structured result, and the result that ended it. */
function liveHeredocTurn(...before: SessionEvent[]): SessionEvent[] {
  const [prompt, ...rest] = heredocTurn;
  return [
    { kind: "prompt", text: String(prompt!.message.content), at: began },
    ...rest.map((saved) =>
      sdk(
        {
          type: saved.type,
          uuid: saved.uuid,
          session_id: "s",
          parent_tool_use_id: null,
          message: saved.message,
          ...(saved.toolUseResult !== undefined && { tool_use_result: saved.toolUseResult }),
        },
        Date.parse(saved.timestamp),
      ),
    ),
    ...before,
    sdk({ type: "result", subtype: "success", uuid: "r", session_id: "s", duration_ms: finished - began, num_turns: 5, is_error: false, result: "done" }, finished),
  ];
}

test("closes the audit's heredoc turn with the files git saw it change, though no edit tool ran", () => {
  // What the session's snapshots say of that turn, as git counted the commit it made.
  const counted = git(
    [
      { path: "/tmp/ac-ux-8259/ac/src/retry.test.ts", added: 42, removed: 24 },
      { path: "/tmp/ac-ux-8259/ac/src/retry.ts", added: 18, removed: 6 },
    ],
    ["f535656"],
  );
  const state = liveHeredocTurn(counted).reduce(reduce, initialState("/tmp/ac-ux-8259/ac", "/home"));
  expect(lastTurn(state)).toMatchObject({ tests: { passed: 4, failed: 0 }, commits: ["f535656"] });
  expect((lastTurn(state) as { commands?: string[] }).commands).toHaveLength(4);
  expect(closing(state)).toBe("1m 39s · 2 files +60 −30 · 4 passed · committed f535656");
});

test("closes the same turn from the edits' diffs where git couldn't say, without claiming a commit", () => {
  const state = liveHeredocTurn().reduce(reduce, initialState("/tmp/ac-ux-8259/ac", "/home"));
  // Claude Code saw no commit in `git commit -q`, and without git nothing says there wasn't one.
  expect(closing(state)).toBe("1m 39s · 4 passed");
});

test("closes the same turn resumed from disk with what the saved messages say", () => {
  const saved = heredocTurn.map((one) => ({ type: one.type, uuid: one.uuid, session_id: "s", message: one.message, parent_tool_use_id: null, parent_agent_id: null, timestamp: one.timestamp }));
  const state = reduce(initialState("/tmp/ac-ux-8259/ac", "/home"), { kind: "history", events: historyEvents(saved as SessionMessage[]) });
  expect(closing(state)).toBe("1m 39s · 4 passed");
});

test("counts the edits' own diffs outside git, leaving out a plan under ~/.claude", () => {
  const patch = [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ["-const now = Date.now();", "+const now = clock.now();"] }];
  const clock = "export type Clock = {\n  now(): number;\n};";
  const state = [
    { kind: "prompt", text: "inject a clock" } as const,
    call("p", "Write", { file_path: "/home/.claude/plans/clock.md", content: "# Plan\n" }),
    answered("p", "File created", { type: "create", filePath: "/home/.claude/plans/clock.md", content: "# Plan\n", structuredPatch: [] }),
    call("e", "Edit", { file_path: "/work/src/cache.ts", old_string: "const now = Date.now();", new_string: "const now = clock.now();" }),
    answered("e", "Updated", { filePath: "/work/src/cache.ts", structuredPatch: patch }),
    call("w", "Write", { file_path: "/work/src/clock.ts", content: clock }),
    answered("w", "File created", { type: "create", filePath: "/work/src/clock.ts", content: clock, structuredPatch: [] }),
    ended(),
  ].reduce(reduce, start());
  expect(lastTurn(state)).toMatchObject({ files: [{ path: "/work/src/cache.ts", added: 1, removed: 1 }, { path: "/work/src/clock.ts", added: 3, removed: 0 }] });
  expect(closing(state)).toBe("6s · 2 files +4 −1");
});

test("says a turn's changes aren't committed when git saw no commit", () => {
  const state = [
    { kind: "prompt", text: "fix it" } as const,
    git([{ path: "/work/a.ts", added: 2, removed: 1 }]),
    ended(),
  ].reduce(reduce, start());
  expect(closing(state)).toBe("6s · 1 file +2 −1 · not committed");
});

test("says what the turn pushed and the pull request it opened, as Claude Code read the commands", () => {
  const pushed = { stdout: "", stderr: "To github.com:a/b.git", interrupted: false, gitOperation: { push: { branch: "fix/clock" } } };
  const opened = { stdout: "https://github.com/a/b/pull/12", stderr: "", interrupted: false, gitOperation: { pr: { number: 12, url: "https://github.com/a/b/pull/12", action: "created" } } };
  const state = [
    { kind: "prompt", text: "ship it" } as const,
    call("p", "Bash", { command: "git push -u origin fix/clock" }),
    answered("p", "To github.com:a/b.git", pushed),
    call("r", "Bash", { command: "gh pr create --fill" }),
    answered("r", "https://github.com/a/b/pull/12", opened),
    git([]),
    ended(),
  ].reduce(reduce, start());
  expect(closing(state)).toBe("6s · pushed · PR #12");
});

test("keeps git's word for one turn only", () => {
  const state = [
    { kind: "prompt", text: "fix it" } as const,
    git([{ path: "/work/a.ts", added: 2, removed: 1 }]),
    ended(),
    { kind: "prompt", text: "and explain it" } as const,
    ended(),
  ].reduce(reduce, start());
  expect(closing(state)).toBe("6s");
});
