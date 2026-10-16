// A list to choose from, for /model, /resume and the tool output browser. Type to filter.
import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { ACCENT, COLOR } from "./theme";

export type PickerItem = {
  key: string;
  label: string;
  /** A short note after the label, such as when a session was last used. */
  note?: string;
  /** More about the focused item, under the list. */
  detail?: string;
  current?: boolean;
};

type Props = {
  title: string;
  /** Null while loading. */
  items: PickerItem[] | null;
  width: number;
  rows?: number;
  empty?: string;
  onPick: (item: PickerItem) => void;
  onCancel: () => void;
};

export function Picker({ title, items, width, rows = 8, empty = "Nothing here yet.", onPick, onCancel }: Props) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);

  // Open on the current item once the list arrives.
  useEffect(() => {
    if (items) setSelected(Math.max(0, items.findIndex((item) => item.current)));
  }, [items]);

  const shown = (items ?? []).filter((item) => matches(item, filter));
  const index = Math.min(selected, Math.max(0, shown.length - 1));

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.escape || (key.ctrl && input === "c")) return onCancel();
    if (key.upArrow) return setSelected(Math.max(0, index - 1));
    if (key.downArrow) return setSelected(Math.min(shown.length - 1, index + 1));
    if (key.pageUp) return setSelected(Math.max(0, index - rows));
    if (key.pageDown) return setSelected(Math.min(shown.length - 1, index + rows));
    if (key.return) {
      const item = shown[index];
      if (item) onPick(item);
      return;
    }
    if (key.backspace) {
      setFilter((text) => text.slice(0, -1));
      return setSelected(0);
    }
    if (key.ctrl || key.meta || key.tab || !input) return;
    setFilter((text) => text + input);
    setSelected(0);
  });

  const start = Math.min(Math.max(0, index - Math.floor(rows / 2)), Math.max(0, shown.length - rows));
  const visible = shown.slice(start, start + rows);
  const focused = shown[index];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
      <Text>
        <Text bold color={ACCENT}>
          {title}
        </Text>
        <Text dimColor>{filter ? `  filter: ${filter}` : "  type to filter"}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {items === null ? (
          <Text dimColor>Loading…</Text>
        ) : shown.length === 0 ? (
          <Text dimColor>{filter ? "Nothing matches." : empty}</Text>
        ) : (
          visible.map((item, i) => {
            const isFocused = start + i === index;
            return (
              <Text key={item.key} wrap="truncate-end">
                <Text color={isFocused ? ACCENT : undefined} bold={isFocused}>
                  {`${isFocused ? "❯" : " "} ${item.label}`}
                </Text>
                {item.current ? <Text color={COLOR.success}> ✓</Text> : null}
                {item.note ? <Text dimColor>{`  ${item.note}`}</Text> : null}
              </Text>
            );
          })
        )}
      </Box>
      {shown.length > rows ? <Text dimColor>{`${index + 1} of ${shown.length}`}</Text> : null}
      {focused?.detail ? (
        <Box marginTop={1}>
          <Text dimColor>{focused.detail}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>↑↓ to choose · enter to select · esc to cancel</Text>
      </Box>
    </Box>
  );
}

function matches(item: PickerItem, filter: string) {
  if (!filter) return true;
  const wanted = filter.toLowerCase();
  return [item.label, item.note, item.detail].some((text) => text?.toLowerCase().includes(wanted));
}
