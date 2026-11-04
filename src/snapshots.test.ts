import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Snapshots } from "./snapshots";
import { patchLines } from "./view/patch";

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
    trees: { from: expect.any(String), to: expect.any(String) },
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
    { path: join(top, "gone.txt"), added: 0, removed: 2, status: "deleted" },
    { path: join(top, "new.txt"), added: 5, removed: 0, status: "new" },
  ]);
});

test("counts a file too big to read without reading it, as one with no lines", async () => {
  const top = repo({ "a.txt": lines(1) });
  const edges = snapshots(top);
  await edges.start();
  // Text, so had it been read, its lines would have been counted.
  write(top, "data.txt", "x\n".repeat(6 * 1024 * 1024));
  expect((await edges.end())?.files).toEqual([{ path: join(top, "data.txt"), added: 0, removed: 0, status: "new", big: true }]);
  // Written again, it's changed again; left alone, it isn't.
  write(top, "data.txt", "y\n".repeat(7 * 1024 * 1024));
  expect((await edges.end())?.files).toEqual([{ path: join(top, "data.txt"), added: 0, removed: 0, big: true }]);
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
  expect((await edges.end())?.files).toEqual([{ path: join(top, "big.txt"), added: 0, removed: 0, big: true }]);
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
    { path: join(top, "c.txt"), added: 1, removed: 0, status: "new" },
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
    { path: join(top, "b.dat"), added: 3, removed: 0, status: "new" },
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
  expect(await edges.end(edited)).toMatchObject({ files: [{ path: join(top, "a.txt"), added: 1, removed: 0 }], commits: [], unseen: [join(elsewhere, ".zshrc"), join(top, ".env")] });
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
  expect((await elsewhere.end())?.files).toEqual([{ path: join(project, ".claude/settings.json"), added: 1, removed: 0, status: "new" }]);
});

test("counts ~/.claude when you work in it", async () => {
  const home = repo({ "notes.txt": lines(1), ".claude/skills/x/SKILL.md": lines(1) });
  const edges = snapshots(join(home, ".claude/skills/x"), home);
  await edges.start();
  write(home, ".claude/skills/x/SKILL.md", lines(2));
  expect((await edges.end())?.files).toEqual([{ path: join(home, ".claude/skills/x/SKILL.md"), added: 1, removed: 0 }]);
});

test("names the commits the turn made, not one made before it", async () => {
  const top = repo({ "a.txt": lines(1) });
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.txt", lines(2));
  git(top, "commit", "-q", "-am", "two");
  const made = git(top, "rev-parse", "--short", "HEAD");
  expect(await edges.end()).toMatchObject({ files: [{ path: join(top, "a.txt"), added: 1, removed: 0 }], commits: [made], unseen: [] });
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

test("reads a rename as one file, from where it was, and says which files are new or deleted", async () => {
  const top = repo({ "old.txt": lines(6), "gone.txt": lines(2, "gone") });
  const edges = snapshots(top);
  await edges.start();
  renameSync(join(top, "old.txt"), join(top, "new.txt"));
  write(top, "new.txt", lines(7));
  unlinkSync(join(top, "gone.txt"));
  write(top, "add.txt", lines(1, "added"));
  expect((await edges.end())?.files).toEqual([
    { path: join(top, "add.txt"), added: 1, removed: 0, status: "new" },
    { path: join(top, "gone.txt"), added: 0, removed: 2, status: "deleted" },
    { path: join(top, "new.txt"), added: 1, removed: 0, from: join(top, "old.txt") },
  ]);
});

test("tells a file too big to diff from a binary one", async () => {
  const top = repo({ "a.txt": lines(1) });
  const edges = snapshots(top);
  await edges.start();
  write(top, "data.txt", "x\n".repeat(6 * 1024 * 1024));
  write(top, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  expect((await edges.end())?.files).toEqual([
    { path: join(top, "data.txt"), added: 0, removed: 0, status: "new", big: true },
    { path: join(top, "logo.png"), added: 0, removed: 0, status: "new", binary: true },
  ]);
});

test("gives a file's diff for the turn, a rename's against where it was, until the session closes", async () => {
  const top = repo({ "a.txt": lines(3), "old.txt": lines(6) });
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.txt", "line 1\nchanged 2\nline 3\n");
  renameSync(join(top, "old.txt"), join(top, "new.txt"));
  write(top, "new.txt", lines(7));
  const ledger = (await edges.end())!;
  const [a, moved] = ledger.files;
  const patch = await edges.patch(ledger.trees!, a!);
  expect(patch).toContain("@@ -1,3 +1,3 @@");
  expect(patch).toContain("-line 2\n+changed 2");
  const renamed = await edges.patch(ledger.trees!, moved!);
  expect(renamed).toContain("rename from old.txt");
  expect(renamed).toContain("+line 7");
  // The turn's trees go with the session's objects.
  edges.close();
  expect(await edges.patch(ledger.trees!, a!)).toBeNull();
});

test("gives a file's diff whole when your git config prints blank context lines empty", async () => {
  const top = repo({ "a.txt": "a\n\nb\nc\n\nd\n" });
  // diff.suppressBlankEmpty prints a blank line of context as an empty line, not a space.
  git(top, "config", "diff.suppressBlankEmpty", "true");
  const edges = snapshots(top);
  await edges.start();
  write(top, "a.txt", "a\n\nB\nc\n\nd\n");
  const ledger = (await edges.end())!;
  const lines = patchLines((await edges.patch(ledger.trees!, ledger.files[0]!))!);
  expect(lines.filter((line) => line.kind !== "context").map((line) => `${line.kind} ${line.text}`)).toEqual(["removed b", "added B"]);
  expect(lines).toHaveLength(7);
});

test("gives what isn't committed, and the branch's changes against the branch it started from", async () => {
  const top = repo({ "a.txt": lines(1) });
  git(top, "branch", "-M", "main");
  git(top, "switch", "-q", "-c", "feature");
  write(top, "a.txt", lines(2));
  git(top, "commit", "-q", "-am", "two");
  write(top, "b.txt", lines(3));
  const edges = snapshots(top);
  await edges.start();
  write(top, "c.txt", lines(1));
  const uncommitted = (await edges.changes("uncommitted"))!;
  expect(uncommitted.files).toEqual([
    { path: join(top, "b.txt"), added: 3, removed: 0, status: "new" },
    { path: join(top, "c.txt"), added: 1, removed: 0, status: "new" },
  ]);
  const branch = (await edges.changes("branch"))!;
  expect(branch.base).toBe("main");
  expect(branch.files.map((file) => file.path)).toEqual([join(top, "a.txt"), join(top, "b.txt"), join(top, "c.txt")]);
  expect(await edges.patch(branch.trees, branch.files[0]!)).toContain("+line 2");
  // Neither moves where the turn counts from.
  expect((await edges.end())?.files.map((file) => file.path)).toEqual([join(top, "c.txt")]);
});

test("gives what's new in a repository with no commits yet, and no branch without a base", async () => {
  const top = folder();
  git(top, "init", "-q");
  write(top, "a.txt", lines(2));
  const edges = snapshots(top);
  expect((await edges.changes("uncommitted"))?.files).toEqual([{ path: join(top, "a.txt"), added: 2, removed: 0, status: "new" }]);
  expect(await edges.changes("branch")).toBeNull();
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
  expect(await edges.end()).toMatchObject({ files: [{ path: join(top, "a.txt"), added: 2, removed: 0, status: "new" }], commits: [], unseen: [] });
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
