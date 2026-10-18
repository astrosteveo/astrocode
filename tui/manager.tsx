// A panel of lists to act on, as /mcp, /permissions, /memory, /hooks, /skills and /sandbox draw
// them, with a gold top edge while it has your keys. Tab switches lists, typing filters (or writes
// something to add, where a list takes that), Enter opens a row's page of facts and what can be
// done to it, or acts on the row at once, and Esc goes back. In full screen, click a tab, a row or
// an action. The panel only draws and takes keys: what it shows and does comes from its owner.
import { Box, Text, useInput, usePaste, type DOMElement } from "ink";
import { useReducer, useRef, useState, type ReactNode } from "react";
import wrapAnsi from "wrap-ansi";
import { ChoiceRow } from "./choice";
import { cellWidth, takeCells } from "./markdown";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE } from "./theme";

/** How a change went, for the transcript. */
export type Outcome = { ok: boolean; message: string };

export type Action = {
  label: string;
  note?: string;
  /** What the panel says while it runs. */
  doing?: string;
  /** The choice in effect, such as a skill's state, marked as current. */
  current?: boolean;
  /** Stays on the row's page afterwards, as signing in does to wait for the browser. Otherwise it's back to the list. */
  stay?: boolean;
  /** How it went, said in the transcript when it says anything; nothing at all for a change of view. */
  run: () => Promise<Outcome | void> | void;
};

export type Row = {
  key: string;
  label: string;
  /** Before the label: its state at a glance, such as ● for on. */
  mark?: { glyph: string; color: string };
  /** Quiet, after the label. */
  note?: string;
  /** Under the list while the row is focused. */
  description?: string;
  /** Drawn quieter, as something turned off is. */
  dim?: boolean;
  /** What Enter opens: the row's facts and what can be done to it. */
  page?: () => Page;
  /** What Enter does at once, for a row with no page. */
  act?: Action;
  /** What Space does, such as turning it on or off. */
  space?: Action;
};

export type Page = {
  title: string;
  description?: string;
  /** A line of facts, quiet. */
  facts?: string;
  /** More under the facts, such as an error or a list of tools. */
  body?: ReactNode;
  /** In ember, before the actions. */
  warning?: string;
  actions: Action[];
  /** Said where the actions would be when there are none. */
  none?: string;
  /** Something to type or paste and send, such as the address a sign-in ended on. */
  field?: { label: string; submit: (text: string) => Promise<Outcome | void> };
};

export type List = {
  key: string;
  name: string;
  /** Null while loading. */
  rows: Row[] | null;
  empty: string;
  /** What typing does, said while nothing's typed. */
  hint?: string;
  /** A row for what's typed, such as a rule to add, shown first. */
  add?: (text: string) => Row | null;
  /** How many rows there are goes by its name, unless its rows aren't things to count, such as a choice of modes. */
  counted?: boolean;
};

type Props = {
  title: string;
  lists: List[];
  /** Why there's nothing to show, such as Claude Code not answering. */
  failure?: string | null;
  width: number;
  /** How many rows of a list show at once. */
  rows: number;
  /** Quiet, above the keys, such as where changes are kept. */
  footnote?: string;
  /** In ember, under the list, such as what's missing for something to work. */
  warning?: string;
  onOutcome: (outcome: Outcome) => void;
  onClose: () => void;
};

/**
 * Which list is showing, what's typed, the focused row, and the row whose page is open with its
 * focused action and what's typed in its field. The focused action is known by its label too, so
 * focus stays on it when the actions change around it, as after signing out.
 */
type Nav = { list: number; filter: string; selected: number; open: { key: string; selected: number; label?: string; field: string } | null };

/** The key of the row a list makes of what's typed. */
const ADD_KEY = "+add";

export function Manager({ title, lists, failure, width, rows, footnote, warning, onOutcome, onClose }: Props) {
  const [working, setWorking] = useState<string | null>(null);
  // In a ref, like the message box's text, because keys can arrive faster than React re-renders.
  const nav = useRef<Nav>({ list: 0, filter: "", selected: 0, open: null });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const panel = useRef<DOMElement>(null);
  const list = useRef<DOMElement>(null);
  const tabs = useRef<(DOMElement | null)[]>([]);

  const go = (change: Partial<Nav>) => {
    nav.current = { ...nav.current, ...change };
    redraw();
  };

  /** What the latest state shows: the list's matching rows, the focused one, and the open row's page. */
  const current = () => {
    const { filter, selected, open } = nav.current;
    const index = Math.min(nav.current.list, Math.max(0, lists.length - 1));
    const showing = lists[index];
    const shown = showing ? rowsOf(showing, filter) : [];
    const at = Math.min(selected, Math.max(0, shown.length - 1));
    const start = Math.min(Math.max(0, at - Math.floor(rows / 2)), Math.max(0, shown.length - rows));
    const row = open ? shown.find((one) => one.key === open.key) : undefined;
    const page = open && row?.page ? row.page() : null;
    const actions = page?.actions ?? [];
    // An action gone since it was focused gives the focus to the first.
    const kept = open?.label === undefined ? -1 : actions.findIndex((action) => action.label === open.label);
    const chosen = open ? (kept !== -1 ? kept : open.label === undefined ? Math.min(open.selected, Math.max(0, actions.length - 1)) : 0) : 0;
    return { showing, index, filter, shown, at, start, focused: shown[at], open: page && open ? { ...open, selected: chosen } : null, page, actions };
  };

  /** Runs an action. One that added what was typed clears it once it's done. */
  const perform = (action: Action, added = false) => {
    const pending = action.run();
    if (!pending) return;
    setWorking(action.doing ?? "Working…");
    void pending
      .catch((error: unknown): Outcome => ({ ok: false, message: messageOf(error) }))
      .then((outcome) => {
        setWorking(null);
        if (outcome) onOutcome(outcome);
        if (!action.stay) go({ open: null, ...(added && outcome?.ok !== false ? { filter: "", selected: 0 } : {}) });
      });
  };

  const submitField = (page: Page, text: string) => {
    const field = page.field;
    const { open } = nav.current;
    if (!field || !open) return;
    go({ open: { ...open, field: "" } });
    perform({ label: field.label, doing: "Sending…", stay: true, run: () => field.submit(text) });
  };

  /** One of the open page's actions, which keeps the focus afterwards if it's still there. */
  const act = (open: NonNullable<Nav["open"]>, action: Action, selected: number) => {
    go({ open: { ...open, selected, label: action.label } });
    perform(action, open.key === ADD_KEY);
  };

  /** Enter on a row: its page, focused on the choice in effect if there is one, or what it does at once. */
  const choose = (row: Row) => {
    if (row.page) {
      const actions = row.page().actions;
      const selected = Math.max(0, actions.findIndex((action) => action.current));
      return go({ open: { key: row.key, selected, label: actions[selected]?.label, field: "" } });
    }
    if (row.act) perform(row.act, row.key === ADD_KEY);
  };

  const moveRow = (step: number) => {
    const { shown, at } = current();
    go({ selected: Math.max(0, Math.min(shown.length - 1, at + step)) });
  };

  const moveAction = (step: number) => {
    const { open, actions } = current();
    if (!open) return;
    const selected = Math.max(0, Math.min(actions.length - 1, open.selected + step));
    go({ open: { ...open, selected, label: actions[selected]?.label } });
  };

  const type = (text: string) => {
    const { open, page } = current();
    if (open && page?.field) return go({ open: { ...open, field: open.field + text } });
    if (!open) go({ filter: nav.current.filter + text, selected: 0 });
  };

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.ctrl && input === "c") return onClose();
    const { open, page, actions, focused, filter } = current();
    if (open && page) {
      if (key.escape || (key.leftArrow && !open.field)) return go({ open: null });
      if (working) return;
      if (key.upArrow || key.downArrow) return moveAction(key.upArrow ? -1 : 1);
      if (key.return) {
        if (page.field && open.field.trim()) return submitField(page, open.field.trim());
        const action = actions[open.selected];
        if (action) act(open, action, open.selected);
        return;
      }
      if (key.backspace) return go({ open: { ...open, field: open.field.slice(0, -1) } });
      if (key.ctrl || key.meta || key.tab || !input) return;
      return type(input);
    }
    if (key.escape) return onClose();
    if (lists.length > 1 && (key.tab || key.leftArrow || key.rightArrow)) {
      const step = key.leftArrow || (key.tab && key.shift) ? -1 : 1;
      return go({ list: (nav.current.list + step + lists.length) % lists.length, selected: 0, filter: "" });
    }
    if (key.upArrow || key.downArrow) return moveRow(key.upArrow ? -1 : 1);
    if (key.pageUp || key.pageDown) return moveRow(key.pageUp ? -rows : rows);
    if (key.return) {
      if (focused && !working) choose(focused);
      return;
    }
    if (input === " " && !filter && focused?.space) {
      if (!working) perform(focused.space);
      return;
    }
    if (key.backspace) return go({ filter: filter.slice(0, -1), selected: 0 });
    if (key.ctrl || key.meta || key.tab || !input) return;
    type(input);
  });

  usePaste((text) => type(text.replace(/\s*\n\s*/g, " ").trim()));

  useMouse((event) => {
    if (!hit(panel.current, event)) return;
    event.handled = true;
    if (event.type === "wheel") return nav.current.open ? moveAction(event.wheel) : moveRow(event.wheel);
    if (event.type !== "press" || event.button !== "left" || working) return;
    const { open, actions, shown, start } = current();
    const at = hit(list.current, event);
    if (open) {
      const action = at ? actions[at.y] : undefined;
      if (action && at) act(open, action, at.y);
      return;
    }
    const clicked = lists.findIndex((_, i) => hit(tabs.current[i], event));
    if (clicked !== -1) return go({ list: clicked, selected: 0, filter: "" });
    const row = at ? shown[start + at.y] : undefined;
    if (!row) return;
    go({ selected: start + (at?.y ?? 0) });
    choose(row);
  });
  const hovered = useHover(panel, (_x, _y, pointer) => {
    if (working) return null;
    const { open, actions, shown, start } = current();
    const at = hit(list.current, pointer);
    if (open) return at && actions[at.y] ? { key: `action:${at.y}`, shape: "pointer" } : null;
    const tab = lists.findIndex((_, i) => hit(tabs.current[i], pointer));
    if (tab !== -1 && lists.length > 1) return { key: `tab:${tab}`, shape: "pointer" };
    return at && shown[start + at.y] ? { key: `row:${start + at.y}`, shape: "pointer" } : null;
  });

  const { showing, index, filter, shown, at, start, focused, open, page, actions } = current();
  const inner = width - 2;

  const footer = (keys: string) =>
    working ? (
      <Text color={PALETTE.teal}>{working}</Text>
    ) : (
      <Text color={PALETTE.dust} wrap="truncate-end">
        {keys}
      </Text>
    );

  if (open && page) {
    const labels = Math.max(0, ...actions.map((action) => cellWidth(action.label)));
    return (
      <Box ref={panel} flexDirection="column">
        <Panel width={width} accent={PALETTE.gold}>
          <Text wrap="truncate-end">
            <Text color={PALETTE.haze}>{`${title} › `}</Text>
            <Text bold color={PALETTE.star}>
              {page.title}
            </Text>
          </Text>
          {page.description || page.facts ? (
            <Box marginTop={1} flexDirection="column">
              {page.description ? <Text color={PALETTE.star}>{clip(page.description, inner - 2, 4)}</Text> : null}
              {page.facts ? (
                <Text color={PALETTE.haze} wrap="truncate-end">
                  {page.facts}
                </Text>
              ) : null}
            </Box>
          ) : null}
          {page.body ? (
            <Box marginTop={1} flexDirection="column">
              {page.body}
            </Box>
          ) : null}
          {page.warning ? (
            <Box marginTop={1}>
              <Text color={PALETTE.ember}>{clip(page.warning, inner - 2, 3)}</Text>
            </Box>
          ) : null}
          {page.field ? (
            <Box marginTop={1}>
              <Text wrap="truncate-start">
                <Text color={PALETTE.haze}>{`${page.field.label}  `}</Text>
                {open.field ? <Text color={PALETTE.gold}>{open.field}</Text> : <Text color={PALETTE.dust}>type or paste it here</Text>}
              </Text>
            </Box>
          ) : null}
          <Box ref={list} flexDirection="column" marginTop={1}>
            {actions.length ? (
              actions.map((action, i) => {
                const isFocused = i === open.selected;
                return (
                  <ChoiceRow key={action.label} selected={isFocused} hovered={hovered === `action:${i}`} width={inner}>
                    <Text wrap="truncate-end">
                      <Text bold={isFocused} color={isFocused ? PALETTE.star : undefined}>
                        {action.label.padEnd(labels)}
                      </Text>
                      {action.current ? <Text color={PALETTE.teal}>{"  current"}</Text> : null}
                      {action.note ? <Text color={PALETTE.haze}>{`   ${action.note}`}</Text> : null}
                    </Text>
                  </ChoiceRow>
                );
              })
            ) : (
              <Text color={PALETTE.haze}>{page.none ?? "Nothing to do here."}</Text>
            )}
          </Box>
          <Box marginTop={1}>
            {footer(
              page.field
                ? `type or paste, enter to send${actions.length ? "   ↑↓ to choose" : ""}   esc to go back`
                : actions.length
                  ? "↑↓ to choose   enter to select   esc to go back"
                  : "esc to go back",
            )}
          </Box>
        </Panel>
      </Box>
    );
  }

  const visible = shown.slice(start, start + rows);
  const names = Math.min(32, Math.max(8, ...visible.map((row) => cellWidth(row.label))));
  const total = showing?.rows?.length;
  const keys = [
    "↑↓ to choose",
    focused?.space && !filter ? `space to ${focused.space.label.toLowerCase()}` : "",
    focused?.page ? "enter for more" : focused?.act ? `enter to ${focused.act.label.toLowerCase()}` : "",
    lists.length > 1 ? "tab for the next list" : "",
    "esc to close",
  ];
  return (
    <Box ref={panel} flexDirection="column">
      <Panel width={width} accent={PALETTE.gold} note={shown.length > rows ? `${(at + 1).toLocaleString("en-US")} of ${shown.length.toLocaleString("en-US")}` : undefined}>
        <Box>
          <Text bold color={PALETTE.star}>
            {title}
          </Text>
          {lists.length > 1 ? (
            lists.map((one, i) => (
              <Box
                key={one.key}
                marginLeft={2}
                ref={(element: DOMElement | null) => {
                  tabs.current[i] = element;
                }}
              >
                <Text
                  color={i === index ? PALETTE.gold : PALETTE.haze}
                  backgroundColor={i !== index && hovered === `tab:${i}` ? PALETTE.hover : undefined}
                  bold={i === index}
                  underline={i === index}
                >
                  {one.name}
                </Text>
                {one.rows && one.counted !== false ? <Text color={PALETTE.dust}>{` ${one.rows.length.toLocaleString("en-US")}`}</Text> : null}
              </Box>
            ))
          ) : total && showing?.counted !== false ? (
            <Text color={PALETTE.dust}>{` ${total.toLocaleString("en-US")}`}</Text>
          ) : null}
          <Box flexGrow={1} />
          <Text color={filter ? PALETTE.gold : PALETTE.dust} wrap="truncate-start">
            {filter ? `  ${filter}` : `  ${showing?.hint ?? "type to filter"}`}
          </Text>
        </Box>
        <Box ref={list} flexDirection="column" marginTop={1}>
          {failure ? (
            <Text color={PALETTE.rose}>{failure}</Text>
          ) : !showing || showing.rows === null ? (
            <Text color={PALETTE.haze}>Loading…</Text>
          ) : shown.length === 0 ? (
            <Text color={PALETTE.haze}>{filter ? "Nothing matches." : showing.empty}</Text>
          ) : (
            visible.map((row, i) => {
              const isFocused = start + i === at;
              return (
                <ChoiceRow key={row.key} selected={isFocused} hovered={hovered === `row:${start + i}`} width={inner}>
                  <Text wrap="truncate-end">
                    {row.mark ? <Text color={row.mark.color}>{`${row.mark.glyph} `}</Text> : null}
                    <Text bold={isFocused} color={isFocused ? PALETTE.star : row.dim ? PALETTE.haze : undefined}>
                      {takeCells(row.label, names)[0].padEnd(names)}
                    </Text>
                    {row.note ? <Text color={PALETTE.haze}>{`   ${row.note}`}</Text> : null}
                  </Text>
                </ChoiceRow>
              );
            })
          )}
        </Box>
        {focused?.description ? (
          <Box marginTop={1}>
            <Text color={PALETTE.haze}>{clip(focused.description, inner - 2, 2)}</Text>
          </Box>
        ) : null}
        {warning ? (
          <Box marginTop={1}>
            <Text color={PALETTE.ember}>{clip(warning, inner - 2, 3)}</Text>
          </Box>
        ) : null}
        {footnote ? (
          <Box marginTop={1}>
            <Text color={PALETTE.dust}>{clip(footnote, inner - 2, 3)}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>{footer(keys.filter(Boolean).join("   "))}</Box>
      </Panel>
    </Box>
  );
}

/** The list's rows that match what's typed, labels that start with it first, and the row it would add. */
function rowsOf(list: List, filter: string): Row[] {
  const rows = list.rows ?? [];
  const wanted = filter.trim().toLowerCase();
  const added = list.add && filter.trim() ? list.add(filter.trim()) : null;
  const extra = added ? [{ ...added, key: ADD_KEY }] : [];
  if (!wanted) return rows;
  const rank = (row: Row) => {
    const label = row.label.toLowerCase();
    if (label.startsWith(wanted)) return 0;
    if (label.includes(wanted)) return 1;
    return [row.note, row.description].some((text) => text?.toLowerCase().includes(wanted)) ? 2 : 3;
  };
  const matched = rows
    .map((row, i) => ({ row, rank: rank(row), i }))
    .filter((entry) => entry.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((entry) => entry.row);
  return [...extra, ...matched];
}

/** `text` wrapped to `room`, no more than `lines` lines, with an ellipsis if it was cut. */
export function clip(text: string, room: number, lines: number) {
  const wrapped = wrapAnsi(text.replace(/\s+/g, " ").trim(), Math.max(10, room), { hard: true }).split("\n");
  if (wrapped.length <= lines) return wrapped.join("\n");
  const kept = wrapped.slice(0, lines);
  kept[lines - 1] = `${takeCells(kept[lines - 1] ?? "", Math.max(1, room - 1))[0]}…`;
  return kept.join("\n");
}

/**
 * Waits until `check` says so, asking every 300 ms for up to four seconds, as for Claude Code to
 * read a settings file again after an edit, which takes it a moment.
 */
export async function until(check: () => Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
