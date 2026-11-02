// Direction B, Workbench: what Claude says on the left, what Claude does on the right. The work
// pane follows the live call, shows each change as it lands, holds decisions next to what they
// decide, and becomes the turn's review when the turn ends.
import { Frame, type Span, type Style } from "./frame";
import { P } from "./palette";
import { diff, fit, paragraph } from "./parts";
import { cacheTest, cacheTurn, firstEdit, status, turn1, turn2, wrap } from "./scenario";

const W = 120;
const H = 40;
/** The work pane: from this column to the edge. */
const X = 63;
/** Text columns in the conversation. */
const TALK = X - 4;
/** The pane's content edge: the column after its last. */
const PR = W - 1;

const code: Style = { fg: P.code };

function frame() {
  const f = new Frame(W, H, P.page, P.text);
  f.fill(X, 0, W - X, H - 3, P.surface);
  return f;
}

const on = (s: Style = {}): Style => ({ bg: P.surface, ...s });

function you(f: Frame, y: number, text: string) {
  f.put(0, y, "❯", { fg: P.gold, bold: true });
  return paragraph(f, 2, y, wrap(text, TALK), { fg: P.bright, bold: true }, { fg: P.code, bold: true });
}

function said(f: Frame, y: number, text: string, mark = "◆", color = P.teal, style: Style = { fg: P.text }) {
  f.put(0, y, mark, { fg: color });
  return paragraph(f, 2, y, wrap(text, TALK), style, code);
}

/** The line under a sentence that stands for its calls; it opens them in the work pane. */
function calls(f: Frame, y: number, spans: Span[]) {
  f.spans(2, y, spans);
  f.put(X - 2, y, "›", { fg: P.dust });
  return y + 1;
}

const sep: Span = [" · ", { fg: P.dust }];

function talkTurnOne(f: Frame, y: number) {
  y = you(f, y, turn1.prompt);
  y = said(f, y, turn1.reply);
  return calls(f, y, [["✓ ", { fg: P.teal }], ["9 calls", { fg: P.haze }], sep, ["2 files ", { fg: P.haze }], ["+31", { fg: P.teal }], [" ", {}], ["−12", { fg: P.rose }], sep, ["4 passed", { fg: P.teal }]]);
}

function talkTurnTwo(f: Frame, y: number) {
  y = you(f, y, turn2.prompt) + 1;
  y = said(f, y, turn2.thinking, "∴", P.dust, { fg: P.haze, italic: true }) + 1;
  return y;
}

/** The pane's views, the open one raised. Gold on the pane's edge when it has your keys. */
function tabs(f: Frame, open: string, focused: boolean) {
  const views = ["Now", "Changes 3", "Calls 9", "Background 2"];
  let x = X + 1;
  for (const view of views) {
    const here = view.startsWith(open);
    x = f.put(x, 0, ` ${view} `, on({ fg: here ? P.bright : P.haze, bg: here ? P.raised : P.surface, bold: here })) + 1;
  }
  for (let y = 0; y < H - 3; y++) f.put(X, y, focused ? "▌" : " ", on({ fg: P.gold }));
}

function hints(f: Frame, spans: [string, string][]) {
  f.spans(X + 2, H - 4, spans.flatMap(([key, does], i): Span[] => [[key, on({ fg: P.haze })], [` ${does}${i < spans.length - 1 ? "   " : ""}`, on({ fg: P.dust })]]));
}

const diffColors = { page: P.surface, added: P.added, removed: P.removed, number: P.dust, text: P.text, sign: { "+": P.teal, "-": P.rose }, gap: P.dust };

function box(f: Frame, focused: boolean, placeholder: string) {
  f.line(0, H - 3, W, "▁", { fg: focused ? P.gold : P.surface });
  f.fill(0, H - 2, W, 1, P.surface);
  f.put(0, H - 2, "❯", { fg: focused ? P.gold : P.dust, bg: P.surface, bold: true });
  f.put(2, H - 2, placeholder, { fg: P.dust, bg: P.surface });
}

function statusBar(f: Frame) {
  const y = H - 1;
  f.put(0, y, ` ${status.mode} `, { fg: P.ink, bg: P.haze });
  f.spans(13, y, [["← 1 needs you", { fg: P.gold }]]);
  f.rightSpans(W - 1, y, [
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
  let y = talkTurnOne(f, 0) + 1;
  y = talkTurnTwo(f, y);
  y = said(f, y, turn2.step1, "✓");
  y = calls(f, y, [["4 calls", { fg: P.haze }], sep, ["3 files ", { fg: P.haze }], ["+58", { fg: P.teal }], [" ", {}], ["−3", { fg: P.rose }]]) + 1;
  y = said(f, y, turn2.step2, "◌");
  y = calls(f, y, [["◌ 2 in the background", { fg: P.teal }]]) + 1;
  y = said(f, y, turn2.step3, "◐");
  calls(f, y, [["◐ ", { fg: P.teal }], ["bun test", { fg: P.text }], [" · 8s", { fg: P.haze }]]);

  tabs(f, "Now", false);
  f.spans(X + 2, 2, [["◐ ", on({ fg: P.teal })], ["Running ", on({ fg: P.teal })], ["bun test", on({ fg: P.bright, bold: true })]]);
  f.right(PR, 2, "8s · 2.1k tokens", on({ fg: P.haze }));
  f.put(X + 4, 3, "$ bun test 2>&1", on({ fg: P.haze }));
  f.put(X + 4, 4, "Its output shows when it ends.", on({ fg: P.dust, italic: true }));

  f.spans(X + 2, 6, [["Just changed  ", on({ fg: P.haze })], ["src/cache.test.ts", on({ fg: P.bright })]]);
  f.rightSpans(PR, 6, [["new  ", on({ fg: P.haze })], ["+39", on({ fg: P.teal })]]);
  const shown = cacheTest.slice(0, 13);
  shown.forEach((line, i) => {
    f.fill(X + 2, 7 + i, PR - X - 2, 1, P.added);
    f.put(X + 2, 7 + i, String(i + 1).padStart(3), { fg: P.dust, bg: P.added });
    f.put(X + 7, 7 + i, fit(line, PR - X - 8), { fg: P.text, bg: P.added });
  });
  f.put(X + 4, 20, `⋯ ${cacheTest.length + 24 - shown.length} more lines`, on({ fg: P.dust }));

  f.put(X + 2, 23, "Background", on({ fg: P.haze }));
  f.spans(X + 2, 24, [["◌ ", on({ fg: P.teal })], ["Explore ", on({ fg: P.teal })], ["Find Date.now and setTimeout uses", on({ fg: P.text })]]);
  f.right(PR, 24, "22s", on({ fg: P.haze }));
  f.spans(X + 4, 25, [["3 calls · ", on({ fg: P.dust })], ["Grep setTimeout in src", on({ fg: P.haze })]]);
  f.spans(X + 2, 26, [["◌ ", on({ fg: P.teal })], ["sleep 90 && echo warmed", on({ fg: P.text })]]);
  f.right(PR, 26, "41s", on({ fg: P.haze }));

  hints(f, [["tab", "views"], ["ctrl+\\", "hide pane"], ["enter", "inspect"]]);
  box(f, true, "Claude is working. Type to queue a message.");
  statusBar(f);
  return f;
}

export function permission() {
  const f = frame();
  let y = talkTurnOne(f, 0) + 1;
  y = talkTurnTwo(f, y);
  y = said(f, y, turn2.step1, "◇", P.gold);
  calls(f, y, [["◇ ", { fg: P.gold }], ["Edit src/cache.ts", { fg: P.gold }], [" · your call, on the right", { fg: P.haze }]]);

  tabs(f, "Now", true);
  f.spans(X + 2, 2, [["◇ ", on({ fg: P.gold })], ["Edit src/cache.ts?", on({ fg: P.bright, bold: true })]]);
  f.right(PR, 2, "waiting 18s", on({ fg: P.gold }));
  f.put(X + 4, 3, "Give Cache an optional clock, as retry has.", on({ fg: P.haze }));
  const d = diff(f, X + 2, 5, PR - X - 2, firstEdit, diffColors);
  const options: [string, string][] = [
    ["Yes", ""],
    ["Yes, accept edits this session", "shift+tab"],
    ["No, tell Claude what to do instead", "esc"],
  ];
  options.forEach(([label, key], i) => {
    const row = d + 1 + i;
    const bg = i === 0 ? P.raised : P.surface;
    f.fill(X + 2, row, PR - X - 2, 1, bg);
    f.put(X + 2, row, i === 0 ? "›" : " ", { fg: P.gold, bg, bold: true });
    f.put(X + 4, row, String(i + 1), { fg: P.haze, bg });
    f.put(X + 7, row, label, { fg: i === 0 ? P.bright : P.text, bg, bold: i === 0 });
    if (key) f.right(PR - 1, row, key, { fg: P.dust, bg });
  });
  f.put(X + 2, d + 5, "This turn so far", on({ fg: P.haze }));
  f.spans(X + 2, d + 6, [["✓ ", on({ fg: P.teal })], ["Read    ", on({ fg: P.haze })], ["src/cache.ts", on({ fg: P.text })]]);
  f.right(PR, d + 6, "25 lines", on({ fg: P.haze }));
  f.spans(X + 2, d + 7, [["✓ ", on({ fg: P.teal })], ["Wrote   ", on({ fg: P.haze })], ["src/clock.ts", on({ fg: P.text })]]);
  f.rightSpans(PR, d + 7, [["new  ", on({ fg: P.haze })], ["+11", on({ fg: P.teal })]]);
  f.spans(X + 2, d + 8, [["◇ ", on({ fg: P.gold })], ["Edit    ", on({ fg: P.gold })], ["src/cache.ts", on({ fg: P.gold })]]);

  hints(f, [["1–3", "choose"], ["enter", "confirm"], ["tab", "comment"]]);
  box(f, false, "Answer on the right, or type to queue a message.");
  statusBar(f);
  return f;
}

export function review() {
  const f = frame();
  let y = talkTurnTwo(f, 0);
  y = said(f, y, turn2.step1, "✓");
  y = said(f, y, turn2.step2.replace("Checking", "Checked"), "✓");
  y = said(f, y, "Ran the whole suite; retry's attempts test still fails, as expected.", "✕", P.rose) + 1;
  y = said(f, y, turn2.reply);
  calls(f, y, [["✓ ", { fg: P.teal }], ["6 calls", { fg: P.haze }], sep, ["3 files ", { fg: P.bright }], ["+58", { fg: P.teal }], [" ", {}], ["−3", { fg: P.rose }], sep, ["7 passed ", { fg: P.teal }], ["1 failed", { fg: P.rose }]]);

  tabs(f, "Changes", true);
  f.spans(X + 2, 2, [["This turn ", on({ fg: P.bright, bold: true })], ["▾", on({ fg: P.haze })]]);
  f.rightSpans(PR, 2, [["uncommitted", on({ fg: P.dust })], ["  ", on({})], ["branch", on({ fg: P.dust })]]);
  f.spans(X + 2, 3, [["3 files ", on({ fg: P.haze })], ["+58", on({ fg: P.teal })], [" ", on({})], ["−3", on({ fg: P.rose })], [" · not committed", on({ fg: P.ember })]]);
  const files: [string, Span[], boolean][] = [
    ["src/clock.ts", [["new  ", on({ fg: P.haze })], ["+11", on({ fg: P.teal })]], false],
    ["src/cache.ts", [["+8", on({ fg: P.teal })], [" ", on({})], ["−3", on({ fg: P.rose })]], true],
    ["src/cache.test.ts", [["new  ", on({ fg: P.haze })], ["+39", on({ fg: P.teal })]], false],
  ];
  files.forEach(([name, size, here], i) => {
    const row = 5 + i;
    const bg = here ? P.raised : P.surface;
    f.fill(X + 2, row, PR - X - 2, 1, bg);
    f.put(X + 2, row, here ? "›" : " ", { fg: P.gold, bg, bold: true });
    f.put(X + 4, row, name, { fg: here ? P.bright : P.text, bg, bold: here });
    f.rightSpans(PR - 1, row, size.map(([t, s]) => [t, { ...s, bg }]));
  });
  const d = diff(f, X + 2, 9, PR - X - 2, cacheTurn, diffColors);
  f.spans(X + 2, d + 1, [["Tests  ", on({ fg: P.haze })], ["bun test", on({ fg: P.text })], ["  7 passed, ", on({ fg: P.teal })], ["1 failed", on({ fg: P.rose })]]);
  f.put(X + 9, d + 2, "retry.test.ts:23 expected 3 calls, got 4", on({ fg: P.haze }));

  hints(f, [["↑↓", "file"], ["[ ]", "scope"], ["e", "$EDITOR"], ["esc", "back to the box"]]);
  box(f, false, "merge it");
  f.rightSpans(W - 1, H - 2, [["tab", { fg: P.haze, bg: P.surface }], [" to use", { fg: P.dust, bg: P.surface }]]);
  statusBar(f);
  return f;
}
