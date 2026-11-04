import { expect, test } from "bun:test";
import type { Agent } from "../src/agents";
import { initialState } from "../src/view/state";
import { Background, Fleet, liveState, moveAll, needsYou } from "./fleet";
import { Store } from "./store";

const conversation = (key: string, task: string, knownId?: string) => {
  const store = new Store("/nonexistent/astrocode-fleet", "/nonexistent");
  store.emit({ kind: "prompt", text: task });
  return { key, store, session: { knownId }, cwd: "/nonexistent/astrocode-fleet" };
};

/** Lets the stores tell their listeners, which they do once for a run of events. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("says where each conversation went as astrocode quits, and how to resume one the background service refused", async () => {
  const said = await moveAll([conversation("a", "fix the build", "id-a"), conversation("b", "add the tests", "id-b"), conversation("c", "")], async (one) => {
    if (one.key === "b") throw new Error("Workspace not trusted.");
    return one.key === "a" ? "7c5dcf5d" : undefined;
  });
  expect(said).toEqual([
    "“fix the build” carries on in the background as 7c5dcf5d: claude attach 7c5dcf5d, or astrocode agents.",
    "“add the tests” couldn't move to the background (Workspace not trusted.), so it ended here: astrocode --resume id-b",
  ]);
});

test("a conversation can move to the background only while nothing runs or waits in it", () => {
  const idle = initialState("/p", "/home/u");
  expect(liveState(idle, 0)).toBe("idle");
  expect(liveState({ ...idle, busy: true }, 0)).toBe("working");
  expect(liveState({ ...idle, tasks: [{ id: "t" } as (typeof idle.tasks)[number]] }, 0)).toBe("working");
  expect(liveState(idle, 1)).toBe("working");
  expect(liveState({ ...idle, busy: true, pending: [{ id: "p" } as (typeof idle.pending)[number]] }, 0)).toBe("blocked");
  expect(liveState({ ...idle, questions: [{ id: "q" } as (typeof idle.questions)[number]] }, 0)).toBe("blocked");
});

test("counts the other conversations that wait on you, not the one on screen or those only working", () => {
  const fleet = new Fleet();
  const shown = fleet.add(conversation("a", "fix the build"));
  const asking = fleet.add(conversation("b", "add the tests"));
  const questioning = fleet.add(conversation("c", "tidy the README"));
  const working = fleet.add(conversation("d", "bump the deps"));
  expect(needsYou(fleet.getSnapshot(), shown.store)).toBe(0);
  asking.store.emit({ kind: "permission", request: { id: "p1", toolName: "Bash", input: { command: "rm -rf dist" } } });
  questioning.store.emit({ kind: "question", request: { id: "q1", questions: [] } });
  shown.store.emit({ kind: "permission", request: { id: "p2", toolName: "Edit", input: {} } });
  working.store.shells.set("s1", new AbortController());
  expect(needsYou(fleet.getSnapshot(), shown.store)).toBe(2);
  asking.store.emit({ kind: "resolved", id: "p1", outcome: "allow" });
  expect(needsYou(fleet.getSnapshot(), shown.store)).toBe(1);
});

test("hears every conversation in the fleet, those that join later too, until it stops listening", async () => {
  const fleet = new Fleet();
  const first = fleet.add(conversation("a", "fix the build"));
  const later = conversation("b", "add the tests");
  await settle();
  let heard = 0;
  const stop = fleet.watch(() => (heard += 1));
  first.store.emit({ kind: "prompt", text: "and the lint" });
  await settle();
  expect(heard).toBe(1);
  fleet.add(later);
  expect(heard).toBe(2);
  later.store.emit({ kind: "permission", request: { id: "p", toolName: "Bash", input: {} } });
  await settle();
  expect(heard).toBe(3);
  fleet.remove(later);
  expect(heard).toBe(4);
  later.store.emit({ kind: "resolved", id: "p", outcome: "allow" });
  await settle();
  expect(heard).toBe(4);
  stop();
  first.store.emit({ kind: "prompt", text: "and the docs" });
  fleet.add(later);
  await settle();
  expect(heard).toBe(4);
});

/** A background session as `claude agents --json` lists it. */
const agent = (id: string, more: Partial<Agent>): Agent => ({ id, name: id, cwd: "/p", folder: "/p", state: "working", alive: true, createdAt: 0, updatedAt: 0, prs: [], ...more });

test("counts Claude Code's background sessions waiting on you too, but not one only waiting for a prompt or one of astrocode's own", () => {
  const fleet = new Fleet();
  const shown = fleet.add(conversation("a", "fix the build", "id-a"));
  fleet.add(conversation("b", "add the tests", "id-b"));
  const agents = [
    agent("asking", { state: "blocked", status: "waiting", sessionId: "id-x" }),
    agent("handed", { state: "blocked", status: "idle", sessionId: "id-y" }),
    agent("busy", { state: "working", status: "busy" }),
    // Moved into astrocode, it's still listed there: its own row stands for it.
    agent("moved", { state: "blocked", status: "waiting", sessionId: "id-b" }),
    agent("this", { state: "blocked", status: "waiting", sessionId: "id-a" }),
  ];
  expect(needsYou(fleet.getSnapshot(), shown.store, agents)).toBe(1);
});

test("reads the background sessions at once and then again while anything listens, and stops when nothing does", async () => {
  let reads = 0;
  const waiting = [agent("asking", { state: "blocked", status: "waiting" })];
  const background = new Background(async () => (reads += 1, waiting), 20);
  expect(background.getSnapshot()).toEqual([]);
  let heard = 0;
  const stop = background.subscribe(() => (heard += 1));
  const also = background.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(background.getSnapshot()).toEqual(waiting);
  expect(heard).toBeGreaterThanOrEqual(2);
  stop();
  also();
  const after = reads;
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(reads).toBe(after);
  // A `claude` that can't list them has none waiting.
  const failing = new Background(() => Promise.reject(new Error("no claude")), 20);
  const quiet = failing.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  quiet();
  expect(failing.getSnapshot()).toEqual([]);
});
