// Direction A, Ledger, as the spec draws it: one column that reads as a record of what Claude did
// and changed. A turn ends in a ledger of its changes; a cursor opens any line in place. Decisions
// open under the line they're about. The frames are parametric in size, so the spec's width
// examples are the same drawings.
import { dust, haze, Ledger, minus, plus, screen, sep, size } from "./kit";
import { P } from "./palette";
import { cacheTurn, firstEdit, turn1, turn2 } from "./scenario";

/** Turn 1, finished: your message, Claude's step sentences, the reply, the ledger. */
export function turnOne(l: Ledger, y: number) {
  y = l.you(y, turn1.prompt);
  for (const s of turn1.steps) y = l.fold(y, s.said, s.took);
  y = l.reply(y, turn1.reply);
  return l.ledger(y, [haze(turn1.took), sep, haze("2 files "), plus(31), [" ", {}], minus(12), sep, ["4 passed", { fg: P.teal }], sep, haze("committed "), ["f535656", { fg: P.code }]]);
}

/** Turn 2 up to Claude's first step: your message and its thinking. */
export function turnTwoStart(l: Ledger, y: number) {
  y = l.you(y, turn2.prompt) + 1;
  return l.thinking(y, turn2.thinking) + 1;
}

/** Turn 2's first step, done: the clock moved into its own file. */
export function stepOne(l: Ledger, y: number, took = "14s") {
  y = l.step(y, "done", turn2.step1, took);
  y = l.act(y, "Read", [["src/cache.ts"]], [haze("25 lines")]);
  y = l.act(y, "Wrote", [["src/clock.ts"]], size(11, 0, true));
  y = l.act(y, "Edited", [["src/cache.ts"]], size(8, 3));
  return l.act(y, "Wrote", [["src/cache.test.ts"]], size(39, 0, true));
}

export function working(W = 120, H = 40) {
  const l = screen(W, H, 4, (t) => {
    let y = turnOne(t, 0) + 1;
    y = turnTwoStart(t, y);
    y = stepOne(t, y) + 1;
    y = t.step(y, "background", turn2.step2);
    y = t.act(y, "Exploring", [["Find Date.now and setTimeout uses"]], [haze("3 calls · 22s")], P.teal);
    y = t.under(y, [haze("Grep "), ["setTimeout", { fg: P.code }], haze(" in src")]);
    y = t.act(y, "Running", [["sleep 90 && echo warmed"]], [haze("41s")], P.teal) + 1;
    y = t.step(y, "running", turn2.step3);
    return t.act(y, "Running", [["bun test"]], [haze("8s")], P.teal);
  });

  l.now([["◐ ", { fg: P.teal }], ["Running ", { fg: P.teal }], ["bun test", { fg: P.bright }], haze(" · 8s · 2.1k tokens")], [["esc", "stop"], ["ctrl+b", "background"]]);
  l.box(true, "Claude is working. Type to queue a message.");
  l.status({ needsYou: 1, running: 2 });
  return l.f;
}

export function permission(W = 120, H = 40) {
  const l = new Ledger(W, H);
  let y = turnOne(l, 0) + 1;
  y = turnTwoStart(l, y);
  y = l.step(y, "waiting", turn2.step1);
  y = l.act(y, "Read", [["src/cache.ts"]], [haze("25 lines")]);
  y = l.act(y, "Wrote", [["src/clock.ts"]], size(11, 0, true));
  y = l.act(y, "Edit", [["src/cache.ts", { fg: P.gold }]], size(6, 1), P.gold);

  // The decision opens under the line it's about, takes the box's place, and has your keys.
  const top = y + 1;
  l.panel(top, H - 1, true);
  l.f.put(4, top, "Edit src/cache.ts?", { fg: P.bright, bg: P.surface, bold: true });
  l.f.right(l.edge, top, "waiting 18s", { fg: P.gold, bg: P.surface });
  const d = l.diff(4, top + 2, l.edge - 4, firstEdit);
  l.options(d + 1, 4, l.edge, [["Yes"], ["Yes, and accept edits for the rest of this session", "shift+tab"], ["No, and tell Claude what to do instead", "esc"]]);
  l.hints(H - 2, 4, [["↑↓", "or 1–3 choose"], ["enter", "confirm"], ["tab", "add a comment"], ["ctrl+o", "whole file"]], P.surface);
  l.status({ needsYou: 1 });
  return l.f;
}

export function review(W = 120, H = 40) {
  const l = new Ledger(W, H);
  let y = l.you(0, turn2.prompt);
  y = l.fold(y, turn2.step1, "1m 2s");
  y = l.fold(y, "Checked where else the code reads the clock, in the background.", "31s");
  y = l.fold(y, "Ran the whole suite; retry's attempts test still fails, as expected.", "16s", "failed");
  y = l.under(y, [["bun test", { fg: P.code }], haze("  7 passed, "), ["1 failed", { fg: P.rose }], haze("   retry.test.ts:23 expected 3 calls, got 4")]);
  y = l.reply(y, turn2.reply);

  // The ledger is the review: Enter opens a file's diff in place; the cursor has your keys.
  y = l.ledger(y, [haze("1m 40s"), sep, ["3 files ", { fg: P.bright }], plus(58), [" ", {}], minus(3), sep, ["7 passed ", { fg: P.teal }], ["1 failed", { fg: P.rose }], sep, ["not committed", { fg: P.ember }]]);
  y = l.entry(y, [["src/clock.ts"]], size(11, 0, true));
  y = l.entry(y, [["src/cache.ts"]], size(8, 3), true);
  y = l.diff(4, y, l.edge - 4, cacheTurn);
  y = l.entry(y, [["src/cache.test.ts"]], size(39, 0, true));
  y = l.entry(y, [["bun test"]], [["7 passed, ", { fg: P.teal }], ["1 failed", { fg: P.rose }]]);
  l.entry(y, [["sleep 90 && echo warmed"]], [haze("exit 0 · 1m 30s")]);

  l.hints(H - 4, 2, [["↑↓", "move"], ["enter", "open or close"], ["a", "open all"], ["e", "edit in $EDITOR"], ["c", "copy path"], ["esc", "back to the box"]]);
  // Claude Code's next-prompt suggestion, as claude offers it: Tab or → takes it.
  l.box(false, "merge it", [["tab", { fg: P.haze }], dust(" to use")]);
  l.status({ needsYou: 1 });
  return l.f;
}
