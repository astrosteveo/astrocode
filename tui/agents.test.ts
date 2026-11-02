import { expect, test } from "bun:test";
import type { Agent } from "../src/agents";
import { initialState } from "../src/view/state";
import { hereState, listLines } from "./agents";

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
