// A turn's ledger opened in place, under its closing line: each file the turn changed, with `new`,
// `+N −N` or `deleted` at the edge, then the commands it ran with their results, the commits it
// made and its tokens. Enter on a file opens its diff for the turn under it, in runs with `⋯ N
// lines` for what the diff leaves out. In git, `[` and `]` switch what it lists between the turn,
// what isn't committed, and the branch against its base, as `claude`'s /diff does. Full screen
// lays it out a piece at a time, so each row knows what Enter or a click on it acts on; scrollback
// prints it whole for /diff, every file open.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { FileChange, Trees } from "../src/events";
import { activityRows, type Part } from "../src/view/activity";
import { compact } from "../src/view/format";
import { commandsOf } from "../src/view/ledger";
import { runsOf, type DiffLine } from "../src/view/patch";
import type { Item } from "../src/view/state";
import { plural, shortPath, toolTarget } from "../src/view/tools";
import { Diff } from "./diff";
import { TONES, type Piece } from "./entries";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
import { HEAD, OPEN_INSET, TAIL, type Spot } from "./opened";
import { PALETTE } from "./theme";

export type TurnItem = Extract<Item, { kind: "turn" }>;

/** What an opened ledger lists: what the turn changed, what isn't committed, or the branch against its base. */
export type Scope = "turn" | "uncommitted" | "branch";
export const SCOPES: readonly Scope[] = ["turn", "uncommitted", "branch"];
const LABELS: Record<Scope, string> = { turn: "this turn", uncommitted: "uncommitted", branch: "branch" };

/**
 * The files a scope lists, with the trees their diffs run between and the branch it's against; or
 * that git is being asked, or couldn't say.
 */
export type Listed = { files: FileChange[]; trees?: Trees; base?: string } | "reading" | "failed";

/** A file's diff: its lines, or that they're being read, or that they weren't kept. */
export type FileDiff = DiffLine[] | "reading" | "gone";

/** A command the turn ran, as its line in the ledger reads: the command, and how it went. */
export type Ran = { command: string; result: Part[] };

/** A piece of an opened ledger: `head` for a file's line, which Enter opens rather than closes. */
export type LedgerPiece = Piece & { head?: boolean; spots?: Spot[] };

const FILE = "ledger:file:";
const SCOPE = "ledger:scope:";
const ALL = "ledger:all:";
const MORE = "ledger:more:";
/** What Enter or a click on a ledger's rows acts on besides closing it: a file's diff, another scope, or every file's diff. */
export const fileTarget = (turn: string, path: string) => `${FILE}${turn}\n${path}`;
export const scopeTarget = (turn: string, scope: Scope | -1 | 1) => `${SCOPE}${turn}\n${scope}`;
export const allTarget = (turn: string) => `${ALL}${turn}`;
/** A folded diff's `⋯ N more lines`, which opens the rest of it: it's held open, as files are, by this key. */
export const moreTarget = (turn: string, path: string) => `${MORE}${turn}\n${path}`;
export const isMore = (target: string | undefined) => target?.startsWith(MORE) === true;

/** What a ledger's target acts on: a file's diff, or the rest of it (`more`), a scope, or every file's diff. */
export function ledgerTarget(target: string): { turn: string; path: string; more?: true } | { turn: string; scope: Scope | -1 | 1 } | { turn: string; all: true } | undefined {
  if (target.startsWith(ALL)) return { turn: target.slice(ALL.length), all: true };
  const prefix = [FILE, MORE, SCOPE].find((one) => target.startsWith(one));
  if (!prefix) return undefined;
  const [turn = "", rest = ""] = target.slice(prefix.length).split("\n");
  if (prefix === FILE) return { turn, path: rest };
  if (prefix === MORE) return { turn, path: rest, more: true };
  return { turn, scope: rest === "-1" ? -1 : rest === "1" ? 1 : (rest as Scope) };
}

/** The commands the turn closed by `items[index]` ran, each with its result as its activity line reads it. */
export function commandRows(items: Item[], index: number, cwd: string, home: string): Ran[] {
  return commandsOf(items, index).map((call) => ({ command: toolTarget(call, cwd, home), result: activityRows([call], new Set(), cwd, home)[0]?.result ?? [] }));
}

type Input = {
  turn: TurnItem;
  /** What it lists. Unset outside git, where there's only the turn, and in scrollback, which has no keys to switch it. */
  scope?: Scope;
  listed: Listed;
  /** Whether a file's diff is open under its line, and whether all of it, rather than its ends. */
  open: (file: FileChange) => boolean;
  whole: (file: FileChange) => boolean;
  diff: (file: FileChange) => FileDiff | undefined;
  commands: Ran[];
  /** The transcript's width. */
  width: number;
  cwd: string;
  home: string;
};

/** The opened ledger's pieces, from column OPEN_INSET. */
export function ledgerPieces({ turn, scope, listed, open, whole, diff, commands, width, cwd, home }: Input): LedgerPiece[] {
  const inner = Math.max(10, width - OPEN_INSET);
  const at = (node: ReactNode) => (
    <Box paddingLeft={OPEN_INSET} width={width}>
      {node}
    </Box>
  );
  const note = (key: string, text: string): LedgerPiece => ({ key, target: turn.key, node: at(<Text color={PALETTE.dust}>{text}</Text>) });
  const pieces: LedgerPiece[] = [];
  if (scope) pieces.push({ key: "scopes", target: turn.key, node: at(<Scopes scope={scope} base={typeof listed === "object" ? listed.base : undefined} />), spots: scopeSpots(turn.key) });
  if (listed === "reading") pieces.push(note("reading", "Reading what changed…"));
  else if (listed === "failed") pieces.push(note("failed", scope === "branch" ? "There's no main or master branch to compare with." : "Git couldn't say what changed."));
  else {
    if (!listed.files.length && scope && scope !== "turn") pieces.push(note("none", "No changes yet"));
    for (const file of listed.files) {
      const target = fileTarget(turn.key, file.path);
      pieces.push({ key: `file:${file.path}`, target, head: true, node: at(<FileLine file={file} width={inner} cwd={cwd} home={home} />) });
      if (open(file)) pieces.push(...diffPieces(turn.key, file, diff(file), whole(file), inner, at));
    }
  }
  if (scope && scope !== "turn") return pieces;
  commands.forEach((one, i) =>
    pieces.push({ key: `command:${i}`, target: turn.key, node: at(<Edged left={[{ text: one.command, tone: "plain" }]} right={one.result} width={inner} />) }),
  );
  for (const commit of turn.commits ?? []) {
    pieces.push({ key: `commit:${commit}`, target: turn.key, node: at(<Edged left={[{ text: "committed ", tone: "quiet" }, { text: commit, tone: "code" }]} right={[]} width={inner} />) });
  }
  if (turn.tokens > 0) pieces.push({ key: "tokens", target: turn.key, node: at(<Text color={PALETTE.haze}>{`${compact(turn.tokens)} tokens`}</Text>) });
  return pieces;
}

/** Whether the ledger has anything to list opened: in git it always has, since what isn't committed may have. */
export function opensLedger(turn: TurnItem, git: boolean) {
  return git || Boolean(turn.files?.length || turn.commands?.length || turn.commits?.length || turn.tokens > 0);
}

/** The scopes as tabs, the one shown raised, with what it compares: `git diff HEAD`, or the base branch. */
function Scopes({ scope, base }: { scope: Scope; base?: string }) {
  const says = scope === "uncommitted" ? "git diff HEAD" : scope === "branch" && base ? `vs ${base}` : "";
  return (
    <Text wrap="truncate-end">
      {SCOPES.map((one) =>
        one === scope ? (
          <Text key={one}>
            <Text color={PALETTE.raised}>▐</Text>
            <Text bold backgroundColor={PALETTE.raised} color={PALETTE.star}>
              {LABELS[one]}
            </Text>
            <Text color={PALETTE.raised}>▌</Text>{" "}
          </Text>
        ) : (
          <Text key={one} color={PALETTE.haze}>{` ${LABELS[one]}  `}</Text>
        ),
      )}
      {says ? <Text color={PALETTE.dust}>{` ${says}`}</Text> : null}
    </Text>
  );
}

/** Where each scope's tab is, for a click: its label and the cell on each side. */
function scopeSpots(turn: string): Spot[] {
  let x = OPEN_INSET;
  return SCOPES.map((one) => {
    const from = x;
    x += cellWidth(LABELS[one]) + 3;
    return { from, to: from + cellWidth(LABELS[one]) + 2, target: scopeTarget(turn, one) };
  });
}

/** `src/cache.ts   +8 −3`: the file from the project's folder, and how it changed at the edge. */
function FileLine({ file, width, cwd, home }: { file: FileChange; width: number; cwd: string; home: string }) {
  const parts: Part[] = file.from ? [{ text: `from ${shortPath(file.from, cwd, home)}  `, tone: "quiet" }] : [];
  if (file.status === "deleted") parts.push({ text: "deleted", tone: "removed" });
  else {
    if (file.status === "new") parts.push({ text: "new ", tone: "faint" });
    if (file.big) parts.push({ text: "too big to diff", tone: "quiet" });
    else if (file.binary) parts.push({ text: "binary", tone: "quiet" });
    else {
      if (file.added || file.status === "new") parts.push({ text: `+${file.added}`, tone: "added" });
      if (file.removed) parts.push({ text: `${file.added || file.status === "new" ? " " : ""}−${file.removed}`, tone: "removed" });
    }
  }
  return <Edged left={[{ text: shortPath(file.path, cwd, home), tone: "plain" }]} right={parts} width={width} path />;
}

/**
 * A file's diff under its line, in runs with `⋯ N lines` before each the diff leaves lines out
 * ahead of: its first 12 lines and its last 8, with `⋯ N more lines` between, which opens the rest,
 * unless it's `whole`. Or why there are no lines to show.
 */
function diffPieces(turn: string, file: FileChange, diff: FileDiff | undefined, whole: boolean, width: number, at: (node: ReactNode) => ReactNode): LedgerPiece[] {
  const target = fileTarget(turn, file.path);
  const say = (text: string) => [{ key: `diff:${file.path}`, target, node: at(<Text color={PALETTE.dust}>{text}</Text>) }];
  if (file.big) return say("It's over 10 MB, so astrocode didn't read it.");
  if (file.binary) return say("It's binary: there are no lines to show.");
  if (diff === undefined || diff === "reading") return say("Reading the diff…");
  if (diff === "gone" || !diff.length) return say("Its diff wasn't kept.");
  const runs = runsOf(diff);
  // One gutter for every run, so their numbers line up. A loop, not a spread: a diff can have more
  // lines than a call can take arguments.
  let last = 0;
  for (const line of diff) last = Math.max(last, line.old ?? 0, line.new ?? 0);
  const digits = String(last).length;
  const view = (key: string, shown: Run[]) => ({ key: `${key}:${file.path}`, target, node: at(<Runs runs={shown} width={width} digits={digits} path={file.path} />) });
  const hidden = whole ? 0 : diff.length - HEAD - TAIL;
  // A fold of one line would take as much room as the line.
  if (hidden <= 1) return [view("diff", runs)];
  return [
    view("head", slice(runs, 0, HEAD)),
    { key: `more:${file.path}`, target: moreTarget(turn, file.path), node: at(<Text color={PALETTE.dust}>{`   ⋯ ${plural(hidden, "more line")}`}</Text>) },
    view("tail", slice(runs, diff.length - TAIL, diff.length)),
  ];
}

type Run = ReturnType<typeof runsOf>[number];

/** The runs' lines from the `from`th to before the `to`th, in their runs, a run's gap kept where its first line is. */
function slice(runs: Run[], from: number, to: number): Run[] {
  let at = 0;
  return runs.flatMap((run) => {
    const start = at;
    at += run.lines.length;
    const lines = run.lines.slice(Math.max(0, from - start), Math.max(0, to - start));
    return lines.length ? [{ skipped: from <= start ? run.skipped : 0, lines }] : [];
  });
}

function Runs({ runs, width, digits, path }: { runs: Run[]; width: number; digits: number; path: string }) {
  return (
    <Box flexDirection="column" width={width}>
      {runs.map((run, i) => (
        <Box key={i} flexDirection="column">
          {run.skipped || i > 0 ? (
            <Box backgroundColor={PALETTE.surface} width={width}>
              <Text color={PALETTE.dust}>{`${" ".repeat(digits + 1)}   ⋯${run.skipped ? ` ${plural(run.skipped, "line")}` : ""}`}</Text>
            </Box>
          ) : null}
          <Diff lines={run.lines} width={width} limit={run.lines.length} path={path} framed={false} digits={digits} />
        </Box>
      ))}
    </Box>
  );
}

/** Parts on the left, cut to fit, and parts at the right edge. */
function Edged({ left, right, width, path = false }: { left: Part[]; right: Part[]; width: number; path?: boolean }) {
  const used = right.reduce((sum, part) => sum + cellWidth(part.text), 0);
  const room = Math.max(4, width - used - 2);
  const text = left.map((part) => part.text).join("");
  // A path keeps its end; anything else, as one part, its start.
  const shown = cellWidth(text) <= room ? left : [{ text: fit(text, room, path), tone: left[0]?.tone ?? "plain" }];
  return (
    <Box justifyContent="space-between" width={width}>
      <Text wrap="truncate-end">
        {shown.map((part, i) => (
          <Text key={i} color={TONES[part.tone]}>
            {part.text}
          </Text>
        ))}
      </Text>
      <Text>
        {right.map((part, i) => (
          <Text key={i} color={TONES[part.tone]}>
            {part.text}
          </Text>
        ))}
      </Text>
    </Box>
  );
}
