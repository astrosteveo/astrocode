// The message box: a small multi-line editor with a slash-command menu. The text lives in a ref
// so keys that arrive faster than React re-renders still see the latest text.
import { Box, Text, useInput, usePaste } from "ink";
import { useReducer, useRef } from "react";
import type { CommandInfo } from "../src/events";
import { cellWidth, takeCells } from "./markdown";
import { ACCENT, COLOR } from "./theme";

type Props = {
  /** Off while a prompt or picker above has the keyboard. */
  active: boolean;
  busy: boolean;
  width: number;
  history: string[];
  commands: CommandInfo[];
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  onCycleMode: () => void;
  /** Ctrl+C on an empty box: the app stops Claude or gets ready to exit. */
  onCtrlC: () => void;
  onExit: () => void;
  onOpenOutput: () => void;
};

/** Commands the menu shows at once. */
const MENU_ROWS = 6;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function Prompt(props: Props) {
  const { active, busy, width, history, commands } = props;
  const buffer = useRef({ text: "", cursor: 0 });
  const recall = useRef<{ index: number; draft: string } | null>(null);
  /** The highlighted command, and whether Esc closed the menu for the text as it is. */
  const menu = useRef({ index: 0, closedFor: "" });
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const set = (text: string, cursor: number) => {
    if (text !== buffer.current.text) menu.current = { index: 0, closedFor: "" };
    buffer.current = { text, cursor };
    redraw();
  };
  const insert = (value: string) => {
    const { text, cursor } = buffer.current;
    set(text.slice(0, cursor) + value + text.slice(cursor), cursor + value.length);
  };

  const matches = menuMatches(buffer.current.text, commands, menu.current.closedFor);

  /** Steps through earlier messages; past the newest one is what you were typing. */
  const recallHistory = (step: -1 | 1) => {
    if (history.length === 0) return;
    const current = recall.current ?? { index: history.length, draft: buffer.current.text };
    const index = Math.min(history.length, Math.max(0, current.index + step));
    if (index === current.index) return;
    recall.current = { index, draft: current.draft };
    const value = index === history.length ? current.draft : (history[index] ?? "");
    set(value, value.length);
  };

  /** Moves to the line above or below, keeping the column. False on the first or last line. */
  const moveLine = (step: -1 | 1) => {
    const { text, cursor } = buffer.current;
    const start = lineStart(text, cursor);
    const column = cursor - start;
    if (step === -1) {
      if (start === 0) return false;
      set(text, Math.min(lineStart(text, start - 1) + column, start - 1));
    } else {
      const end = lineEnd(text, cursor);
      if (end === text.length) return false;
      set(text, Math.min(end + 1 + column, lineEnd(text, end + 1)));
    }
    return true;
  };

  const submit = (text: string) => {
    recall.current = null;
    set("", 0);
    props.onSubmit(text);
  };

  usePaste((pasted) => insert(pasted.replace(/\r\n?/g, "\n")), { isActive: active });

  useInput(
    (input, key) => {
      if (key.eventType === "release") return;
      const { text, cursor } = buffer.current;

      if (matches.length > 0) {
        const chosen = matches[Math.min(menu.current.index, matches.length - 1)];
        if (key.upArrow || key.downArrow) {
          const step = key.upArrow ? -1 : 1;
          menu.current.index = (menu.current.index + step + matches.length) % matches.length;
          return redraw();
        }
        if (key.escape) {
          menu.current.closedFor = text;
          return redraw();
        }
        if (chosen && (key.tab || key.return)) {
          const completed = `/${chosen.name}`;
          // A command that takes arguments gets a space to type them after; one that doesn't runs on Enter.
          if (key.tab || chosen.argumentHint) return set(`${completed} `, completed.length + 1);
          return submit(completed);
        }
      }

      if (key.ctrl && input === "c") {
        if (text) set("", 0);
        else props.onCtrlC();
        return;
      }
      if (key.ctrl && input === "d") {
        if (!text) props.onExit();
        return;
      }
      if (key.ctrl && input === "o") return props.onOpenOutput();
      if (key.escape) {
        if (busy) props.onInterrupt();
        return;
      }
      if (key.tab) {
        if (key.shift) props.onCycleMode();
        return;
      }
      if (key.return) {
        // Shift+Enter (with the kitty keyboard protocol), Alt+Enter, or a backslash before Enter: a new line.
        if (key.shift || key.meta) return insert("\n");
        if (text.slice(0, cursor).endsWith("\\")) return set(`${text.slice(0, cursor - 1)}\n${text.slice(cursor)}`, cursor);
        if (text.trim()) submit(text);
        return;
      }
      if (key.backspace) {
        if (cursor > 0) {
          const at = previous(text, cursor);
          set(text.slice(0, at) + text.slice(cursor), at);
        }
        return;
      }
      if (key.delete) {
        if (cursor < text.length) set(text.slice(0, cursor) + text.slice(next(text, cursor)), cursor);
        return;
      }
      if (key.leftArrow) return set(text, key.ctrl || key.meta ? wordStart(text, cursor) : previous(text, cursor));
      if (key.rightArrow) return set(text, key.ctrl || key.meta ? wordEnd(text, cursor) : next(text, cursor));
      if (key.home || (key.ctrl && input === "a")) return set(text, lineStart(text, cursor));
      if (key.end || (key.ctrl && input === "e")) return set(text, lineEnd(text, cursor));
      if (key.ctrl && input === "u") {
        const start = lineStart(text, cursor);
        return set(text.slice(0, start) + text.slice(cursor), start);
      }
      if (key.ctrl && input === "k") return set(text.slice(0, cursor) + text.slice(lineEnd(text, cursor)), cursor);
      if (key.ctrl && input === "w") {
        const at = wordStart(text, cursor);
        return set(text.slice(0, at) + text.slice(cursor), at);
      }
      if (key.upArrow) {
        if (!moveLine(-1)) recallHistory(-1);
        return;
      }
      if (key.downArrow) {
        if (!moveLine(1)) recallHistory(1);
        return;
      }
      if (key.ctrl || key.meta || !input) return;
      insert(input);
    },
    { isActive: active },
  );

  const { text, cursor } = buffer.current;
  const end = next(text, cursor);
  const under = text.slice(cursor, end);
  const placeholder = busy ? "Claude is working. Type to queue a message" : "Message Claude, or / for commands";
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={active ? ACCENT : COLOR.muted} borderDimColor={!active} paddingX={1} width={width}>
        <Box flexShrink={0}>
          <Text color={active ? ACCENT : COLOR.muted}>{"› "}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {text === "" ? (
            <Text>
              {active ? <Text inverse> </Text> : null}
              <Text dimColor>{placeholder}</Text>
            </Text>
          ) : (
            <Text>
              {text.slice(0, cursor)}
              {active ? <Text inverse>{under && under !== "\n" ? under : " "}</Text> : under === "\n" ? "" : under}
              {under === "\n" ? "\n" : ""}
              {text.slice(end)}
            </Text>
          )}
        </Box>
      </Box>
      {active && matches.length > 0 ? <CommandMenu matches={matches} index={menu.current.index} width={width} /> : null}
    </Box>
  );
}

function CommandMenu({ matches, index, width }: { matches: CommandInfo[]; index: number; width: number }) {
  const focus = Math.min(index, matches.length - 1);
  const start = Math.min(Math.max(0, focus - MENU_ROWS + 1), Math.max(0, matches.length - MENU_ROWS));
  const names = Math.min(24, Math.max(...matches.map((command) => cellWidth(command.name) + 1)));
  return (
    <Box flexDirection="column" paddingX={2}>
      {matches.slice(start, start + MENU_ROWS).map((command, i) => {
        const isFocused = start + i === focus;
        const name = `/${command.name}`.padEnd(names + 2);
        const about = takeCells(command.description.replace(/\s+/g, " "), Math.max(10, width - names - 8))[0];
        return (
          <Text key={command.name} wrap="truncate-end">
            <Text color={isFocused ? ACCENT : undefined} bold={isFocused}>
              {`${isFocused ? "❯" : " "} ${name}`}
            </Text>
            <Text dimColor>{about}</Text>
          </Text>
        );
      })}
      {matches.length > MENU_ROWS ? <Text dimColor>{`  ${matches.length} commands · ↑↓ · tab completes · enter runs`}</Text> : null}
    </Box>
  );
}

/** Commands for a `/word` being typed: names that start with it first, then ones that contain it. */
function menuMatches(text: string, commands: CommandInfo[], closedFor: string) {
  if (!text.startsWith("/") || /\s/.test(text) || text === closedFor) return [];
  const typed = text.slice(1).toLowerCase();
  const starts = commands.filter((command) => command.name.toLowerCase().startsWith(typed));
  const contains = commands.filter((command) => !starts.includes(command) && command.name.toLowerCase().includes(typed));
  const found = [...starts, ...contains];
  // Exactly the command typed, and nothing longer: no menu needed.
  return found.length === 1 && found[0]?.name.toLowerCase() === typed ? [] : found;
}

function previous(text: string, at: number) {
  let last = 0;
  for (const { index } of graphemes.segment(text)) {
    if (index >= at) break;
    last = index;
  }
  return last;
}

function next(text: string, at: number) {
  for (const { index, segment } of graphemes.segment(text)) {
    if (index >= at) return index + segment.length;
  }
  return text.length;
}

function lineStart(text: string, at: number) {
  return text.lastIndexOf("\n", at - 1) + 1;
}

function lineEnd(text: string, at: number) {
  const end = text.indexOf("\n", at);
  return end === -1 ? text.length : end;
}

function wordStart(text: string, at: number) {
  let i = at;
  while (i > 0 && /\s/.test(text[i - 1] ?? "")) i--;
  while (i > 0 && !/\s/.test(text[i - 1] ?? "")) i--;
  return i;
}

function wordEnd(text: string, at: number) {
  let i = at;
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  while (i < text.length && !/\s/.test(text[i] ?? "")) i++;
  return i;
}
