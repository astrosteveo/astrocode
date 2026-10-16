// The message box: a small multi-line editor. The text lives in a ref so keys that arrive faster
// than React re-renders still see the latest text.
import { Box, Text, useInput, usePaste } from "ink";
import { useReducer, useRef } from "react";
import { ACCENT, COLOR } from "./theme";

type Props = {
  /** Off while a permission prompt has the keyboard. */
  active: boolean;
  busy: boolean;
  width: number;
  history: string[];
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  onCycleMode: () => void;
  /** Ctrl+C on an empty box: the app stops Claude or gets ready to exit. */
  onCtrlC: () => void;
  onExit: () => void;
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function Prompt({ active, busy, width, history, onSubmit, onInterrupt, onCycleMode, onCtrlC, onExit }: Props) {
  const buffer = useRef({ text: "", cursor: 0 });
  const recall = useRef<{ index: number; draft: string } | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const set = (text: string, cursor: number) => {
    buffer.current = { text, cursor };
    redraw();
  };
  const insert = (value: string) => {
    const { text, cursor } = buffer.current;
    set(text.slice(0, cursor) + value + text.slice(cursor), cursor + value.length);
  };

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
      const above = lineStart(text, start - 1);
      set(text, Math.min(above + column, start - 1));
    } else {
      const end = lineEnd(text, cursor);
      if (end === text.length) return false;
      const below = end + 1;
      set(text, Math.min(below + column, lineEnd(text, below)));
    }
    return true;
  };

  usePaste((pasted) => insert(pasted.replace(/\r\n?/g, "\n")), { isActive: active });

  useInput(
    (input, key) => {
      if (key.eventType === "release") return;
      const { text, cursor } = buffer.current;
      if (key.ctrl && input === "c") {
        if (text) set("", 0);
        else onCtrlC();
        return;
      }
      if (key.ctrl && input === "d") {
        if (!text) onExit();
        return;
      }
      if (key.escape) {
        if (busy) onInterrupt();
        return;
      }
      if (key.tab) {
        if (key.shift) onCycleMode();
        return;
      }
      if (key.return) {
        // Shift+Enter (with the kitty keyboard protocol), Alt+Enter, or a backslash before Enter: a new line.
        if (key.shift || key.meta) return insert("\n");
        if (text.slice(0, cursor).endsWith("\\")) return set(`${text.slice(0, cursor - 1)}\n${text.slice(cursor)}`, cursor);
        if (!text.trim()) return;
        recall.current = null;
        set("", 0);
        onSubmit(text);
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
  const placeholder = busy ? "Claude is working. Type to queue a message" : "Message Claude";
  return (
    <Box borderStyle="round" borderColor={COLOR.muted} paddingX={1} width={width}>
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
  );
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
