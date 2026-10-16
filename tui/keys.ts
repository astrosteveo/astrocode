// The message box's keys, as actions named the way Claude Code names them, so the same
// `~/.claude/keybindings.json` changes both `claude` and astrocode. The defaults are Claude Code's
// own for the actions astrocode has. Editing keys (Ctrl+A, Ctrl+K, Alt+B and the like), Esc and
// the arrows aren't actions in Claude Code either, and stay as they are unless a binding takes
// their key.
import type { Key } from "ink";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const ACTIONS = {
  "app:interrupt": "stop or clear",
  "app:exit": "exit",
  "app:toggleTodos": "to-dos",
  "app:toggleTranscript": "tool output",
  "history:search": "search",
  "chat:killAgents": "stop background",
  "chat:cycleMode": "mode",
  "chat:modelPicker": "model",
  "chat:increaseEffort": "more effort",
  "chat:decreaseEffort": "less effort",
  "chat:thinkingToggle": "thinking",
  "chat:submit": "send",
  "chat:sendNow": "send now",
  "chat:newline": "new line",
  "chat:undo": "undo",
  "chat:externalEditor": "editor",
  "chat:stash": "stash",
  "chat:imagePaste": "paste image",
  "chat:clearInput": "clear",
  "task:background": "background",
} as const;

export type Action = keyof typeof ACTIONS;

/** Claude Code's default bindings for the actions astrocode has, in its Global and Chat contexts. */
const DEFAULTS: Record<string, Action> = {
  "ctrl+c": "app:interrupt",
  "ctrl+d": "app:exit",
  "ctrl+t": "app:toggleTodos",
  "ctrl+o": "app:toggleTranscript",
  "ctrl+r": "history:search",
  "ctrl+l": "chat:clearInput",
  "ctrl+x ctrl+k": "chat:killAgents",
  "shift+tab": "chat:cycleMode",
  "meta+p": "chat:modelPicker",
  "meta+t": "chat:thinkingToggle",
  enter: "chat:submit",
  "ctrl+enter": "chat:sendNow",
  "ctrl+x ctrl+s": "chat:sendNow",
  "ctrl+j": "chat:newline",
  "ctrl+_": "chat:undo",
  "ctrl+-": "chat:undo",
  "ctrl+shift+-": "chat:undo",
  "ctrl+shift+_": "chat:undo",
  "ctrl+g": "chat:externalEditor",
  "ctrl+x ctrl+e": "chat:externalEditor",
  "ctrl+s": "chat:stash",
  "ctrl+v": "chat:imagePaste",
  "ctrl+b": "task:background",
  "ctrl+x ctrl+b": "task:background",
};

/** The contexts of keybindings.json that reach the message box. */
const CONTEXTS = new Set(["Global", "Chat"]);

const MODIFIERS: Record<string, string> = {
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "meta",
  opt: "meta",
  option: "meta",
  meta: "meta",
  cmd: "super",
  command: "super",
  super: "super",
  win: "super",
};
const ORDER = ["ctrl", "shift", "meta", "super"];
const NAMES: Record<string, string> = { esc: "escape", return: "enter", pgup: "pageup", pgdn: "pagedown" };

/** Bindings by key, chords written as their keys with a space between, as keybindings.json writes them. */
export type Keymap = ReadonlyMap<string, Action>;

export const DEFAULT_KEYMAP: Keymap = new Map(Object.entries(DEFAULTS));

/** `$CLAUDE_CONFIG_DIR/keybindings.json`, which is `~/.claude/keybindings.json` unless set. */
function keybindingsPath() {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "keybindings.json");
}

/**
 * The defaults with the user's keybindings.json over them. `problems` says what in the file
 * astrocode couldn't use: a malformed file, or actions it doesn't have.
 */
export async function loadKeymap(): Promise<{ keymap: Keymap; problems: { tone: "info" | "error"; text: string }[] }> {
  let raw: string;
  try {
    raw = await readFile(keybindingsPath(), "utf8");
  } catch {
    return { keymap: DEFAULT_KEYMAP, problems: [] };
  }
  const keymap = new Map(DEFAULT_KEYMAP);
  const problems: { tone: "info" | "error"; text: string }[] = [];
  const unknown = new Set<string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { keymap, problems: [{ tone: "error", text: `${keybindingsPath()} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  const blocks = typeof parsed === "object" && parsed !== null ? (parsed as { bindings?: unknown }).bindings : undefined;
  if (!Array.isArray(blocks)) return { keymap, problems: [{ tone: "error", text: `${keybindingsPath()} needs a "bindings" array, as Claude Code's does.` }] };
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const { context, bindings } = block as { context?: unknown; bindings?: unknown };
    if (typeof context !== "string" || !CONTEXTS.has(context) || typeof bindings !== "object" || bindings === null) continue;
    for (const [written, action] of Object.entries(bindings)) {
      const chord = parseChord(written);
      if (!chord) continue;
      if (action === null) keymap.delete(chord);
      else if (typeof action === "string" && action in ACTIONS) keymap.set(chord, action as Action);
      else if (typeof action === "string") {
        // A key bound to something astrocode can't do does nothing here, rather than its default.
        keymap.delete(chord);
        unknown.add(action);
      }
    }
  }
  if (unknown.size) problems.push({ tone: "info", text: `astrocode doesn't have ${[...unknown].join(", ")} from keybindings.json, so those keys do nothing here.` });
  return { keymap, problems };
}

/** `Ctrl+Shift+P`, `alt+enter`, `ctrl+k ctrl+s` in the one spelling keys are matched by. */
export function parseChord(written: string) {
  const strokes = written.trim().toLowerCase().split(/\s+/).map(parseStroke);
  return strokes.every((stroke) => stroke !== null) && strokes.length ? strokes.join(" ") : null;
}

function parseStroke(written: string) {
  const parts = written.split("+");
  // A trailing "+" is the plus key itself: "ctrl++".
  if (parts.length > 1 && parts.at(-1) === "") parts.splice(-2, 2, "+");
  const name = parts.pop();
  if (!name) return null;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const modifier = MODIFIERS[part];
    if (!modifier) return null;
    modifiers.add(modifier);
  }
  return [...ORDER.filter((one) => modifiers.has(one)), NAMES[name] ?? name].join("+");
}

/** Keys Ink names with a flag rather than a character. */
const FLAGGED: [keyof Key, string][] = [
  ["return", "enter"],
  ["escape", "escape"],
  ["tab", "tab"],
  ["backspace", "backspace"],
  ["delete", "delete"],
  ["upArrow", "up"],
  ["downArrow", "down"],
  ["leftArrow", "left"],
  ["rightArrow", "right"],
  ["pageUp", "pageup"],
  ["pageDown", "pagedown"],
  ["home", "home"],
  ["end", "end"],
];

/** A key pressed, in the spelling `parseChord` gives. Null for typed text that's more than one key. */
export function strokeOf(input: string, key: Key) {
  // Ctrl+J without the kitty protocol is a bare line feed.
  if (input === "\n") return "ctrl+j";
  const name = FLAGGED.find(([flag]) => key[flag])?.[1] ?? (input === " " ? "space" : [...input].length === 1 ? input.toLowerCase() : null);
  if (!name) return null;
  const modifiers = [key.ctrl && "ctrl", key.shift && "shift", key.meta && "meta", key.super && "super"].filter(Boolean);
  return [...modifiers, name].join("+");
}

/** The first key bound to an action, to name it in a hint, or null when nothing is. */
export function keyFor(keymap: Keymap, action: Action) {
  for (const [chord, bound] of keymap) if (bound === action) return chord;
  return null;
}

/** Whether keys pressed so far start a longer chord, so the next key finishes it. */
export function startsChord(keymap: Keymap, pressed: string) {
  for (const chord of keymap.keys()) if (chord.startsWith(`${pressed} `)) return true;
  return false;
}

/** What can follow keys pressed so far, for the hint while a chord waits: `ctrl+e editor · …`. */
export function chordHint(keymap: Keymap, pressed: string) {
  const next = [...keymap].flatMap(([chord, action]) => (chord.startsWith(`${pressed} `) ? [`${chord.slice(pressed.length + 1)} ${ACTIONS[action]}`] : []));
  return `${pressed}, then ${next.join(" · ")}`;
}
