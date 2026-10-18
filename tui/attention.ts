// What the terminal window says about the conversation while you look elsewhere: the title names
// the session and marks whether Claude is working or waiting on you, the tab shows progress, and
// a turn that ends, a prompt that opens or a long `!` command that finishes while the window is
// out of focus sends a notification.
import { basename } from "node:path";
import { useEffect, useRef, useState } from "react";
import type { NotifyMode } from "../src/settings";
import { permissionTitle } from "../src/view/permissions";
import type { Item, ShellItem, State } from "../src/view/state";
import type { GitInfo } from "./git";
import { trace, type TerminalWindow } from "./window";

/**
 * Where the terminal doesn't report focus, a turn this long is taken as one you've stopped
 * watching. A prompt then never notifies, since you may well be looking at it.
 */
const LONG_TURN_MS = 30_000;
/** A `!` command this long that ends while the window is out of focus notifies. */
const LONG_COMMAND_MS = 10_000;
/** As much of Claude's last words as a notification carries. */
const BODY = 140;

type Input = {
  state: State;
  window: TerminalWindow | null;
  notify: NotifyMode;
  /** The session's title, once Claude Code has one. */
  title?: string;
  git: GitInfo | null;
};

export function useAttention({ state, window, notify, title, git }: Input) {
  const focused = useFocus(window);
  const waiting = state.pending.length + state.questions.length + state.elicitations.length > 0;

  // The title: what's going on first, since a tab bar cuts titles off at the end.
  const mark = waiting ? "● " : state.busy ? "◇ " : "";
  const folder = basename(state.cwd) || state.cwd;
  const branch = git ? ` ⎇ ${git.branch}${git.changes ? ` ±${git.changes}` : ""}` : "";
  const text = `${mark}${title ? `${title} · ` : ""}${folder}${branch}`;
  useEffect(() => window?.setTitle(text), [window, text]);

  // A failed turn keeps the tab red until you've seen it: the window comes back into focus, or the next turn starts.
  const last = state.items.findLast((item) => item.kind === "turn");
  const [seenFailure, setSeenFailure] = useState<string | null>(null);
  const failed = last?.kind === "turn" && last.outcome === "failed" && !last.replayed && seenFailure !== last.key;
  useEffect(() => {
    if (focused && failed && last) setSeenFailure(last.key);
  }, [focused, failed, last?.key]);
  const progress = waiting ? "waiting" : state.busy ? "busy" : failed ? "error" : "none";
  useEffect(() => window?.setProgress(progress), [window, progress]);

  // Notifications, for what's new since the last render. What a resumed conversation replays isn't new.
  const seen = useRef<{ items: number; prompts: ReadonlySet<string>; running: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    const prompts = new Set([...state.pending, ...state.questions, ...state.elicitations].map((one) => one.id));
    const running = new Set(state.items.flatMap((item) => (item.kind === "shell" && item.status === "running" ? [item.id] : [])));
    const before = seen.current;
    seen.current = { items: state.items.length, prompts, running };
    for (const item of state.items.slice(Math.min(before?.items ?? state.items.length, state.items.length))) {
      if (item.kind === "turn") trace(`turn ${item.outcome} ${item.durationMs}ms replayed=${Boolean(item.replayed)} focused=${focused} window=${window?.focused} notify=${notify}`);
    }
    if (!window || !before || notify === "off") return;
    const send = (said: { title: string; body: string } | null) => said && window.notify(notify, said.title, said.body);
    for (const item of state.items.slice(Math.min(before.items, state.items.length))) send(turnMessage(item, state.items, focused));
    if (focused !== false) return;
    for (const item of state.items) if (item.kind === "shell" && before.running.has(item.id) && !running.has(item.id)) send(commandMessage(item));
    for (const request of state.pending) if (!before.prompts.has(request.id)) send({ title: "Claude needs your permission", body: permissionTitle(request) });
    for (const request of state.questions) {
      if (!before.prompts.has(request.id)) send({ title: "Claude has a question", body: request.questions[0]?.question ?? "" });
    }
    for (const request of state.elicitations) {
      if (!before.prompts.has(request.id)) send({ title: `${request.server} is asking you something`, body: request.message });
    }
  }, [state.items, state.pending, state.questions, state.elicitations]);
}

/** What a turn that just ended says in a notification, if it's worth one at this focus. */
function turnMessage(item: Item, items: Item[], focused: boolean | null) {
  if (item.kind !== "turn" || item.replayed || item.outcome === "stopped") return null;
  if (focused === true || (focused === null && item.durationMs < LONG_TURN_MS)) return null;
  if (item.outcome === "failed") return { title: "Claude's turn failed", body: item.detail?.split("\n")[0] ?? "" };
  const words = items.findLast((one) => one.kind === "text");
  return { title: "Claude is done", body: words?.kind === "text" ? summary(words.text) : "" };
}

/** What a `!` command that just ended says, if it ran long enough that you may have turned away. */
function commandMessage(item: ShellItem) {
  const took = item.startedAt !== undefined && item.endedAt !== undefined ? item.endedAt - item.startedAt : 0;
  if (took < LONG_COMMAND_MS) return null;
  const how = item.status === "done" ? "finished" : item.status === "stopped" ? "stopped" : item.code == null ? "failed" : `exited with ${item.code}`;
  return { title: "Your command ended", body: `${item.command.split("\n")[0]} ${how}` };
}

/** Whether the window has focus, as the terminal last said; null where it doesn't say. */
function useFocus(window: TerminalWindow | null) {
  const [focused, setFocused] = useState(window?.focused ?? null);
  useEffect(() => window?.watch(() => setFocused(window.focused)), [window]);
  return focused;
}

/** Claude's last words, cut down to their first sentence or line. */
function summary(text: string) {
  const plain = text.replace(/[`*_#>]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
  const first = plain.split("\n").find((line) => line.trim()) ?? "";
  return first.length > BODY ? `${first.slice(0, BODY - 1).trimEnd()}…` : first;
}
