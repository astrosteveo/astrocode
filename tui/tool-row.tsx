// A tool call: its node on the rail says how it went (a filled hexagon once it's done, an outline
// while it runs or after it stopped), and its row says what it was: the tool, what it acts on,
// and a word on the result, set against the right edge. Finished rows keep what matters from the
// result on a panel under them.
import { Box, Text } from "ink";
import type { ToolCall } from "../src/view/state";
import type { Todo } from "../src/view/todos";
import { bashOutput, field, plural, toolLabel, toolSummary, toolTarget } from "../src/view/tools";
import { cellWidth, printable, printableColored } from "./markdown";
import { fit, onPanel, Panel } from "./markdown-view";
import { PALETTE, TINT } from "./theme";

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

type Props = { call: ToolCall; waiting?: boolean; cwd: string; home: string; width: number; detailed?: boolean };

/** The node a tool call shows on the rail. */
export function toolNode(call: ToolCall, waiting: boolean) {
  return STATUS[waiting ? "waiting" : call.status];
}

export function ToolRow({ call, waiting = false, cwd, home, width, detailed = false }: Props) {
  const status = waiting ? "waiting" : call.status;
  const name = toolLabel(call.name);
  const summary = toolSummary(call, waiting);
  const summaryColor =
    status === "error" ? PALETTE.rose : status === "denied" || status === "stopped" ? PALETTE.ember : status === "waiting" ? PALETTE.gold : PALETTE.haze;
  const room = width - cellWidth(name) - 2 - (summary ? cellWidth(summary) + 2 : 0);
  const target = fit(toolTarget(call, cwd, home), room, PATHLIKE.has(call.name));
  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between" width={width}>
        <Text wrap="truncate-end">
          <Text bold color={PALETTE.teal}>
            {name}
          </Text>
          {target ? `  ${target}` : ""}
        </Text>
        {summary ? <Text color={summaryColor}>{summary}</Text> : null}
      </Box>
      {detailed ? <Detail call={call} width={width} /> : null}
    </Box>
  );
}

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
    case "Bash":
      return <BashOutput call={call} width={width} limit={OUTPUT_LINES} />;
    case "Edit":
      return <EditDiff call={call} width={width} limit={OUTPUT_LINES * 2} />;
    case "TodoWrite":
      return <Todos call={call} />;
    case "AskUserQuestion":
      return <QuestionAnswers call={call} />;
    default:
      return null;
  }
}

export function BashOutput({ call, width, limit }: { call: ToolCall; width: number; limit: number }) {
  const structured = bashOutput(call.output);
  return <ShellOutput stdout={structured?.stdout ?? call.result ?? ""} stderr={structured?.stderr ?? ""} width={width} limit={limit} />;
}

/** What a command printed, on a panel, with what it printed as errors on one of its own. */
export function ShellOutput({ stdout: out, stderr: err, width, limit }: { stdout: string; stderr: string; width: number; limit: number }) {
  // Claude Code's words for a command that printed nothing.
  const said = /^\(\w+ completed with no output\)$/.test(out.trim()) ? "" : out;
  const stdout = clip(printableColored(said), limit);
  const stderr = clip(printable(err), limit);
  if (!stdout.text && !stderr.text) return null;
  return (
    <Box flexDirection="column">
      {stdout.text ? (
        <Panel note={stdout.hidden ? stdout.note : undefined} width={width}>
          <Text>{onPanel(stdout.text)}</Text>
        </Panel>
      ) : null}
      {stderr.text ? (
        <Panel label="stderr" note={stderr.hidden ? stderr.note : undefined} width={width}>
          <Text color={PALETTE.rose}>{stderr.text}</Text>
        </Panel>
      ) : null}
    </Box>
  );
}

/** Claude Code's patch for the edit when it sent one, with context lines; else the replaced text. */
export function patchLines(call: ToolCall) {
  const hunks = field(call.output, "structuredPatch");
  const text = (key: string) => (typeof call.input[key] === "string" ? (call.input[key] as string) : "");
  if (Array.isArray(hunks)) {
    return hunks.flatMap((hunk) => {
      const body = field(hunk, "lines");
      return Array.isArray(body) ? body.map(String) : [];
    });
  }
  return [...text("old_string").split("\n").map((line) => `-${line}`), ...text("new_string").split("\n").map((line) => `+${line}`)];
}

/** An edit as a diff on a panel: added lines tinted teal, removed ones rose, the rest quiet. */
export function EditDiff({ call, width, limit }: { call: ToolCall; width: number; limit: number }) {
  const lines = patchLines(call);
  const shown = lines.slice(0, limit);
  return (
    <Panel width={width} paddingX={0}>
      {shown.map((line, i) => {
        const kind = line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : "context";
        return (
          <Box key={i} backgroundColor={kind === "added" ? TINT.added : kind === "removed" ? TINT.removed : undefined} width={width}>
            <Text color={kind === "added" ? PALETTE.teal : kind === "removed" ? PALETTE.rose : PALETTE.haze}>
              {` ${printable(line) || " "}`}
            </Text>
          </Box>
        );
      })}
      {lines.length > shown.length ? <Text color={PALETTE.haze}>{` ${plural(lines.length - shown.length, "more line")}`}</Text> : null}
    </Panel>
  );
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
