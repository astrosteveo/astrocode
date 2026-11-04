// The key sheet: every key for whatever has your keys, as `?` and /help show it. It's made from the
// keymap, so a key moved in keybindings.json shows where it went, one added shows beside the
// default, and one bound to nothing isn't offered. Keys that aren't actions (the box's own, the
// transcript's, a permission prompt's) are listed as they are, the box's only while no binding has
// taken them. Sections stand in columns, as many across as fit, and ↑↓ scroll what doesn't.
import { Box, Text, useInput, type DOMElement } from "ink";
import { useRef, useState } from "react";
import { ANYWHERE } from "./focus";
import { ACTIONS, hintKey, hintOf, startsChord, type Action, type Keymap } from "./keys";
import { cellWidth } from "./markdown";
import { Panel } from "./markdown-view";
import { hit, useMouse } from "./mouse";
import { PALETTE } from "./theme";

/** What has your keys as the sheet opens. An opened call is under its line in full screen, and the inspector in scrollback. */
export type Place = "box" | "transcript" | "opened" | "decision";

type Row = [key: string, does: string];

export type Section = { title: string; rows: Row[] };

/** Cells between two columns of keys. */
const GAP = 3;

/** Claude Code's other spellings of Ctrl+_, which terminals send for the one key. */
const SPELLINGS = new Set(["ctrl+-", "ctrl+shift+-", "ctrl+shift+_"]);

export function sheetOf(place: Place, keymap: Keymap, fullscreen: boolean): Section[] {
  /**
   * Keys of the box's own, in the keymap's spelling, that no binding has taken from it: the box asks
   * the keymap first, so a stroke bound, or one that starts a chord, is the binding's.
   */
  const free = (keys: string[]) => keys.filter((key) => !key.split(" ").some((stroke) => keymap.has(stroke) || startsChord(keymap, stroke)));
  const row = (does: string, keys: string[]): Row[] => (keys.length ? [[keys.join(", "), does]] : []);
  const own = (does: string, ...keys: string[]) => row(does, free(keys).map(hintOf));
  const send = hintKey(keymap, "chat:submit");
  /**
   * Every key bound to an action, the one every hint names first; a chord such as Ctrl+X Ctrl+S is
   * how a terminal without the kitty keyboard protocol sends what Ctrl+Enter would. `also` are keys of
   * the box's own that do the same.
   */
  const bound = (action: Action, does: string = ACTIONS[action], ...also: string[]): Row[] =>
    row(does, [...free(also), ...[...keymap].flatMap(([chord, to]) => (to === action && !SPELLINGS.has(chord) ? [chord] : []))].map(hintOf));

  const box: Section = {
    title: "In the box",
    rows: [
      ...bound("chat:submit"),
      ...bound("chat:newline", ACTIONS["chat:newline"], "shift+enter"),
      // Shift+Enter needs the kitty keyboard protocol; these don't. `\` before the key that sends is a new line.
      ...row(ACTIONS["chat:newline"], [...free(["meta+enter"]).map(hintOf), ...(send ? [`\\ ${send}`] : [])]),
      ...bound("chat:sendNow"),
      ...bound("chat:queueSubmit"),
      ...own("edit what's queued", "up"),
      ...own("earlier messages", "up down"),
      ...bound("history:search"),
      ...own("stop Claude", "escape"),
      ...own("clear, or rewind", "escape escape"),
      ...own("conversations", "left"),
      ...bound("chat:stash"),
      ...bound("chat:externalEditor"),
      ...bound("chat:imagePaste"),
      ...bound("chat:undo"),
      ...bound("chat:workflowKeywordToggle"),
      ...own("every key", "?"),
    ],
  };
  const typed: Section = {
    title: "Typed first",
    rows: [...own("commands", "/"), ...own("files", "@"), ...own("shell command", "!"), ...own("note to CLAUDE.md", "#")],
  };
  const editing: Section = {
    title: "Editing",
    rows: [
      ...own("line start", "ctrl+a"),
      ...own("line end", "ctrl+e"),
      ...own("word back", "meta+b"),
      ...own("word on", "meta+f"),
      ...own("cut to start", "ctrl+u"),
      ...own("cut to end", "ctrl+k"),
      ...own("cut word back", "ctrl+w"),
      ...own("cut word on", "meta+d"),
      ...own("put back", "ctrl+y"),
    ],
  };
  const transcript: Section = {
    title: "In the transcript",
    rows: [
      ["↑ ↓", "move"],
      ["pgup, pgdn", "half a screen"],
      ["home, end", "top, end"],
      ["{ }, alt+↑ ↓", "your messages"],
      ["alt+shift+↑ ↓", "tool calls"],
      ["enter", "open or close"],
      [["esc", "q", hintKey(keymap, "app:toggleTranscript")].filter(Boolean).join(", "), "back to the box"],
      ["?", "every key"],
    ],
  };
  const opened: Section = {
    title: "In an opened call",
    rows: fullscreen
      ? [
          ["← →", "call before, after"],
          ["tab", "next tab"],
          ["c", "copy the tab"],
          ["e", "the tab in $EDITOR"],
          ["esc", "close it"],
        ]
      : [
          ["← →", "call before, after"],
          ["tab, shift+tab", "next, previous tab"],
          ["1, 2, …", "that tab"],
          ["↑ ↓", "scroll"],
          ["pgup, pgdn", "a page"],
          ["home, end", "top, end"],
          ["c", "copy the tab"],
          ...bound("chat:followClaude"),
          ["esc", "close it"],
        ],
  };
  const decision: Section = {
    title: "In a permission prompt",
    rows: [
      ["↑ ↓, tab", "choose"],
      ["enter", "confirm"],
      ["1, 2, …", "answer at once"],
      ["esc, ctrl+c", "deny"],
    ],
  };
  // Full screen's, from the box or a decision: the view moves, with no cursor. In scrollback the
  // terminal scrolls. In a decision Alt+↑ and Alt+↓ move its choice too.
  const scrolling: Section = {
    title: "Scrolling",
    rows: [
      ["pgup, pgdn", "a page"],
      ["ctrl+home, ctrl+end", "top, end"],
      ...(place === "decision"
        ? []
        : ([
            ["alt+↑ ↓", "your messages"],
            ["alt+shift+↑ ↓", "tool calls"],
          ] as Row[])),
    ],
  };
  // Full screen's; in scrollback the terminal has the mouse. A click on ← N needs you or on the box
  // doesn't take your keys from a decision.
  const mouse: Section = {
    title: "Mouse",
    rows: [
      ["click a line", "open, close"],
      ["click an option", "choose it"],
      ["click a link", "open it"],
      ["click a picture", "enlarge it"],
      ["click copy, ▶ run", "a code block"],
      ["click mode, model, effort", "change it"],
      ["click ◌ N running", "what's running"],
      ...(place === "decision" ? [] : [["click ← N needs you", "conversations"] as Row]),
      ...(place === "transcript" || place === "opened" ? [["click the box", "your keys back"] as Row] : []),
      ["wheel", "scroll"],
      ["drag", "copy"],
      ["double click", "copy a word"],
      ["triple click", "copy a line"],
      ["shift+drag", "terminal's own"],
    ],
  };
  // The box's and the transcript's: a decision and an overlay keep the rest from the box.
  const anywhere: Section = {
    title: "Anywhere",
    rows: [
      // In the transcript Ctrl+C leaves what's typed alone.
      ...[...ANYWHERE].flatMap((action) => bound(action, action === "app:interrupt" && place !== "box" ? "stop" : ACTIONS[action])),
      // In the transcript it's among the ways back to the box.
      ...(place === "box" ? bound("app:toggleTranscript", fullscreen ? "transcript" : ACTIONS["app:toggleTranscript"]) : []),
      ...bound("chat:clearInput"),
      ...own("suspend", "ctrl+z"),
      ...(fullscreen ? own("find", "ctrl+f") : []),
    ],
  };
  const redraw: Section = { title: "Anywhere", rows: bound("chat:clearInput") };
  const pointer = fullscreen ? [mouse] : [];
  switch (place) {
    case "box":
      // Full screen's /help shows this one, so it has the transcript's keys too, for after Ctrl+O.
      return [box, typed, editing, ...(fullscreen ? [scrolling, transcript, mouse] : []), anywhere];
    case "transcript":
      return [transcript, ...pointer, anywhere];
    case "opened":
      return fullscreen ? [opened, transcript, mouse, anywhere] : [opened, redraw];
    case "decision":
      return [decision, ...(fullscreen ? [scrolling, mouse] : []), redraw];
  }
}

type Props = {
  sections: Section[];
  /** Whether the keys are yours from keybindings.json, rather than Claude Code's own. */
  custom: boolean;
  width: number;
  /** Rows of keys there's room for; ↑↓ scroll the rest. */
  rows: number;
  onClose: () => void;
};

/** The sheet, over the box. Type to filter; Esc closes it. */
export function KeySheet({ sections, custom, width, rows, onClose }: Props) {
  const [filter, setFilter] = useState("");
  const [top, setTop] = useState(0);
  const room = width - 2;
  const columns = pack(matching(sections, filter), room);
  const height = Math.max(0, ...columns.map((column) => column.lines.length));
  const most = Math.max(0, height - rows);
  const from = Math.min(top, most);
  const panel = useRef<DOMElement>(null);

  // The wheel over the sheet scrolls it, and never what's behind it.
  useMouse((event) => {
    if (event.type !== "wheel" || !hit(panel.current, event)) return;
    event.handled = true;
    setTop(Math.max(0, Math.min(most, from + event.wheel)));
  });

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.escape || (key.ctrl && input === "c")) return onClose();
    if (key.upArrow) return setTop(Math.max(0, from - 1));
    if (key.downArrow) return setTop(Math.min(most, from + 1));
    if (key.backspace) {
      setFilter((text) => text.slice(0, -1));
      return setTop(0);
    }
    if (key.ctrl || key.meta || key.tab || key.return || !input) return;
    setFilter((text) => text + input);
    setTop(0);
  });

  return (
    <Box ref={panel} flexDirection="column">
      <Panel width={width} accent={PALETTE.gold}>
        <Text wrap="truncate-end">
          <Text bold color={PALETTE.star}>
            Keys
          </Text>
          <Text color={filter ? PALETTE.gold : PALETTE.dust}>{filter ? `   ${filter}` : custom ? "   as your keybindings.json sets them" : ""}</Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {columns.length ? (
            Array.from({ length: Math.min(rows, height) }, (_, i) => (
              <Box key={from + i}>
                {columns.map((column, x) => (
                  <Box key={x} width={Math.min(room, column.width + (x < columns.length - 1 ? GAP : 0))}>
                    <Cell line={column.lines[from + i]} keyWidth={column.keyWidth} />
                  </Box>
                ))}
              </Box>
            ))
          ) : (
            <Text color={PALETTE.haze}>Nothing matches.</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Text color={PALETTE.dust}>{[most ? "↑↓ to scroll" : "", "type to filter", "esc to close"].filter(Boolean).join("   ")}</Text>
        </Box>
      </Panel>
    </Box>
  );
}

/** A column's line: a section's title, a key and what it does, or a blank between sections. */
type Line = { title: string } | { key: string; does: string } | null;

type Column = { lines: Line[]; keyWidth: number; width: number };

function Cell({ line, keyWidth }: { line: Line | undefined; keyWidth: number }) {
  if (!line) return <Text> </Text>;
  if ("title" in line)
    return (
      <Text wrap="truncate-end" color={PALETTE.star}>
        {line.title}
      </Text>
    );
  return (
    <Text wrap="truncate-end">
      <Text color={PALETTE.haze}>{`${line.key}${" ".repeat(keyWidth - cellWidth(line.key) + 2)}`}</Text>
      <Text color={PALETTE.dust}>{line.does}</Text>
    </Text>
  );
}

/** The rows with `filter` in their key or what they do, and all of a section whose title has it. */
function matching(sections: Section[], filter: string) {
  const wanted = filter.toLowerCase();
  return sections.flatMap((section) => {
    const rows = section.title.toLowerCase().includes(wanted) ? section.rows : section.rows.filter(([key, does]) => `${key} ${does}`.toLowerCase().includes(wanted));
    return rows.length ? [{ ...section, rows }] : [];
  });
}

/**
 * Sections in as few rows as fit `room` cells across: each whole, one under another in a column,
 * the columns side by side in order. One column, however wide, once nothing else fits.
 */
function pack(sections: Section[], room: number): Column[] {
  const tallest = Math.max(0, ...sections.map((section) => section.rows.length + 1));
  for (let height = tallest; ; height++) {
    const groups: Section[][] = [];
    for (const section of sections) {
      const last = groups.at(-1);
      if (last && columnOf([...last, section]).lines.length <= height) last.push(section);
      else groups.push([section]);
    }
    const columns = groups.map(columnOf);
    if (columns.length <= 1 || columns.reduce((sum, column) => sum + column.width, 0) + GAP * (columns.length - 1) <= room) return columns;
  }
}

function columnOf(sections: Section[]): Column {
  const lines = sections.flatMap((section, i): Line[] => [...(i ? [null] : []), { title: section.title }, ...section.rows.map(([key, does]) => ({ key, does }))]);
  const keyWidth = Math.max(0, ...sections.flatMap((section) => section.rows.map(([key]) => cellWidth(key))));
  const width = Math.max(...sections.map((section) => cellWidth(section.title)), ...sections.flatMap((section) => section.rows.map(([, does]) => keyWidth + 2 + cellWidth(does))));
  return { lines, keyWidth, width };
}
