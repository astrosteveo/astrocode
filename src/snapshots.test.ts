import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Snapshots } from "./snapshots";

// Each test makes a git repository of its own, changes its working tree between a turn's edges as
// Claude would, through Bash as well as through edits, and reads back what the ledger counts.

const made: string[] = [];
const opened: Snapshots[] = [];
afterEach(() => {
  for (const one of opened.splice(0)) one.close();
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folder() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "ledger-test-")));
  made.push(path);
  return path;
}

function git(cwd: string, ...args: string[]) {
  const done = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr.toString()}`);
  return done.stdout.toString().trim();
}

/** A repository with `files` committed. */
function repo(files: Record<string, string>) {
  const top = folder();
  git(top, "init", "-q");
  for (const [path, text] of Object.entries(files)) write(top, path, text);
  git(top, "add", "--", ...Object.keys(files));
  git(top, "commit", "-q", "-m", "init");
  return top;
}

function write(top: string, path: string, text: string | Buffer) {
  mkdirSync(join(top, path, ".."), { recursive: true });
  writeFileSync(join(top, path), text);
}

function snapshots(cwd: string, home = "/nowhere", deadline?: number) {
  const one = new Snapshots(cwd, home, deadline);
  opened.push(one);
  return one;
}

const lines = (count: number, word = "line") => Array.from({ length: count }, (_, i) => `${word} ${i + 1}\n`).join("");

test("counts the audit's Python-heredoc edit, which no edit tool made", async () => {
  const fixture = join(import.meta.dir, "fixtures", "heredoc");
  const top = repo({ "src/retry.ts": readFileSync(join(fixture, "retry.ts.txt"), "utf8"), "src/retry.test.ts": readFileSync(join(fixture, "retry.test.ts.txt"), "utf8") });
  const edges = snapshots(top);
  await edges.start();
  // As Claude ran it: Python rewrote src/retry.ts, and cat rewrote the tests.
  const ran = Bun.spawnSync(["bash", join(fixture, "heredoc.sh.txt")], { cwd: top });
  expect(ran.exitCode).toBe(0);
  // The same counts git gave in the audit's repository, for the commit that turn made.
  expect(await edges.end()).toEqual({
    files: [
      { path: join(top, "src/retry.test.ts"), added: 42, removed: 24 },
      { path: join(top, "src/retry.ts"), added: 18, removed: 6 },
    ],
    commits: [],
    unseen: [],
  });
});

test("counts new and deleted files, and leaves ignored ones out", async () => {
  const top = repo({ "a.txt": lines(3), "gone.txt": lines(2), ".gitignore": "build/\n" });
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.txt", lines(4));
  write(top, "new.txt", lines(5));
  write(top, "build/out.js", lines(9));
  unlinkSync(join(top, "gone.txt"));
  expect((await edges.end())?.files).toEqual([
    { path: join(top, "a.txt"), added: 1, removed: 0 },
    { path: join(top, "gone.txt"), added: 0, removed: 2 },
    { path: join(top, "new.txt"), added: 5, removed: 0 },
  ]);
});

test("counts a file too big to read without reading it, as one with no lines", async () => {
  const top = repo({ "a.txt": lines(1) });
  const edges = snapshots(top);
  await edges.start();
  // Text, so had it been read, its lines would have been counted.
  write(top, "data.txt", "x\n".repeat(6 * 1024 * 1024));
  expect((await edges.end())?.files).toEqual([{ path: join(top, "data.txt"), added: 0, removed: 0 }]);
  // Written again, it's changed again; left alone, it isn't.
  write(top, "data.txt", "y\n".repeat(7 * 1024 * 1024));
  expect((await edges.end())?.files).toEqual([{ path: join(top, "data.txt"), added: 0, removed: 0 }]);
  expect((await edges.end())?.files).toEqual([]);
});

test("doesn't count a big file you track that was only touched, or written again the same", async () => {
  const big = "x\n".repeat(6 * 1024 * 1024);
  const top = repo({ "big.txt": big });
  const edges = snapshots(top);
  await edges.start();
  const later = new Date(Date.now() + 5000);
  utimesSync(join(top, "big.txt"), later, later);
  expect((await edges.end())?.files).toEqual([]);
  write(top, "big.txt", big);
  expect((await edges.end())?.files).toEqual([]);
  // The same size, but not the same.
  write(top, "big.txt", `y${big.slice(1)}`);
  expect((await edges.end())?.files).toEqual([{ path: join(top, "big.txt"), added: 0, removed: 0 }]);
});

test("leaves your index, your stash and the repository's objects as they were", async () => {
  const top = repo({ "a.txt": lines(2), "b.txt": lines(2) });
  write(top, "b.txt", lines(3));
  git(top, "stash", "-q");
  write(top, "a.txt", lines(3, "staged"));
  git(top, "add", "a.txt");
  write(top, "a.txt", lines(4, "worktree"));
  const fingerprint = () => ({
    index: createHash("sha256").update(readFileSync(join(top, ".git/index"))).digest("hex"),
    stash: git(top, "stash", "list", "--format=%H"),
    refs: git(top, "for-each-ref", "--format=%(objectname) %(refname)"),
    objects: git(top, "count-objects", "-v"),
    staged: git(top, "diff", "--cached", "--numstat"),
  });
  const before = fingerprint();
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.txt", lines(5, "worktree"));
  write(top, "c.txt", lines(1));
  // The working tree counts, not what's staged: a.txt went from 4 lines to 5.
  expect((await edges.end())?.files).toEqual([
    { path: join(top, "a.txt"), added: 1, removed: 0 },
    { path: join(top, "c.txt"), added: 1, removed: 0 },
  ]);
  expect(fingerprint()).toEqual(before);
});

test("doesn't run your clean filters, such as Git LFS's, which write into .git", async () => {
  const top = repo({ "a.dat": lines(1), ".gitattributes": "*.dat filter=mark\n" });
  const marks = join(folder(), "marks");
  // Like LFS's: it keeps a copy of what it cleans, and must succeed.
  git(top, "config", "filter.mark.clean", `sh -c 'cat >> ${marks}; echo cleaned'`);
  git(top, "config", "filter.mark.required", "true");
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.dat", lines(2));
  write(top, "b.dat", lines(3));
  expect((await edges.end())?.files).toEqual([
    { path: join(top, "a.dat"), added: 1, removed: 0 },
    { path: join(top, "b.dat"), added: 3, removed: 0 },
  ]);
  expect(existsSync(marks)).toBe(false);
});

test("says which of the files the edit tools changed git can't see: ignored, or outside the repository", async () => {
  const top = repo({ "a.txt": lines(1), ".gitignore": ".env\n" });
  const elsewhere = folder();
  const edges = snapshots(top);
  await edges.start();
  write(top, ".env", "PORT=2\n");
  write(top, "a.txt", lines(2));
  write(elsewhere, ".zshrc", "PATH=x\n");
  const edited = [join(top, ".env"), join(top, "a.txt"), join(elsewhere, ".zshrc")];
  expect(await edges.end(edited)).toEqual({ files: [{ path: join(top, "a.txt"), added: 1, removed: 0 }], commits: [], unseen: [join(elsewhere, ".zshrc"), join(top, ".env")] });
});

test("sees the whole repository from a folder inside it", async () => {
  const top = repo({ "a.txt": lines(1), "src/b.txt": lines(1) });
  const edges = snapshots(join(top, "src"));
  await edges.start();
  write(top, "a.txt", lines(2));
  expect((await edges.end())?.files).toEqual([{ path: join(top, "a.txt"), added: 1, removed: 0 }]);
});

test("leaves ~/.claude out when it's inside the repository, but not the project's own .claude", async () => {
  const home = repo({ "notes.txt": lines(1) });
  const edges = snapshots(home, home);
  await edges.start();
  write(home, ".claude/plans/plan.md", lines(3));
  write(home, "notes.txt", lines(2));
  expect((await edges.end())?.files).toEqual([{ path: join(home, "notes.txt"), added: 1, removed: 0 }]);

  const project = repo({ "a.txt": lines(1) });
  const elsewhere = snapshots(project, folder());
  await elsewhere.start();
  write(project, ".claude/settings.json", "{}\n");
  expect((await elsewhere.end())?.files).toEqual([{ path: join(project, ".claude/settings.json"), added: 1, removed: 0 }]);
});

test("names the commits the turn made, not one made before it", async () => {
  const top = repo({ "a.txt": lines(1) });
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.txt", lines(2));
  git(top, "commit", "-q", "-am", "two");
  const made = git(top, "rev-parse", "--short", "HEAD");
  expect(await edges.end()).toEqual({ files: [{ path: join(top, "a.txt"), added: 1, removed: 0 }], commits: [made], unseen: [] });
});

test("names a signed commit by its hash when git log shows signatures", async () => {
  const top = repo({ "a.txt": lines(1) });
  const keys = folder();
  Bun.spawnSync(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", join(keys, "key")]);
  writeFileSync(join(keys, "signers"), `t@example.com ${readFileSync(join(keys, "key.pub"), "utf8")}`);
  git(top, "config", "gpg.format", "ssh");
  git(top, "config", "user.signingkey", join(keys, "key"));
  git(top, "config", "gpg.ssh.allowedSignersFile", join(keys, "signers"));
  git(top, "config", "log.showSignature", "true");
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.txt", lines(2));
  git(top, "commit", "-q", "-S", "-am", "two");
  expect((await edges.end())?.commits).toEqual([git(top, "rev-parse", "--short", "HEAD")]);
});

test("doesn't count older commits a switch or a pull brings in as the turn's", async () => {
  const top = repo({ "a.txt": lines(1) });
  git(top, "switch", "-q", "-c", "older");
  write(top, "a.txt", lines(2));
  const past = "2026-01-01T00:00:00Z";
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-am", "older"], {
    cwd: top,
    env: { ...process.env, GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past },
  });
  git(top, "switch", "-q", "-");
  const edges = snapshots(top);
  await edges.start();
  git(top, "merge", "-q", "--ff-only", "older");
  expect((await edges.end())?.commits).toEqual([]);
});

test("counts a turn Claude starts by itself from where the last one ended", async () => {
  const top = repo({ "a.txt": lines(1), "b.txt": lines(1) });
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.txt", lines(2));
  expect((await edges.end())?.files).toEqual([{ path: join(top, "a.txt"), added: 1, removed: 0 }]);
  write(top, "b.txt", lines(3));
  expect((await edges.end())?.files).toEqual([{ path: join(top, "b.txt"), added: 2, removed: 0 }]);
});

test("says nothing outside git", async () => {
  const edges = snapshots(folder());
  await edges.start();
  expect(await edges.end()).toBeNull();
});

test("deletes its index and objects when the session closes", async () => {
  const ours = () => new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("astrocode-ledger-")));
  const before = ours();
  const top = repo({ "a.txt": lines(1) });
  const edges = snapshots(top);
  await edges.start();
  const added = [...ours()].filter((name) => !before.has(name));
  expect(added).toHaveLength(1);
  edges.close();
  expect(existsSync(join(tmpdir(), added[0]!))).toBe(false);
});

test("starts from the repository's first file", async () => {
  const top = folder();
  git(top, "init", "-q");
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.txt", lines(2));
  expect(await edges.end()).toEqual({ files: [{ path: join(top, "a.txt"), added: 2, removed: 0 }], commits: [], unseen: [] });
});


/** Runs `body` with the temporary folder at `path`, as when TMPDIR names one that isn't there. */
async function withTemp<T>(path: string, body: () => Promise<T>) {
  const was = process.env.TMPDIR;
  process.env.TMPDIR = path;
  try {
    return await body();
  } finally {
    if (was === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = was;
  }
}

test("says nothing, rather than failing, when it can't make its folder", async () => {
  const top = repo({ "a.txt": lines(1) });
  await withTemp(join(folder(), "missing"), async () => {
    const edges = snapshots(top);
    await edges.start();
    write(top, "a.txt", lines(2));
    expect(await edges.end()).toBeNull();
  });
});

test("stops recording for the session once an edge runs out of time, so no turn waits on it again", async () => {
  const top = repo({ "a.txt": lines(1) });
  const temp = folder();
  await withTemp(temp, async () => {
    // No edge can finish in a millisecond.
    const edges = snapshots(top, "/nowhere", 1);
    await edges.start();
    expect(readdirSync(temp)).toEqual([]);
    write(top, "a.txt", lines(2));
    expect(await edges.end()).toBeNull();
    await edges.start();
    expect(readdirSync(temp)).toEqual([]);
  });
});

test("deletes the folders an astrocode that was killed left behind, and only those", async () => {
  const top = repo({ "a.txt": lines(1) });
  const temp = folder();
  const gone = Bun.spawnSync(["true"]).pid;
  const running = Bun.spawn(["sleep", "10"]);
  try {
    mkdirSync(join(temp, `astrocode-ledger-${gone}-AbC123`));
    mkdirSync(join(temp, `astrocode-ledger-${running.pid}-DeF456`));
    await withTemp(temp, () => snapshots(top).start());
    const left = readdirSync(temp);
    expect(left).not.toContain(`astrocode-ledger-${gone}-AbC123`);
    expect(left).toContain(`astrocode-ledger-${running.pid}-DeF456`);
  } finally {
    running.kill();
  }
});
