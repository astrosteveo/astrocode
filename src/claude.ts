// Claude Code's own command line, for what the Agent SDK can't do: `claude plugin …` and the
// `edit-…` subcommands Claude Code's dialogs write settings with. It runs the binary the SDK runs.
import { dirname, join } from "node:path";
import { topLevelEnv } from "./session";

/**
 * Runs `claude <args>` in `cwd`, with `input` on its stdin. Its output is piped, never inherited:
 * nothing may write to the terminal behind Ink's back.
 */
export async function claude(cwd: string, args: string[], input?: string) {
  const child = Bun.spawn([claudeBinary(), ...args], {
    cwd,
    env: topLevelEnv(),
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { out, err, code };
}

let binary: string | undefined;

/** The Claude Code binary the SDK ships for this platform, as the SDK finds it, or `claude` on the PATH. */
function claudeBinary() {
  if (binary) return binary;
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  for (const flavor of ["", "-musl"]) {
    try {
      const manifest = Bun.resolveSync(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${flavor}/package.json`, import.meta.dir);
      return (binary = join(dirname(manifest), name));
    } catch {
      // Not installed for this platform; try the next.
    }
  }
  return (binary = "claude");
}
