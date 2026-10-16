// The message box: a small multi-line editor with a menu for slash commands and one for `@` file
// mentions, on a panel whose top edge turns gold while it has your keys. The text lives in a ref so
// keys that arrive faster than React re-renders still see the latest text. In full screen, clicking
// puts the cursor where you click, and clicking in a menu chooses.
import { Box, Text, useInput, usePaste, type DOMElement } from "ink";
import { useEffect, useReducer, useRef, type ReactNode, type RefObject } from "react";
import wrapAnsi from "wrap-ansi";
import type { CommandInfo, ImageAttachment } from "../src/events";
import { ChoiceRow } from "./choice";
import { baseName, fileMatches, projectFiles } from "./files";
import { cellWidth, takeCells } from "./markdown";
import { Panel } from "./markdown-view";
import { clipboardImage, imageLabel, pastedImageFile } from "./images";
import { hit, useMouse } from "./mouse";
import { PALETTE } from "./theme";

type Props = {
  /** Off while a prompt or picker above has the keyboard. */
  active: boolean;
  busy: boolean;
  /** A command run with `!` is still going: Esc stops it. */
  running: boolean;
  width: number;
  /** The project, whose files `@` offers. */
  cwd: string;
  history: string[];
  commands: CommandInfo[];
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  onCycleMode: () => void;
  /** Ctrl+C on an empty box: the app stops Claude or gets ready to exit. */
  onCtrlC: () => void;
  onExit: () => void;
  onOpenOutput: () => void;
  /** Text to put in the box in place of what's there, such as a message rewound to or edited in $EDITOR. */
  prefill: { text: string } | null;
  /** Keeps an image for the message and gives its number for `[Image #n]`. */
  onAttach: (image: ImageAttachment) => number;
  onNotice: (tone: "info" | "error", text: string) => void;
  /** Ctrl+G: the message in your editor. */
  onEdit: (text: string) => void;
  /** Ctrl+B: what Claude waits on moves to the background. */
  onBackground: () => void;
  /** Ctrl+T: the to-do list shown or hidden. */
  onToggleTodos: () => void;
  /** Esc twice on an empty box, while Claude isn't working. */
  onRewind: () => void;
};

/** Two presses of Esc this close together are a double press. */
const DOUBLE_ESC_MS = 600;

/** Rows a menu shows at once. */
const MENU_ROWS = 6;

/** What a menu offers: a slash command, or a file or folder (ending in `/`) for an `@` mention. */
type Suggestion = { kind: "command"; command: CommandInfo } | { kind: "file"; path: string };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function Prompt(props: Props) {
  const { active, busy, width, cwd, history, commands } = props;
  const buffer = useRef({ text: "", cursor: 0 });
  const recall = useRef<{ index: number; draft: string } | null>(null);
  /** The highlighted suggestion, and whether Esc closed the menu for the text as it is. */
  const menu = useRef({ index: 0, closedFor: "" });
  /** The project's files, listed again each time an `@` mention starts. */
  const files = useRef<string[] | null>(null);
  const area = useRef<DOMElement>(null);
  const menuBox = useRef<DOMElement>(null);
  const lastEscape = useRef(0);
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

  const mention = active && buffer.current.text !== menu.current.closedFor ? mentionAt(buffer.current.text, buffer.current.cursor) : null;
  const matches: Suggestion[] = [
    ...menuMatches(buffer.current.text, commands, menu.current.closedFor).map((command) => ({ kind: "command" as const, command })),
    ...(mention && files.current ? fileMatches(files.current, mention.typed).map((path) => ({ kind: "file" as const, path })) : []),
  ];
  const focus = Math.min(menu.current.index, Math.max(0, matches.length - 1));
  const menuStart = Math.min(Math.max(0, focus - MENU_ROWS + 1), Math.max(0, matches.length - MENU_ROWS));

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

  const mentioning = mention !== null;
  useEffect(() => {
    if (!mentioning) return;
    let alive = true;
    void projectFiles(cwd).then((list) => {
      if (!alive) return;
      files.current = list;
      redraw();
    });
    return () => {
      alive = false;
    };
  }, [mentioning, cwd]);

  /**
   * A suggestion from the menu. A command that takes arguments, or Tab, completes it to type them
   * after; otherwise it runs. A file replaces the `@` mention it was found for. A folder leaves the
   * menu open on what's in it.
   */
  const choose = (chosen: Suggestion, complete: boolean) => {
    if (chosen.kind === "command") {
      const completed = `/${chosen.command.name}`;
      if (complete || chosen.command.argumentHint) return set(`${completed} `, completed.length + 1);
      return submit(completed);
    }
    const { text, cursor } = buffer.current;
    const at = mentionAt(text, cursor);
    if (!at) return;
    const folder = chosen.path.endsWith("/") && !/\s/.test(chosen.path);
    const written = /\s/.test(chosen.path) ? `@"${chosen.path}"` : `@${chosen.path}`;
    const after = text.slice(at.end);
    const gap = folder || after.startsWith(" ") ? "" : " ";
    set(text.slice(0, at.start) + written + gap + after, at.start + written.length + gap.length);
  };

  useEffect(() => {
    if (!props.prefill) return;
    recall.current = null;
    set(props.prefill.text, props.prefill.text.length);
  }, [props.prefill]);

  /** An image goes in as `[Image #n]`, with a space after it when text follows. */
  const insertImage = (image: ImageAttachment) => {
    const { text, cursor } = buffer.current;
    const label = imageLabel(props.onAttach(image));
    const before = cursor > 0 && !/\s/.test(text[cursor - 1] ?? "") ? " " : "";
    insert(`${before}${label} `);
  };

  const pasteImage = () =>
    void clipboardImage().then(
      (image) => {
        if (image === null) props.onNotice("info", "There's no image on the clipboard. Paste text with your terminal's own paste, often Ctrl+Shift+V.");
        else if (typeof image === "string") props.onNotice("error", image);
        else insertImage(image);
      },
      (error: unknown) => props.onNotice("error", error instanceof Error ? error.message : String(error)),
    );

  // A path to an image, as dropping a file on the terminal pastes, attaches the image.
  usePaste(
    (pasted) => {
      const text = pasted.replace(/\r\n?/g, "\n");
      void pastedImageFile(text, cwd).then(
        (found) => {
          if (!found) return insert(text);
          if (typeof found.image === "string") {
            props.onNotice("error", found.image);
            return insert(text);
          }
          insertImage(found.image);
        },
        () => insert(text),
      );
    },
    { isActive: active },
  );

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
        if (chosen && (key.tab || key.return)) return choose(chosen, key.tab);
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
      if (key.ctrl && input === "v") return pasteImage();
      if (key.ctrl && input === "g") return props.onEdit(text);
      if (key.ctrl && input === "b") return props.onBackground();
      if (key.ctrl && input === "t") return props.onToggleTodos();
      if (key.escape) {
        if (busy || props.running) return props.onInterrupt();
        if (text) return;
        const now = Date.now();
        if (now - lastEscape.current < DOUBLE_ESC_MS) {
          lastEscape.current = 0;
          return props.onRewind();
        }
        lastEscape.current = now;
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
      // Ctrl+Home and Ctrl+End scroll full screen to the top and the end.
      if ((key.home && !key.ctrl) || (key.ctrl && input === "a")) return set(text, lineStart(text, cursor));
      if ((key.end && !key.ctrl) || (key.ctrl && input === "e")) return set(text, lineEnd(text, cursor));
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

  useMouse(
    (event) => {
      const inMenu = matches.length > 0 ? hit(menuBox.current, event) : null;
      if (event.type === "wheel" && inMenu) {
        event.handled = true;
        menu.current.index = (focus + event.wheel + matches.length) % matches.length;
        return redraw();
      }
      if (event.type !== "press" || event.button !== "left") return;
      if (inMenu) {
        event.handled = true;
        const chosen = inMenu.y < MENU_ROWS ? matches[menuStart + inMenu.y] : undefined;
        if (chosen) choose(chosen, false);
        return;
      }
      const at = hit(area.current, event);
      if (!at) return;
      event.handled = true;
      const { text, cursor } = buffer.current;
      // In a mode, the `!` or `#` is drawn as the marker, not in the text area.
      const skip = modeOf(text) ? 1 : 0;
      const offset = offsetAt(text.slice(skip), cursor >= skip ? cursor - skip : null, area.current?.yogaNode?.getComputedWidth() ?? 1, at.x, at.y);
      if (offset !== null) set(text, offset + skip);
    },
    { isActive: active },
  );

  const mode = modeOf(buffer.current.text);
  // `!` runs a command in your shell, and `#` adds a note to CLAUDE.md. The box says which, and the
  // `!` or `#` takes the place of `❯`, as the transcript draws it.
  const skip = mode ? 1 : 0;
  const marker = mode ? buffer.current.text.slice(0, skip) : "❯";
  const onMarker = mode !== undefined && buffer.current.cursor === 0;
  const text = buffer.current.text.slice(skip);
  const cursor = Math.max(0, buffer.current.cursor - skip);
  const end = next(text, cursor);
  const under = text.slice(cursor, end);
  const placeholder = busy ? "Claude is working. Type to queue a message" : "Message Claude, / for commands, @ for files, ! for a shell";
  const caret = (character: string) =>
    active ? (
      <Text backgroundColor={PALETTE.gold} color={PALETTE.ink}>
        {character}
      </Text>
    ) : (
      character
    );
  return (
    <Box flexDirection="column">
      <Panel width={width} accent={active ? PALETTE.gold : undefined} label={mode}>
        <Box>
          <Box flexShrink={0}>
            <Text color={active ? PALETTE.gold : PALETTE.dust}>
              {onMarker ? caret(marker) : marker}{" "}
            </Text>
          </Box>
          <Box ref={area} flexGrow={1} flexShrink={1}>
            {text === "" ? (
              <Text>
                {active && !onMarker ? caret(" ") : null}
                {mode ? null : <Text color={PALETTE.haze}>{placeholder}</Text>}
              </Text>
            ) : (
              <Text color={PALETTE.star}>
                {text.slice(0, cursor)}
                {active && !onMarker ? caret(under && under !== "\n" ? under : " ") : under === "\n" ? "" : under}
                {under === "\n" ? "\n" : ""}
                {text.slice(end)}
              </Text>
            )}
          </Box>
        </Box>
      </Panel>
      {active && matches.length > 0 ? <SuggestionMenu matches={matches} focus={focus} start={menuStart} width={width} rows={menuBox} /> : null}
    </Box>
  );
}

type MenuProps = { matches: Suggestion[]; focus: number; start: number; width: number; rows: RefObject<DOMElement | null> };

/** Commands, with what they do, or paths, with the name bright and its folder dim. */
function SuggestionMenu({ matches, focus, start, width, rows }: MenuProps) {
  const names = Math.min(24, Math.max(...matches.map((match) => (match.kind === "command" ? cellWidth(match.command.name) + 1 : 0))));
  const inner = width - 2;
  const files = matches[0]?.kind === "file";
  const row = (match: Suggestion, isFocused: boolean): ReactNode => {
    const color = isFocused ? PALETTE.star : PALETTE.tealLight;
    if (match.kind === "file") {
      const name = baseName(match.path) + (match.path.endsWith("/") ? "/" : "");
      return (
        <Text wrap="truncate-start">
          <Text color={PALETTE.haze}>{match.path.slice(0, match.path.length - name.length)}</Text>
          <Text color={color} bold={isFocused}>
            {name}
          </Text>
        </Text>
      );
    }
    const { command } = match;
    const about = takeCells(command.description.replace(/\s+/g, " "), Math.max(10, inner - names - 6))[0];
    return (
      <Text wrap="truncate-end">
        <Text color={color} bold={isFocused}>
          {`/${command.name}`.padEnd(names + 3)}
        </Text>
        <Text color={PALETTE.haze}>{about}</Text>
      </Text>
    );
  };
  return (
    <Panel width={width} note={matches.length > MENU_ROWS ? `${matches.length} ${files ? "matches" : "commands"}` : undefined}>
      <Box ref={rows} flexDirection="column">
        {matches.slice(start, start + MENU_ROWS).map((match, i) => (
          <ChoiceRow key={match.kind === "file" ? match.path : match.command.name} selected={start + i === focus} width={inner}>
            {row(match, start + i === focus)}
          </ChoiceRow>
        ))}
      </Box>
      <Text color={PALETTE.dust}>{files ? "  ↑↓ to choose   tab or enter attaches   esc closes" : "  ↑↓ to choose   tab completes   enter runs"}</Text>
    </Panel>
  );
}

/**
 * The `@` mention the cursor is in, if any: from its `@` to the end of the word, and what's typed
 * before the cursor. The `@` starts a word, so an email address isn't one.
 */
function mentionAt(text: string, cursor: number) {
  const typed = /(?:^|\s)@([^\s"]*)$/.exec(text.slice(0, cursor))?.[1];
  if (typed === undefined) return null;
  return { start: cursor - typed.length - 1, end: cursor + (/^\S*/.exec(text.slice(cursor))?.[0].length ?? 0), typed };
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

/**
 * The offset in `text` under a cell of the text area, wrapped as Ink wraps it, with the cursor
 * drawn at `cursor`. Wrapping keeps every character and only adds line breaks, so each cell can be
 * traced back to the text. Past the end of a line, the cursor goes to its end.
 */
function offsetAt(text: string, cursor: number | null, room: number, x: number, y: number) {
  // What's drawn: the text, with a space for the cursor where it has no character of its own to
  // cover. A `null` cursor is drawn outside the text, on the marker.
  let shown = "";
  const offsets: number[] = [];
  const put = (part: string, from: number | null) => {
    for (let k = 0; k < part.length; k++) {
      shown += part[k];
      offsets.push(from === null ? (cursor ?? 0) : from + k);
    }
  };
  if (cursor === null) put(text, 0);
  else {
    const end = next(text, cursor);
    const under = text.slice(cursor, end);
    put(text.slice(0, cursor), 0);
    if (under && under !== "\n") put(under, cursor);
    else put(" ", null);
    if (under === "\n") put("\n", null);
    put(text.slice(end), end);
  }

  const cells: { row: number; col: number; width: number; offset: number; newline: boolean }[] = [];
  let row = 0;
  let col = 0;
  let i = 0;
  for (const character of wrapAnsi(shown, Math.max(1, room), { trim: false, hard: true })) {
    if (!shown.startsWith(character, i)) {
      // A line break wrapping added.
      row += 1;
      col = 0;
      continue;
    }
    const offset = offsets[i] ?? text.length;
    i += character.length;
    if (character === "\n") {
      cells.push({ row, col, width: 1, offset, newline: true });
      row += 1;
      col = 0;
      continue;
    }
    const width = cellWidth(character);
    cells.push({ row, col, width, offset, newline: false });
    col += width;
  }
  if (y > row) return text.length;
  const line = cells.filter((cell) => cell.row === y);
  const last = line.at(-1);
  if (!last) return null;
  const covering = line.find((cell) => x >= cell.col && x < cell.col + Math.max(1, cell.width));
  const offset = covering ? covering.offset : last.newline ? last.offset : y === row ? text.length : last.offset;
  return offset >= text.length ? text.length : previous(text, offset + 1);
}

/** The box's mode: `!` runs a command in your shell, and `#` adds a note to CLAUDE.md. */
function modeOf(text: string) {
  return text.startsWith("!") ? "shell" : text.startsWith("#") ? "memory" : undefined;
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
