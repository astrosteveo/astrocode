import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptHistory } from "./prompt-history";

// Claude Code's history.jsonl, in a folder of its own. The home folder is read once as the process
// starts, so the test of `~/.claude` runs in a process of its own with a temporary HOME.
const root = mkdtempSync(join(tmpdir(), "astrocode-history-"));
const config = join(root, ".claude");
const file = join(config, "history.jsonl");
const saved = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CLAUDE_CODE_SKIP_PROMPT_HISTORY: process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY };
const HERE = "/home/u/here";
const OTHER = "/home/u/other";

/** Lines as `claude` 2.1.318 writes them. */
const line = (display: string, timestamp: number, project = HERE, sessionId: string | undefined = "s1", pastedContents: object = {}) =>
  JSON.stringify({ display, pastedContents, timestamp, project, sessionId });

beforeEach(() => {
  rmSync(config, { recursive: true, force: true });
  process.env.CLAUDE_CONFIG_DIR = config;
  delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY;
});

afterAll(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

function write(lines: string[], pastes: Record<string, string> = {}) {
  mkdirSync(join(config, "paste-cache"), { recursive: true });
  writeFileSync(file, lines.map((one) => `${one}\n`).join(""));
  for (const [hash, text] of Object.entries(pastes)) writeFileSync(join(config, "paste-cache", `${hash}.txt`), text);
}

test("↑ goes through this folder's messages from claude, oldest first, with what was pasted put back", async () => {
  write(
    [
      line("first here", 1000),
      line("elsewhere", 1001, OTHER, "s2"),
      "not a line claude wrote",
      JSON.stringify({ display: "no project", pastedContents: {}, timestamp: 1002 }),
      line("Look: [Pasted text #1 +2 lines] and [Pasted text #2 +40 lines] at [Image #3]", 1003, HERE, "s3", {
        1: { id: 1, type: "text", content: "a\nb\nc" },
        2: { id: 2, type: "text", contentHash: "0123456789abcdef" },
      }),
      line("[Pasted text #1 +9 lines] is gone", 1004, HERE, "s3", { 1: { id: 1, type: "text", contentHash: "fedcba9876543210" } }),
      line("[...Truncated text #1 +500 lines...] kept", 1005, HERE, "s3", { 1: { id: 1, type: "text", content: "the middle" } }),
      // Older versions wrote no session, and a broken paste record doesn't lose the line.
      JSON.stringify({ display: "no session", pastedContents: "broken", timestamp: 1006, project: HERE }),
    ],
    { "0123456789abcdef": "the long paste" },
  );
  const history = new PromptHistory();
  await history.load();
  expect(history.recall(HERE)).toEqual([
    "first here",
    "Look: a\nb\nc and the long paste at [Image #3]",
    "[Pasted text #1 +9 lines] is gone",
    "the middle kept",
    "no session",
  ]);
});

test("↑ puts this session's messages nearest, as claude does", async () => {
  write([line("mine, older", 1000, HERE, "s1"), line("another session's", 1001, HERE, "s2"), line("mine, newer", 1002, HERE, "s1")]);
  const history = new PromptHistory();
  await history.load();
  expect(history.recall(HERE, "s1")).toEqual(["another session's", "mine, older", "mine, newer"]);
  expect(history.recall(HERE, "unknown")).toEqual(["mine, older", "another session's", "mine, newer"]);
});

test("↑ goes back through a folder's newest hundred, as claude does", async () => {
  write(Array.from({ length: 150 }, (_, n) => line(`message ${n}`, 1000 + n)));
  const history = new PromptHistory();
  await history.load();
  const recalled = history.recall(HERE);
  expect(recalled).toHaveLength(100);
  expect(recalled[0]).toBe("message 50");
  expect(recalled.at(-1)).toBe("message 149");
});

test("Ctrl+R searches every folder's messages, as claude does", async () => {
  write([line("here", 1000), line("elsewhere", 1001, OTHER, "s2")]);
  const history = new PromptHistory();
  await history.load();
  expect(history.everything()).toEqual(["here", "elsewhere"]);
});

test("a message sent here is added to claude's file in its format", async () => {
  write([line("from claude", 1000, HERE, "s1")]);
  const history = new PromptHistory();
  await history.load();
  const sent = [history.add("before the session has an id", HERE), history.add("!git status", HERE, "s9"), history.add("/model", HERE, "s9")];
  // Kept straight away, before it's written.
  expect(history.recall(HERE, "s9")).toEqual(["from claude", "before the session has an id", "!git status", "/model"]);
  await Promise.all(sent);

  const lines = readFileSync(file, "utf8").split("\n");
  expect(lines.at(-1)).toBe("");
  const added = lines.slice(1, -1).map((one) => JSON.parse(one));
  expect(added.map((entry) => Object.keys(entry))).toEqual([
    ["display", "pastedContents", "timestamp", "project"],
    ["display", "pastedContents", "timestamp", "project", "sessionId"],
    ["display", "pastedContents", "timestamp", "project", "sessionId"],
  ]);
  expect(added.map(({ display, pastedContents, project, sessionId }) => ({ display, pastedContents, project, sessionId }))).toEqual([
    { display: "before the session has an id", pastedContents: {}, project: HERE, sessionId: undefined },
    { display: "!git status", pastedContents: {}, project: HERE, sessionId: "s9" },
    { display: "/model", pastedContents: {}, project: HERE, sessionId: "s9" },
  ]);
  // Sent within the same millisecond, each still gets a time of its own, in order.
  const times = added.map((entry) => entry.timestamp as number);
  expect(times[0]).toBeGreaterThan(1000);
  expect(times[1]).toBeGreaterThan(times[0]!);
  expect(times[2]).toBeGreaterThan(times[1]!);
  // Read back after writing, each is still there once.
  expect(history.recall(HERE, "s9")).toEqual(["from claude", "before the session has an id", "!git status", "/model"]);
});

test("the file is made for you alone when there's none yet", async () => {
  const history = new PromptHistory();
  await history.load();
  expect(history.everything()).toEqual([]);
  await history.add("hello", HERE, "s1");
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(file, "utf8")).toContain('"display":"hello"');
});

test("the same message twice in a row in a session is kept once, as claude keeps it", async () => {
  const history = new PromptHistory();
  await history.add("again", HERE, "s1");
  await history.add("again", HERE, "s1");
  await history.add("again", HERE, "s2");
  expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
  expect(history.recall(HERE)).toEqual(["again", "again"]);
});

test("what's sent in claude meanwhile shows up once astrocode sends again", async () => {
  write([]);
  const history = new PromptHistory();
  await history.load();
  await history.add("from astrocode", HERE, "s1");
  writeFileSync(file, `${readFileSync(file, "utf8")}${line("from claude", Date.now() + 10, HERE, "s2")}\n`);
  await history.add("from astrocode again", HERE, "s1");
  expect(history.recall(HERE, "s1")).toEqual(["from claude", "from astrocode", "from astrocode again"]);
});

test("CLAUDE_CODE_SKIP_PROMPT_HISTORY keeps messages out of the file, but not out of ↑", async () => {
  process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = "1";
  const history = new PromptHistory();
  await history.add("not saved", HERE, "s1");
  expect(() => statSync(file)).toThrow();
  expect(history.recall(HERE)).toEqual(["not saved"]);
});

test("with no CLAUDE_CONFIG_DIR it's history.jsonl in ~/.claude", () => {
  const home = join(root, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "history.jsonl"), `${line("from claude", 1000)}\n`);
  const env: Record<string, string | undefined> = { ...process.env, HOME: home };
  delete env.CLAUDE_CONFIG_DIR;
  const script = `
    import { PromptHistory } from ${JSON.stringify(join(import.meta.dir, "prompt-history.ts"))};
    const history = new PromptHistory();
    await history.load();
    await history.add("from astrocode", ${JSON.stringify(HERE)}, "s1");
    console.log(JSON.stringify(history.recall(${JSON.stringify(HERE)}, "s1")));
  `;
  const run = Bun.spawnSync([process.execPath, "-e", script], { env, cwd: root });
  expect(run.stderr.toString()).toBe("");
  expect(JSON.parse(run.stdout.toString())).toEqual(["from claude", "from astrocode"]);
  expect(readFileSync(join(home, ".claude", "history.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
});

test("a message with a secret in it stays out of claude's file, as claude keeps it out, but not out of ↑", async () => {
  write([]);
  const history = new PromptHistory();
  await history.load();
  const secrets = [
    "!curl -H 'x-api-key: sk-ant-api03-AbCdEfGh1234567890abcdefXYZ' https://api.anthropic.com",
    "/mcp add api --header 'Authorization: Bearer abcdef0123456789abcdef'",
    // astrocode puts what you paste in the message, so a key anywhere in it counts as pasted.
    "deploy with AKIAIOSFODNN7EXAMPLE as the key",
  ];
  for (const text of secrets) await history.add(text, HERE, "s1");
  await history.add("!git status", HERE, "s1");
  expect(readFileSync(file, "utf8").trim().split("\n").map((one) => JSON.parse(one).display)).toEqual(["!git status"]);
  expect(history.recall(HERE, "s1")).toEqual([...secrets, "!git status"]);
});

test("a line waits for claude's lock on the file, so claude rewriting the file meanwhile doesn't lose it", async () => {
  write([line("from claude", 1000)]);
  const history = new PromptHistory();
  await history.load();
  // claude drops old lines under its lock: it reads the lines it keeps, then puts a file of them in place.
  mkdirSync(`${file}.lock`);
  const kept = readFileSync(file, "utf8");
  const sent = history.add("from astrocode", HERE, "s1");
  await Bun.sleep(150);
  writeFileSync(`${file}.tmp`, kept);
  renameSync(`${file}.tmp`, file);
  rmdirSync(`${file}.lock`);
  await sent;
  expect(readFileSync(file, "utf8").trim().split("\n").map((one) => JSON.parse(one).display)).toEqual(["from claude", "from astrocode"]);
  expect(existsSync(`${file}.lock`)).toBe(false);
});

test("a lock left by a claude that's gone is taken over once it's stale, as claude takes it over", async () => {
  write([]);
  mkdirSync(`${file}.lock`);
  const old = new Date(Date.now() - 20_000);
  utimesSync(`${file}.lock`, old, old);
  const history = new PromptHistory();
  const started = Date.now();
  await history.add("from astrocode", HERE, "s1");
  expect(Date.now() - started).toBeLessThan(1000);
  expect(readFileSync(file, "utf8")).toContain('"display":"from astrocode"');
  expect(existsSync(`${file}.lock`)).toBe(false);
});
