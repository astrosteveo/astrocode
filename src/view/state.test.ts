import { expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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
