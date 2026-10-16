import { Box, Text, useInput } from "ink";
import { useRef, useState } from "react";
import type { Decision as Choice, PermissionRequest } from "../src/events";
import { alwaysLabel, permissionNote, permissionTitle } from "../src/view/permissions";
import { plural, shortPath } from "../src/view/tools";
import { printable } from "./markdown";
import { ACCENT, COLOR } from "./theme";

/** Keys pressed this soon after the prompt appears were meant for something else, so Enter and digits wait. */
const GRACE_MS = 500;

/** Lines of a command, diff or file the prompt shows before saying how many more there are. */
const PREVIEW_LINES = 12;

type Props = { request: PermissionRequest; cwd: string; home: string; width: number; onDecide: (choice: Choice) => void };

/** Choose with the arrow keys and Enter, or press a number. Esc or Ctrl+C denies. */
export function DecisionPrompt({ request, cwd, home, width, onDecide }: Props) {
  const always = alwaysLabel(request.alwaysAllow, home);
  const options: { choice: Choice; label: string }[] = [
    { choice: "allow", label: "Allow" },
    ...(always ? [{ choice: "always" as const, label: always }] : []),
    { choice: "deny", label: "Deny, and tell Claude what to do instead" },
  ];
  const [selected, setSelected] = useState(request.defaultToNo ? options.length - 1 : 0);
  const shownAt = useRef(Date.now());
  const note = permissionNote(request, cwd, home);

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.upArrow) setSelected((i) => (i + options.length - 1) % options.length);
    else if (key.downArrow || (key.tab && !key.shift)) setSelected((i) => (i + 1) % options.length);
    else if (key.escape || (key.ctrl && input === "c")) onDecide("deny");
    else if (Date.now() - shownAt.current < GRACE_MS) return;
    else if (key.return) onDecide(options[selected]?.choice ?? "deny");
    else if (/^[1-9]$/.test(input)) {
      const option = options[Number(input) - 1];
      if (option) onDecide(option.choice);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
      <Text bold color={ACCENT}>
        {permissionTitle(request)}
      </Text>
      {note ? <Text dimColor>{note}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        <Details request={request} cwd={cwd} home={home} />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, i) => (
          <Text key={option.choice} color={i === selected ? ACCENT : undefined} bold={i === selected}>
            {`${i === selected ? "❯" : " "} ${i + 1}. ${option.label}`}
          </Text>
        ))}
      </Box>
      <Text dimColor>↑↓ to choose · enter to confirm · esc to deny</Text>
    </Box>
  );
}

function Details({ request, cwd, home }: Pick<Props, "request" | "cwd" | "home">) {
  const text = (key: string) => {
    const value = request.input[key];
    return typeof value === "string" ? printable(value) : "";
  };
  switch (request.toolName) {
    case "Bash":
      return (
        <>
          <Text>
            <Text color={ACCENT}>$ </Text>
            {preview(text("command"))}
          </Text>
          {text("description") ? <Text dimColor>{text("description")}</Text> : null}
        </>
      );
    case "Edit":
      return (
        <>
          <Text bold>{shortPath(text("file_path"), cwd, home)}</Text>
          {preview(text("old_string"))
            .split("\n")
            .map((line, i) => (
              <Text key={`d${i}`} color={COLOR.error}>{`- ${line}`}</Text>
            ))}
          {preview(text("new_string"))
            .split("\n")
            .map((line, i) => (
              <Text key={`a${i}`} color={COLOR.success}>{`+ ${line}`}</Text>
            ))}
        </>
      );
    case "Write":
      return (
        <>
          <Text bold>{shortPath(text("file_path"), cwd, home)}</Text>
          <Text dimColor>{preview(text("content"))}</Text>
        </>
      );
    case "WebFetch":
      return <Text>{text("url")}</Text>;
    default:
      return <Text dimColor>{preview(JSON.stringify(request.input, null, 2))}</Text>;
  }
}

function preview(text: string) {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length <= PREVIEW_LINES) return lines.join("\n");
  return `${lines.slice(0, PREVIEW_LINES).join("\n")}\n… ${plural(lines.length - PREVIEW_LINES, "more line")}`;
}
