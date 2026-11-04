// A unified diff, as git prints it, read into numbered lines for drawing.

/** A line of a diff, with its numbers in the old and new file where they're known. */
export type DiffLine = { kind: "context" | "removed" | "added"; text: string; old?: number; new?: number };

/** A unified diff's lines, numbered from its hunks' headers; what comes before the first hunk, and git's notes, left out. */
export function patchLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let old = 0;
  let next = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      old = Number(header[1]);
      next = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) lines.push({ kind: "added", text: line.slice(1), new: next++ });
    else if (line.startsWith("-")) lines.push({ kind: "removed", text: line.slice(1), old: old++ });
    else if (line.startsWith(" ")) lines.push({ kind: "context", text: line.slice(1), old: old++, new: next++ });
    // `\ No newline at end of file`, and the next file's header, aren't lines of this one.
    else inHunk = line.startsWith("\\");
  }
  return lines;
}

/**
 * The lines in runs that follow on in the file, and how many lines of it come before each run that
 * the diff leaves out. Lines without numbers are one run.
 */
export function runsOf(lines: DiffLine[]): { skipped: number; lines: DiffLine[] }[] {
  const runs: { skipped: number; lines: DiffLine[] }[] = [];
  // Where the next line would be on each side. Lines left out are the same on both sides, so a
  // gap moves both on as far.
  let old = 1;
  let next = 1;
  for (const one of lines) {
    const at = one.kind === "removed" ? one.old : one.new;
    const gap = at === undefined ? 0 : Math.max(0, at - (one.kind === "removed" ? old : next));
    if (!runs.length || gap > 0) runs.push({ skipped: gap, lines: [] });
    runs.at(-1)!.lines.push(one);
    old += gap + (one.kind === "added" ? 0 : 1);
    next += gap + (one.kind === "removed" ? 0 : 1);
  }
  return runs;
}
