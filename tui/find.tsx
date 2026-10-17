// Ctrl+F in full screen: a line to type what to find in the transcript. The matches are drawn in
// the transcript itself (`markMatches()`), and the viewport follows the one search is on. Enter or
// ↑ goes to the next match up, older; ↓ or Shift+Enter the next one down. Esc closes it and leaves
// the view where it is.
import { Box, Text, useInput } from "ink";
import { useRef, useState } from "react";
import { cellWidth } from "./markdown";
import { Panel } from "./markdown-view";
import { PALETTE } from "./theme";

/** What to find, and which match search is on, counted from the newest. */
export type Find = { query: string; back: number };

type Props = {
  find: Find;
  /** How many matches there are, as the transcript last counted them. */
  count: number;
  width: number;
  onChange: (find: Find) => void;
  onClose: () => void;
};

export function FindBar({ find, count, width, onChange, onClose }: Props) {
  // Keys can come faster than renders, so the query is kept here as well as in the parent.
  const latest = useRef(find);
  latest.current = find;
  const [, redraw] = useState(0);
  const change = (next: Find) => {
    latest.current = next;
    onChange(next);
    redraw((n) => n + 1);
  };

  useInput((input, key) => {
    if (key.eventType === "release") return;
    const { query, back } = latest.current;
    if (key.escape || (key.ctrl && (input === "c" || input === "f" || input === "g"))) return onClose();
    if ((key.return && !key.shift) || key.upArrow) return change({ query, back: count ? (back + 1) % count : 0 });
    if ((key.return && key.shift) || key.downArrow) return change({ query, back: count ? (back - 1 + count) % count : 0 });
    if (key.backspace) return change({ query: [...query].slice(0, -1).join(""), back: 0 });
    if (key.ctrl && input === "u") return change({ query: "", back: 0 });
    if (key.ctrl || key.meta || !input) return;
    change({ query: query + input.replace(/[\r\n]/g, " "), back: 0 });
  });

  const { query, back } = latest.current;
  const status = !query ? "" : count ? `${count - (back % count)} of ${count}` : "no matches";
  const hint = "enter ↑ older   ↓ newer   esc closes";
  const room = width - 4 - cellWidth(status) - 3;
  const shown = cellWidth(query) > room - 8 ? `…${[...query].slice(-(room - 9)).join("")}` : query;
  return (
    <Panel width={width} accent={PALETTE.gold} note={width > 70 ? hint : undefined}>
      <Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={PALETTE.gold}>{"Find "}</Text>
            <Text bold color={PALETTE.star}>
              {shown}
            </Text>
            <Text inverse color={PALETTE.gold}>
              {" "}
            </Text>
            {!query ? <Text color={PALETTE.dust}>{" in the conversation"}</Text> : null}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          <Text color={count || !query ? PALETTE.haze : PALETTE.ember}>{status}</Text>
        </Box>
      </Box>
    </Panel>
  );
}

