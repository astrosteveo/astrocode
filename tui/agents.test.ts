import { expect, test } from "bun:test";
import type { Agent } from "../src/agents";
import { initialState } from "../src/view/state";
import { chosenLine, hereState, listLines, moveTo, startFolder } from "./agents";

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
  lines.map((line) => (line.kind === "folder" ? `# ${line.folder}` : line.kind === "agent" ? line.agent.id : line.kind));

test("puts the session open here first under its project, worktree or not", () => {
  const lines = listLines([agent("b", "/p/other"), agent("a", "/p/here")], { cwd: "/p/here/.claude/worktrees/feat-x", folder: "/p/here" }, "/p/here");
  expect(describe(lines)).toEqual(["# /p/here", "here", "a", "gap", "# /p/other", "b"]);
});

test("gives the session open here a heading of its own when nothing else ran in its project", () => {
  const lines = listLines([agent("b", "/p/other")], { cwd: "/p/new", folder: "/p/new" }, "/p/new");
  expect(describe(lines)).toEqual(["# /p/new", "here", "gap", "# /p/other", "b"]);
});

test("lists background sessions alone when no conversation is open, this folder's first", () => {
  expect(describe(listLines([agent("b", "/p/b"), agent("a", "/p/a"), agent("c", "/p/c")], null, "/p/c"))).toEqual([
    "# /p/c",
    "c",
    "gap",
    "# /p/a",
    "a",
    "gap",
    "# /p/b",
    "b",
  ]);
  expect(listLines([], null, "/p")).toEqual([]);
});

test("the open session can move to the background only while nothing runs or waits in it", () => {
  const idle = initialState("/p", "/home/u");
  expect(hereState(idle, 0)).toBe("idle");
  expect(hereState({ ...idle, busy: true }, 0)).toBe("working");
  expect(hereState({ ...idle, tasks: [{ id: "t" } as (typeof idle.tasks)[number]] }, 0)).toBe("working");
  expect(hereState(idle, 1)).toBe("working");
  expect(hereState({ ...idle, busy: true, pending: [{ id: "p" } as (typeof idle.pending)[number]] }, 0)).toBe("blocked");
  expect(hereState({ ...idle, questions: [{ id: "q" } as (typeof idle.questions)[number]] }, 0)).toBe("blocked");
});

test("a new session starts in the selected row's project", () => {
  const lines = listLines([agent("b", "/p/other"), agent("a", "/p/here")], { cwd: "/p/here", folder: "/p/here" }, "/p/here");
  const at = (key: string) => lines.find((line) => (line.kind === "agent" ? line.agent.id : line.kind) === key);
  expect(startFolder(at("b"), "/p/here")).toBe("/p/other");
  expect(startFolder(at("a"), "/p/here")).toBe("/p/here");
  expect(startFolder(at("here"), "/p/here")).toBe("/p/here");
});

test("in the project astrocode runs in, a new session starts in its own folder, worktree or subfolder", () => {
  const worktree = "/p/here/.claude/worktrees/feat-x";
  const lines = listLines([agent("a", "/p/here")], { cwd: worktree, folder: "/p/here" }, worktree);
  expect(startFolder(lines.find((line) => line.kind === "here"), worktree)).toBe(worktree);
  expect(startFolder(lines.find((line) => line.kind === "agent"), worktree)).toBe(worktree);
  expect(startFolder(undefined, "/p/here/src")).toBe("/p/here/src");
});

test("↑↓ move a session at a time, or a project at a time to its first row, and stop at the ends", () => {
  const lines = listLines([agent("a1", "/p/a"), agent("a2", "/p/a"), agent("b1", "/p/b"), agent("c1", "/p/c")], { cwd: "/p/a", folder: "/p/a" }, "/p/a");
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
  const lines = listLines([agent("a1", "/p/a"), agent("a2", "/p/a"), agent("b1", "/p/b")], null, "/p/a");
  const at = (key: string) => lines.findIndex((line) => (line.kind === "folder" ? `# ${line.folder}` : line.kind === "agent" ? line.agent.id : line.kind) === key);
  expect(chosenLine(lines, "a2", false)).toBe(at("a2"));
  expect(chosenLine(lines, "a2", true)).toBe(at("# /p/a"));
  expect(chosenLine(lines, "b1", true)).toBe(at("# /p/b"));
  expect(chosenLine([], undefined, true)).toBe(-1);
});
