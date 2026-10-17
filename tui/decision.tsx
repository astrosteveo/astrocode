// Asking you before a tool runs: what Claude wants to do, on a panel with a gold top edge, and the
// choices. "Always allow" names the one rule it adds.
import { Box, Text, useInput, type DOMElement } from "ink";
import { useRef, useState } from "react";
import type { Decision as Choice, PermissionRequest } from "../src/events";
import { alwaysLabel, permissionNote, permissionTitle } from "../src/view/permissions";
import { plural, shortPath } from "../src/view/tools";
import { ChoiceRow } from "./choice";
import { printable } from "./markdown";
import { Diff, diffLines } from "./diff";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE } from "./theme";

/** Keys pressed this soon after the prompt appears were meant for something else, so Enter, digits and clicks wait. */
const GRACE_MS = 500;

/** Lines of a command, diff or file the prompt shows before saying how many more there are. */
const PREVIEW_LINES = 12;

type Props = { request: PermissionRequest; cwd: string; home: string; width: number; onDecide: (choice: Choice) => void };

/** Choose with the arrow keys and Enter, press a number, or click an option. Esc or Ctrl+C denies. */
export function DecisionPrompt({ request, cwd, home, width, onDecide }: Props) {
  const always = alwaysLabel(request.alwaysAllow, home);
  const options: { choice: Choice; label: string }[] = [
    { choice: "allow", label: "Allow" },
    ...(always ? [{ choice: "always" as const, label: always }] : []),
    { choice: "deny", label: "Deny, and tell Claude what to do instead" },
  ];
  const [selected, setSelected] = useState(request.defaultToNo ? options.length - 1 : 0);
  const shownAt = useRef(Date.now());
  const rows = useRef<(DOMElement | null)[]>([]);
  const list = useRef<DOMElement>(null);
  const note = permissionNote(request, cwd, home);

  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left") return;
    const index = options.findIndex((_, i) => hit(rows.current[i], event));
    const option = options[index];
    if (!option) return;
    event.handled = true;
    setSelected(index);
    if (Date.now() - shownAt.current >= GRACE_MS) onDecide(option.choice);
  });
  const hovered = useHover(list, (_x, _y, pointer) => {
    const index = options.findIndex((_, i) => hit(rows.current[i], pointer));
    return index === -1 ? null : { key: index, shape: "pointer" };
  });

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

  const inner = width - 2;
  return (
    <Panel width={width} accent={PALETTE.gold}>
      <Text bold color={PALETTE.star}>
        {permissionTitle(request)}
      </Text>
      {note ? <Text color={PALETTE.haze}>{note}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        <Details request={request} cwd={cwd} home={home} width={inner} note={note} />
      </Box>
      <Box ref={list} flexDirection="column" marginTop={1}>
        {options.map((option, i) => (
          <Box
            key={option.choice}
            ref={(element) => {
              rows.current[i] = element;
            }}
          >
            <ChoiceRow selected={i === selected} hovered={i === hovered} width={inner}>
              <Text bold={i === selected} color={i === selected ? PALETTE.star : undefined}>
                {`${i + 1}  ${option.label}`}
              </Text>
            </ChoiceRow>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={PALETTE.dust}>↑↓ to choose   enter to confirm   esc to deny</Text>
      </Box>
    </Panel>
  );
}

/** What the tool would do. `note` is already shown above, so a description that says the same isn't repeated. */
function Details({ request, cwd, home, width, note }: Pick<Props, "request" | "cwd" | "home" | "width"> & { note?: string }) {
  const text = (key: string) => {
    const value = request.input[key];
    return typeof value === "string" ? printable(value) : "";
  };
  switch (request.toolName) {
    case "Bash":
      return (
        <>
          <Text>
            <Text color={PALETTE.dust}>$ </Text>
            <Text color={PALETTE.star}>{preview(text("command"))}</Text>
          </Text>
          {text("description") && text("description") !== note ? <Text color={PALETTE.haze}>{text("description")}</Text> : null}
        </>
      );
    case "Edit":
      return (
        <>
          <Text color={PALETTE.star}>{shortPath(text("file_path"), cwd, home)}</Text>
          <Diff lines={diffLines(text("old_string"), text("new_string"))} width={width} limit={PREVIEW_LINES * 2} path={text("file_path")} framed={false} />
        </>
      );
    case "Write":
      return (
        <>
          <Text color={PALETTE.star}>{shortPath(text("file_path"), cwd, home)}</Text>
          <Text color={PALETTE.haze}>{preview(text("content"))}</Text>
        </>
      );
    case "WebFetch":
      return <Text color={PALETTE.sky}>{text("url")}</Text>;
    default:
      return <Text color={PALETTE.haze}>{preview(JSON.stringify(request.input, null, 2))}</Text>;
  }
}

function preview(text: string) {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length <= PREVIEW_LINES) return lines.join("\n");
  return `${lines.slice(0, PREVIEW_LINES).join("\n")}\n… ${plural(lines.length - PREVIEW_LINES, "more line")}`;
}
