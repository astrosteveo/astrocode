// Commands you run with `!`: run here, in the project, and added to the conversation the way
// Claude Code adds its own, so Claude sees them with your next message.
import { spawn } from "node:child_process";
import { topLevelEnv } from "./session";

/** As much of each stream as goes to Claude, as Claude Code's own shell output is cut. */
const MAX_OUTPUT = 30_000;

export type ShellResult = { stdout: string; stderr: string; code: number | null };

/** Runs `command` in your shell. It gets no input; `signal` stops it. */
export function runShell(command: string, cwd: string, signal: AbortSignal): Promise<ShellResult> {
  return new Promise((done) => {
    const shell = process.env.SHELL || "/bin/sh";
    const child = spawn(shell, ["-c", command], { cwd, env: topLevelEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    const take = (into: "stdout" | "stderr") => (chunk: Buffer) => {
      if (into === "stdout") stdout = (stdout + chunk.toString("utf8")).slice(0, MAX_OUTPUT);
      else stderr = (stderr + chunk.toString("utf8")).slice(0, MAX_OUTPUT);
    };
    child.stdout.on("data", take("stdout"));
    child.stderr.on("data", take("stderr"));
    // The command's whole process group, so what it started stops too.
    const stop = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {}
    };
    signal.addEventListener("abort", stop, { once: true });
    child.on("error", (error) => {
      signal.removeEventListener("abort", stop);
      done({ stdout, stderr: `${stderr}${error.message}\n`, code: null });
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", stop);
      done({ stdout, stderr: signal.aborted ? `${stderr}Stopped.\n` : stderr, code: signal.aborted ? null : code });
    });
  });
}
