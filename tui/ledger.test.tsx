import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { FileChange } from "../src/events";
import { patchLines } from "../src/view/patch";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { DEFAULT_KEYMAP } from "./keys";
import { fileTarget, moreTarget, opensLedger, scopeTarget, type Listed, type TurnItem } from "./ledger";
import { cellWidth } from "./markdown";
import { edgeOf } from "./measure";
import { diffKey, NO_REVIEW, turnDiff, type Review } from "./review";
import { startOf } from "./start";
import { layout, type Transcript } from "./transcript";

const CACHE = "@@ -3,3 +3,3 @@\n const a = 1;\n-  if (Date.now() > entry.expires) {\n+  if (this.clock.now() > entry.expires) {\n }\n@@ -20,1 +20,2 @@\n x\n+y\n";

/** A turn that wrote a file, edited another and ran the tests, as git counted it. */
function ended(files: FileChange[] = [
  { path: "/p/src/clock.ts", added: 11, removed: 0, status: "new" },
  { path: "/p/src/cache.ts", added: 2, removed: 1 },
]): State {
  const items: Item[] = [
    { kind: "prompt", key: "p", text: "give the cache a clock", starts: true },
    { kind: "tool", key: "b", call: { id: "b", name: "Bash", input: { command: "bun test", description: "Run the tests" }, status: "error", subagentCalls: 0, result: "Exit code 1\n 7 pass\n 1 fail\nRan 8 tests across 1 file." } },
    { kind: "text", key: "t", text: "The cache takes a clock now." },
    { kind: "turn", key: "end", outcome: "finished", durationMs: 100_000, tokens: 2900, files, commands: ["bun test"], commits: ["f535656"], trees: { from: "a", to: "b" } },
  ];
  return { ...initialState("/p", "/home/u"), items, tools: { b: 1 } };
}

const plain = (transcript: Transcript) => transcript.rows.map((row) => stripVTControlCharacters(row.text));
const draw = (state: State, width: number, { open = [] as string[], review = NO_REVIEW as Review } = {}) =>
  layout({ state, width, pictureRows: 10, start: startOf(state, undefined, DEFAULT_KEYMAP), expanded: new Set(["end", ...open]), waiting: new Set(), review });
const withDiff = (review: Partial<Review> = {}): Review => ({ ...NO_REVIEW, diffs: new Map([[diffKey("turn", "end", "/p/src/cache.ts"), patchLines(CACHE)]]), ...review });

test("opens under its closing line at every width: each file and how it changed, then the commands, commits and tokens", () => {
  for (const width of [78, 118, 198]) {
    const transcript = draw(ended(), width);
    const lines = plain(transcript);
    const at = lines.findIndex((line) => line.includes("1m 40s · 2 files +13 −1"));
    expect(lines.slice(at + 1).map((line) => line.trim().split(/\s{2,}/))).toEqual([
      ["src/clock.ts", "new +11"],
      ["src/cache.ts", "+2 −1"],
      ["bun test", "✕ exit 1 · 7 passed, 1 failed"],
      ["committed f535656"],
      ["2.9k tokens"],
    ]);
    // In place under the line, from column 4, each result at the edge.
    for (const line of lines.slice(at + 1)) expect(line).toMatch(/^ {4}\S/);
    expect(cellWidth(lines[at + 1]!.trimEnd())).toBe(width);
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(width);
    // A file opens its diff; the rest closes the ledger.
    const rows = transcript.rows.slice(at + 1);
    expect(rows.map((row) => row.head)).toEqual([true, true, false, false, false]);
    expect(rows.map((row) => row.target)).toEqual([fileTarget("end", "/p/src/clock.ts"), fileTarget("end", "/p/src/cache.ts"), "end", "end", "end"]);
  }
});

test("a file's diff opens under its line, unified at every width, as it keeps to the measure, with the lines it leaves out counted", () => {
  for (const columns of [80, 120, 200]) {
    const width = edgeOf(columns);
    const transcript = draw(ended(), width, { open: [fileTarget("end", "/p/src/cache.ts")], review: withDiff() });
    const lines = plain(transcript);
    const file = lines.findIndex((line) => line.includes("src/cache.ts"));
    const diff = lines.slice(file + 1, lines.findIndex((line) => line.includes("bun test")));
    expect(diff[0]).toMatch(/^ {4}\s*⋯ 2 lines/);
    expect(diff.some((line) => /⋯ 14 lines/.test(line))).toBe(true);
    // Numbered, the removed line by the old file and the added one by the new, in one gutter for every run.
    expect(diff.some((line) => line.includes("│"))).toBe(false);
    expect(diff.find((line) => line.includes("Date.now()"))).toMatch(/^ {4} 4  - +if \(Date\.now\(\)/);
    expect(diff.find((line) => line.includes("this.clock.now()"))).toMatch(/^ {4} 4  \+ +if \(this\.clock\.now\(\)/);
    expect(diff.find((line) => line.endsWith("y") || /\+ y\s*$/.test(line))).toMatch(/^ {4}21  \+ y/);
    // Enter in the diff closes it: it goes by its file.
    expect(transcript.rows[file + 2]).toMatchObject({ target: fileTarget("end", "/p/src/cache.ts"), head: false, open: true });
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(width);
  }
  // While it's read, and once its trees are gone, it says so.
  expect(plain(draw(ended(), 118, { open: [fileTarget("end", "/p/src/cache.ts")] }))).toContainEqual(expect.stringContaining("Reading the diff…"));
  const gone = withDiff({ diffs: new Map([[diffKey("turn", "end", "/p/src/cache.ts"), "gone"]]) });
  expect(plain(draw(ended(), 118, { open: [fileTarget("end", "/p/src/cache.ts")], review: gone }))).toContainEqual(expect.stringContaining("Its diff wasn't kept."));
});

test("a long diff shows its first 12 lines and last 8, and the line between opens the rest", () => {
  const big = Array.from({ length: 3000 }, (_, i) => ({ kind: "added" as const, text: `line ${i + 1}`, new: i + 1 }));
  const state = ended([{ path: "/p/big.ts", added: 3000, removed: 0, status: "new" }]);
  const review = { ...NO_REVIEW, diffs: new Map([[diffKey("turn", "end", "/p/big.ts"), big]]) };
  const folded = draw(state, 118, { open: [fileTarget("end", "/p/big.ts")], review });
  const lines = plain(folded);
  const more = lines.findIndex((line) => line.includes("⋯ 2980 more lines"));
  expect(lines.slice(more - 12, more).map((line) => line.trim())).toEqual(Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(4)}  + line ${i + 1}`.trim()));
  expect(lines[more + 1]).toContain("2993  + line 2993");
  expect(lines[more + 8]).toContain("3000  + line 3000");
  expect(lines.length).toBeLessThan(60);
  // It opens the rest; it doesn't close the diff, which the lines around it do.
  expect(folded.rows[more]).toMatchObject({ target: moreTarget("end", "/p/big.ts"), head: false, open: true });
  expect(folded.rows[more - 1]!.target).toBe(fileTarget("end", "/p/big.ts"));
  const whole = plain(draw(state, 118, { open: [fileTarget("end", "/p/big.ts"), moreTarget("end", "/p/big.ts")], review }));
  expect(whole.some((line) => line.includes("more lines"))).toBe(false);
  expect(whole.some((line) => line.includes("line 1500"))).toBe(true);
});

test("says a file is new, deleted, renamed, binary or too big to diff", () => {
  const files: FileChange[] = [
    { path: "/p/a.ts", added: 3, removed: 0, status: "new" },
    { path: "/p/b.ts", added: 0, removed: 9, status: "deleted" },
    { path: "/p/src/c.ts", added: 1, removed: 0, from: "/p/c.ts" },
    { path: "/p/logo.png", added: 0, removed: 0, binary: true },
    { path: "/p/data.csv", added: 0, removed: 0, status: "new", big: true },
  ];
  const lines = plain(draw(ended(files), 118)).map((line) => line.trim().split(/\s{2,}/));
  expect(lines).toContainEqual(["a.ts", "new +3"]);
  expect(lines).toContainEqual(["b.ts", "deleted"]);
  expect(lines).toContainEqual(["src/c.ts", "from c.ts", "+1"]);
  expect(lines).toContainEqual(["logo.png", "binary"]);
  expect(lines).toContainEqual(["data.csv", "new too big to diff"]);
  // Opened, those have no lines to show, and say why.
  const opened = plain(draw(ended(files), 118, { open: files.map((file) => fileTarget("end", file.path)) }));
  expect(opened).toContainEqual(expect.stringContaining("It's binary: there are no lines to show."));
  expect(opened).toContainEqual(expect.stringContaining("It's over 10 MB, so astrocode didn't read it."));
});

test("in git it offers the turn, what isn't committed and the branch, each tab where a click picks it", () => {
  const transcript = draw(ended(), 118, { review: { ...NO_REVIEW, git: true } });
  const at = transcript.rows.findIndex((row) => row.spots);
  const tabs = transcript.rows[at]!;
  expect(stripVTControlCharacters(tabs.text).trim()).toBe("▐this turn▌  uncommitted   branch");
  const cells = (from: number, to: number) => [...stripVTControlCharacters(tabs.text)].slice(from, to).join("").trim();
  expect(tabs.spots!.map((spot) => [cells(spot.from, spot.to), spot.target])).toEqual([
    ["▐this turn▌", scopeTarget("end", "turn")],
    ["uncommitted", scopeTarget("end", "uncommitted")],
    ["branch", scopeTarget("end", "branch")],
  ]);
  // Outside git there's only the turn.
  expect(plain(draw(ended(), 118)).some((line) => line.includes("uncommitted"))).toBe(false);
});

test("another scope lists what git says, without the turn's commands, and says when there's nothing to compare with, or git failed or took too long", () => {
  const scoped = (scope: "uncommitted" | "branch", listed: Listed) => plain(draw(ended(), 118, { review: { ...NO_REVIEW, git: true, scopes: new Map([["end", scope]]), lists: new Map([[scope, listed]]) } }));
  const uncommitted = scoped("uncommitted", { files: [{ path: "/p/notes.md", added: 4, removed: 0, status: "new" }], trees: { from: "h", to: "w" } });
  expect(uncommitted).toContainEqual(expect.stringContaining("this turn  ▐uncommitted▌  branch   git diff HEAD"));
  expect(uncommitted.map((line) => line.trim().split(/\s{2,}/))).toContainEqual(["notes.md", "new +4"]);
  expect(uncommitted.some((line) => line.includes("bun test") || line.includes("tokens"))).toBe(false);
  expect(scoped("branch", { files: [], base: "main" })).toContainEqual(expect.stringContaining("vs main"));
  expect(scoped("branch", { files: [], base: "main" })).toContainEqual(expect.stringContaining("No changes yet"));
  expect(scoped("branch", "no base")).toContainEqual(expect.stringContaining("There's no main or master branch to compare with."));
  expect(scoped("branch", "failed")).toContainEqual(expect.stringContaining("Git couldn't say what changed."));
  expect(scoped("branch", "slow")).toContainEqual(expect.stringContaining("Git took too long to say what changed."));
  expect(scoped("uncommitted", "reading")).toContainEqual(expect.stringContaining("Reading what changed…"));
});

test("opens a turn that did anything, or any turn in git, where what isn't committed may have changed", () => {
  const turn = (more: Partial<TurnItem> = {}): TurnItem => ({ kind: "turn", key: "t", outcome: "finished", durationMs: 6000, tokens: 0, ...more });
  expect(opensLedger(turn({ tokens: 1200 }), false)).toBe(true);
  expect(opensLedger(turn({ commands: ["ls"] }), false)).toBe(true);
  expect(opensLedger(turn(), false)).toBe(false);
  expect(opensLedger(turn(), true)).toBe(true);
});

test("opens the diff of a file of a million lines and more, folded", () => {
  // Past what a call's arguments can hold, so nothing may spread the lines into one.
  const count = 1_200_000;
  const huge = Array.from({ length: count }, (_, i) => ({ kind: "added" as const, text: String(i + 1), new: i + 1 }));
  const state = ended([{ path: "/p/nums.txt", added: count, removed: 0, status: "new" }]);
  const review = { ...NO_REVIEW, diffs: new Map([[diffKey("turn", "end", "/p/nums.txt"), huge]]) };
  const lines = plain(draw(state, 118, { open: [fileTarget("end", "/p/nums.txt")], review }));
  const more = lines.findIndex((line) => line.includes(`⋯ ${count - 20} more lines`));
  expect(more).toBeGreaterThan(-1);
  // One gutter, as wide as the last line's number.
  expect(lines[more - 12]).toMatch(/^ {4} {6}1  \+ 1/);
  expect(lines[more + 8]).toContain("1200000  + 1200000");
});

test("a diff made of edits, the second above the first, keeps each in a run of its own", async () => {
  // Outside git, or for a resumed turn, the diff comes from the turn's edits, in the order Claude made them.
  const edit = (id: string, at: number, text: string): ToolCall => ({
    id,
    name: "Edit",
    input: { file_path: "/p/a.ts", old_string: `${text} old`, new_string: `${text} new` },
    status: "done",
    subagentCalls: 0,
    output: { structuredPatch: [{ oldStart: at, oldLines: 3, newStart: at, newLines: 3, lines: [` before ${at}`, `-${text} old`, `+${text} new`, ` after ${at}`] }] },
  });
  const state = ended([{ path: "/p/a.ts", added: 2, removed: 2 }]);
  const turn = state.items.at(-1) as TurnItem;
  const none = { changes: async () => null, patch: async () => null };
  const diff = await turnDiff(none, { ...turn, trees: undefined }, turn.files![0]!, [edit("1", 200, "far"), edit("2", 10, "near")]);
  const review = { ...NO_REVIEW, diffs: new Map([[diffKey("turn", "end", "/p/a.ts"), diff]]) };
  const lines = plain(draw(state, 118, { open: [fileTarget("end", "/p/a.ts")], review })).map((line) => line.trimEnd());
  const far = lines.findIndex((line) => line.includes("after 200"));
  expect(lines[far]).toMatch(/^ {4}202 {4}after 200/);
  // Not joined on to it, as though it followed: a line apart, numbered again from where it is.
  expect(lines[far + 1]).toMatch(/^ {4} +⋯$/);
  expect(lines[far + 2]).toMatch(/^ {4} 10 {4}before 10/);
  expect(lines[far + 3]).toMatch(/^ {4} 11  - near old/);
});

test("a file renamed with no line changed says so, rather than that its diff wasn't kept", async () => {
  const file: FileChange = { path: "/p/kept.txt", added: 0, removed: 0, from: "/p/old.txt" };
  const state = ended([file]);
  const turn = state.items.at(-1) as TurnItem;
  // What git prints for a rename alone: its headers, and no hunk.
  const git = { changes: async () => null, patch: async () => "diff --git a/old.txt b/kept.txt\nsimilarity index 100%\nrename from old.txt\nrename to kept.txt\n" };
  const review = { ...NO_REVIEW, diffs: new Map([[diffKey("turn", "end", "/p/kept.txt"), await turnDiff(git, turn, file, [])]]) };
  const lines = plain(draw(state, 118, { open: [fileTarget("end", "/p/kept.txt")], review }));
  expect(lines).toContainEqual(expect.stringContaining("No lines changed."));
  expect(lines.some((line) => line.includes("wasn't kept"))).toBe(false);
});
