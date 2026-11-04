import { afterEach, expect, mock, test } from "bun:test";
import * as sdk from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "./events";
import { AsyncQueue } from "./queue";

/** What a stand-in Claude Code was sent, in order: each message's text, and each control request. */
let sent: unknown[] = [];
/** The options each stand-in Claude Code was started with. */
let started: Record<string, unknown>[] = [];
/** How the stand-in answers a message, when a test has it work: what it says goes to `out`. */
let answer: ((message: SDKUserMessage, out: AsyncQueue<unknown>) => void) | undefined;
/** What the stand-in last started says, for a turn it starts by itself. */
let said: AsyncQueue<unknown> | undefined;

// A stand-in Claude Code, in place of the SDK's query: it queues every message, as Claude Code does
// while Claude works, and keeps what it was sent. It never finishes starting, so it's asked nothing else.
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  ...sdk,
  query: ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Record<string, unknown> }) => {
    started.push(options);
    const out = new AsyncQueue<unknown>();
    const close = out.close.bind(out);
    said = out;
    void (async () => {
      for await (const message of prompt) {
        sent.push(message.message.content);
        if (answer) answer(message, out);
        else out.push({ type: "command_lifecycle", command_uuid: message.uuid, state: "queued" });
      }
    })();
    return Object.assign(out, {
      request: async (body: Record<string, unknown>) => {
        sent.push(body);
        return { response: { still_queued: [], send_now: "stopped" } };
      },
      initializationResult: () => new Promise(() => {}),
      // The queue's own close: this one takes its place on the object.
      close,
    });
  },
}));

const { AgentSession } = await import("./session");

const session = () => {
  sent = [];
  answer = undefined;
  return new AgentSession({ cwd: "/tmp", emit: () => {} });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a message sent now goes, then what's queued goes now, once Claude Code has queued it", async () => {
  session().send("this instead", new Map(), { now: true });
  await settle();
  expect(sent).toEqual(["this instead", { subtype: "interrupt", send_now: true }]);
});

test("a message sent as usual waits in the queue", async () => {
  session().send("after that", new Map());
  await settle();
  expect(sent).toEqual(["after that"]);
});

test("what's queued goes now with nothing typed", async () => {
  const one = session();
  one.send("queued", new Map());
  await settle();
  await one.sendQueuedNow();
  expect(sent).toEqual(["queued", { subtype: "interrupt", send_now: true }]);
});

test("a new conversation's id is known before Claude Code says it, so its first message is kept with it", () => {
  started = [];
  const one = new AgentSession({ cwd: "/tmp", emit: () => {} });
  const first = one.knownId;
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  one.start();
  expect(started.at(-1)).toMatchObject({ sessionId: first, resume: undefined });
  // /clear starts another conversation, with an id of its own.
  one.reset();
  expect(one.knownId).not.toBe(first);
  one.start();
  expect(started.at(-1)).toMatchObject({ sessionId: one.knownId, resume: undefined });
  one.close();
  // A conversation picked up again keeps its id, and Claude Code isn't given another.
  const resumed = new AgentSession({ cwd: "/tmp", emit: () => {}, resume: "earlier" });
  expect(resumed.knownId).toBe("earlier");
  resumed.start();
  expect(started.at(-1)).toMatchObject({ sessionId: undefined, resume: "earlier" });
  resumed.close();
});

// A turn in a git repository: the session records the working tree before Claude Code has your
// message, and says what changed just before the turn's result.

const folders: string[] = [];
const sessions: { close(): void }[] = [];
afterEach(() => {
  for (const one of sessions.splice(0)) one.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A repository with a.txt committed, and a session working in it that keeps what it emits. */
function inRepo() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "session-test-")));
  folders.push(top);
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: top });
  git("init", "-q");
  writeFileSync(join(top, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  sent = [];
  answer = undefined;
  const events: SessionEvent[] = [];
  const one = new AgentSession({ cwd: top, emit: (event) => events.push(event) });
  sessions.push(one);
  return { top, one, events };
}

const assistant = (text: string) => ({ type: "assistant", uuid: randomUUID(), session_id: "s", parent_tool_use_id: null, message: { id: randomUUID(), model: "x", role: "assistant", content: [{ type: "text", text }] } });
const result = () => ({ type: "result", subtype: "success", uuid: randomUUID(), session_id: "s", duration_ms: 10, num_turns: 1, is_error: false, result: "ok" });
/** The events as they came: their kinds, Claude Code's by type, and a notice by its words. */
const kinds = (events: SessionEvent[]) => events.map((event) => (event.kind === "sdk" ? `sdk:${event.message.type}` : event.kind === "notice" ? `notice: ${event.text}` : event.kind));
const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await Bun.sleep(10);
};

test("records the working tree before Claude Code has your message, and says what changed before the result", async () => {
  const { top, one, events } = inRepo();
  // Claude Code changes a file as soon as it has the message, so it counts only if the turn's first edge came before.
  answer = (_, out) => {
    writeFileSync(join(top, "a.txt"), "one\ntwo\n");
    out.push(assistant("done"));
    out.push(result());
  };
  one.send("add a line");
  await until(() => kinds(events).includes("sdk:result"));
  expect(kinds(events)).toEqual(["prompt", "sdk:assistant", "ledger", "sdk:result"]);
  expect(events.find((event) => event.kind === "ledger")).toMatchObject({ files: [{ path: join(top, "a.txt"), added: 1, removed: 0 }], commits: [] });
});

test("counts a message you sent mid-turn in the turn it joined", async () => {
  const { top, one, events } = inRepo();
  // The first message starts work and the second ends it, as Claude Code takes a queued message mid-turn.
  answer = (message, out) => {
    const first = sent.length === 1;
    writeFileSync(join(top, first ? "a.txt" : "b.txt"), "one\ntwo\n");
    out.push(first ? assistant("working") : result());
  };
  one.send("add a line");
  one.send("and a file");
  await until(() => kinds(events).includes("sdk:result"));
  expect(events.flatMap((event) => (event.kind === "prompt" ? [event.starts] : []))).toEqual([true, false]);
  expect(events.find((event) => event.kind === "ledger")).toMatchObject({
    files: [
      { path: join(top, "a.txt"), added: 1, removed: 0 },
      { path: join(top, "b.txt"), added: 2, removed: 0 },
    ],
  });
});

test("counts a turn Claude starts by itself from where the last one ended", async () => {
  const { top, one, events } = inRepo();
  answer = (_, out) => {
    out.push(assistant("done"));
    out.push(result());
  };
  one.send("hi");
  await until(() => kinds(events).includes("sdk:result"));
  events.length = 0;
  writeFileSync(join(top, "a.txt"), "one\ntwo\nthree\n");
  said!.push(assistant("a task finished"));
  said!.push(result());
  await until(() => kinds(events).includes("sdk:result"));
  expect(kinds(events)).toEqual(["sdk:assistant", "ledger", "sdk:result"]);
  expect(events.find((event) => event.kind === "ledger")).toMatchObject({ files: [{ path: join(top, "a.txt"), added: 2, removed: 0 }] });
});

test("sends your messages and ends the turn when the working tree can't be recorded", async () => {
  const { one, events } = inRepo();
  const was = process.env.TMPDIR;
  process.env.TMPDIR = join(tmpdir(), `missing-${randomUUID()}`);
  try {
    answer = (_, out) => {
      out.push(assistant("done"));
      out.push(result());
    };
    one.send("first");
    await until(() => kinds(events).includes("sdk:result"));
    one.send("second");
    await until(() => kinds(events).filter((kind) => kind === "sdk:result").length === 2);
    expect(sent).toEqual(["first", "second"]);
    expect(kinds(events)).toEqual(["prompt", "sdk:assistant", "sdk:result", "prompt", "sdk:assistant", "sdk:result"]);
  } finally {
    if (was === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = was;
  }
});
