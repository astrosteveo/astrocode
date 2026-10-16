// A tool call's whole output, printed into scrollback on request (Ctrl+O or /output).
import { Box, Text } from "ink";
import type { ToolCall } from "../src/view/state";
import { field, toolLabel, toolTarget } from "../src/view/tools";
import { highlightCode } from "./highlight";
import { printable } from "./markdown";
import { Frame, Markdown, fit } from "./markdown-view";
import { BashOutput, clip, EditDiff, STATUS } from "./tool-row";

/** The most lines printed for one output; scrollback can hold this much without trouble. */
const MAX_LINES = 2000;

type Props = { call: ToolCall; cwd: string; home: string; width: number };

export function FullOutput({ call, cwd, home, width }: Props) {
  const { glyph, color } = STATUS[call.status];
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={color}>{glyph}</Text>
        <Text bold>{` ${toolLabel(call.name)} `}</Text>
        <Text dimColor>{fit(toolTarget(call, cwd, home), width - 20, true)}</Text>
        <Text dimColor>{"  full output"}</Text>
      </Text>
      <Box paddingLeft={2} flexDirection="column">
        <Body call={call} width={width - 2} />
      </Box>
    </Box>
  );
}

function Body({ call, width }: { call: ToolCall; width: number }) {
  const path = typeof call.input.file_path === "string" ? call.input.file_path : "";
  const language = path.includes(".") ? (path.split(".").pop() ?? "") : "";
  switch (call.name) {
    case "Bash":
      return <BashOutput call={call} width={width} limit={MAX_LINES} />;
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
  if (!result) return <Text dimColor>No output.</Text>;
  const shown = clip(printable(result), MAX_LINES);
  return (
    <Frame label="result" note={shown.note} width={width}>
      <Text>{shown.text}</Text>
    </Frame>
  );
}

function Source({ label, source, language, width }: { label: string; source: string; language: string; width: number }) {
  const shown = clip(source, MAX_LINES);
  return (
    <Frame label={label} note={shown.note} width={width}>
      <Text>{highlightCode(shown.text, language)}</Text>
    </Frame>
  );
}
