import { expect, test } from "bun:test";
import { attaches, backgroundArgs, backgroundedId, dispatch, groupAgents, parseAgentList, prLabel, summary, toAgent, type Agent } from "./agents";

const LIST = JSON.stringify([
  {
    pid: 1293784,
    id: "570eb766",
    cwd: "/home/u/Projects/printborn",
    kind: "background",
    startedAt: 1793574287266,
    sessionId: "fd422b53-52b7-48a2-8501-3ca7f9dce6cf",
    name: "#20",
    status: "idle",
    state: "done",
  },
  { id: "e345473f", cwd: "/home/u/Projects/astro-plugins/.claude/worktrees/fix-x", kind: "background", startedAt: 1793576561898, state: "stopped" },
  { pid: 1335906, cwd: "/home/u/Projects/astro-statusline", kind: "interactive", startedAt: 1793576000000 },
  { pid: 1, id: "00513814", cwd: "/home/u/Projects/astrocode", kind: "background", startedAt: 1, status: "waiting", waitingFor: "permission prompt", state: "blocked" },
]);

const agent = (fields: Partial<Agent>): Agent => ({
  id: "a",
  name: "a",
  cwd: "/p",
  folder: "/p",
  state: "done",
  alive: false,
  createdAt: 0,
  updatedAt: 0,
  prs: [],
  ...fields,
});

test("lists background sessions only, with whether each is running", () => {
  const rows = parseAgentList(LIST);
  expect(rows.map((row) => row.id)).toEqual(["570eb766", "e345473f", "00513814"]);
  expect(rows[0]).toMatchObject({ pid: 1293784, state: "done", status: "idle", name: "#20" });
  expect(rows[1]?.pid).toBeUndefined();
  expect(rows[2]).toMatchObject({ state: "blocked", waitingFor: "permission prompt" });
});

test("fills a row in from its job file: summary, result, pull requests and project", () => {
  const [row] = parseAgentList(LIST);
  const job = {
    state: "done",
    detail: "#24 zones landed",
    output: { result: "Server loads zones; 284 tests green." },
    children: [
      { id: "28", href: "https://github.com/o/r/pull/28", kind: "pr" },
      { id: "29", href: "https://github.com/o/r/pull/29", kind: "pr" },
      { id: "x", href: "https://example.com", kind: "link" },
    ],
    intent: "Let's do #6.",
    originCwd: "/home/u/Projects/printborn",
    createdAt: "2026-11-01T23:05:03.609Z",
    updatedAt: "2026-11-01T23:10:37.208Z",
  };
  const filled = toAgent(row!, job);
  expect(filled).toMatchObject({ id: "570eb766", alive: true, detail: "#24 zones landed", result: "Server loads zones; 284 tests green.", intent: "Let's do #6." });
  expect(filled.prs.map((pr) => pr.id)).toEqual(["28", "29"]);
  expect(filled.createdAt).toBe(Date.parse("2026-11-01T23:05:03.609Z"));
  expect(summary(filled)).toBe("Server loads zones; 284 tests green.");
  expect(prLabel(filled)).toBe("2 PRs");
});

test("a row whose job file is missing or changed still shows, named by its id, under its project", () => {
  const [, stopped] = parseAgentList(LIST);
  const filled = toAgent(stopped!, { output: "not an object", children: "nope" });
  expect(filled).toMatchObject({ name: "e345473f", folder: "/home/u/Projects/astro-plugins", alive: false, prs: [] });
  expect(filled.updatedAt).toBe(1793576561898);
  expect(summary(filled)).toBe("");
});

test("a running session says what it's doing; one PR is named by its number", () => {
  const working = agent({ state: "working", detail: "Running the tests", intent: "Fix the flaky test", prs: [{ id: "22", href: "h" }] });
  expect(summary(working)).toBe("Running the tests");
  expect(summary({ ...working, detail: undefined })).toBe("Fix the flaky test");
  expect(prLabel(working)).toBe("#22");
});

test("joins a session that's working or waiting on you; moves the rest into astrocode", () => {
  expect(attaches(agent({ alive: true, state: "working" }))).toBe(true);
  expect(attaches(agent({ alive: true, state: "blocked" }))).toBe(true);
  expect(attaches(agent({ alive: true, state: "done", status: "busy" }))).toBe(true);
  expect(attaches(agent({ alive: true, state: "done", status: "idle" }))).toBe(false);
  expect(attaches(agent({ alive: false, state: "working" }))).toBe(false);
  expect(attaches(agent({ state: "stopped" }))).toBe(false);
});

test("groups by project, this one first and the rest by path, each oldest first", () => {
  const groups = groupAgents(
    [
      agent({ id: "1", folder: "/p/zeta", createdAt: 3 }),
      agent({ id: "2", folder: "/p/here", createdAt: 5 }),
      agent({ id: "3", folder: "/p/alpha", createdAt: 1 }),
      agent({ id: "4", folder: "/p/here", createdAt: 2 }),
    ],
    "/p/here/.claude/worktrees/feat-x",
  );
  expect(groups.map((group) => [group.folder, group.agents.map((one) => one.id)])).toEqual([
    ["/p/here", ["4", "2"]],
    ["/p/alpha", ["3"]],
    ["/p/zeta", ["1"]],
  ]);
});

test("hands a conversation back to its own background session as it was, and gives a new one this one's settings", () => {
  const settings = { model: "haiku", effort: "high", mode: "bypassPermissions" } as const;
  // Flags on a conversation that has a background session start a copy of it instead.
  expect(backgroundArgs("c84fd2af-97bc", settings, [agent({ sessionId: "c84fd2af-97bc" })])).toEqual(["--bg", "--resume", "c84fd2af-97bc"]);
  expect(backgroundArgs("d31b5a7e-7944", settings, [agent({ sessionId: "c84fd2af-97bc" })])).toEqual([
    "--bg",
    "--resume",
    "d31b5a7e-7944",
    "--model",
    "haiku",
    "--effort",
    "high",
    "--permission-mode",
    "bypassPermissions",
  ]);
});

test("reads the id claude --bg prints", () => {
  expect(backgroundedId("backgrounded · 8c2ad407 · astrocode-bgtest\n  claude agents   list sessions")).toBe("8c2ad407");
  expect(backgroundedId("note: woke session 8c2ad407 with its saved options (--name, --model).\nbackgrounded · 8c2ad407 · x (idle — send a prompt to start)")).toBe("8c2ad407");
  expect(backgroundedId("Error: something")).toBeUndefined();
});

test("won't start a session in a folder that's gone", async () => {
  await expect(dispatch("task", "/nonexistent/astrocode-gone", {})).rejects.toThrow("/nonexistent/astrocode-gone is gone");
});
