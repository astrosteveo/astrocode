import { highlight, supportsLanguage } from "cli-highlight";

const ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  yml: "yaml",
  md: "markdown",
};

/** Source code with terminal color codes for its syntax, or as it was for a language we can't read. */
export function highlightCode(source: string, language: string) {
  const name = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  if (!name || !supportsLanguage(name)) return source;
  try {
    return highlight(source, { language: name, ignoreIllegals: true });
  } catch {
    return source;
  }
}
