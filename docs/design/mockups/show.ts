// Prints one mockup and holds it on screen until killed, for the screenshot.
//   bun docs/design/mockups/show.ts a working
import * as a from "./a-ledger";
import * as b from "./b-workbench";
import * as c from "./c-plus";
import type { Frame } from "./frame";

export const DIRECTIONS: Record<string, Record<string, () => Frame>> = {
  a: { working: a.working, permission: a.permission, review: a.review },
  b: { working: b.working, permission: b.permission, review: b.review },
  c: { working: c.working, permission: c.permission, review: c.review },
};

if (import.meta.main) {
  const [direction = "", moment = ""] = process.argv.slice(2);
  const make = DIRECTIONS[direction]?.[moment];
  if (!make) {
    console.error(`usage: bun show.ts <${Object.keys(DIRECTIONS).join("|")}> <working|permission|review>`);
    process.exit(2);
  }
  // Hide the cursor and print from the top-left, with nothing after the last row.
  process.stdout.write(`\x1b[?25l\x1b[2J\x1b[H${make().ansi()}`);
  setInterval(() => {}, 1 << 30);
}
