// Direction C, Claude Code plus: claude's own screen, glyphs, prompts and keys, with only what it
// lacks added: steps named in Claude's words, each turn's changes on its done line, thinking
// shown, the other conversations in the footer, and readings it has no room for by default.
import { Frame, type Span, type Style } from "./frame";
import { CC } from "./palette";
import { diff, paragraph } from "./parts";
import { cacheTurn, firstEdit, status, turn1, turn2, wrap } from "./scenario";

const W = 120;
const H = 40;
const TEXT = W - 4;
/** In claude, code in prose is the text's color, so backticks only drop out. */
const code: Style = { fg: CC.text };

function frame() {
  return new Frame(W, H, CC.page, CC.text);
}

function you(f: Frame, y: number, text: string) {
  const lines = wrap(text, TEXT);
  f.fill(0, y, W, lines.length, CC.promptBg);
  f.put(0, y, "❯", { fg: CC.text, bg: CC.promptBg });
  lines.forEach((line, i) => f.put(2, y + i, line.replaceAll("`", ""), { fg: CC.text, bg: CC.promptBg }));
  return y + lines.length;
}

function bullet(f: Frame, y: number, text: string, dot = CC.text, style: Style = { fg: CC.text }) {
  f.put(0, y, "●", { fg: dot });
  return paragraph(f, 2, y, wrap(text, TEXT), style, code);
}

/** claude's result line under a call: ⎿ and dim text. */
function result(f: Frame, y: number, spans: Span[]) {
  f.put(2, y, "⎿", { fg: CC.dim });
  f.spans(5, y, spans.map(([t, s]) => [t, { fg: CC.dim, ...s }]));
  return y + 1;
}

const ours = (text: string, s: Style = {}): Span => [text, { fg: CC.ours, ...s }];

function turnOne(f: Frame, y: number) {
  y = you(f, y, turn1.prompt) + 1;
  y = bullet(f, y, turn1.reply);
  f.put(2, y, "Thought for 20s, ran 4 shell commands", { fg: CC.dim });
  f.spans(0, y + 1, [
    ["✻ ", { fg: CC.dim }],
    [`Cogitated for ${turn1.took}`, { fg: CC.dim }],
    [" · ", { fg: CC.faint }],
    ours("2 files "),
    ["+31", { fg: CC.success }],
    [" ", {}],
    ["−12", { fg: CC.error }],
    [" · ", { fg: CC.faint }],
    ours("committed f535656"),
  ]);
  return y + 2;
}

function thinking(f: Frame, y: number) {
  f.put(0, y, "∴", { fg: CC.dim });
  return paragraph(f, 2, y, wrap(turn2.thinking, TEXT), { fg: CC.dim, italic: true }, { fg: CC.dim, italic: true });
}

/** claude's box: a rule, the prompt, a rule; the footer under it. */
function box(f: Frame, footer: Span[], right: Span[]) {
  f.line(0, H - 5, W, "─", { fg: CC.faint });
  f.put(0, H - 4, "❯", { fg: CC.text });
  f.line(0, H - 3, W, "─", { fg: CC.faint });
  footerRows(f, footer, right);
}

function footerRows(f: Frame, footer: Span[], right: Span[]) {
  f.spans(2, H - 2, footer);
  f.rightSpans(W - 1, H - 2, [
    ours(`ctx ${status.context}`),
    [" · ", { fg: CC.faint }],
    ours(`5h ${status.fiveHour}  7d ${status.sevenDay}`),
    [" · ", { fg: CC.faint }],
    [`${status.model} ${status.effort}`, { fg: CC.dim }],
    [" · ", { fg: CC.faint }],
    [`${status.branch} ${status.changed}`, { fg: CC.dim }],
  ]);
  f.spans(2, H - 1, [ours("← 1 needs input", { fg: CC.warning }), [" · ", { fg: CC.faint }], ...right]);
  f.right(W - 1, H - 1, "? for shortcuts", { fg: CC.dim });
}

export function working() {
  const f = frame();
  let y = turnOne(f, 0) + 1;
  y = you(f, y, turn2.prompt) + 1;
  y = thinking(f, y) + 1;
  y = bullet(f, y, turn2.step1, CC.success);
  y = result(f, y, [
    ["Read src/cache.ts · Wrote src/clock.ts ", {}],
    ["+11", { fg: CC.success }],
    [" · Edited src/cache.ts ", {}],
    ["+8", { fg: CC.success }],
    [" ", {}],
    ["−3", { fg: CC.error }],
    [" · Wrote src/cache.test.ts ", {}],
    ["+39", { fg: CC.success }],
  ]) + 1;
  y = bullet(f, y, "Explore(Find Date.now and setTimeout uses)", CC.dim);
  y = result(f, y, [["Running in the background · 3 tool uses · Grep setTimeout in src", {}]]) + 1;
  y = bullet(f, y, "Bash(sleep 90 && echo warmed)", CC.dim);
  y = result(f, y, [["Running in the background (41s)", {}]]) + 1;
  y = bullet(f, y, turn2.step3, CC.dim);
  result(f, y, [["Running bun test…", {}]]);

  f.spans(0, H - 7, [
    ["✻ ", { fg: CC.claude }],
    ["Testing… ", { fg: CC.claude }],
    ["(8s · ↓ 2.1k tokens · esc to interrupt)", { fg: CC.dim }],
  ]);
  box(f, [["⏸ ask first", { fg: CC.dim }], [" (shift+tab to cycle)", { fg: CC.faint }]], [["2 background tasks", { fg: CC.dim }]]);
  return f;
}

export function permission() {
  const f = frame();
  let y = turnOne(f, 0) + 1;
  y = you(f, y, turn2.prompt) + 1;
  y = thinking(f, y) + 1;
  y = bullet(f, y, turn2.step1, CC.dim);
  result(f, y, [["Read src/cache.ts · Wrote src/clock.ts ", {}], ["+11", { fg: CC.success }]]);

  // claude's dialog, word for word, in place of the box.
  let top = H - 23;
  f.line(0, top, W, "─", { fg: CC.permission });
  f.put(1, top + 1, "Edit file", { fg: CC.permission, bold: true });
  f.put(1, top + 2, "src/cache.ts", { fg: CC.text });
  f.line(0, top + 3, W, "╌", { fg: CC.faint });
  top = diff(f, 0, top + 4, W, firstEdit, {
    page: CC.page,
    added: CC.added,
    removed: CC.removed,
    number: CC.dim,
    text: CC.text,
    sign: { "+": CC.text, "-": CC.text },
    gap: CC.dim,
  });
  f.line(0, top, W, "╌", { fg: CC.faint });
  f.put(1, top + 1, "Do you want to make this edit to cache.ts?", { fg: CC.text });
  f.spans(1, top + 2, [["❯ ", { fg: CC.permission }], ["1. Yes", { fg: CC.permission }]]);
  f.put(3, top + 3, "2. Yes, allow all edits during this session (shift+tab)", { fg: CC.text });
  f.put(3, top + 4, "3. No, and tell Claude what to do differently (esc)", { fg: CC.text });
  f.put(1, top + 5, "Esc to cancel · Tab to amend", { fg: CC.dim });
  footerRows(f, [["⏸ ask first", { fg: CC.dim }]], [["waiting 18s", { fg: CC.warning }]]);
  return f;
}

export function review() {
  const f = frame();
  let y = you(f, 0, turn2.prompt) + 1;
  y = bullet(f, y, turn2.reply);
  f.put(2, y, "Thought for 9s, ran 6 tools", { fg: CC.dim });
  f.spans(0, y + 1, [
    ["✻ ", { fg: CC.dim }],
    ["Worked for 1m 40s", { fg: CC.dim }],
    [" · ", { fg: CC.faint }],
    ours("3 files "),
    ["+58", { fg: CC.success }],
    [" ", {}],
    ["−3", { fg: CC.error }],
    [" · ", { fg: CC.faint }],
    ours("7 passed "),
    ours("1 failed", { fg: CC.error }),
    [" · ", { fg: CC.faint }],
    ours("not committed"),
  ]);
  y += 3;
  y = you(f, y, "/diff") + 1;

  // /diff as claude names it, per turn: the files on the left, the open file's diff on the right.
  f.line(0, y, W, "─", { fg: CC.permission });
  f.spans(1, y + 1, [["Changes  ", { fg: CC.permission, bold: true }], ["◂ ", { fg: CC.dim }], ["This turn", { fg: CC.text, bold: true }], [" ▸", { fg: CC.dim }], ["   Turn 1 · Uncommitted · Branch", { fg: CC.faint }]]);
  const list = y + 3;
  const files: [string, Span[], boolean][] = [
    ["src/clock.ts", [["+11", { fg: CC.success }]], false],
    ["src/cache.ts", [["+8 ", { fg: CC.success }], ["−3", { fg: CC.error }]], true],
    ["src/cache.test.ts", [["+39", { fg: CC.success }]], false],
  ];
  files.forEach(([name, size, here], i) => {
    f.spans(1, list + i, [[here ? "❯ " : "  ", { fg: CC.permission }], [name, { fg: here ? CC.permission : CC.text }]]);
    f.rightSpans(29, list + i, size);
  });
  f.spans(1, list + 4, [["Tests ", { fg: CC.dim }], ["7 passed ", { fg: CC.success }], ["1 failed", { fg: CC.error }]]);
  f.put(1, list + 5, "retry.test.ts:23", { fg: CC.dim });
  for (let r = list; r < list + cacheTurn.length; r++) f.put(31, r, "│", { fg: CC.faint });
  diff(f, 33, list, W - 33, cacheTurn, {
    page: CC.page,
    added: CC.added,
    removed: CC.removed,
    number: CC.dim,
    text: CC.text,
    sign: { "+": CC.text, "-": CC.text },
    gap: CC.dim,
  });
  f.put(1, list + cacheTurn.length + 1, "←→ turn · ↑↓ file · enter open in $EDITOR · esc close", { fg: CC.dim });
  return f;
}
