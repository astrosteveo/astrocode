// What a slash command's first argument can be, for the message box's menu. Claude Code works this
// out with each command's own completer, which the SDK doesn't pass along, so astrocode reads the
// words a command's argument hint spells out, such as `[low|medium|high]`.
import type { CommandInfo } from "../src/events";

/**
 * Commands whose choices Claude Code knows but their hint doesn't show. `/claude-api` has no hint
 * at all; its list is the one Claude Code 2.1.302 offers.
 */
const KNOWN: Record<string, string[]> = {
  "claude-api": ["cost-optimize", "migrate", "managed-agents-onboard", "prompt-audit", "upgrade", "build-eval", "hillclimb", "preserved-thinking-migration"],
};

/** A word that's meant literally, as opposed to a placeholder such as `<path>` or `"Acme"`. */
const WORD = /^-{0,2}[a-z][\w.:-]*$/i;

/**
 * The words a command's first argument can be. A hint's first group is its first bracketed part,
 * or the whole hint when it has no brackets. Its `|`-separated choices that start with a plain
 * word are offered by that word, as is a lone choice that's a flag or a word followed by more of
 * its own (`[prompt-audit [<path>]]`). A lone plain word, as in `[name]`, names what to type.
 */
export function argumentOptions(command: CommandInfo): string[] {
  const known = KNOWN[command.name];
  if (known) return known;
  const group = firstGroup(command.argumentHint.trim());
  if (!group) return [];
  const choices = splitTop(group).map((choice) => choice.trim());
  const words = choices.map((choice) => {
    const word = /^\S+/.exec(choice)?.[0] ?? "";
    if (!WORD.test(word)) return null;
    if (choices.length > 1 || word.startsWith("-") || /^\S+\s+[[<(]/.test(choice)) return word;
    return null;
  });
  return [...new Set(words.filter((word) => word !== null))];
}

/**
 * Choices for the argument being typed after `/name `: those that start with it. None once a
 * second argument starts, or when what's typed is already the only choice.
 */
export function argumentMatches(text: string, commands: CommandInfo[]) {
  const typing = /^\/(\S+) (\S*)$/.exec(text);
  if (!typing) return [];
  const [, name = "", typed = ""] = typing;
  const command = commands.find((each) => each.name === name);
  if (!command) return [];
  const found = argumentOptions(command).filter((option) => option.toLowerCase().startsWith(typed.toLowerCase()));
  return found.length === 1 && found[0] === typed ? [] : found.map((value) => ({ command, value }));
}

/** The inside of the hint's first bracketed group, or the hint itself when it starts with no bracket. */
function firstGroup(hint: string) {
  const open = hint[0];
  const close = open === "[" ? "]" : open === "<" ? ">" : open === "(" ? ")" : undefined;
  if (!close) return hint;
  let depth = 0;
  for (let i = 0; i < hint.length; i++) {
    if ("[<(".includes(hint[i] ?? "")) depth++;
    else if ("]>)".includes(hint[i] ?? "") && --depth === 0) return hint.slice(1, i);
  }
  return "";
}

/** Splits on the `|`s that aren't inside a nested group. */
function splitTop(group: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < group.length; i++) {
    const character = group[i] ?? "";
    if ("[<(".includes(character)) depth++;
    else if ("]>)".includes(character)) depth--;
    else if (character === "|" && depth === 0) {
      parts.push(group.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(group.slice(start));
  return parts;
}
