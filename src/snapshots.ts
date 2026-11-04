// The working tree at each edge of a turn, recorded as a git tree, so the ledger a turn closes with
// counts whatever changed between its start and its end, edits made through Bash included.
//
// The trees are built in an index and an object store of the session's own, in a temporary folder.
// The index starts as a copy of yours and is kept from edge to edge, so git hashes only what changed
// since, and your objects are read as alternates. Nothing in .git changes or is added: your index,
// refs and stash stay as they were, though git may touch the mtime of an object it already has.
// Clean filters, such as Git LFS's, don't run: files are hashed as they are on disk.
// A file over 10 MB isn't read: a stub of its size and mtime stands in for it, so a turn that writes
// one still counts it. Files under ~/.claude don't count, unless the repository is in it.
import { rmSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { FileChange } from "./events";

/** Files bigger than this aren't hashed, so an edge never reads a build's output or a dataset whole. */
const BIG = 10 * 1024 * 1024;

/**
 * An edge that takes longer is stopped with SIGTERM, on which git removes its index lock (SIGKILL
 * would leave it, and the next edge would fail), and the turn's ledger comes from its edits' diffs.
 * So do the ledgers of the session's later turns: their edges would most likely run out of time
 * too, and each would hold up your message, or the turn's result, as long.
 */
const DEADLINE = 2000;

/** The sessions' folders, deleted as astrocode exits should a session not have closed, as when it crashes. */
const folders = new Set<string>();
process.on("exit", () => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** What a turn changed in a git repository: the files, and the commits made on HEAD, oldest first. */
export type Ledger = { files: FileChange[]; commits: string[] };

/** The working tree as a tree at one edge, with HEAD then, if there was one, and when the edge started. */
type Edge = { tree: string; head?: string; at: number };

type Repo = {
  top: string;
  /** Your index, copied at the first edge and after one fails. */
  index: string;
  folder: string;
  env: Record<string, string | undefined>;
  /** ~/.claude, relative to the top, when it's inside the repository. */
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
   * starts by itself counts from. Null outside git, or when an edge failed or ran out of time.
   */
  end(): Promise<Ledger | null> {
    return this.serial(async (signal) => {
      const from = this.last;
      this.last = await this.edge(signal);
      const repo = this.repo;
      if (!from || !this.last || !repo) return null;
      const [numstat, log] = await Promise.all([
        git(repo, ["diff-tree", "-r", "--numstat", "-z", from.tree, this.last.tree], signal),
        // Commits made since the turn started: a pull or a switch brings older ones, which don't count.
        // rev-list, not log, which your log settings, such as log.showSignature, would add lines to.
        git(repo, ["rev-list", "--abbrev-commit", `--since=@${Math.floor(from.at / 1000)}`, "HEAD", ...(from.head ? [`^${from.head}`] : [])], signal),
      ]);
      if (numstat === null) return null;
      return { files: numstats(numstat, repo.top), commits: (log ?? "").split("\n").filter(Boolean).reverse() };
    }, null);
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
    const folder = await mkdtemp(join(tmpdir(), "astrocode-ledger-"));
    folders.add(folder);
    const claude = relative(top, join(this.home, ".claude"));
    return {
      top,
      index,
      folder,
      env: { ...process.env, ...(await unfiltered(top)), GIT_INDEX_FILE: join(folder, "index"), GIT_OBJECT_DIRECTORY: join(folder, "objects"), GIT_ALTERNATE_OBJECT_DIRECTORIES: objects },
      claude: claude && !claude.startsWith("..") && !isAbsolute(claude) ? claude : undefined,
    };
  }

  private async write(repo: Repo, signal: AbortSignal): Promise<{ tree: string; head?: string } | null> {
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
    const big = (
      await Promise.all(
        paths.map(async (path) => {
          const stat = await lstat(join(repo.top, path)).catch(() => null);
          return stat?.isFile() && stat.size > BIG ? [{ path, size: stat.size, mtime: stat.mtimeMs }] : [];
        }),
      )
    ).flat();
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
    return tree ? { tree, head: head?.trim() || undefined } : null;
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

/** `diff-tree --numstat -z`'s lines as files, by absolute path. A binary file counts no lines. */
function numstats(text: string, top: string): FileChange[] {
  return text.split("\0").flatMap((record) => {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (!match) return [];
    const count = (value: string) => (value === "-" ? 0 : Number(value));
    return [{ path: join(top, match[3]!), added: count(match[1]!), removed: count(match[2]!) }];
  });
}
