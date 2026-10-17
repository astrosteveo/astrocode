// A list to choose from, for /model, /resume and the tool output browser, on a panel with a gold
// top edge while it has your keys. Type to filter. In full screen, click an item to pick it; the
// wheel moves through the list.
import { Box, Text, useInput, type DOMElement } from "ink";
import { useEffect, useRef, useState } from "react";
import { ChoiceRow } from "./choice";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE } from "./theme";

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
  const panel = useRef<DOMElement>(null);
  const list = useRef<DOMElement>(null);

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
  const inner = width - 2;

  useMouse((event) => {
    if (event.type === "wheel" && hit(panel.current, event)) {
      event.handled = true;
      return setSelected(Math.max(0, Math.min(shown.length - 1, index + event.wheel)));
    }
    if (event.type !== "press" || event.button !== "left" || !hit(panel.current, event)) return;
    event.handled = true;
    const at = hit(list.current, event);
    const item = at ? visible[at.y] : undefined;
    if (!item) return;
    setSelected(start + (at?.y ?? 0));
    onPick(item);
  });
  const hovered = useHover(list, (_, y) => (visible[y] ? { key: start + y, shape: "pointer" } : null));

  return (
    <Box ref={panel} flexDirection="column">
      <Panel width={width} accent={PALETTE.gold} note={shown.length > rows ? `${index + 1} of ${shown.length}` : undefined}>
        <Text>
          <Text bold color={PALETTE.star}>
            {title}
          </Text>
          <Text color={filter ? PALETTE.gold : PALETTE.dust}>{filter ? `   ${filter}` : "   type to filter"}</Text>
        </Text>
        <Box ref={list} flexDirection="column" marginTop={1}>
          {items === null ? (
            <Text color={PALETTE.haze}>Loading…</Text>
          ) : shown.length === 0 ? (
            <Text color={PALETTE.haze}>{filter ? "Nothing matches." : empty}</Text>
          ) : (
            visible.map((item, i) => {
              const isFocused = start + i === index;
              return (
                <ChoiceRow key={item.key} selected={isFocused} hovered={start + i === hovered} width={inner}>
                  <Text wrap="truncate-end">
                    <Text bold={isFocused} color={isFocused ? PALETTE.star : undefined}>
                      {item.label}
                    </Text>
                    {item.current ? <Text color={PALETTE.teal}>{"  current"}</Text> : null}
                    {item.note ? <Text color={PALETTE.haze}>{`   ${item.note}`}</Text> : null}
                  </Text>
                </ChoiceRow>
              );
            })
          )}
        </Box>
        {focused?.detail ? (
          <Box marginTop={1}>
            <Text color={PALETTE.haze}>{focused.detail}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text color={PALETTE.dust}>↑↓ to choose   enter to select   esc to cancel</Text>
        </Box>
      </Panel>
    </Box>
  );
}

function matches(item: PickerItem, filter: string) {
  if (!filter) return true;
  const wanted = filter.toLowerCase();
  return [item.label, item.note, item.detail].some((text) => text?.toLowerCase().includes(wanted));
}
