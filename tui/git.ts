export type GitInfo = { branch: string; changes: number };

/** The branch and how many files have changes, or null outside a git repository. */
export async function gitInfo(cwd: string): Promise<GitInfo | null> {
  // `branch --show-current` also works in a repository with no commits yet.
  const branch = (await git(cwd, ["branch", "--show-current"])) || (await git(cwd, ["rev-parse", "--short", "HEAD"]));
  if (!branch) return null;
  const status = await git(cwd, ["status", "--porcelain"]);
  return { branch, changes: status ? status.split("\n").filter(Boolean).length : 0 };
}

async function git(cwd: string, args: string[]) {
  try {
    const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(child.stdout).text();
    return (await child.exited) === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}
