import { expect, test } from "bun:test";
import type { Agent } from "../src/agents";
import { initialState } from "../src/view/state";
import { chosenLine, listLines, mineState, mineSummary, moveTo, saying, startFolder } from "./agents";
import { PALETTE } from "./theme";

const agent = (id: string, folder: string, createdAt = 0): Agent => ({
  id,
  name: id,
  cwd: folder,
  folder,
  state: "done",
  alive: false,
  createdAt,
  updatedAt: 0,
  prs: [],
});

const describe = (lines: ReturnType<typeof listLines>) =>
  lines.map((line) => (line.kind === "folder" ? `# ${line.folder}` : line.kind === "agent" ? line.agent.id : line.kind === "mine" ? line.key : line.kind));

test("puts astrocode's conversations first under their projects, worktree or not", () => {
  const lines = listLines([agent("b", "/p/other"), agent("a", "/p/here")], [{ key: "here", cwd: "/p/here/.claude/worktrees/feat-x" }], "/p/here");
  expect(describe(lines)).toEqual(["# /p/here", "here", "a", "gap", "# /p/other", "b"]);
});

test("gives a conversation in astrocode a heading of its own when nothing else ran in its project", () => {
  const lines = listLines([agent("b", "/p/other")], [{ key: "here", cwd: "/p/new" }], "/p/new");
  expect(describe(lines)).toEqual(["# /p/new", "here", "gap", "# /p/other", "b"]);
});

test("lists every conversation astrocode runs, in the order they started, each under its project", () => {
  const mine = [
    { key: "m1", cwd: "/p/here" },
    { key: "m2", cwd: "/p/far" },
    { key: "m3", cwd: "/p/here" },
  ];
  expect(describe(listLines([agent("a", "/p/here"), agent("b", "/p/other")], mine, "/p/here"))).toEqual([
    "# /p/here",
    "m1",
    "m3",
    "a",
    "gap",
    "# /p/far",
    "m2",
    "gap",
    "# /p/other",
    "b",
  ]);
});

test("lists background sessions alone when no conversation is open, this folder's first", () => {
  expect(describe(listLines([agent("b", "/p/b"), agent("a", "/p/a"), agent("c", "/p/c")], [], "/p/c"))).toEqual([
    "# /p/c",
    "c",
    "gap",
    "# /p/a",
    "a",
    "gap",
    "# /p/b",
    "b",
  ]);
  expect(listLines([], [], "/p")).toEqual([]);
});

test("a conversation's row says what Claude is doing, or once it's done, how its last turn went", () => {
  const fresh = initialState("/p", "/home/u");
  expect(mineState(fresh, 0)).toBe("idle");
  expect(mineSummary(fresh, 0)).toBe("");
  const asked = { ...fresh, busy: true, items: [{ kind: "prompt" as const, key: "1", text: "fix the build" }] };
  expect(mineState(asked, 0)).toBe("working");
  expect(mineSummary(asked, 0)).toBe("");
  const turn = (outcome: "finished" | "stopped" | "failed", detail?: string) => ({ kind: "turn" as const, key: "3", outcome, durationMs: 1, tokens: 1, detail });
  const done = { ...asked, busy: false, items: [...asked.items, { kind: "text" as const, key: "2", text: "\n## **Fixed** the `build`\n\nMore." }, turn("finished")] };
  expect(mineState(done, 0)).toBe("done");
  expect(mineSummary(done, 0)).toBe("Fixed the build");
  const failed = { ...done, items: [...asked.items, turn("failed", "overloaded")] };
  expect(mineState(failed, 0)).toBe("failed");
  expect(mineSummary(failed, 0)).toBe("overloaded");
  expect(mineState({ ...done, items: [...asked.items, turn("stopped")] }, 0)).toBe("stopped");
  expect(mineState({ ...done, pending: [{ id: "p" } as (typeof done.pending)[number]] }, 0)).toBe("blocked");
  expect(mineSummary({ ...done, pending: [{ id: "p", toolName: "Bash", input: { command: "rm -rf dist" } }] }, 0)).toBe("Run $ rm -rf dist");
});

test("a new session starts in the selected row's project", () => {
  const lines = listLines([agent("b", "/p/other"), agent("a", "/p/here")], [{ key: "here", cwd: "/p/here" }], "/p/here");
  const at = (key: string) => lines.find((line) => (line.kind === "agent" ? line.agent.id : line.kind === "mine" ? line.key : line.kind) === key);
  expect(startFolder(at("b"), "/p/here")).toBe("/p/other");
  expect(startFolder(at("a"), "/p/here")).toBe("/p/here");
  expect(startFolder(at("here"), "/p/here")).toBe("/p/here");
});

test("in the project astrocode runs in, a new session starts in its own folder, worktree or subfolder", () => {
  const worktree = "/p/here/.claude/worktrees/feat-x";
  const lines = listLines([agent("a", "/p/here")], [{ key: "here", cwd: worktree }], worktree);
  expect(startFolder(lines.find((line) => line.kind === "mine"), worktree)).toBe(worktree);
  expect(startFolder(lines.find((line) => line.kind === "agent"), worktree)).toBe(worktree);
  expect(startFolder(undefined, "/p/here/src")).toBe("/p/here/src");
});

test("↑↓ move a session at a time, or a project at a time to its first row, and stop at the ends", () => {
  const lines = listLines([agent("a1", "/p/a"), agent("a2", "/p/a"), agent("b1", "/p/b"), agent("c1", "/p/c")], [{ key: "here", cwd: "/p/a" }], "/p/a");
  expect(moveTo(lines, "here", 1, false)).toBe("a1");
  expect(moveTo(lines, "a2", 1, false)).toBe("b1");
  expect(moveTo(lines, "here", -1, false)).toBe("here");
  expect(moveTo(lines, "here", 1, true)).toBe("b1");
  expect(moveTo(lines, "a2", 1, true)).toBe("b1");
  expect(moveTo(lines, "b1", 1, true)).toBe("c1");
  expect(moveTo(lines, "c1", 1, true)).toBe("c1");
  expect(moveTo(lines, "c1", -1, true)).toBe("b1");
  expect(moveTo(lines, "b1", -1, true)).toBe("here");
  expect(moveTo([], undefined, 1, true)).toBeUndefined();
});

test("the chosen row is drawn as chosen, or while a task is typed, its project's heading", () => {
  const lines = listLines([agent("a1", "/p/a"), agent("a2", "/p/a"), agent("b1", "/p/b")], [], "/p/a");
  const at = (key: string) => lines.findIndex((line) => (line.kind === "folder" ? `# ${line.folder}` : line.kind === "agent" ? line.agent.id : line.kind) === key);
  expect(chosenLine(lines, "a2", false)).toBe(at("a2"));
  expect(chosenLine(lines, "a2", true)).toBe(at("# /p/a"));
  expect(chosenLine(lines, "b1", true)).toBe(at("# /p/b"));
  expect(chosenLine([], undefined, true)).toBe(-1);
});

test("a conversation waiting on you says what it asks: Claude's question, the MCP server's form, or the call it wants to make", () => {
  const fresh = initialState("/p", "/home/u");
  const question = { id: "q", questions: [{ question: "Tea or coffee?", header: "Drink", multiSelect: false, options: [] }] };
  expect(mineSummary({ ...fresh, questions: [question] }, 0)).toBe("Tea or coffee?");
  expect(mineSummary({ ...fresh, elicitations: [{ id: "e", server: "github", message: "Pick a repository", mode: "form", fields: [] }] }, 0)).toBe("Pick a repository");
  expect(mineSummary({ ...fresh, pending: [{ id: "p", toolName: "Edit", input: { file_path: "/p/src/a.ts" } }] }, 0)).toBe("Edit src/a.ts");
});

test("a row's words take the Ledger's colors: a gold asks: before what waits on you, and what runs or failed up to the first ·", () => {
  const { gold, haze, teal, rose } = PALETTE;
  expect(saying("blocked", "Tea or coffee?", 22)).toEqual([
    { text: "asks:", color: gold },
    { text: " Tea or coffee?  ", color: haze },
  ]);
  expect(saying("working", "Running Bash · bun test", 23)).toEqual([
    { text: "Running Bash", color: teal },
    { text: " · bun test", color: haze },
  ]);
  expect(saying("working", "Thinking", 10)).toEqual([
    { text: "Thinking", color: teal },
    { text: "  ", color: haze },
  ]);
  expect(saying("failed", "tools/live.sh exit 2 · zone 3 missing", 24)).toEqual([
    { text: "tools/live.sh exit 2", color: rose },
    { text: " · …", color: haze },
  ]);
  expect(saying("done", "replied with a table", 20)).toEqual([{ text: "replied with a table", color: haze }]);
  // Nothing asked yet says nothing, not a bare `asks:`.
  expect(saying("blocked", "", 4)).toEqual([{ text: "    ", color: haze }]);
});
