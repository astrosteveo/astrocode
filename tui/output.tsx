// A tool call's whole output, printed into scrollback on request (Ctrl+O or /output), or opened
// under its row in full screen.
import { Box, Text } from "ink";
import type { ToolCall } from "../src/view/state";
import { field, toolLabel, toolTarget } from "../src/view/tools";
import { highlightCode } from "./highlight";
import { printable } from "./markdown";
import { Markdown, fit, onPanel, Panel } from "./markdown-view";
import { PALETTE } from "./theme";
import { BashOutput, clip, CommandPanel, EditDiff, hiddenCommand } from "./tool-row";

/** The most lines printed for one output; scrollback can hold this much without trouble. */
const MAX_LINES = 2000;

type Props = { call: ToolCall; cwd: string; home: string; width: number };

/** The header of a printed output: which call it belongs to, since it lands at the end of the transcript. */
export function FullOutput({ call, cwd, home, width }: Props) {
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold color={PALETTE.teal}>
          {toolLabel(call.name)}
        </Text>
        <Text>{`  ${fit(toolTarget(call, cwd, home), width - TARGET_ROOM, true)}`}</Text>
        <Text color={PALETTE.haze}>{"  whole output"}</Text>
      </Text>
      <OutputBody call={call} width={width} />
    </Box>
  );
}

/** About how many cells a row's tool name and summary take, leaving the rest for what the call acts on. */
const TARGET_ROOM = 30;

export function OutputBody({ call, width }: { call: ToolCall; width: number }) {
  const path = typeof call.input.file_path === "string" ? call.input.file_path : "";
  const language = path.includes(".") ? (path.split(".").pop() ?? "") : "";
  switch (call.name) {
    case "Bash": {
      const command = hiddenCommand(call, typeof call.input.command === "string" ? call.input.command : "", width - TARGET_ROOM);
      return (
        <Box flexDirection="column">
          {command ? <CommandPanel command={command} width={width} limit={MAX_LINES} /> : null}
          <BashOutput call={call} width={width} limit={MAX_LINES} />
        </Box>
      );
    }
    case "Edit":
      return <EditDiff call={call} width={width} limit={MAX_LINES} />;
    case "Write":
      return <Source label={path.split("/").pop() ?? "file"} source={String(call.input.content ?? "")} language={language} width={width} />;
    case "Read": {
      const content = field(field(call.output, "file"), "content");
      if (typeof content === "string") return <Source label={path.split("/").pop() ?? "file"} source={content} language={language} width={width} />;
      break;
    }
    case "WebFetch":
    case "WebSearch":
    case "Agent":
    case "Task": {
      const said = field(call.output, "result");
      return <Markdown text={clip(typeof said === "string" ? said : (call.result ?? ""), MAX_LINES).text || "No output."} width={width} />;
    }
  }
  const result = call.result?.trim() ? call.result : call.output === undefined ? "" : JSON.stringify(call.output, null, 2);
  if (!result) return <Text color={PALETTE.haze}>No output.</Text>;
  const shown = clip(printable(result), MAX_LINES);
  return (
    <Panel note={shown.note} width={width}>
      <Text>{shown.text}</Text>
    </Panel>
  );
}

function Source({ label, source, language, width }: { label: string; source: string; language: string; width: number }) {
  const shown = clip(source, MAX_LINES);
  return (
    <Panel label={label} note={shown.note} width={width}>
      <Text>{onPanel(highlightCode(shown.text, language))}</Text>
    </Panel>
  );
}
