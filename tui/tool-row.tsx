// A tool call as one row, after nebula-ui: a status glyph, the tool as a pill, what it acts on,
// and a word on how it went. Finished rows in scrollback also keep what matters from the result.
import { Box, Text } from "ink";
import type { ToolCall } from "../src/view/state";
import { bashOutput, field, plural, toolLabel, toolSummary, toolTarget } from "../src/view/tools";
import { cellWidth, printable, printableColored } from "./markdown";
import { Frame, fit } from "./markdown-view";
import { ACCENT, COLOR } from "./theme";

const STATUS = {
  running: { glyph: "◌", color: COLOR.info },
  waiting: { glyph: "◆", color: ACCENT },
  done: { glyph: "✓", color: COLOR.success },
  error: { glyph: "✗", color: COLOR.error },
  denied: { glyph: "⊘", color: COLOR.warning },
  stopped: { glyph: "⊘", color: COLOR.warning },
} as const;

const PATHLIKE = new Set(["Read", "Edit", "Write", "NotebookEdit", "WebFetch"]);

/** Lines of output a finished row keeps in scrollback; its frame says how many more there were. */
const OUTPUT_LINES = 12;

type Props = { call: ToolCall; waiting?: boolean; cwd: string; home: string; width: number; detailed?: boolean };

export function ToolRow({ call, waiting = false, cwd, home, width, detailed = false }: Props) {
  const status = waiting ? "waiting" : call.status;
  const { glyph, color } = STATUS[status];
  const pill = ` ${toolLabel(call.name)} `;
  const summary = toolSummary(call, waiting);
  const summaryColor =
    status === "error" ? COLOR.error : status === "denied" || status === "stopped" ? COLOR.warning : status === "waiting" ? ACCENT : undefined;
  const room = width - 2 - cellWidth(pill) - 1 - (summary ? cellWidth(summary) + 2 : 0);
  const target = fit(toolTarget(call, cwd, home), room, PATHLIKE.has(call.name));
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={color}>{glyph}</Text>{" "}
        <Text inverse bold color={ACCENT}>
          {pill}
        </Text>
        {target ? ` ${target}` : ""}
        {summary ? (
          <Text color={summaryColor} dimColor={!summaryColor}>
            {`  ${summary}`}
          </Text>
        ) : null}
      </Text>
      {detailed ? <Detail call={call} width={width - 2} /> : null}
    </Box>
  );
}

/** The row for a tool call Claude is still writing. */
export function DraftRow({ name }: { name: string }) {
  return (
    <Text>
      <Text color={COLOR.info}>⋯</Text>{" "}
      <Text inverse bold color={ACCENT}>
        {` ${toolLabel(name)} `}
      </Text>
      <Text dimColor>{"  preparing"}</Text>
    </Text>
  );
}

function Detail({ call, width }: { call: ToolCall; width: number }) {
  const body = detail(call, width);
  return body ? (
    <Box paddingLeft={2} flexDirection="column">
      {body}
    </Box>
  ) : null;
}

function detail(call: ToolCall, width: number) {
  if (call.status === "error") {
    const said = printable(call.result ?? "").trim();
    return said ? <Text color={COLOR.error}>{clip(said, 6).text}</Text> : null;
  }
  if (call.status !== "done") return null;
  switch (call.name) {
    case "Bash":
      return <BashOutput call={call} width={width} />;
    case "Edit":
      return <EditDiff call={call} width={width} />;
    case "TodoWrite":
      return <Todos call={call} />;
    default:
      return null;
  }
}

function BashOutput({ call, width }: { call: ToolCall; width: number }) {
  const structured = bashOutput(call.output);
  const fallback = /^\(\w+ completed with no output\)$/.test(call.result?.trim() ?? "") ? "" : (call.result ?? "");
  const stdout = clip(printableColored(structured?.stdout ?? fallback), OUTPUT_LINES);
  const stderr = clip(printable(structured?.stderr ?? ""), OUTPUT_LINES);
  if (!stdout.text && !stderr.text) return null;
  return (
    <Box flexDirection="column">
      {stdout.text ? (
        <Frame label="stdout" note={stdout.note} width={width}>
          <Text>{stdout.text}</Text>
        </Frame>
      ) : null}
      {stderr.text ? (
        <Frame label="stderr" note={stderr.note} width={width} labelColor={COLOR.error}>
          <Text color={COLOR.error}>{stderr.text}</Text>
        </Frame>
      ) : null}
    </Box>
  );
}

/** Claude Code's patch for the edit when it sent one, with context lines; else the replaced text. */
function EditDiff({ call, width }: { call: ToolCall; width: number }) {
  const hunks = field(call.output, "structuredPatch");
  const text = (key: string) => (typeof call.input[key] === "string" ? (call.input[key] as string) : "");
  const lines = Array.isArray(hunks)
    ? hunks.flatMap((hunk) => {
        const body = field(hunk, "lines");
        return Array.isArray(body) ? body.map(String) : [];
      })
    : [...text("old_string").split("\n").map((line) => `-${line}`), ...text("new_string").split("\n").map((line) => `+${line}`)];
  const added = lines.filter((line) => line.startsWith("+")).length;
  const removed = lines.filter((line) => line.startsWith("-")).length;
  const shown = lines.slice(0, OUTPUT_LINES * 2);
  const path = text("file_path");
  return (
    <Frame label={path.split("/").pop() ?? path} note={`+${added} −${removed}`} width={width}>
      {shown.map((line, i) => (
        <Text key={i} color={line.startsWith("+") ? COLOR.success : line.startsWith("-") ? COLOR.error : undefined} dimColor={line.startsWith(" ")}>
          {printable(line) || " "}
        </Text>
      ))}
      {lines.length > shown.length ? <Text dimColor>{plural(lines.length - shown.length, "more line")}</Text> : null}
    </Frame>
  );
}

function Todos({ call }: { call: ToolCall }) {
  const todos = Array.isArray(call.input.todos) ? call.input.todos : [];
  return (
    <Box flexDirection="column">
      {todos.map((todo, i) => {
        const status = field(todo, "status");
        const content = String(field(todo, "content") ?? "");
        if (status === "completed") {
          return (
            <Text key={i} dimColor strikethrough>
              {`☒ ${content}`}
            </Text>
          );
        }
        if (status === "in_progress") {
          return (
            <Text key={i} bold color={ACCENT}>
              {`◐ ${content}`}
            </Text>
          );
        }
        return <Text key={i}>{`☐ ${content}`}</Text>;
      })}
    </Box>
  );
}

/** The first `limit` lines, and a note saying how many there were or how many were left out. */
function clip(text: string, limit: number) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const hidden = lines.length - limit;
  return {
    text: text.trim() ? lines.slice(0, limit).join("\n") : "",
    note: hidden > 0 ? plural(hidden, "more line") : plural(lines.length, "line"),
  };
}
