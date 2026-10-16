#!/usr/bin/env bun
// astrocode: Claude Code's engine with our own terminal front end.
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `Usage: astrocode [options] [project-dir]

Runs Claude in project-dir (default: the current folder), signed in as Claude Code is.

Options:
  -c, --continue       Continue the most recent session here
  -r, --resume <id>    Resume a session by id
  -m, --model <model>  Model to use, such as opus or haiku (default: Claude Code's)
  -h, --help           Show this help`;

const { values, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        continue: { type: "boolean", short: "c" },
        resume: { type: "string", short: "r" },
        model: { type: "string", short: "m" },
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

const { startTerminal } = await import("../tui/main");
await startTerminal({
  cwd: resolve(positionals[0] ?? process.cwd()),
  model: values.model ?? (process.env.ASTROCODE_MODEL || undefined),
  resume: values.resume,
  continue: values.continue,
});
