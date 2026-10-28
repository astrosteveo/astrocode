// Commands in Claude's code blocks that you can run as you would with `!`: a shell block's whole
// source, or a console block's prompted lines without what they printed.
import type { Item } from "../src/view/state";
import { parse } from "./markdown";

const SHELLS = new Set(["sh", "bash", "zsh", "shell"]);
const SESSIONS = new Set(["console", "shellsession", "terminal"]);
/** A console line's prompt, as in `$ bun test`. */
const PROMPT = /^\s*[$%] /;

/** What a finished code block in `language` runs, or undefined when it isn't a shell's. */
export function runnable(language: string, source: string): string | undefined {
  const lang = language.toLowerCase();
  const text = source.replace(/\n$/, "");
  if (SHELLS.has(lang)) return text.trim() ? text : undefined;
  if (!SESSIONS.has(lang)) return undefined;
  if (!text.split("\n").some((line) => PROMPT.test(line))) return text.trim() ? text : undefined;
  // A prompted line goes with the lines it continues onto, those after a trailing backslash.
  const kept: string[] = [];
  let continues = false;
  for (const line of text.split("\n")) {
    if (continues || PROMPT.test(line)) {
      kept.push(continues ? line : line.replace(PROMPT, ""));
      continues = line.endsWith("\\");
    }
  }
  return kept.join("\n");
}

/** The commands in Claude's replies, newest first, each once. */
export function runnableCommands(items: Item[]): string[] {
  const commands = items.flatMap((item) =>
    item.kind === "text"
      ? parse(item.text).flatMap((block) => {
          const command = block.kind === "code" && !block.isOpen ? runnable(block.language, block.source) : undefined;
          return command ? [command] : [];
        })
      : [],
  );
  return [...new Set(commands.reverse())];
}
