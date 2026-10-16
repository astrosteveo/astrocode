#!/usr/bin/env bun
// astrocode: Claude Code's engine with our own terminal front end.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { EFFORTS, isEffort } from "./events";

const USAGE = `Usage: astrocode [options] [project-dir]

Runs Claude in project-dir (default: the current folder), signed in as Claude Code is.

Options:
  -c, --continue       Continue the most recent session here
  -r, --resume <id>    Resume a session by id
  -m, --model <model>  Model to use, such as opus or haiku (default: Claude Code's)
  -e, --effort <level> Effort: low, medium, high, xhigh or max (default: Claude Code's)
  -f, --fullscreen     Use the whole terminal, with the mouse (or set ASTROCODE_FULLSCREEN=1)
  -h, --help           Show this help`;

const { values, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        continue: { type: "boolean", short: "c" },
        resume: { type: "string", short: "r" },
        model: { type: "string", short: "m" },
        effort: { type: "string", short: "e" },
        fullscreen: { type: "boolean", short: "f" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    process.exit(2);
  }
})();

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const effort = values.effort ?? (process.env.ASTROCODE_EFFORT || undefined);
if (effort !== undefined && !isEffort(effort)) {
  console.error(`Effort must be one of ${EFFORTS.join(", ")}.\n\n${USAGE}`);
  process.exit(2);
}

const { startTerminal } = await import("../tui/main");
await startTerminal({
  cwd: resolve(positionals[0] ?? process.cwd()),
  model: values.model ?? (process.env.ASTROCODE_MODEL || undefined),
  effort,
  resume: values.resume,
  continue: values.continue,
  fullscreen: values.fullscreen ?? /^(1|true|yes|on)$/i.test(process.env.ASTROCODE_FULLSCREEN ?? ""),
});
