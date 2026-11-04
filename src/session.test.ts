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
/** How the stand-in starts, and what else it answers. Unless a test says otherwise, it never finishes starting, so it's asked nothing else. */
let starting: () => Promise<unknown> = () => new Promise(() => {});
let answers: Record<string, unknown> = {};

// A stand-in Claude Code, in place of the SDK's query: it queues every message, as Claude Code does
// while Claude works, and keeps what it was sent.
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
      initializationResult: () => starting(),
      // The queue's own close: this one takes its place on the object.
      close,
      ...answers,
    });
  },
}));

const { AgentSession } = await import("./session");

const session = (emit: (event: SessionEvent) => void = () => {}) => {
  sent = [];
  answer = undefined;
  return new AgentSession({ cwd: "/tmp", emit });
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

test("tells the view which files the edit tools changed that git can't see", async () => {
  const { top, one, events } = inRepo();
  writeFileSync(join(top, ".gitignore"), ".env\n");
  answer = (_, out) => {
    writeFileSync(join(top, ".env"), "PORT=2\n");
    out.push({ ...assistant(""), message: { id: randomUUID(), model: "x", role: "assistant", content: [{ type: "tool_use", id: "e", name: "Write", input: { file_path: join(top, ".env"), content: "PORT=2\n" } }] } });
    out.push(result());
  };
  one.send("set the port");
  await until(() => kinds(events).includes("sdk:result"));
  expect(events.find((event) => event.kind === "ledger")).toMatchObject({ unseen: [join(top, ".env")] });
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

test("a new Claude Code says what it loaded: its version, and the CLAUDE.md files, plugins, MCP servers and skills in use", async () => {
  starting = async () => ({ models: [], commands: [], account: {}, claude_code_version: "2.1.318" });
  answers = {
    getMemoryDialog: async () => ({ files: [{ path: "/home/u/.claude/CLAUDE.md", exists: true }, { path: "/tmp/CLAUDE.md", exists: false }] }),
    getSettings: async () => ({ effective: { enabledPlugins: { "a@market": true, "b@market": false, "c@market": true } }, applied: {} }),
    // astrocode's own server isn't one of Claude Code's, and one turned off isn't in use.
    mcpServerStatus: async () => [
      { name: "show", status: "connected", source: "sdk" },
      { name: "github", status: "pending", source: "user" },
      { name: "browser", status: "failed", source: "plugin" },
      { name: "old", status: "disabled", source: "user" },
    ],
    getSkillsDialog: async () => ({ skills: [{ name: "review", state: "on" }, { name: "deploy", state: "off" }, { name: "notes", state: "name-only" }] }),
  };
  const events: SessionEvent[] = [];
  try {
    session((event) => events.push(event)).start();
    await settle();
  } finally {
    starting = () => new Promise(() => {});
    answers = {};
  }
  expect(events.find((event) => event.kind === "loaded")).toEqual({ kind: "loaded", loaded: { version: "2.1.318", claudeMd: 1, plugins: 2, mcpServers: 2, skills: 2 } });
});

test("what Claude Code can't say it loaded is left out", async () => {
  starting = async () => ({ models: [], commands: [], account: {}, claude_code_version: "2.1.318" });
  answers = { mcpServerStatus: async () => [{ name: "github", status: "connected", source: "user" }] };
  const events: SessionEvent[] = [];
  try {
    session((event) => events.push(event)).start();
    await settle();
  } finally {
    starting = () => new Promise(() => {});
    answers = {};
  }
  expect(events.find((event) => event.kind === "loaded")).toEqual({ kind: "loaded", loaded: { version: "2.1.318", mcpServers: 1 } });
});

test("Claude Code is asked for its settings once as it starts", async () => {
  starting = async () => ({ models: [], commands: [], account: {}, claude_code_version: "2.1.318" });
  let asked = 0;
  answers = {
    getSettings: async () => {
      asked += 1;
      return { effective: { enabledPlugins: { "a@market": true } }, applied: { ultracodeAvailable: true } };
    },
  };
  const events: SessionEvent[] = [];
  try {
    session((event) => events.push(event)).start();
    await settle();
  } finally {
    starting = () => new Promise(() => {});
    answers = {};
  }
  expect(asked).toBe(1);
  expect(events).toContainEqual({ kind: "ultracode-available", available: true });
  expect(events.find((event) => event.kind === "loaded")).toEqual({ kind: "loaded", loaded: { version: "2.1.318", plugins: 1 } });
});

test("prompts offer bypass permissions and auto mode unless your settings turn them off", async () => {
  starting = async () => ({ models: [], commands: [], account: {}, claude_code_version: "2.1.318" });
  answers = { getSettings: async () => ({ effective: { permissions: { disableBypassPermissionsMode: "disable" } }, applied: {} }) };
  const events: SessionEvent[] = [];
  try {
    session((event) => events.push(event)).start();
    await settle();
  } finally {
    starting = () => new Promise(() => {});
    answers = {};
  }
  expect(events).toContainEqual({ kind: "modes-available", bypass: false, auto: true });
});

test("prompts don't offer auto mode where Claude Code has it off: in your permissions settings, or for the model or account", async () => {
  const modes = async (init: Record<string, unknown>, effective: Record<string, unknown>) => {
    starting = async () => ({ models: [], commands: [], account: {}, claude_code_version: "2.1.318", ...init });
    answers = { getSettings: async () => ({ effective, applied: {} }) };
    const events: SessionEvent[] = [];
    try {
      session((event) => events.push(event)).start();
      await settle();
    } finally {
      starting = () => new Promise(() => {});
      answers = {};
    }
    return events.find((event) => event.kind === "modes-available");
  };
  expect(await modes({}, { permissions: { disableAutoMode: "disable" } })).toEqual({ kind: "modes-available", bypass: true, auto: false });
  expect(await modes({}, { disableAutoMode: "disable" })).toEqual({ kind: "modes-available", bypass: true, auto: false });
  // Asked to start in auto mode, Claude Code started asking first instead.
  expect(await modes({ current_permission_mode: "default" }, {})).toEqual({ kind: "modes-available", bypass: true, auto: false });
  expect(await modes({ current_permission_mode: "auto" }, {})).toEqual({ kind: "modes-available", bypass: true, auto: true });
});

test("a no with a comment tells Claude what you said and lets it carry on; a plain no stops the turn", async () => {
  const events: SessionEvent[] = [];
  const one = session((event) => events.push(event));
  one.start();
  const ask = started.at(-1)!.canUseTool as sdk.CanUseTool;
  const asking = (id: string, toolName = "Bash", more = {}) =>
    ask(toolName, { command: "rm -rf build" }, { signal: new AbortController().signal, toolUseID: id, requestId: id, ...more });
  const commented = asking("a");
  one.decide("a", { allow: false, comment: "use git clean instead" });
  expect(await commented).toEqual({
    behavior: "deny",
    message:
      "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nuse git clean instead",
    interrupt: false,
  });
  const plain = asking("b");
  one.decide("b", { allow: false });
  expect(await plain).toMatchObject({ behavior: "deny", interrupt: true });
  // A yes applies the changes its row names, such as a switch of mode.
  const mcp = asking("c", "mcp__hello__greet", { displayName: "Greet", mcpServer: { name: "hello", source: "dynamic" } });
  const switched = [{ type: "setMode" as const, mode: "auto" as const, destination: "session" as const }];
  one.decide("c", { allow: true, updates: switched });
  expect(await mcp).toEqual({ behavior: "allow", updatedInput: { command: "rm -rf build" }, updatedPermissions: switched });
  expect(events.flatMap((event) => (event.kind === "resolved" ? [event.outcome] : []))).toEqual(["deny", "deny", "allow"]);
  expect(events.findLast((event) => event.kind === "permission")).toMatchObject({ request: { displayName: "Greet", server: "hello" } });
});

test("a Claude Code that fails to start has loaded nothing", async () => {
  starting = async () => {
    throw new Error("no claude");
  };
  const events: SessionEvent[] = [];
  try {
    session((event) => events.push(event)).start();
    await settle();
  } finally {
    starting = () => new Promise(() => {});
  }
  expect(events.find((event) => event.kind === "loaded")).toEqual({ kind: "loaded", loaded: {} });
});
