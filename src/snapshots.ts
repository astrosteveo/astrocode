// The working tree at each edge of a turn, recorded as a git tree, so the ledger a turn closes with
// counts whatever changed between its start and its end, edits made through Bash included.
//
// The trees are built in an index and an object store of the session's own, in a temporary folder.
// The index starts as a copy of yours and is kept from edge to edge, so git hashes only what changed
// since, and your objects are read as alternates. Nothing in .git changes or is added: your index,
// refs and stash stay as they were, though git may touch the mtime of an object it already has.
// Clean filters, such as Git LFS's, don't run: files are hashed as they are on disk.
// A file over 10 MB isn't read: a stub of its size and mtime stands in for it, so a turn that writes
// one still counts it. One you track is read when it's the size the index holds it at, as git
// status would, to tell whether it was only touched. Files under ~/.claude don't count, unless you work in it.
import { rmSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { FileChange, Ledger, Trees } from "./events";

/** Files bigger than this aren't hashed, so an edge never reads a build's output or a dataset whole. */
const BIG = 10 * 1024 * 1024;

/**
 * An edge that takes longer is stopped with SIGTERM, on which git removes its index lock (SIGKILL
 * would leave it, and the next edge would fail), and the turn's ledger comes from its edits' diffs.
 * So do the ledgers of the session's later turns: their edges would most likely run out of time
 * too, and each would hold up your message, or the turn's result, as long.
 */
const DEADLINE = 2000;

/**
 * The sessions' folders, deleted as astrocode exits should a session not have closed, as when it
 * crashes. Killed, as when its terminal closes, it exits without: the next astrocode deletes them.
 */
const folders = new Set<string>();
process.on("exit", () => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/**
 * The working tree as a tree at one edge, with HEAD then, if there was one, when the edge started,
 * and the files too big to read, whose stubs stand in for them, by path from the top.
 */
type Edge = { tree: string; head?: string; at: number; big: string[] };

/** What a scope of /diff shows besides a turn: the files, the trees their diffs run between, and the branch it's against. */
export type Changes = { files: FileChange[]; trees: Trees; base?: string };

type Repo = {
  top: string;
  /** Your index, copied at the first edge and after one fails. */
  index: string;
  folder: string;
  env: Record<string, string | undefined>;
  /** ~/.claude, relative to the top, when it's inside the repository and you don't work in it. */
  claude?: string;
};

export class Snapshots {
  private repo: Repo | null | undefined;
  /** The last edge: the next turn counts from there. */
  private last: Edge | undefined;
  /** Edges share the index, so they run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The index is copied from yours at the next edge: the first, and any after one that failed. */
  private seed = true;

  constructor(
    private readonly cwd: string,
    private readonly home: string,
    private readonly deadline = DEADLINE,
  ) {}

  /** Records the tree a turn starts from. */
  async start(): Promise<void> {
    await this.serial(async (signal) => (this.last = await this.edge(signal)), undefined);
  }

  /**
   * What the turn changed since it started, recording the tree it ends at, which a turn Claude
   * starts by itself counts from, and which of the files the edit tools changed, `edited`, git
   * can't see. Null outside git, or when an edge failed or ran out of time.
   */
  end(edited: string[] = []): Promise<Ledger | null> {
    return this.serial(async (signal) => {
      const from = this.last;
      this.last = await this.edge(signal);
      const repo = this.repo;
      if (!from || !this.last || !repo) return null;
      const trees = { from: from.tree, to: this.last.tree };
      const [files, log, unseen] = await Promise.all([
        filesBetween(repo, trees, [...from.big, ...this.last.big], signal),
        // Commits made since the turn started: a pull or a switch brings older ones, which don't count.
        // rev-list, not log, which your log settings, such as log.showSignature, would add lines to.
        git(repo, ["rev-list", "--abbrev-commit", `--since=@${Math.floor(from.at / 1000)}`, "HEAD", ...(from.head ? [`^${from.head}`] : [])], signal),
        unseenOf(repo, edited, signal),
      ]);
      if (files === null) return null;
      return { files, commits: (log ?? "").split("\n").filter(Boolean).reverse(), unseen, trees };
    }, null);
  }

  /**
   * The working tree now against HEAD (`uncommitted`), or against where the branch left the one it
   * started from (`branch`), as /diff's scopes show them. Recording it moves nothing a turn counts
   * from. `no base`: there's no branch to compare with. `slow`: comparing took longer than an edge
   * may, which, unlike a slow edge, stops nothing. Null outside git, or when git failed.
   */
  async changes(scope: "uncommitted" | "branch"): Promise<Changes | "no base" | "slow" | null> {
    const now = await this.serial((signal) => this.edge(signal), undefined);
    const repo = this.repo;
    if (!now || !repo) return null;
    // Comparing reads only objects, not the index, so it runs outside the queue, on a deadline of
    // its own: a big branch holds up no edge, and running out of time says nothing of the edges'.
    const signal = AbortSignal.timeout(this.deadline);
    // Before the first commit, everything is new.
    const base = scope === "branch" ? await baseOf(repo, signal) : { ref: now.head ?? (await git(repo, ["hash-object", "-t", "tree", "--stdin"], signal, ""))?.trim() };
    if (signal.aborted) return "slow";
    if (!base?.ref) return scope === "branch" ? "no base" : null;
    const trees = { from: base.ref, to: now.tree };
    const files = await filesBetween(repo, trees, now.big, signal);
    if (!files) return signal.aborted ? "slow" : null;
    return { files, trees, base: "branch" in base ? base.branch : undefined };
  }

  /**
   * One file's diff between two trees, a renamed file's against where it was, or null once the
   * trees are gone, as when the session closed.
   */
  async patch(trees: Trees, file: FileChange): Promise<string | null> {
    const repo = this.repo;
    if (!repo) return null;
    const paths = [file.from, file.path].flatMap((path) => (path ? [relative(repo.top, path)] : []));
    // Your diff.suppressBlankEmpty would print a blank line of context empty, which reads as the hunk's end.
    const settings = ["-c", `core.bigFileThreshold=${BIG}`, "-c", "diff.suppressBlankEmpty=false"];
    return git(repo, ["--literal-pathspecs", ...settings, "diff-tree", "-p", "-M", "--no-color", trees.from, trees.to, "--", ...paths], AbortSignal.timeout(this.deadline));
  }

  /** Deletes the index and objects; the next edge starts over. */
  close() {
    if (this.repo) {
      rmSync(this.repo.folder, { recursive: true, force: true });
      folders.delete(this.repo.folder);
    }
    this.repo = undefined;
    this.last = undefined;
    this.seed = true;
  }

  /**
   * Runs an edge after the one before it. One that fails gives `failed`, so the message or result
   * waiting on it still goes, even when it threw, as when its folder can't be made.
   */
  private serial<T>(edge: (signal: AbortSignal) => Promise<T>, failed: T): Promise<T> {
    const next = this.queue.then(async () => {
      const signal = AbortSignal.timeout(this.deadline);
      const done = await edge(signal).catch(() => failed);
      // It ran out of time: no edge is recorded for the rest of the session.
      if (done === failed && signal.aborted) {
        this.close();
        this.repo = null;
      }
      return done;
    });
    this.queue = next;
    return next;
  }

  /** The working tree as a tree; undefined when it couldn't be recorded. */
  private async edge(signal: AbortSignal): Promise<Edge | undefined> {
    const at = Date.now();
    if (this.repo === undefined) this.repo = await this.open();
    const repo = this.repo;
    if (!repo) return undefined;
    const written = await this.write(repo, signal).catch(() => null);
    // A failed edge may have left the index half written: the next starts again from yours.
    if (!written) this.seed = true;
    return written ? { ...written, at } : undefined;
  }

  private async open(): Promise<Repo | null> {
    const said = await git({ top: this.cwd, env: process.env }, ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-path", "index", "--git-path", "objects"]);
    const [top, index, objects] = said?.split("\n") ?? [];
    if (!top || !index || !objects) return null;
    await sweep();
    const folder = await mkdtemp(join(tmpdir(), `astrocode-ledger-${process.pid}-`));
    folders.add(folder);
    const claude = join(this.home, ".claude");
    return {
      top,
      index,
      folder,
      env: { ...process.env, ...(await unfiltered(top)), GIT_INDEX_FILE: join(folder, "index"), GIT_OBJECT_DIRECTORY: join(folder, "objects"), GIT_ALTERNATE_OBJECT_DIRECTORIES: objects },
      claude: within(top, claude) && !within(claude, this.cwd) ? relative(top, claude) : undefined,
    };
  }

  private async write(repo: Repo, signal: AbortSignal): Promise<Omit<Edge, "at"> | null> {
    const run = (args: string[], input?: string) => git(repo, args, signal, input);
    if (this.seed) {
      await mkdir(join(repo.folder, "objects"), { recursive: true });
      await rm(join(repo.folder, "index.lock"), { force: true });
      // A repository with nothing added yet has no index: one is made from nothing.
      await copyFile(repo.index, join(repo.folder, "index")).catch(() => rm(join(repo.folder, "index"), { force: true }));
      this.seed = false;
    }
    // Only files that are new, or that changed since the index last saw them, can have grown big.
    const [untracked, changed, head] = await Promise.all([
      run(["ls-files", "-z", "-o", "--exclude-standard"]),
      run(["diff-files", "-z", "--name-only", "--diff-filter=d"]),
      // None before the first commit.
      run(["rev-parse", "-q", "--verify", "HEAD"]),
    ]);
    if (untracked === null || changed === null) return null;
    const inClaude = (path: string) => repo.claude !== undefined && (path === repo.claude || path.startsWith(`${repo.claude}/`));
    const paths = [...untracked.split("\0"), ...changed.split("\0")].filter((path) => path && !inClaude(path));
    const large = (
      await Promise.all(
        paths.map(async (path) => {
          const stat = await lstat(join(repo.top, path)).catch(() => null);
          return stat?.isFile() && stat.size > BIG ? [{ path, size: stat.size, mtime: stat.mtimeMs }] : [];
        }),
      )
    ).flat();
    const kept = await unchanged(run, large);
    const big = large.filter((file) => !kept.has(file.path));
    const left = [...big.map((file) => file.path), ...(repo.claude ? [repo.claude] : [])];
    const pathspec = [".", ...left.map((path) => `:(exclude,literal)${path}`)].map((spec) => `${spec}\0`).join("");
    if ((await run(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], pathspec)) === null) return null;
    if (big.length) {
      const stubs = join(repo.folder, "stubs");
      await mkdir(stubs, { recursive: true });
      const written = await Promise.all(
        big.map(async (file, i) => {
          const path = join(stubs, String(i));
          await writeFile(path, `astrocode: not hashed\0size ${file.size} mtime ${file.mtime}`);
          return path;
        }),
      );
      const ids = (await run(["hash-object", "-w", "--stdin-paths"], `${written.join("\n")}\n`))?.split("\n");
      if (!ids) return null;
      const entries = big.map((file, i) => `100644 ${ids[i]}\t${file.path}\0`).join("");
      if ((await run(["update-index", "-z", "--index-info"], entries)) === null) return null;
    }
    const tree = (await run(["write-tree"]))?.trim();
    return tree ? { tree, head: head?.trim() || undefined, big: big.map((file) => file.path) } : null;
  }
}

/**
 * Settings that turn off the repository's clean filters for the edges: Git LFS's keeps a copy of
 * each file it cleans in .git, and another filter could be as slow or write elsewhere. Their files
 * are hashed as they are on disk, as git sets them as config through the environment.
 */
async function unfiltered(top: string): Promise<Record<string, string>> {
  const names = (await git({ top, env: process.env }, ["config", "--name-only", "--get-regexp", "^filter\\."])) ?? "";
  const drivers = new Set(names.split("\n").flatMap((name) => /^filter\.(.+)\.[^.]+$/.exec(name)?.[1] ?? []));
  const settings = [...drivers].flatMap((driver) => [
    [`filter.${driver}.clean`, ""],
    [`filter.${driver}.process`, ""],
    [`filter.${driver}.required`, "false"],
  ]);
  // Settings already given through the environment stay first.
  const given = Number(process.env.GIT_CONFIG_COUNT) || 0;
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(given + settings.length) };
  settings.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${given + i}`] = key!;
    env[`GIT_CONFIG_VALUE_${given + i}`] = value!;
  });
  return settings.length ? env : {};
}

/**
 * Of the big files, those the index holds as they are, their stat changed only, as when touched or
 * written again the same: git reads those it holds at their size, and updates the stat of any
 * that match. LFS's are held as pointers, so they aren't read.
 */
async function unchanged(run: (args: string[], input?: string) => Promise<string | null>, big: { path: string; size: number }[]) {
  if (!big.length) return new Set<string>();
  const listed = (await run(["--literal-pathspecs", "ls-files", "-z", "--format=%(objectsize) %(path)", "--", ...big.map((file) => file.path)])) ?? "";
  const held = new Map<string, number>();
  for (const line of listed.split("\0")) {
    const [, size, path] = /^(\d+) ([\s\S]+)$/.exec(line) ?? [];
    if (path) held.set(path, Number(size));
  }
  const sized = big.filter((file) => held.get(file.path) === file.size).map((file) => file.path);
  if (!sized.length) return new Set<string>();
  if ((await run(["--literal-pathspecs", "add", "--refresh", "--pathspec-from-file=-", "--pathspec-file-nul"], sized.map((path) => `${path}\0`).join(""))) === null) return new Set<string>();
  const differ = await run(["--literal-pathspecs", "diff-files", "-z", "--name-only", "--", ...sized]);
  if (differ === null) return new Set<string>();
  const still = new Set(differ.split("\0"));
  return new Set(sized.filter((path) => !still.has(path)));
}

/** Deletes the folders astrocodes that were killed left behind, known by their pid. */
async function sweep() {
  const temp = tmpdir();
  for (const name of await readdir(temp).catch(() => [])) {
    const pid = Number(/^astrocode-ledger-(\d+)-/.exec(name)?.[1]);
    if (pid && !alive(pid)) await rm(join(temp, name), { recursive: true, force: true }).catch(() => {});
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Another user's.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Of `paths`, those git can't see: outside the repository, or ignored. A path through a symlink counts where it leads. */
async function unseenOf(repo: Repo, paths: string[], signal: AbortSignal) {
  const outside: string[] = [];
  const inside = new Map<string, string>();
  for (const path of paths) {
    const real = join(await realpath(dirname(path)).catch(() => dirname(path)), basename(path));
    if (within(repo.top, real)) inside.set(relative(repo.top, real), path);
    else outside.push(path);
  }
  // Exits 1 when none is ignored.
  const ignored = inside.size ? await git(repo, ["check-ignore", "-z", "--stdin"], signal, [...inside.keys()].map((where) => `${where}\0`).join("")) : null;
  return [...outside, ...(ignored ?? "").split("\0").flatMap((where) => inside.get(where) ?? [])];
}

/** `path` is `folder`, or in it. */
function within(folder: string, path: string) {
  const where = relative(folder, path);
  return where !== ".." && !where.startsWith(`..${sep}`) && !isAbsolute(where);
}

/** What git printed, or null when it failed, or ran past the edge's deadline and was stopped. */
async function git(repo: Pick<Repo, "top" | "env">, args: string[], signal?: AbortSignal, input?: string): Promise<string | null> {
  try {
    const child = Bun.spawn(["git", ...args], { cwd: repo.top, env: repo.env, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "ignore", signal });
    const out = await new Response(child.stdout).text();
    return (await child.exited) === 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * The files that differ between two trees, with renames found. `big`: the files whose stubs stand
 * in for them at either tree, by path from the top. ~/.claude is left out, as the edges leave it,
 * since a commit compared with one may hold it.
 */
async function filesBetween(repo: Repo, trees: Trees, big: string[], signal: AbortSignal): Promise<FileChange[] | null> {
  const pathspec = repo.claude ? ["--", ".", `:(exclude,literal)${repo.claude}`] : [];
  // A big file's lines aren't counted, so git doesn't read it to count them.
  const text = await git(repo, ["-c", `core.bigFileThreshold=${BIG}`, "diff-tree", "-r", "-M", "--raw", "--numstat", "-z", trees.from, trees.to, ...pathspec], signal);
  return text === null ? null : changesOf(text, repo.top, new Set(big));
}

/**
 * `diff-tree --raw --numstat -z`'s records as files, by absolute path: first each file's status,
 * then its counts, in the same order. A rename's paths, where it was and where it is, follow its
 * status and its counts each as fields of their own. A binary file counts no lines.
 */
function changesOf(text: string, top: string, big: Set<string>): FileChange[] {
  const fields = text.split("\0");
  let at = 0;
  const statuses: { status: string; paths: string[] }[] = [];
  while (fields[at]?.startsWith(":")) {
    const status = fields[at]!.split(" ").at(-1)!;
    const paths = fields.slice(at + 1, at + (/^[RC]/.test(status) ? 3 : 2));
    statuses.push({ status, paths });
    at += 1 + paths.length;
  }
  return statuses.map(({ status, paths }) => {
    const [, added = "-", removed = "-", path = ""] = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[at] ?? "") ?? [];
    at += path ? 1 : 3;
    const count = (value: string) => (value === "-" ? 0 : Number(value));
    const where = paths.at(-1)!;
    const file: FileChange = { path: join(top, where), added: count(added), removed: count(removed) };
    if (status === "A") file.status = "new";
    if (status === "D") file.status = "deleted";
    if (paths.length > 1) file.from = join(top, paths[0]!);
    if (paths.some((one) => big.has(one))) file.big = true;
    else if (added === "-") file.binary = true;
    return file;
  });
}

/**
 * Where the branch left the one it started from, as `claude`'s /diff finds it: origin's default
 * branch, else main or master, from origin or from here. HEAD itself, on that branch.
 */
async function baseOf(repo: Repo, signal: AbortSignal): Promise<{ ref: string; branch: string } | null> {
  const named = (await git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], signal))?.trim().replace(/^origin\//, "");
  for (const branch of new Set([...(named ? [named] : []), "main", "master"])) {
    for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
      const at = (await git(repo, ["merge-base", "HEAD", ref], signal))?.trim();
      if (at) return { ref: at, branch };
    }
  }
  return null;
}
