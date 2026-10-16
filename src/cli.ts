#!/usr/bin/env bun
// astrocode: Claude Code's engine with our own front end, in the terminal or the browser.
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `Usage: astrocode [options] [project-dir]

Runs Claude in project-dir (default: the current folder), signed in as Claude Code is.

Options:
  -c, --continue       Continue the most recent session here
  -r, --resume <id>    Resume a session by id
  -m, --model <model>  Model to use, such as opus or haiku (default: Claude Code's)
      --web            Open the browser front end instead of the terminal one
      --port <port>    Port for --web (default: 4317)
  -h, --help           Show this help`;

const { values, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        continue: { type: "boolean", short: "c" },
        resume: { type: "string", short: "r" },
        model: { type: "string", short: "m" },
        web: { type: "boolean" },
        port: { type: "string" },
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

const cwd = resolve(positionals[0] ?? process.cwd());
const model = values.model ?? (process.env.ASTROCODE_MODEL || undefined);

if (values.web) {
  const { startWeb } = await import("./server");
  startWeb({ cwd, model, port: Number(values.port ?? process.env.ASTROCODE_PORT ?? 4317) });
} else {
  const { startTerminal } = await import("../tui/main");
  await startTerminal({ cwd, model, resume: values.resume, continue: values.continue });
}
