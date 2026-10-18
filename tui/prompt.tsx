// The message box: a small multi-line editor with a menu for slash commands and one for `@` file
// mentions, on a panel whose top edge turns gold while it has your keys. The menu unfolds up out of
// the box and folds back down into it, so the box itself never moves. The text lives in a ref so
// keys that arrive faster than React re-renders still see the latest text. In full screen, clicking
// puts the cursor where you click, and clicking in a menu chooses.
//
// The keys are Claude Code's, from the keymap (`keys.ts`), and the shell's: Ctrl+K, Ctrl+U, Ctrl+W
// and Alt+D cut and Ctrl+Y puts back, Alt+B and Alt+F move by words. Ctrl+S puts the message aside
// until Ctrl+S brings it back.
import { Box, Text, useAnimation, useInput, usePaste, type DOMElement } from "ink";
import { useEffect, useReducer, useRef, type ReactNode, type RefObject } from "react";
import wrapAnsi from "wrap-ansi";
import type { CommandInfo, ImageAttachment } from "../src/events";
import { argumentMatches } from "./arguments";
import { ChoiceRow } from "./choice";
import { baseName, fileMatches, projectFiles } from "./files";
import { cellWidth, takeCells } from "./markdown";
import { fit, Panel } from "./markdown-view";
import { clipboardImage, imageLabel, pastedImageFile } from "./images";
import { chordHint, keyFor, startsChord, strokeOf, type Action, type Keymap } from "./keys";
import { hit, useHover, useMouse } from "./mouse";
import { prepare } from "./pictures";
import { PALETTE } from "./theme";

type Props = {
  /** Off while a prompt or picker above has the keyboard. */
  active: boolean;
  /** Full screen, where the menu covers the transcript; in scrollback it makes room for itself. */
  fullscreen: boolean;
  busy: boolean;
  /** What the box says while a prompt above it has the keys: a question, or a tool call to allow. */
  waitingOn?: "question" | "permission";
  width: number;
  /** The project, whose files `@` offers. */
  cwd: string;
  history: string[];
  commands: CommandInfo[];
  /** `now`: Ctrl+Enter or Ctrl+X Ctrl+S, which stops what Claude is doing to send it straight away. */
  onSubmit: (text: string, now?: boolean) => void;
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
  /** Ctrl+Z: astrocode stops until the shell's `fg`. */
  onSuspend: () => void;
  /** What keys do: Claude Code's defaults with `~/.claude/keybindings.json` over them. */
  keymap: Keymap;
  /** chat:increaseEffort and chat:decreaseEffort, which have no key unless keybindings.json gives them one. */
  onStepEffort: (by: -1 | 1) => void;
  /** Alt+T: thinking on or off. */
  onToggleThinking: () => void;
  /** Alt+P: the model and effort picker. */
  onModelPicker: () => void;
  /** Ctrl+X Ctrl+K: everything running alongside the conversation stopped, once it's pressed twice. */
  onStopTasks: () => void;
  /** Ctrl+F: find in full screen's transcript. Not in scrollback, where the terminal has its own. */
  onFind?: () => void;
  /** A message put aside with Ctrl+S. It stays until Ctrl+S brings it back, whatever is sent meanwhile. */
  stash: string | null;
  onStash: (text: string | null) => void;
};

/** Two presses of Esc this close together are a double press. */
const DOUBLE_ESC_MS = 600;

/** Rows a menu shows at once. */
const MENU_ROWS = 6;

/** How long the menu takes to unfold out of the box or fold back into it. */
const FOLD_MS = 120;

/** How long a chord waits for its next key, as in Claude Code. */
const CHORD_MS = 3000;

/** Steps Ctrl+_ can undo. */
const UNDO_STEPS = 200;


/**
 * What a menu offers: a slash command, a word its first argument can be, or a file or folder
 * (ending in `/`) for an `@` mention. An `inline` command is one typed partway through a message,
 * which choosing writes in rather than runs.
 */
type Suggestion =
  | { kind: "command"; command: CommandInfo; inline: boolean }
  | { kind: "argument"; command: CommandInfo; value: string }
  | { kind: "file"; path: string };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function Prompt(props: Props) {
  const { active, busy, width, cwd, history, commands } = props;
  const buffer = useRef({ text: "", cursor: 0 });
  const recall = useRef<{ index: number; draft: string } | null>(null);
  /**
   * The highlighted suggestion, whether you moved to it with the arrows or the wheel, and whether
   * Esc closed the menu for the text as it is.
   */
  const menu = useRef({ index: 0, moved: false, closedFor: "" });
  /** The project's files, listed again each time an `@` mention starts. */
  const files = useRef<string[] | null>(null);
  const area = useRef<DOMElement>(null);
  const menuBox = useRef<DOMElement>(null);
  const lastEscape = useRef(0);
  /** Earlier texts for Ctrl+_, and whether the last change was typing, which a run of undoes as one. */
  const undo = useRef<{ text: string; cursor: number }[]>([]);
  const lastEdit = useRef<"type" | "edit" | "undo" | "fresh">("edit");
  /** What Ctrl+K, Ctrl+U, Ctrl+W or Alt+D cut last, for Ctrl+Y. */
  const killed = useRef("");
  /** Ctrl+R: what's typed to find, how many older matches to skip, and the box as it was. */
  const search = useRef<{ query: string; skip: number; before: { text: string; cursor: number } } | null>(null);
  /** The keys of a chord pressed so far, and when, while it waits for the next. */
  const chord = useRef<{ keys: string; at: number } | null>(null);
  /** The stash as last set here, ahead of the re-render that brings the prop. */
  const stashed = useRef(props.stash);
  stashed.current = props.stash;
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  /**
   * How the change undoes: `type` joins the typing before it, `word` (a space typed) starts a new
   * run of typing, and `fresh` starts the history over, for text that's been sent or stashed.
   */
  const set = (text: string, cursor: number, edit: "type" | "word" | "edit" | "undo" | "fresh" = "edit") => {
    const before = buffer.current;
    if (text !== before.text) {
      menu.current = { index: 0, moved: false, closedFor: "" };
      if (edit === "edit" || edit === "word" || (edit === "type" && lastEdit.current !== "type")) {
        undo.current.push(before);
        if (undo.current.length > UNDO_STEPS) undo.current.shift();
      }
    }
    if (edit === "fresh") undo.current = [];
    lastEdit.current = edit === "word" ? "type" : edit;
    buffer.current = { text, cursor };
    redraw();
  };
  const insert = (value: string) => {
    const { text, cursor } = buffer.current;
    // A word typed undoes as one step, with the space before it.
    const edit = /^\S$/u.test(value) ? "type" : value === " " ? "word" : "edit";
    set(text.slice(0, cursor) + value + text.slice(cursor), cursor + value.length, edit);
  };
  /** Cuts from `from` to `to`, keeping what went for Ctrl+Y. */
  const cut = (from: number, to: number) => {
    const { text } = buffer.current;
    if (from === to) return;
    killed.current = text.slice(from, to);
    set(text.slice(0, from) + text.slice(to), from);
  };

  /** Ctrl+S: the message goes aside, or comes back, or the two trade places. */
  const toggleStash = () => {
    const { text } = buffer.current;
    const kept = stashed.current;
    if (!text.trim() && kept === null) {
      const key = keyFor(props.keymap, "chat:stash") ?? "Stashing";
      return props.onNotice("info", `Nothing to stash. ${key} puts what you've written aside, and ${key} again brings it back.`);
    }
    const next = text.trim() ? text : null;
    stashed.current = next;
    props.onStash(next);
    recall.current = null;
    set(kept ?? "", (kept ?? "").length, "fresh");
  };

  /** Ctrl+R's matches, newest first and each once, and the one it's on. */
  const found = (query: string) => {
    const wanted = query.toLowerCase();
    return [...new Set([...history].reverse())].filter((text) => text.toLowerCase().includes(wanted));
  };
  const endSearch = (keep: boolean) => {
    const open = search.current;
    if (!open) return;
    search.current = null;
    const match = found(open.query)[open.skip];
    if (keep && match !== undefined && open.query) set(match, match.length);
    else redraw();
  };

  const searching = search.current !== null;
  const open = active && !searching && buffer.current.text !== menu.current.closedFor;
  const mention = open ? mentionAt(buffer.current.text, buffer.current.cursor) : null;
  // In `!` and `#` mode a `/` starts a path, not a command.
  const inline = open && !modeOf(buffer.current.text) ? commandAt(buffer.current.text, buffer.current.cursor) : null;
  const matches: Suggestion[] = searching ? [] : [
    ...menuMatches(buffer.current.text, commands, menu.current.closedFor).map((command) => ({ kind: "command" as const, command, inline: false })),
    ...(open ? argumentMatches(buffer.current.text, commands).map((match) => ({ kind: "argument" as const, ...match })) : []),
    ...(inline ? inlineMatches(commands, inline.typed).map((command) => ({ kind: "command" as const, command, inline: true })) : []),
    ...(mention && files.current ? fileMatches(files.current, mention.typed).map((path) => ({ kind: "file" as const, path })) : []),
  ];
  const focus = Math.min(menu.current.index, Math.max(0, matches.length - 1));
  const menuStart = Math.min(Math.max(0, focus - MENU_ROWS + 1), Math.max(0, matches.length - MENU_ROWS));

  // The menu as it last showed, which is what folds away once it closes.
  const shownMenu = useRef<{ matches: Suggestion[]; focus: number; start: number } | null>(null);
  const showing = active && matches.length > 0;
  if (showing) shownMenu.current = { matches, focus, start: menuStart };
  // Whatever takes the keys, such as the picker a command opens, takes the menu's place at once.
  const unfolded = useFold(showing ? menuHeight(matches.length) : 0, !active);
  // Scrollback can't draw over what's above the live part, so the menu gets rows of its own there,
  // as many as it has needed. Ink redraws the live part from its top row, so giving rows back pulls
  // the box up: they stay until the message is sent, or until something else takes the keys.
  const room = useRef(0);
  room.current = props.fullscreen || !active ? 0 : Math.max(room.current, unfolded, showing ? menuHeight(matches.length) : 0);

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

  const submit = (text: string, now = false) => {
    recall.current = null;
    room.current = 0;
    set("", 0, "fresh");
    props.onSubmit(text, now);
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
   * after; otherwise it runs. An argument does the same for the command it follows. A command
   * partway through a message replaces the `/word` it was found for. A file replaces the `@`
   * mention it was found for. A folder leaves the menu open on what's in it.
   */
  const choose = (chosen: Suggestion, complete: boolean) => {
    if (chosen.kind === "command" && chosen.inline) {
      const { text, cursor } = buffer.current;
      const at = commandAt(text, cursor);
      if (!at) return;
      const written = `/${chosen.command.name}`;
      const after = text.slice(at.end);
      const gap = after.startsWith(" ") ? "" : " ";
      return set(text.slice(0, at.start) + written + gap + after, at.start + written.length + gap.length);
    }
    if (chosen.kind === "command") {
      const completed = `/${chosen.command.name}`;
      if (complete || chosen.command.argumentHint) return set(`${completed} `, completed.length + 1);
      return submit(completed);
    }
    if (chosen.kind === "argument") {
      const completed = `/${chosen.command.name} ${chosen.value}`;
      return complete ? set(`${completed} `, completed.length + 1) : submit(completed);
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

  /**
   * An image goes in as `[Image #n]`, with a space after it when text follows. It goes in once it's
   * ready to draw, so it's drawn however soon the message is sent.
   */
  const insertImage = (image: ImageAttachment) =>
    void prepare(image).then(() => {
      const { text, cursor } = buffer.current;
      const label = imageLabel(props.onAttach(image));
      const before = cursor > 0 && !/\s/.test(text[cursor - 1] ?? "") ? " " : "";
      insert(`${before}${label} `);
    });

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

  /** Waits for the rest of a chord after `keys`, with a hint of what can follow. */
  const arm = (keys: string) => {
    const at = Date.now();
    chord.current = { keys, at };
    setTimeout(() => {
      if (chord.current?.at !== at) return;
      chord.current = null;
      redraw();
    }, CHORD_MS);
    redraw();
  };

  /** What a key bound in the keymap does. */
  const perform = (action: Action) => {
    const { text, cursor } = buffer.current;
    switch (action) {
      case "app:interrupt":
        return text ? set("", 0) : props.onCtrlC();
      case "app:exit":
        return text ? undefined : props.onExit();
      case "app:toggleTodos":
        return props.onToggleTodos();
      case "app:toggleTranscript":
        return props.onOpenOutput();
      case "history:search":
        search.current = { query: "", skip: 0, before: buffer.current };
        return redraw();
      case "chat:killAgents":
        return props.onStopTasks();
      case "chat:cycleMode":
        return props.onCycleMode();
      case "chat:modelPicker":
        return props.onModelPicker();
      case "chat:increaseEffort":
        return props.onStepEffort(1);
      case "chat:decreaseEffort":
        return props.onStepEffort(-1);
      case "chat:thinkingToggle":
        return props.onToggleThinking();
      case "chat:submit":
        // A backslash before the cursor makes it a new line instead.
        if (text.slice(0, cursor).endsWith("\\")) return set(`${text.slice(0, cursor - 1)}\n${text.slice(cursor)}`, cursor);
        return text.trim() ? submit(text) : undefined;
      case "chat:sendNow":
        return text.trim() ? submit(text, true) : undefined;
      case "chat:newline":
        return insert("\n");
      case "chat:undo": {
        const last = undo.current.pop();
        return last ? set(last.text, last.cursor, "undo") : undefined;
      }
      case "chat:externalEditor":
        return props.onEdit(text);
      case "chat:stash":
        return toggleStash();
      case "chat:imagePaste":
        return pasteImage();
      case "chat:clearInput":
        return set("", 0);
      case "task:background":
        return props.onBackground();
    }
  };

  useInput(
    (input, key) => {
      if (key.eventType === "release") return;
      const { text, cursor } = buffer.current;

      if (search.current) {
        const open = search.current;
        if (props.keymap.get(strokeOf(input, key) ?? "") === "history:search") {
          if (open.skip + 1 < found(open.query).length) open.skip += 1;
          return redraw();
        }
        if (key.escape || (key.ctrl && (input === "c" || input === "g"))) {
          search.current = null;
          return set(open.before.text, open.before.cursor);
        }
        if (key.backspace) {
          open.query = open.query.slice(0, -1);
          open.skip = 0;
          return redraw();
        }
        if (key.return || key.tab || key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) return endSearch(true);
        if (key.ctrl || key.meta || !input) return;
        open.query += input;
        open.skip = 0;
        return redraw();
      }

      const pressed = strokeOf(input, key);
      // The second key of a chord: it finishes the chord, goes on to a longer one, or is swallowed.
      if (chord.current) {
        const { keys, at } = chord.current;
        chord.current = null;
        redraw();
        if (Date.now() - at < CHORD_MS) {
          const chordKeys = pressed ? `${keys} ${pressed}` : "";
          const action = props.keymap.get(chordKeys);
          if (action) return perform(action);
          if (chordKeys && startsChord(props.keymap, chordKeys)) return arm(chordKeys);
          return;
        }
      }

      if (matches.length > 0) {
        const chosen = matches[Math.min(menu.current.index, matches.length - 1)];
        if (key.upArrow || key.downArrow) {
          const step = key.upArrow ? -1 : 1;
          menu.current.index = (menu.current.index + step + matches.length) % matches.length;
          menu.current.moved = true;
          return redraw();
        }
        if (key.escape) {
          menu.current.closedFor = text;
          return redraw();
        }
        // Enter right after `/name ` sends the command bare, unless you've moved to a choice.
        const bare = key.return && chosen?.kind === "argument" && text.endsWith(" ") && !menu.current.moved;
        if (chosen && (key.tab || key.return) && !bare) return choose(chosen, key.tab);
      }

      if (pressed) {
        const action = props.keymap.get(pressed);
        if (action) return perform(action);
        if (startsChord(props.keymap, pressed)) return arm(pressed);
      }
      if (key.ctrl && input === "z") return props.onSuspend();
      // Full screen's own keys: Ctrl+F finds in the transcript, and Alt+↑ and Alt+↓ move through it.
      if (key.ctrl && input === "f" && props.onFind) return props.onFind();
      if (props.fullscreen && key.meta && (key.upArrow || key.downArrow)) return;
      if (key.ctrl && input === "y") return killed.current ? insert(killed.current) : undefined;
      if (key.escape) {
        if (busy) return props.onInterrupt();
        if (text) return;
        const now = Date.now();
        if (now - lastEscape.current < DOUBLE_ESC_MS) {
          lastEscape.current = 0;
          return props.onRewind();
        }
        lastEscape.current = now;
        return;
      }
      if (key.tab) return;
      if (key.return) {
        // Shift+Enter (with the kitty keyboard protocol) or Alt+Enter: a new line, as in `claude`.
        if (key.shift || key.meta) insert("\n");
        return;
      }
      if (key.backspace && key.meta) return cut(wordStart(text, cursor), cursor);
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
      if (key.meta && input === "b") return set(text, wordStart(text, cursor));
      if (key.meta && input === "f") return set(text, wordEnd(text, cursor));
      if (key.meta && input === "d") return cut(cursor, wordEnd(text, cursor));
      if (key.leftArrow) return set(text, key.ctrl || key.meta ? wordStart(text, cursor) : previous(text, cursor));
      if (key.rightArrow) return set(text, key.ctrl || key.meta ? wordEnd(text, cursor) : next(text, cursor));
      // Ctrl+Home and Ctrl+End scroll full screen to the top and the end.
      if ((key.home && !key.ctrl) || (key.ctrl && input === "a")) return set(text, lineStart(text, cursor));
      if ((key.end && !key.ctrl) || (key.ctrl && input === "e")) return set(text, lineEnd(text, cursor));
      if (key.ctrl && input === "u") return cut(lineStart(text, cursor), cursor);
      if (key.ctrl && input === "k") return cut(cursor, lineEnd(text, cursor));
      if (key.ctrl && input === "w") return cut(wordStart(text, cursor), cursor);
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
      if (search.current) return;
      const inMenu = matches.length > 0 ? hit(menuBox.current, event) : null;
      if (event.type === "wheel" && inMenu) {
        event.handled = true;
        menu.current.index = (focus + event.wheel + matches.length) % matches.length;
        menu.current.moved = true;
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
  // A menu row answers to a click. So does the text, which puts the cursor where it's clicked, so
  // the pointer is a text beam over it.
  const hoveredMatch = useHover(menuBox, (_, y) => (y < MENU_ROWS && matches[menuStart + y] ? { key: menuStart + y, shape: "pointer" } : null), showing);
  useHover(area, () => ({ key: 0, shape: "text" }), active && !search.current);

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
  // An idle, empty box says nothing; it speaks up only while Claude works or waits on you.
  const placeholder =
    props.waitingOn === "question"
      ? "Claude is waiting for your answer above"
      : props.waitingOn === "permission"
        ? "Claude is waiting for your OK above"
        : busy
          ? "Claude is working. Type to queue a message"
          : "";
  const caret = (character: string) =>
    active ? (
      <Text backgroundColor={PALETTE.gold} color={PALETTE.ink}>
        {character}
      </Text>
    ) : (
      character
    );
  const preview = props.stash === null ? "" : fit(props.stash.replace(/\s+/g, " ").trim(), 24, false);
  const stashKey = keyFor(props.keymap, "chat:stash");
  const note = chord.current ? chordHint(props.keymap, chord.current.keys) : preview ? `stashed “${preview}”${stashKey ? `  ${stashKey}` : ""}` : undefined;

  if (search.current) {
    const { query, skip } = search.current;
    const all = query ? found(query) : [];
    const match = all[skip];
    return (
      <Panel width={width} accent={PALETTE.gold} label="search what you've sent" note={query ? (match === undefined ? "no match" : `${skip + 1} of ${all.length}`) : undefined}>
        <Box>
          <Box flexShrink={0}>
            <Text color={PALETTE.gold}>{"⌕ "}</Text>
          </Box>
          <Text color={PALETTE.gold}>
            {query}
            {caret(" ")}
          </Text>
        </Box>
        {match === undefined ? (
          <Text color={PALETTE.dust}>{query ? "Nothing you've sent has that in it." : "Type to search. ctrl+r older   enter keeps it   esc cancels"}</Text>
        ) : (
          <Box paddingLeft={2}>
            <Highlighted text={match} query={query} />
          </Box>
        )}
      </Panel>
    );
  }

  const folding = shownMenu.current;
  return (
    <Box flexDirection="column">
      {room.current > 0 ? <Box height={room.current} flexShrink={0} /> : null}
      <Box flexDirection="column">
        <Panel width={width} accent={active ? PALETTE.gold : undefined} label={mode} note={note} behind={unfolded > 0 ? PALETTE.surface : undefined}>
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
        {unfolded > 0 && folding ? (
          // It runs into the box's top edge, and only its lowest `unfolded` rows show.
          <Box position="absolute" bottom="100%" left={0} width={width} height={unfolded} overflow="hidden" flexDirection="column" justifyContent="flex-end">
            <Box flexShrink={0} flexDirection="column">
              <SuggestionMenu matches={folding.matches} focus={folding.focus} start={folding.start} hovered={hoveredMatch} width={width} rows={menuBox} />
            </Box>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

/** Rows the menu takes for this many matches: its top edge, the rows that fit, and the line of keys. */
function menuHeight(count: number) {
  return Math.min(MENU_ROWS, count) + 2;
}

/**
 * Rows of the menu showing, eased toward `target` over FOLD_MS whenever it changes, or at once
 * with `snap`.
 */
function useFold(target: number, snap: boolean) {
  const fold = useRef({ from: 0, to: 0, at: 0 });
  const now = Date.now();
  const at = ({ from, to, at }: typeof fold.current) => {
    const t = Math.min(1, (now - at) / FOLD_MS);
    return Math.round(from + (to - from) * (1 - (1 - t) ** 2));
  };
  if (snap) fold.current = { from: target, to: target, at: now };
  else if (target !== fold.current.to) fold.current = { from: at(fold.current), to: target, at: now };
  const shown = at(fold.current);
  // Only for the redraws: each one works out where the fold has got to.
  useAnimation({ interval: 16, isActive: shown !== target });
  return shown;
}

/** A match from Ctrl+R, with the first place the search found in gold. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return <Text color={PALETTE.star}>{text}</Text>;
  return (
    <Text color={PALETTE.star}>
      {text.slice(0, at)}
      <Text color={PALETTE.gold} bold>
        {text.slice(at, at + query.length)}
      </Text>
      {text.slice(at + query.length)}
    </Text>
  );
}

type MenuProps = { matches: Suggestion[]; focus: number; start: number; hovered: number | null; width: number; rows: RefObject<DOMElement | null> };

/** Commands, with what they do, a command's choices, or paths, with the name bright and its folder dim. */
function SuggestionMenu({ matches, focus, start, hovered, width, rows }: MenuProps) {
  const names = Math.min(24, Math.max(...matches.map((match) => (match.kind === "command" ? cellWidth(match.command.name) + 1 : 0))));
  const inner = width - 2;
  const first = matches[0];
  const kind = first?.kind;
  const files = kind === "file";
  const what = files ? "matches" : kind === "argument" ? "choices" : "commands";
  const keys = files
    ? "tab or enter attaches   esc closes"
    : first?.kind === "command" && first.inline
      ? "tab or enter writes it in   esc closes"
      : kind === "argument"
        ? "tab completes   enter runs   esc closes"
        : "tab completes   enter runs";
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
    if (match.kind === "argument") {
      return (
        <Text wrap="truncate-end" color={color} bold={isFocused}>
          {match.value}
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
    <Panel width={width} note={matches.length > MENU_ROWS ? `${matches.length} ${what}` : undefined} open>
      <Box ref={rows} flexDirection="column">
        {matches.slice(start, start + MENU_ROWS).map((match, i) => (
          <ChoiceRow key={match.kind === "file" ? match.path : match.kind === "argument" ? match.value : match.command.name} selected={start + i === focus} hovered={start + i === hovered} width={inner}>
            {row(match, start + i === focus)}
          </ChoiceRow>
        ))}
      </Box>
      <Text color={PALETTE.dust}>{`  ↑↓ to choose   ${keys}`}</Text>
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

/**
 * The `/command` the cursor is in partway through a message, if any: from its `/` to the end of the
 * word, and what's typed before the cursor. The `/` starts a word after the first, as an `@` does.
 */
function commandAt(text: string, cursor: number) {
  const typed = /\s\/([^\s/"]*)$/.exec(text.slice(0, cursor))?.[1];
  if (typed === undefined) return null;
  return { start: cursor - typed.length - 1, end: cursor + (/^\S*/.exec(text.slice(cursor))?.[0].length ?? 0), typed };
}

/**
 * Commands for a `/word` partway through a message: only names that start with it, so a path such
 * as `/usr/lib` closes the menu by its third letter or so instead of offering what contains it.
 */
function inlineMatches(commands: CommandInfo[], typed: string) {
  const wanted = typed.toLowerCase();
  const found = commands.filter((command) => command.name.toLowerCase().startsWith(wanted));
  return found.length === 1 && found[0]?.name.toLowerCase() === wanted ? [] : found;
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
