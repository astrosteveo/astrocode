// Direction A, Ledger: one column that reads as a record of what Claude did and changed. A turn
// ends in a ledger of its changes; a cursor opens any line in place. Decisions open under the
// line they're about. One gutter column carries each entry's state.
import { Frame, type Span, type Style } from "./frame";
import { P } from "./palette";
import { diff, paragraph } from "./parts";
import { cacheTurn, firstEdit, status, turn1, turn2, wrap } from "./scenario";

const W = 120;
const H = 40;
/** Where results end: the column after the last one. */
const R = 118;
const TEXT = W - 4;

const code: Style = { fg: P.code };
const diffColors = (bg: string) => ({
  page: bg,
  added: P.added,
  removed: P.removed,
  number: P.dust,
  text: P.text,
  sign: { "+": P.teal, "-": P.rose },
  gap: P.dust,
});

function frame() {
  return new Frame(W, H, P.page, P.text);
}

/** Your message: a gold prompt mark, your words bright. */
function you(f: Frame, y: number, text: string) {
  f.put(0, y, "❯", { fg: P.gold, bold: true });
  return paragraph(f, 2, y, wrap(text, TEXT), { fg: P.bright, bold: true }, { fg: P.code, bold: true });
}

/** A finished step, folded to Claude's sentence. */
function folded(f: Frame, y: number, said: string, took: string, mark = "✓", color = P.teal) {
  f.put(0, y, mark, { fg: color });
  f.put(2, y, said, { fg: P.haze });
  f.right(R, y, took, { fg: P.dust });
}

/** A step's heading: its state in the gutter, Claude's sentence. */
function step(f: Frame, y: number, mark: string, color: string, said: string, took?: string) {
  f.put(0, y, mark, { fg: color });
  f.put(2, y, said, { fg: P.bright });
  if (took) f.right(R, y, took, { fg: P.dust });
}

/** One thing Claude did: verb, target, result at the measure's edge. */
function act(f: Frame, y: number, verb: string, target: Span[], result: Span[] = [], verbColor = P.haze) {
  f.put(4, y, verb, { fg: verbColor });
  f.spans(16, y, target.map(([t, s]) => [t, { fg: P.text, ...s }]));
  if (result.length) f.rightSpans(R, y, result);
}

/** Claude's reply: a teal mark, then prose. */
function reply(f: Frame, y: number, text: string) {
  f.put(0, y, "◆", { fg: P.teal });
  return paragraph(f, 2, y, wrap(text, TEXT), { fg: P.text }, code);
}

/** The turn's ledger: time, changes, tests, commit. */
function ledger(f: Frame, y: number, spans: Span[]) {
  f.put(0, y, "╰", { fg: P.dust });
  f.spans(2, y, spans);
}

const sep: Span = [" · ", { fg: P.dust }];

function turnOne(f: Frame, y: number) {
  y = you(f, y, turn1.prompt);
  turn1.steps.forEach((s, i) => folded(f, y + i, s.said, s.took));
  y = reply(f, y + turn1.steps.length, turn1.reply);
  ledger(f, y, [
    [turn1.took, { fg: P.haze }],
    sep,
    ["2 files ", { fg: P.haze }],
    ["+31", { fg: P.teal }],
    [" ", {}],
    ["−12", { fg: P.rose }],
    sep,
    ["4 passed", { fg: P.teal }],
    sep,
    ["committed ", { fg: P.haze }],
    ["f535656", { fg: P.code }],
  ]);
  return y + 1;
}

/** The box: a soft edge, gold when it has your keys, and one row to type in. */
function box(f: Frame, focused: boolean, placeholder: string, hint: Span[] = []) {
  f.line(0, H - 3, W, "▁", { fg: focused ? P.gold : P.surface });
  f.fill(0, H - 2, W, 1, P.surface);
  f.put(0, H - 2, "❯", { fg: focused ? P.gold : P.dust, bg: P.surface, bold: true });
  f.put(2, H - 2, placeholder, { fg: P.dust, bg: P.surface, italic: hint.length > 0 });
  if (hint.length) f.rightSpans(W - 1, H - 2, hint.map(([t, s]) => [t, { ...s, bg: P.surface }]));
}

function statusBar(f: Frame, extra: Span[] = []) {
  const y = H - 1;
  f.put(0, y, ` ${status.mode} `, { fg: P.ink, bg: P.haze });
  f.spans(13, y, [["← 1 needs you", { fg: P.gold }]]);
  f.rightSpans(W - 1, y, [
    ...extra,
    ["context ", { fg: P.haze }],
    [status.context, { fg: P.bright }],
    ["   5h ", { fg: P.haze }],
    [status.fiveHour, { fg: P.bright }],
    ["  7d ", { fg: P.haze }],
    [status.sevenDay, { fg: P.bright }],
    [`   ${status.model} `, { fg: P.bright }],
    [status.effort, { fg: P.haze }],
    [`   ${status.branch} `, { fg: P.haze }],
    [status.changed, { fg: P.gold }],
  ]);
}

export function working() {
  const f = frame();
  let y = turnOne(f, 0) + 1;
  y = you(f, y, turn2.prompt) + 1;
  f.put(0, y, "∴", { fg: P.dust });
  y = paragraph(f, 2, y, wrap(turn2.thinking, TEXT), { fg: P.haze, italic: true }, { fg: P.haze, italic: true }) + 1;

  step(f, y, "✓", P.teal, turn2.step1, "14s");
  act(f, y + 1, "Read", [["src/cache.ts"]], [["25 lines", { fg: P.haze }]]);
  act(f, y + 2, "Wrote", [["src/clock.ts"]], [["new  ", { fg: P.haze }], ["+11", { fg: P.teal }]]);
  act(f, y + 3, "Edited", [["src/cache.ts"]], [["+8", { fg: P.teal }], [" ", {}], ["−3", { fg: P.rose }]]);
  act(f, y + 4, "Wrote", [["src/cache.test.ts"]], [["new  ", { fg: P.haze }], ["+39", { fg: P.teal }]]);
  y += 6;

  step(f, y, "◌", P.teal, turn2.step2);
  act(f, y + 1, "Exploring", [["Find Date.now and setTimeout uses", {}]], [["3 calls · 22s", { fg: P.haze }]], P.teal);
  f.spans(16, y + 2, [["└ ", { fg: P.dust }], ["Grep ", { fg: P.haze }], ["setTimeout", { fg: P.code }], [" in src", { fg: P.haze }]]);
  act(f, y + 3, "Running", [["sleep 90 && echo warmed", { fg: P.code }]], [["41s", { fg: P.haze }]], P.teal);
  y += 5;

  step(f, y, "◐", P.teal, turn2.step3);
  act(f, y + 1, "Running", [["bun test", { fg: P.code }]], [["8s", { fg: P.haze }]], P.teal);

  // What Claude is doing now, in one line over the box: the one thing that moves.
  const now = H - 4;
  f.spans(0, now, [
    ["◐ ", { fg: P.teal }],
    ["Running ", { fg: P.teal }],
    ["bun test", { fg: P.bright }],
    [" · 8s · 2.1k tokens", { fg: P.haze }],
  ]);
  f.rightSpans(W - 1, now, [
    ["esc", { fg: P.haze }],
    [" stop   ", { fg: P.dust }],
    ["ctrl+b", { fg: P.haze }],
    [" background", { fg: P.dust }],
  ]);
  box(f, true, "Claude is working. Type to queue a message.");
  statusBar(f, [["◌ 2 running   ", { fg: P.teal }]]);
  return f;
}

export function permission() {
  const f = frame();
  let y = turnOne(f, 0) + 1;
  y = you(f, y, turn2.prompt) + 1;
  f.put(0, y, "∴", { fg: P.dust });
  y = paragraph(f, 2, y, wrap(turn2.thinking, TEXT), { fg: P.haze, italic: true }, { fg: P.haze, italic: true }) + 1;

  step(f, y, "◇", P.gold, turn2.step1);
  act(f, y + 1, "Read", [["src/cache.ts"]], [["25 lines", { fg: P.haze }]]);
  act(f, y + 2, "Wrote", [["src/clock.ts"]], [["new  ", { fg: P.haze }], ["+11", { fg: P.teal }]]);
  act(f, y + 3, "Edit", [["src/cache.ts", { fg: P.gold }]], [["+6", { fg: P.teal }], [" ", {}], ["−1", { fg: P.rose }]], P.gold);

  // The decision opens under the line it's about, takes the box's place, and has the keys.
  const top = y + 4;
  f.line(2, top, W - 2, "▁", { fg: P.gold });
  const panel = top + 1;
  f.fill(2, panel, W - 2, H - 1 - panel, P.surface);
  f.spans(4, panel, [
    ["Edit ", { fg: P.bright, bg: P.surface, bold: true }],
    ["src/cache.ts", { fg: P.bright, bg: P.surface, bold: true }],
    ["?", { fg: P.bright, bg: P.surface, bold: true }],
  ]);
  f.rightSpans(R, panel, [["waiting 18s", { fg: P.gold, bg: P.surface }]]);
  const d = diff(f, 4, panel + 2, R - 4, firstEdit, diffColors(P.surface));
  const options: [string, string, string][] = [
    ["1", "Yes", ""],
    ["2", "Yes, and accept edits for the rest of this session", "shift+tab"],
    ["3", "No, and tell Claude what to do instead", "esc"],
  ];
  options.forEach(([key, label, shortcut], i) => {
    const row = d + 1 + i;
    const bg = i === 0 ? P.raised : P.surface;
    f.fill(4, row, R - 4, 1, bg);
    f.put(4, row, i === 0 ? "›" : " ", { fg: P.gold, bg, bold: true });
    f.put(6, row, key, { fg: P.haze, bg });
    f.put(9, row, label, { fg: i === 0 ? P.bright : P.text, bg, bold: i === 0 });
    if (shortcut) f.right(R - 1, row, shortcut, { fg: P.dust, bg });
  });
  f.spans(4, H - 2, [
    ["↑↓", { fg: P.haze, bg: P.surface }],
    [" or ", { fg: P.dust, bg: P.surface }],
    ["1–3", { fg: P.haze, bg: P.surface }],
    [" choose   ", { fg: P.dust, bg: P.surface }],
    ["enter", { fg: P.haze, bg: P.surface }],
    [" confirm   ", { fg: P.dust, bg: P.surface }],
    ["tab", { fg: P.haze, bg: P.surface }],
    [" add a comment   ", { fg: P.dust, bg: P.surface }],
    ["ctrl+o", { fg: P.haze, bg: P.surface }],
    [" whole file", { fg: P.dust, bg: P.surface }],
  ]);
  statusBar(f);
  return f;
}

export function review() {
  const f = frame();
  let y = you(f, 0, turn2.prompt);
  folded(f, y, turn2.step1, "1m 2s");
  folded(f, y + 1, "Checked where else the code reads the clock, in the background.", "31s");
  folded(f, y + 2, "Ran the whole suite; retry's attempts test still fails, as expected.", "16s", "✕", P.rose);
  f.spans(4, y + 3, [
    ["bun test", { fg: P.code }],
    ["  7 passed, ", { fg: P.haze }],
    ["1 failed", { fg: P.rose }],
    ["   retry.test.ts:23 expected 3 calls, got 4", { fg: P.haze }],
  ]);
  y = reply(f, y + 4, turn2.reply);

  // The ledger is the review: Enter opens a file's diff in place; the cursor has the keys.
  ledger(f, y, [
    ["1m 40s", { fg: P.haze }],
    sep,
    ["3 files ", { fg: P.bright }],
    ["+58", { fg: P.teal }],
    [" ", {}],
    ["−3", { fg: P.rose }],
    sep,
    ["7 passed ", { fg: P.teal }],
    ["1 failed", { fg: P.rose }],
    sep,
    ["not committed", { fg: P.ember }],
  ]);
  const row = (at: number, name: string, result: Span[], kind = "", cursor = false) => {
    const bg = cursor ? P.raised : P.page;
    if (cursor) f.fill(2, at, R - 2, 1, bg);
    f.put(2, at, cursor ? "›" : " ", { fg: P.gold, bg, bold: true });
    f.put(4, at, name, { fg: cursor ? P.bright : P.text, bg, bold: cursor });
    if (kind) f.put(24, at, kind, { fg: P.haze, bg });
    f.rightSpans(R, at, result.map(([t, s]) => [t, { ...s, bg }]));
  };
  row(y + 1, "src/clock.ts", [["+11", { fg: P.teal }]], "new");
  row(y + 2, "src/cache.ts", [["+8", { fg: P.teal }], [" ", {}], ["−3", { fg: P.rose }]], "", true);
  f.fill(4, y + 3, R - 4, cacheTurn.length, P.surface);
  const after = diff(f, 4, y + 3, R - 4, cacheTurn, diffColors(P.surface));
  row(after, "src/cache.test.ts", [["+39", { fg: P.teal }]], "new");
  row(after + 1, "bun test", [["7 passed, ", { fg: P.teal }], ["1 failed", { fg: P.rose }]]);
  row(after + 2, "sleep 90 && echo warmed", [["exit 0 · 1m 30s", { fg: P.haze }]]);

  f.spans(2, H - 4, [
    ["↑↓", { fg: P.haze }],
    [" move   ", { fg: P.dust }],
    ["enter", { fg: P.haze }],
    [" open or close   ", { fg: P.dust }],
    ["a", { fg: P.haze }],
    [" open all   ", { fg: P.dust }],
    ["e", { fg: P.haze }],
    [" edit in $EDITOR   ", { fg: P.dust }],
    ["c", { fg: P.haze }],
    [" copy path   ", { fg: P.dust }],
    ["esc", { fg: P.haze }],
    [" back to the box", { fg: P.dust }],
  ]);
  // Claude Code's next-prompt suggestion, as claude offers it: Tab or → takes it.
  box(f, false, "merge it", [["tab", { fg: P.haze }], [" to use", { fg: P.dust }]]);
  statusBar(f);
  return f;
}
