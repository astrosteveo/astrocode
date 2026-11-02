// Every mockup, and a way to print one and hold it on screen until killed, for the screenshot.
//   bun docs/design/mockups/show.ts a-working        prints one
//   bun docs/design/mockups/show.ts --list           names, sizes and folders, for shoot.sh
import * as a from "./a-ledger";
import * as b from "./b-workbench";
import * as c from "./c-plus";
import type { Frame } from "./frame";
import * as spec from "./spec";

type Mockup = { folder: string; cols: number; rows: number; make: () => Frame };

const direction = (key: string, mod: typeof b): Record<string, Mockup> => ({
  [`${key}-working`]: { folder: "directions/shots", cols: 120, rows: 40, make: () => mod.working() },
  [`${key}-permission`]: { folder: "directions/shots", cols: 120, rows: 40, make: () => mod.permission() },
  [`${key}-review`]: { folder: "directions/shots", cols: 120, rows: 40, make: () => mod.review() },
});

const at = (make: (W: number, H: number) => Frame, cols: number, rows: number): Mockup => ({ folder: "shots", cols, rows, make: () => make(cols, rows) });

export const MOCKUPS: Record<string, Mockup> = {
  ...direction("a", a),
  ...direction("b", b),
  ...direction("c", c),
  launch: at(spec.launch, 120, 40),
  writing: at(spec.writing, 120, 40),
  working: at(a.working, 120, 40),
  "working-80": at(a.working, 80, 24),
  permission: at(a.permission, 120, 40),
  "permission-80": at(spec.permissionBash, 80, 24),
  question: at(spec.question, 120, 40),
  failing: at(spec.failing, 120, 40),
  "subagent-200": at(spec.subagent, 200, 50),
  review: at(a.review, 120, 40),
  resume: at(spec.resume, 120, 40),
  conversations: at(spec.conversations, 120, 40),
  keys: at(spec.keys, 120, 40),
  states: at(spec.states, 120, 40),
};

if (import.meta.main) {
  const [name = ""] = process.argv.slice(2);
  if (name === "--list") {
    for (const [key, m] of Object.entries(MOCKUPS)) console.log(`${key} ${m.cols} ${m.rows} ${m.folder}`);
    process.exit(0);
  }
  const mockup = MOCKUPS[name];
  if (!mockup) {
    console.error(`usage: bun show.ts <${Object.keys(MOCKUPS).join("|")}> | --list`);
    process.exit(2);
  }
  // Hide the cursor and print from the top-left, with nothing after the last row.
  process.stdout.write(`\x1b[?25l\x1b[2J\x1b[H${mockup.make().ansi()}`);
  setInterval(() => {}, 1 << 30);
}
