// A tool call: its node on the rail says how it went (a filled hexagon once it's done, an outline
// while it runs or after it stopped), and its row says what it was: the tool, what it acts on,
// and a word on the result, set against the right edge. Finished rows keep what matters from the
// result on a panel under them. Bash calls are cards of their own (`shell-card.tsx`).
import { Box, Text } from "ink";
import { resolve } from "node:path";
import type { ToolCall } from "../src/view/state";
import type { Todo } from "../src/view/todos";
import { field, plural, SHOW_TOOL, toolLabel, toolSummary, toolTarget } from "../src/view/tools";
import { Diff, editLines } from "./diff";
import { fileUrl, hyperlink } from "./links";
import { cellWidth, printable } from "./markdown";
import { fit } from "./markdown-view";
import { isReady, Pictures } from "./pictures";
import { PALETTE } from "./theme";

export const STATUS = {
  running: { glyph: "⬡", color: PALETTE.haze },
  waiting: { glyph: "⬢", color: PALETTE.gold },
  done: { glyph: "⬢", color: PALETTE.teal },
  error: { glyph: "⬢", color: PALETTE.rose },
  denied: { glyph: "⬡", color: PALETTE.ember },
  stopped: { glyph: "⬡", color: PALETTE.ember },
} as const;

export const PATHLIKE = new Set(["Read", "Edit", "Write", "NotebookEdit", "WebFetch"]);

/** Lines of output a finished row keeps; its panel says how many more there were. */
const OUTPUT_LINES = 12;

/** `pictureRows`: how tall a picture the result carried may be. */
/** `fileLink`: the file the call acts on is a link the terminal opens, in scrollback. */
type Props = { call: ToolCall; waiting?: boolean; cwd: string; home: string; width: number; pictureRows: number; detailed?: boolean; fileLink?: boolean };

/** The node a tool call shows on the rail. */
export function toolNode(call: ToolCall, waiting: boolean) {
  return STATUS[waiting ? "waiting" : call.status];
}

export function ToolRow({ call, waiting = false, cwd, home, width, pictureRows, detailed = false, fileLink = false }: Props) {
  const status = waiting ? "waiting" : call.status;
  const name = toolLabel(call.name);
  const summary = toolSummary(call, waiting);
  const summaryColor =
    status === "error" ? PALETTE.rose : status === "denied" || status === "stopped" ? PALETTE.ember : status === "waiting" ? PALETTE.gold : PALETTE.haze;
  const room = width - cellWidth(name) - 2 - (summary ? cellWidth(summary) + 2 : 0);
  // A question waiting for you is spelled out in its prompt, under the transcript.
  const whole = waiting && call.name === "AskUserQuestion" ? "" : toolTarget(call, cwd, home);
  const fitted = fit(whole, room, PATHLIKE.has(call.name));
  const file = typeof call.input.file_path === "string" ? call.input.file_path : typeof call.input.notebook_path === "string" ? call.input.notebook_path : "";
  const target = fileLink && file && fitted ? hyperlink(fileUrl(resolve(cwd, file)), fitted) : fitted;
  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between" width={width}>
        <Text wrap="truncate-end">
          <Text color={PALETTE.teal}>{name}</Text>
          {target ? <Text color={PALETTE.haze}>{`  ${target}`}</Text> : null}
        </Text>
        {summary ? <Text color={summaryColor}>{summary}</Text> : null}
      </Box>
      {detailed ? <Detail call={call} width={width} /> : null}
      {/* What Claude shows you on purpose may take the whole screen; a picture a tool returned, half. */}
      {detailed ? <Pictures images={picturesOf(call)} width={width} rows={call.name === SHOW_TOOL ? pictureRows * 2 : pictureRows} /> : null}
    </Box>
  );
}

/** The pictures a finished call's row draws under it: the images its result carried, where the terminal draws them. */
export const picturesOf = (call: ToolCall) => (call.status === "done" ? (call.images ?? []).filter(isReady) : []);

/** The row for a tool call Claude is still writing. */
export function DraftRow({ name }: { name: string }) {
  return (
    <Text>
      <Text bold color={PALETTE.teal}>
        {toolLabel(name)}
      </Text>
      <Text color={PALETTE.haze}>{"  getting ready"}</Text>
    </Text>
  );
}

function Detail({ call, width }: { call: ToolCall; width: number }) {
  if (call.status === "error") {
    const said = printable(call.result ?? "").trim();
    return said ? <Text color={PALETTE.rose}>{clip(said, 6).text}</Text> : null;
  }
  if (call.status !== "done") return null;
  switch (call.name) {
    case "Edit":
      return <Diff lines={editLines(call)} width={width} limit={OUTPUT_LINES * 2} path={String(call.input.file_path ?? "")} />;
    case "TodoWrite":
      return <Todos call={call} />;
    case "AskUserQuestion":
      return <QuestionAnswers call={call} />;
    default:
      return null;
  }
}

function Todos({ call }: { call: ToolCall }) {
  return <TodoList todos={Array.isArray(call.input.todos) ? call.input.todos : []} />;
}

/** To-dos as Claude wrote them: done ones struck through, the one under way bright. */
export function TodoList({ todos }: { todos: unknown[] }) {
  return (
    <Box flexDirection="column">
      {todos.map((todo, i) => {
        const status = field(todo, "status");
        const content = String(field(todo, "content") ?? "");
        if (status === "completed") {
          return (
            <Text key={i} color={PALETTE.haze} strikethrough>
              {`● ${content}`}
            </Text>
          );
        }
        if (status === "in_progress") {
          return (
            <Text key={i} bold color={PALETTE.teal}>
              {`◐ ${content}`}
            </Text>
          );
        }
        return <Text key={i}>{`○ ${content}`}</Text>;
      })}
    </Box>
  );
}

/**
 * Claude's latest to-dos, held above the message box while it works through them. The rows shown
 * start just before the first one not yet done.
 */
export function PinnedTodos({ todos, rows }: { todos: Todo[]; rows: number }) {
  const done = todos.filter((todo) => todo.status === "completed").length;
  const next = todos.findIndex((todo) => todo.status !== "completed");
  const start = Math.max(0, Math.min(next === -1 ? todos.length : next - 1, todos.length - rows));
  const shown = todos.slice(start, start + rows);
  const hidden = todos.length - shown.length;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={PALETTE.haze}>To-dos</Text>
        <Text color={PALETTE.dust}>{`  ${done} of ${todos.length} done${hidden ? `, ${hidden} not shown` : ""}   ctrl+t hides`}</Text>
      </Text>
      <Box paddingLeft={2}>
        <TodoList todos={shown} />
      </Box>
    </Box>
  );
}

/** What you answered, under the question's row, in your color. */
function QuestionAnswers({ call }: { call: ToolCall }) {
  const answers = field(call.output, "answers") ?? call.input.answers;
  if (typeof answers !== "object" || answers === null) return null;
  return (
    <Box flexDirection="column">
      {Object.entries(answers as Record<string, unknown>).map(([question, answer]) => (
        <Text key={question}>
          <Text color={PALETTE.haze}>{`${question}  `}</Text>
          <Text color={PALETTE.gold}>{String(answer)}</Text>
        </Text>
      ))}
    </Box>
  );
}

/** The first `limit` lines, and a note saying how many there were or how many were left out. */
export function clip(text: string, limit: number) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const hidden = lines.length - limit;
  return {
    text: text.trim() ? lines.slice(0, limit).join("\n") : "",
    hidden: hidden > 0,
    note: hidden > 0 ? plural(hidden, "more line") : plural(lines.length, "line"),
  };
}
