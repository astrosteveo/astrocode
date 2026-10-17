// Edits as diffs on a panel: added lines tinted teal, removed ones rose, the rest quiet. Where the
// panel is wide enough, the old lines go on the left and the new on the right, each with its line
// number when Claude Code's patch gives them, so a changed line sits beside what it replaced.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { ToolCall } from "../src/view/state";
import { field, plural } from "../src/view/tools";
import { cellWidth, printable } from "./markdown";
import { fit, Panel } from "./markdown-view";
import { PALETTE, TINT } from "./theme";

/** A line of a diff, with its numbers in the old and new file where they're known. */
export type DiffLine = { kind: "context" | "removed" | "added"; text: string; old?: number; new?: number };

/** A panel this wide or wider shows the two sides next to each other. */
export const SPLIT_WIDTH = 140;
/** Past this many lines a side, lines are compared in one block instead of matched up, which would be slow. */
const MATCH_LIMIT = 1000;

/** An edit's lines: Claude Code's patch when it sent one, with context and numbers, else a diff of the text it replaced. */
export function editLines(call: ToolCall): DiffLine[] {
  const hunks = field(call.output, "structuredPatch");
  if (Array.isArray(hunks) && hunks.length) {
    return hunks.flatMap((hunk) => {
      let old = Number(field(hunk, "oldStart")) || undefined;
      let next = Number(field(hunk, "newStart")) || undefined;
      const lines = field(hunk, "lines");
      return (Array.isArray(lines) ? lines.map(String) : []).map((line): DiffLine => {
        const kind = line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : "context";
        const numbered: DiffLine = { kind, text: line.slice(1), old: kind === "added" ? undefined : old, new: kind === "removed" ? undefined : next };
        if (kind !== "added" && old !== undefined) old++;
        if (kind !== "removed" && next !== undefined) next++;
        return numbered;
      });
    });
  }
  const text = (key: string) => (typeof call.input[key] === "string" ? (call.input[key] as string) : "");
  return diffLines(text("old_string"), text("new_string"));
}

/** The lines that changed between two texts, with the lines they share as context. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MATCH_LIMIT || b.length > MATCH_LIMIT) {
    return [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];
  }
  // The longest run of lines the two share, from the end, so the walk below can go from the start.
  const longest = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i]![j] = a[i] === b[j] ? longest[i + 1]![j + 1]! + 1 : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i++]! });
      j++;
    } else if (longest[i + 1]![j]! >= longest[i]![j + 1]!) {
      // On a tie the removed line goes first, so lines replaced read old, then new.
      out.push({ kind: "removed", text: a[i++]! });
    } else {
      out.push({ kind: "added", text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++]! });
  while (j < b.length) out.push({ kind: "added", text: b[j++]! });
  return out;
}

const COLORS = {
  context: { color: PALETTE.haze, background: undefined },
  removed: { color: PALETTE.rose, background: TINT.removed },
  added: { color: PALETTE.teal, background: TINT.added },
} as const;

/**
 * A diff on a panel, its first `limit` lines, side by side when `width` allows. `framed={false}`
 * leaves out the panel, for a diff inside one already, such as a permission prompt.
 */
export function Diff({ lines, width, limit, framed = true }: { lines: DiffLine[]; width: number; limit: number; framed?: boolean }) {
  const split = width >= SPLIT_WIDTH;
  const Frame = framed ? Panel : Bare;
  const shown = lines.slice(0, limit);
  const more = lines.length > shown.length ? <Text color={PALETTE.haze}>{` ${plural(lines.length - shown.length, "more line")}`}</Text> : null;
  if (!split) {
    return (
      <Frame width={width} paddingX={0}>
        {shown.map((line, i) => (
          <Box key={i} backgroundColor={COLORS[line.kind].background} width={width}>
            <Text color={COLORS[line.kind].color}>{` ${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${printable(line.text) || " "}`}</Text>
          </Box>
        ))}
        {more}
      </Frame>
    );
  }
  const rows = pairs(shown);
  const digits = String(Math.max(0, ...shown.map((line) => Math.max(line.old ?? 0, line.new ?? 0)))).length;
  const numbered = shown.some((line) => line.old !== undefined || line.new !== undefined);
  // Each side gets half, less the rule between them.
  const side = Math.floor((width - 1) / 2);
  return (
    <Frame width={width} paddingX={0}>
      {rows.map(([left, right], i) => (
        <Box key={i} width={width}>
          <Half line={left} number={left?.old} width={side} digits={numbered ? digits : 0} />
          <Text color={PALETTE.dust}>│</Text>
          <Half line={right} number={right?.new} width={width - side - 1} digits={numbered ? digits : 0} />
        </Box>
      ))}
      {more}
    </Frame>
  );
}

function Bare({ children }: { width: number; paddingX: number; children: ReactNode }) {
  return <Box flexDirection="column">{children}</Box>;
}

/** One side of a row: the line number in quiet gray, then the line, cut off at the side's edge. */
function Half({ line, number, width, digits }: { line?: DiffLine; number?: number; width: number; digits: number }) {
  if (!line) return <Box width={width} />;
  const gutter = digits ? `${String(number ?? "").padStart(digits)} ` : "";
  const text = printable(line.text).replace(/\t/g, "  ");
  return (
    <Box width={width} backgroundColor={COLORS[line.kind].background}>
      <Text wrap="truncate-end">
        <Text color={PALETTE.dust}>{` ${gutter}`}</Text>
        <Text color={COLORS[line.kind].color}>{fit(text, Math.max(1, width - cellWidth(gutter) - 2), false) || " "}</Text>
      </Text>
    </Box>
  );
}

/**
 * The diff as rows of two sides. A line both sides share goes on both; a run of removed lines and
 * the added lines after it go side by side, line for line, with blank space where one runs longer.
 */
function pairs(lines: DiffLine[]): [DiffLine | undefined, DiffLine | undefined][] {
  const rows: [DiffLine | undefined, DiffLine | undefined][] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "context") {
      rows.push([line, line]);
      i++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (lines[i]?.kind === "removed") removed.push(lines[i++]!);
    while (lines[i]?.kind === "added") added.push(lines[i++]!);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) rows.push([removed[k], added[k]]);
  }
  return rows;
}
