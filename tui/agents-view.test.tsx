import { afterAll, beforeAll, expect, test } from "bun:test";
import { render } from "ink";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { installedBinary } from "../src/claude";
import { AgentsView } from "./agents";

// A stand-in `claude` on PATH: `agents --json` lists two background sessions in another project and one in a third,
// and `--bg` says where it was started instead of starting one.
const root = mkdtempSync(join(tmpdir(), "astrocode-agents-"));
const here = join(root, "here");
const other = join(root, "other");
const third = join(root, "third");
const dispatched = join(root, "dispatched");
const saved = { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };

beforeAll(() => {
  for (const folder of [here, other, third, join(root, "bin")]) mkdirSync(folder);
  const list = JSON.stringify([
    { id: "0a1b2c3d", cwd: other, kind: "background", startedAt: 1, state: "done", name: "older" },
    { id: "1a1b2c3d", cwd: other, kind: "background", startedAt: 2, state: "done", name: "newer" },
    { id: "2a1b2c3d", cwd: third, kind: "background", startedAt: 3, state: "done", name: "elsewhere" },
  ]);
  const claude = join(root, "bin", "claude");
  writeFileSync(
    claude,
    `#!/bin/sh\nif [ "$1" = "--bg" ]; then pwd > '${dispatched}'; echo 'backgrounded · 9f8e7d6c · task'; exit 0; fi\necho '${list}'\n`,
  );
  chmodSync(claude, 0o755);
  process.env.PATH = `${join(root, "bin")}:${process.env.PATH}`;
  process.env.CLAUDE_CONFIG_DIR = root;
  // Never let these tests start a real background session.
  if (installedBinary() !== claude) throw new Error(`The stand-in claude isn't the one found: ${installedBinary()}`);
});

afterAll(() => {
  process.env.PATH = saved.PATH;
  if (saved.CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = saved.CLAUDE_CONFIG_DIR;
  rmSync(root, { recursive: true, force: true });
});

/** The agents view on a fake terminal, with what it was asked to start in astrocode. */
function view() {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
  stdout.resume();
  const started: { task: string; cwd: string }[] = [];
  const app = render(
    <AgentsView
      here={null}
      cwd={here}
      home={root}
      settings={{}}
      onBack={() => {}}
      onOpen={async () => {}}
      onStart={async (task, cwd) => {
        started.push({ task, cwd });
      }}
      onExit={async () => {}}
    />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  return { press: (keys: string) => stdin.write(keys), started, app };
}

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

test("Ctrl+Enter starts the task in astrocode, in the chosen row's project", async () => {
  const { press, started, app } = view();
  // The list is read before the row it chooses is known.
  await settle(500);
  press("fix the build");
  await settle();
  // Ctrl+Enter as the kitty keyboard protocol sends it.
  press("\x1b[13;5u");
  await settle();
  app.unmount();
  expect(started).toEqual([{ task: "fix the build", cwd: other }]);
  expect(existsSync(dispatched)).toBe(false);
});

test("Enter alone starts it in astrocode too, not in Claude Code's background service", async () => {
  const { press, started, app } = view();
  await settle(500);
  press("fix the build");
  await settle();
  press("\r");
  await settle(500);
  app.unmount();
  expect(started).toEqual([{ task: "fix the build", cwd: other }]);
  expect(existsSync(dispatched)).toBe(false);
});

test("with a task typed, ↓ moves to the next project, past the rest of this one's sessions", async () => {
  const { press, started, app } = view();
  await settle(500);
  press("fix the build");
  await settle();
  press("\x1b[B");
  await settle();
  press("\r");
  await settle(500);
  app.unmount();
  expect(started).toEqual([{ task: "fix the build", cwd: third }]);
});

test("with the box empty, ↓ moves to the next session in the same project", async () => {
  const { press, started, app } = view();
  await settle(500);
  press("\x1b[B");
  await settle();
  press("fix the build");
  await settle();
  press("\r");
  await settle(500);
  app.unmount();
  expect(started).toEqual([{ task: "fix the build", cwd: other }]);
});
