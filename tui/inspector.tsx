// The inspector: everything about one tool call, beside the transcript on a wide screen and in its
// place on a narrow one or in scrollback. Its header says what the call did and how it went; its
// tabs hold the exact command or input, the exact output, and the result as Claude got it, whole.
// ← and → move between the conversation's calls, Tab between the tabs, ↑↓ PgUp PgDn Home End
// scroll, c copies what the tab shows, and Esc closes it. A click on it gives it the keys.
import { Box, renderToString, Text, useInput, type DOMElement } from "ink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import wrapAnsi from "wrap-ansi";
import { activityRows, readLines } from "../src/view/activity";
import { timed, took } from "../src/view/format";
import { runOfCall } from "../src/view/runs";
import type { ToolCall } from "../src/view/state";
import { field, plural, subagentReport, toolLabel } from "../src/view/tools";
import { Diff, editLines } from "./diff";
import { highlightCode } from "./highlight";
import { printable, printableColored } from "./markdown";
import { fit, Markdown, onPanel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE, sgr } from "./theme";
import { TodoList } from "./tool-row";

/** Where the call is: its place among its turn's calls, and its step's among the turn's steps. */
export type Place = { index: number; count: number; step?: number; steps: number };

type Props = {
  call: ToolCall;
  place: Place;
  /** Waiting on a permission prompt or a question. */
  waiting: boolean;
  width: number;
  height: number;
  /** It has the keys. A click on it gives them to it. */
  focused: boolean;
  /** It's in the transcript's place, which Esc brings back. */
  over?: boolean;
  cwd: string;
  home: string;
  onClose: () => void;
  onFocus: () => void;
  onMove: (by: -1 | 1) => void;
  onCopy: (text: string, what: string) => void;
};

type TabId = "output" | "command" | "sent" | "input" | "diff" | "content" | "results" | "response" | "report" | "prompt" | "todos" | "answers" | "plan" | "result";

const LABELS: Record<TabId, string> = {
  output: "Output",
  command: "Command",
  sent: "Sent to Claude",
  input: "Input",
  diff: "Diff",
  content: "Content",
  results: "Results",
  response: "Response",
  report: "Report",
  prompt: "Prompt",
  todos: "To-dos",
  answers: "Answers",
  plan: "Plan",
  result: "Result",
};

/** Rows the inspector takes besides its body: its top edge, header, tabs, the rules and the keys. */
const CHROME = 8;
const WHEEL_LINES = 3;
/** The most lines of a long result drawn; past that, the tab says how many more there were. */
const MOST_LINES = 5000;

/** The call's tabs, the one it opens on first. */
function tabsOf(call: ToolCall): TabId[] {
  switch (call.name) {
    case "Bash":
      return ["output", "command", "sent", "input"];
    case "Edit":
    case "MultiEdit":
      return ["diff", "sent", "input"];
    case "Write":
      return field(call.output, "type") === "update" && editLines(call).length ? ["diff", "content", "sent", "input"] : ["content", "sent", "input"];
    case "Read":
      return ["content", "sent", "input"];
    case "Grep":
    case "Glob":
      return ["results", "input"];
    case "WebFetch":
    case "WebSearch":
      return ["response", "input"];
    case "Agent":
    case "Task":
      return ["report", "prompt", "input"];
    case "TodoWrite":
      return ["todos", "input"];
    case "AskUserQuestion":
      return ["answers", "input"];
    case "ExitPlanMode":
      return ["plan", "sent", "input"];
    default:
      return ["result", "input"];
  }
}

export function Inspector({ call, place, waiting, width, height, focused, over = false, cwd, home, onClose, onFocus, onMove, onCopy }: Props) {
  const tabs = tabsOf(call);
  const [picked, setPicked] = useState<{ id: string; tab: TabId } | null>(null);
  const tab = picked?.id === call.id && tabs.includes(picked.tab) ? picked.tab : tabs[0]!;
  const inner = width - 2;
  // The body's text, less the column of its scrollbar.
  const room = inner - 1;
  const body = useBody(call, tab, room);
  const view = Math.max(1, height - CHROME);
  const total = body?.lines.length ?? 0;
  const maxTop = Math.max(0, total - view);
  const [scroll, setScroll] = useState({ key: "", top: 0 });
  const key = `${call.id}|${tab}`;
  const top = scroll.key === key ? Math.min(scroll.top, maxTop) : 0;
  const scrollTo = (next: number) => setScroll({ key, top: Math.max(0, Math.min(maxTop, Math.round(next))) });

  const box = useRef<DOMElement>(null);
  const tabRefs = useRef<(DOMElement | null)[]>([]);
  const back = useRef<DOMElement>(null);
  const forward = useRef<DOMElement>(null);
  const close = useRef<DOMElement>(null);

  const pick = (next: TabId) => setPicked({ id: call.id, tab: next });
  const step = (by: number) => pick(tabs[(tabs.indexOf(tab) + by + tabs.length) % tabs.length]!);
  const copy = () => {
    if (body?.copy) onCopy(body.copy, LABELS[tab].toLowerCase());
  };

  useInput(
    (input, key) => {
      if (key.eventType === "release") return;
      if (key.escape || (key.ctrl && input === "c")) return onClose();
      if (key.leftArrow) return onMove(-1);
      if (key.rightArrow) return onMove(1);
      if (key.tab) return step(key.shift ? -1 : 1);
      if (key.upArrow) return scrollTo(top - 1);
      if (key.downArrow) return scrollTo(top + 1);
      if (key.pageUp) return scrollTo(top - Math.max(1, view - 2));
      if (key.pageDown || input === " ") return scrollTo(top + Math.max(1, view - 2));
      if (key.home) return scrollTo(0);
      if (key.end) return scrollTo(maxTop);
      if (input === "c") return copy();
      const number = Number(input);
      if (number >= 1 && number <= tabs.length) return pick(tabs[number - 1]!);
    },
    { isActive: focused },
  );

  useMouse((event) => {
    const at = hit(box.current, event);
    if (!at) return;
    event.handled = true;
    if (event.type === "wheel") return scrollTo(top + event.wheel * WHEEL_LINES);
    if (event.type !== "press" || event.button !== "left") return;
    if (!focused) onFocus();
    const tabAt = tabRefs.current.findIndex((one) => hit(one, event));
    if (tabAt !== -1 && tabs[tabAt]) return pick(tabs[tabAt]);
    if (hit(back.current, event)) return onMove(-1);
    if (hit(forward.current, event)) return onMove(1);
    if (hit(close.current, event)) return onClose();
  });
  const hovered = useHover(box, (_, __, pointer) => {
    const tabAt = tabRefs.current.findIndex((one) => hit(one, pointer));
    if (tabAt !== -1) return { key: `tab${tabAt}`, shape: "pointer" };
    if (hit(back.current, pointer)) return { key: "back", shape: "pointer" };
    if (hit(forward.current, pointer)) return { key: "forward", shape: "pointer" };
    if (hit(close.current, pointer)) return { key: "close", shape: "pointer" };
    return null;
  });

  const status = statusOf(call, waiting);
  const time = call.startedAt !== undefined ? clock(call.startedAt) : "";
  const about = [place.step !== undefined ? `step ${place.step} of ${place.steps}` : "", time].filter(Boolean).join(" · ");
  const position = `${place.index} of ${place.count}`;
  const ms = call.startedAt !== undefined && call.endedAt !== undefined ? call.endedAt - call.startedAt : call.elapsed ? call.elapsed * 1000 : undefined;
  const spent = timed(ms) ? took(ms) : "";
  const title = titleOf(call, cwd, home);
  const pillWidth = status.text.length + 2 + (spent ? spent.length + 2 : 0);
  const thumb = total > view ? Math.max(1, Math.round((view * view) / total)) : 0;
  const thumbTop = thumb && maxTop ? Math.round(((view - thumb) * top) / maxTop) : 0;
  const shown = body?.lines.slice(top, top + view) ?? [];

  return (
    <Box ref={box} flexDirection="column" width={width} height={height} flexShrink={0}>
      <Text color={focused ? PALETTE.gold : PALETTE.surface}>{(focused ? "▁" : "▄").repeat(width)}</Text>
      <Box flexDirection="column" backgroundColor={PALETTE.surface} paddingX={1} width={width} height={height - 1}>
        <Box justifyContent="space-between" width={inner}>
          <Text bold color={PALETTE.star} wrap="truncate-end">
            {title.verb ? `${title.verb} ` : ""}
            {fit(title.text, inner - pillWidth - 2 - (title.verb ? title.verb.length + 1 : 0), title.path)}
          </Text>
          <Text>
            <Text color={status.color}>▐</Text>
            <Text bold backgroundColor={status.color} color={PALETTE.ink}>
              {status.text}
            </Text>
            <Text color={status.color}>▌</Text>
            {spent ? <Text color={PALETTE.dust}>{`  ${spent}`}</Text> : null}
          </Text>
        </Box>
        <Box justifyContent="space-between" width={inner}>
          <Text wrap="truncate-end">
            <Text color={PALETTE.teal}>{toolLabel(call.name)}</Text>
            {about ? <Text color={PALETTE.dust}>{`  ·  ${about}`}</Text> : null}
          </Text>
          <Box>
            <Box ref={back}>
              <Text color={hovered === "back" ? PALETTE.star : PALETTE.haze}>‹ </Text>
            </Box>
            <Text color={PALETTE.dust}>{position}</Text>
            <Box ref={forward}>
              <Text color={hovered === "forward" ? PALETTE.star : PALETTE.haze}> ›</Text>
            </Box>
          </Box>
        </Box>
        <Text> </Text>
        <Box width={inner}>
          {tabs.map((one, i) => {
            const active = one === tab;
            const over = hovered === `tab${i}`;
            return (
              <Box
                key={one}
                ref={(element) => {
                  tabRefs.current[i] = element;
                }}
                marginRight={1}
              >
                {active ? (
                  <Text>
                    <Text color={PALETTE.raised}>▐</Text>
                    <Text bold backgroundColor={PALETTE.raised} color={PALETTE.star}>
                      {LABELS[one]}
                    </Text>
                    <Text color={PALETTE.raised}>▌</Text>
                  </Text>
                ) : (
                  <Text color={over ? PALETTE.star : PALETTE.haze}>{` ${LABELS[one]} `}</Text>
                )}
              </Box>
            );
          })}
        </Box>
        <Text color={PALETTE.raised}>{"─".repeat(inner)}</Text>
        <Box flexDirection="row" width={inner} height={view}>
          <Box flexDirection="column" width={room} height={view}>
            {body ? (
              shown.map((line, i) => (
                <Text key={i} wrap="truncate-end">
                  {line || " "}
                </Text>
              ))
            ) : (
              <Text color={PALETTE.dust}>Drawing…</Text>
            )}
          </Box>
          <Box flexDirection="column" width={1} height={view}>
            {thumb
              ? Array.from({ length: view }, (_, i) => (
                  <Text key={i} color={PALETTE.dust}>
                    {i >= thumbTop && i < thumbTop + thumb ? "┃" : " "}
                  </Text>
                ))
              : null}
          </Box>
        </Box>
        <Text color={PALETTE.raised}>{"─".repeat(inner)}</Text>
        <Box justifyContent="space-between" width={inner}>
          {focused ? (
            <Text wrap="truncate-end">
              <Keys pairs={[["←→", "calls"], ["tab", "view"], ["↑↓", "scroll"], ["c", "copy"]]} />
            </Text>
          ) : (
            <Text color={PALETTE.dust} wrap="truncate-end">
              Click here for the keys
            </Text>
          )}
          <Box ref={close}>
            <Text>
              <Text color={hovered === "close" ? PALETTE.star : PALETTE.haze}>esc</Text>
              <Text color={hovered === "close" ? PALETTE.star : PALETTE.dust}>{over ? " back to the transcript" : " close"}</Text>
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function Keys({ pairs }: { pairs: [string, string][] }) {
  return (
    <>
      {pairs.map(([key, does], i) => (
        <Text key={key}>
          {i ? "   " : ""}
          <Text color={PALETTE.haze}>{key}</Text>
          <Text color={PALETTE.dust}>{` ${does}`}</Text>
        </Text>
      ))}
    </>
  );
}

/**
 * What the header calls the call: Claude's description of a command or subagent, else its activity
 * line, whose path keeps its end when it's cut to fit.
 */
function titleOf(call: ToolCall, cwd: string, home: string): { verb?: string; text: string; path: boolean } {
  const description = typeof call.input.description === "string" ? call.input.description.trim() : "";
  if ((call.name === "Bash" || call.name === "Agent" || call.name === "Task") && description) return { text: description, path: false };
  const row = activityRows([call], new Set(), cwd, home)[0];
  return row ? { verb: row.verb, text: row.target.map((part) => part.text).join("").trim(), path: row.path } : { text: toolLabel(call.name), path: false };
}

/** How the call went, for the pill in the header. */
function statusOf(call: ToolCall, waiting: boolean): { text: string; color: string } {
  if (waiting) return { text: "waiting for you", color: PALETTE.gold };
  const bash = call.name === "Bash" ? runOfCall(call, false) : null;
  if (call.background === "running") return { text: "◌ in the background", color: PALETTE.teal };
  switch (call.status) {
    case "running":
      return { text: "◌ running", color: PALETTE.haze };
    case "done":
      return { text: bash ? `✓ exit ${bash.code ?? 0}` : "✓ done", color: PALETTE.teal };
    case "error":
      return { text: bash?.code !== null && bash?.code !== undefined ? `✕ exit ${bash.code}` : "✕ failed", color: PALETTE.rose };
    case "denied":
      return { text: call.deniedBy ? `denied by ${call.deniedBy}` : "denied", color: PALETTE.ember };
    case "stopped":
      return { text: "■ stopped", color: PALETTE.ember };
  }
}

/** HH:MM:SS in the local time. */
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

type Body = { lines: string[]; copy: string };

/** Each call's tabs as drawn, by width and tab. Calls are replaced, not changed, when they change. */
const bodies = new WeakMap<ToolCall, Map<string, Body>>();

/**
 * The tab's lines, drawn just after React commits, since Ink can't render to a string in the middle
 * of rendering, and kept until the call changes. Undefined until then.
 */
function useBody(call: ToolCall, tab: TabId, width: number) {
  const key = `${tab}|${width}`;
  const known = bodies.get(call)?.get(key);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (known) return;
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      const all = bodies.get(call) ?? new Map<string, Body>();
      all.set(key, bodyOf(call, tab, width));
      bodies.set(call, all);
      redraw((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [call, key, known]);
  return known;
}

function bodyOf(call: ToolCall, tab: TabId, width: number): Body {
  const text = (key: string) => (typeof call.input[key] === "string" ? (call.input[key] as string) : "");
  const path = text("file_path");
  const language = path.includes(".") ? (path.split(".").pop() ?? "") : "";
  const result = call.result ?? "";
  switch (tab) {
    case "output":
      return outputOf(call, width);
    case "command":
      return commandOf(call, width);
    case "sent":
      return result.trim()
        ? { lines: [...pictureNote(call), ...numbered(onPanel(printable(result)), width)], copy: result }
        : { lines: [say(call.status === "running" ? "Nothing yet: the call is still running." : "Claude got no text back.")], copy: "" };
    case "input": {
      const json = JSON.stringify(call.input, null, 2);
      return { lines: wrapped(onPanel(highlightCode(json, "json")), width), copy: json };
    }
    case "diff": {
      const lines = editLines(call);
      const drawn = linesOf(<Diff lines={lines} width={width} limit={MOST_LINES} path={path} framed={false} />, width);
      const unified = lines.map((line) => `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${line.text}`).join("\n");
      return { lines: drawn.length ? drawn : [say("Nothing changed.")], copy: unified };
    }
    case "content": {
      const file = field(call.output, "file");
      const read = field(file, "content");
      // A saved conversation keeps only the text Claude got, numbered as `cat -n` numbers it.
      const saved = call.name === "Read" && typeof read !== "string" ? readLines(result) : null;
      const source = call.name === "Read" ? (typeof read === "string" ? read : (saved?.lines.join("\n") ?? "")) : text("content");
      if (!source) return { lines: [...pictureNote(call), say(call.images?.length ? "" : "It has no text.")].filter(Boolean), copy: "" };
      const start = saved?.start ?? (Number(field(file, "startLine")) || 1);
      return { lines: [...pictureNote(call), ...numbered(onPanel(highlightCode(source, language)), width, { start })], copy: source };
    }
    case "results":
      return result.trim() ? { lines: numbered(onPanel(printable(result)), width), copy: result } : { lines: [say("It found nothing.")], copy: "" };
    case "response": {
      const said = field(call.output, "result");
      const markdown = typeof said === "string" ? said : result;
      return { lines: markdownLines(markdown || "No response.", width), copy: markdown };
    }
    case "report": {
      const report = subagentReport(call);
      return { lines: markdownLines(report || (call.status === "running" ? "It's still working. Its report comes when it ends." : "It reported nothing."), width), copy: report };
    }
    case "prompt":
      return { lines: markdownLines(text("prompt") || "No prompt.", width), copy: text("prompt") };
    case "plan":
      return { lines: markdownLines(text("plan") || "No plan.", width), copy: text("plan") };
    case "todos": {
      const todos = Array.isArray(call.input.todos) ? call.input.todos : [];
      const copy = todos.map((todo) => `- [${field(todo, "status") === "completed" ? "x" : " "}] ${String(field(todo, "content") ?? "")}`).join("\n");
      return { lines: linesOf(<TodoList todos={todos} />, width), copy };
    }
    case "answers": {
      const answers = field(call.output, "answers") ?? call.input.answers;
      const pairs = typeof answers === "object" && answers !== null ? Object.entries(answers as Record<string, unknown>) : [];
      const copy = pairs.map(([question, answer]) => `${question}\n${String(answer)}`).join("\n\n");
      return {
        lines: pairs.length ? pairs.flatMap(([question, answer], i) => [...(i ? [""] : []), ...wrapped(`${sgr(PALETTE.haze)}${question}\x1b[39m`, width), ...wrapped(`${sgr(PALETTE.gold)}${String(answer)}\x1b[39m`, width)]) : [say("No answers yet.")],
        copy,
      };
    }
    case "result": {
      const shown = result.trim() ? result : call.output === undefined ? "" : JSON.stringify(call.output, null, 2);
      return shown ? { lines: [...pictureNote(call), ...numbered(onPanel(printable(shown)), width)], copy: shown } : { lines: [...pictureNote(call), say(call.status === "running" ? "Nothing yet: the call is still running." : "No result.")], copy: "" };
    }
  }
}

/**
 * What a command printed, as its terminal showed it, under the command's first line: what it
 * printed to stdout, numbered, then what it printed as errors.
 */
function outputOf(call: ToolCall, width: number): Body {
  const run = runOfCall(call, false);
  const first = run.command.split("\n")[0] ?? "";
  const head = `${sgr(PALETTE.dust)}$ \x1b[39m${onPanel(highlightShell(first))}${run.command.trim().includes("\n") ? `${sgr(PALETTE.dust)} …\x1b[39m` : ""}`;
  const lines = [...wrapped(head, width), ""];
  if (run.background === "running") return { lines: [...lines, say("It runs in the background. /tasks shows its output as it goes.")], copy: "" };
  if (run.status === "running") return { lines: [...lines, say("It's still running. Its output comes when it ends.")], copy: "" };
  const out = run.stdout.replace(/\n+$/, "");
  const err = run.stderr.replace(/\n+$/, "");
  if (!out.trim() && !err.trim()) return { lines: [...lines, say(run.status === "denied" ? "It didn't run." : "It printed nothing.")], copy: "" };
  if (out.trim()) lines.push(...numbered(onPanel(printableColored(out)), width));
  if (err.trim()) {
    if (out.trim()) lines.push("");
    lines.push(`${sgr(run.status === "error" ? PALETTE.rose : PALETTE.dust)}stderr\x1b[39m`);
    lines.push(...numbered(onPanel(printable(err)), width, { color: run.status === "error" ? PALETTE.rose : undefined }));
  }
  return { lines, copy: [printable(out), printable(err)].filter((one) => one.trim()).join("\n") };
}

/** A command whole, as Claude wrote it, and what else Claude Code knows of the call. */
function commandOf(call: ToolCall, width: number): Body {
  const run = runOfCall(call, false);
  const command = run.command.replace(/\n+$/, "");
  const lines = wrapped(`${sgr(PALETTE.dust)}$ \x1b[39m${onPanel(highlightShell(command))}`, width);
  lines.push("");
  const kv = (label: string, value: string, color?: string) => {
    if (value) lines.push(...wrapped(`${sgr(PALETTE.dust)}${label.padEnd(14)}\x1b[39m${color ? sgr(color) : ""}${value}${color ? "\x1b[39m" : ""}`, width));
  };
  const timeout = Number(call.input.timeout);
  kv("description", typeof call.input.description === "string" ? call.input.description : "");
  kv("timeout", timeout ? took(timeout) : "2m, the default");
  kv("background", call.input.run_in_background === true ? "yes, from the start" : run.timedOutAfterMs ? `moved there after ${took(run.timedOutAfterMs)}` : call.background ? "yes" : "no");
  if (call.input.dangerouslyDisableSandbox === true) kv("sandbox", "off, as Claude asked", PALETTE.ember);
  if (call.startedAt !== undefined) kv("started", clock(call.startedAt));
  if (call.endedAt !== undefined) kv("ended", `${clock(call.endedAt)}${run.ms !== undefined ? `   took ${took(run.ms)}` : ""}`);
  if (run.code !== null) kv("exit code", String(run.code), run.code ? PALETTE.rose : PALETTE.teal);
  if (run.interrupted) kv("interrupted", "yes", PALETTE.ember);
  if (run.note) kv("Claude Code", run.note);
  if (run.taskId) kv("task", run.taskId);
  return { lines, copy: command };
}

/**
 * A command highlighted as shell, the text of its heredocs left as written, since the highlighter
 * reads that text as code too and colors it at random.
 */
function highlightShell(command: string) {
  const lines = command.split("\n");
  const out: string[] = [];
  let code: string[] = [];
  const flush = () => {
    if (code.length) out.push(...highlightCode(code.join("\n"), "bash").split("\n"));
    code = [];
  };
  for (let i = 0; i < lines.length; i++) {
    code.push(lines[i]!);
    const heredoc = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(lines[i]!);
    if (!heredoc) continue;
    flush();
    // The text up to the line that ends it, which is code again.
    while (i + 1 < lines.length && lines[i + 1]!.replace(/^\t+/, "") !== heredoc[2]) out.push(lines[++i]!);
  }
  flush();
  return out.join("\n");
}

/** A line about pictures the result carried, which the transcript draws under the call's line. */
function pictureNote(call: ToolCall) {
  const count = call.images?.length ?? 0;
  return count ? [say(`${plural(count, "picture")}, drawn in the transcript under the call's line.`), ""] : [];
}

const say = (text: string) => `${sgr(PALETTE.haze)}${text}\x1b[39m`;

function linesOf(element: ReactNode, width: number) {
  const text = renderToString(element, { columns: width });
  return text === "" ? [] : text.split("\n");
}

function markdownLines(text: string, width: number) {
  return linesOf(<Markdown text={text} width={width} />, width);
}

/** Text cut into rows of `width` cells, as a terminal wraps it, its colors carried from row to row. */
function wrapped(text: string, width: number) {
  return carried(text.split("\n")).flatMap((line) => wrapAnsi(expandTabs(line), Math.max(1, width), { hard: true, trim: false, wordWrap: false }).split("\n"));
}

/**
 * Text as numbered lines, each wrapped to `width` with its number in a gutter on its first row.
 * `start` is the first line's number, as where a read began.
 */
function numbered(text: string, width: number, { start = 1, color }: { start?: number; color?: string } = {}) {
  const lines = carried(text.replace(/\n+$/, "").split("\n")).slice(0, MOST_LINES);
  const total = text.replace(/\n+$/, "").split("\n").length;
  const digits = String(start + lines.length - 1).length;
  const room = Math.max(1, width - digits - 2);
  const out: string[] = [];
  lines.forEach((line, i) => {
    const rows = wrapAnsi(expandTabs(line), room, { hard: true, trim: false, wordWrap: false }).split("\n");
    rows.forEach((row, j) => {
      const number = j === 0 ? String(start + i).padStart(digits) : " ".repeat(digits);
      out.push(`${sgr(PALETTE.dust)}${number}\x1b[39m  ${color ? sgr(color) : ""}${row}${color ? "\x1b[39m" : ""}`);
    });
  });
  if (total > lines.length) out.push(say(`… ${plural(total - lines.length, "more line")}. c copies them all.`));
  return out;
}

/** Tabs as the spaces to the next stop of eight, as a terminal shows them. */
function expandTabs(line: string) {
  if (!line.includes("\t")) return line;
  let out = "";
  let column = 0;
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b[")) {
      out += part;
      continue;
    }
    for (const character of part) {
      if (character === "\t") {
        const spaces = 8 - (column % 8);
        out += " ".repeat(spaces);
        column += spaces;
      } else {
        out += character;
        column += 1;
      }
    }
  }
  return out;
}

/**
 * Lines that each start with the colors the line before left on, as a highlighter's string that
 * colors a comment over several lines does: each line is drawn on its own.
 */
function carried(lines: string[]) {
  let open = "";
  return lines.map((line) => {
    const out = open + line;
    for (const [code] of line.matchAll(/\x1b\[([0-9;]*)m/g)) {
      const codes = code.slice(2, -1);
      if (codes === "" || codes === "0" || codes === "39" || codes.endsWith(";39") || codes.startsWith("0;")) open = codes.startsWith("0;") ? code : "";
      else open += code;
    }
    return out;
  });
}
