// The spec's storyboards and sheets, drawn with the Ledger's rules (kit.ts). Each frame is one
// moment the spec walks through; sizes vary, to show what changes with width.
import { stepOne, turnOne, turnTwoStart } from "./a-ledger";
import type { Span } from "./frame";
import { dust, haze, Ledger, MARK, minus, on, plus, screen, sep, size, type Mark } from "./kit";
import { P } from "./palette";
import { status as reading } from "./scenario";

const bright = (text: string, bold = false): Span => [text, { fg: P.bright, bold }];
const teal = (text: string): Span => [text, { fg: P.teal }];
const gold = (text: string): Span => [text, { fg: P.gold }];
const rose = (text: string): Span => [text, { fg: P.rose }];

/** What a fresh screen says: where you are, what astrocode loaded from Claude Code, what's next. */
function welcome(l: Ledger) {
  l.f.spans(2, 1, [bright("astrocode", true), haze("  0.2 · Claude Code 2.1.301 underneath")]);
  l.f.spans(2, 2, [haze(`/tmp/retrykit · ${reading.branch} · ${reading.model} ${reading.effort} · ${reading.mode}`)]);
  l.f.spans(2, 3, [dust("From Claude Code: "), haze("CLAUDE.md · 8 plugins · 3 MCP servers · 41 skills · your keybindings")]);
  l.f.spans(2, 5, [bright("Recent sessions here"), dust("   /resume picks one · astrocode -c continues the last")]);
  const recent: [Mark, string, Span[], string][] = [
    ["done", "Retry tries exactly attempts times", [haze("2 files "), plus(31), [" ", {}], minus(12), sep, haze("committed")], "12 min ago"],
    ["stopped", "Plan getText's clock", [haze("a plan, not started")], "2 h ago"],
    ["done", "Retry gets a deadline", [haze("1 file "), plus(18), [" ", {}], minus(2), sep, haze("PR #11 merged")], "yesterday"],
  ];
  recent.forEach(([mark, name, what, when], i) => {
    const y = 6 + i;
    l.f.put(2, y, MARK[mark].ch, { fg: MARK[mark].fg });
    l.f.put(4, y, name, { fg: P.text });
    l.f.spans(44, y, what);
    l.f.right(l.edge, y, when, { fg: P.dust });
  });
  l.f.spans(2, 10, [bright("Keys"), dust("   ? lists them all, for whatever has your keys")]);
  const keys: [string, string][] = [
    ["/", "commands"], ["@", "files"], ["!", "shell command"], ["?", "every key"],
    ["shift+tab", "mode"], ["ctrl+o", "transcript"], ["←", "conversations"], ["esc", "stop Claude"],
  ];
  keys.forEach(([key, does], i) => {
    const x = 4 + (i % 4) * 27;
    const y = 11 + Math.floor(i / 4);
    l.f.spans(x, y, [haze(key), dust(` ${does}`)]);
  });
}

export function launch(W = 120, H = 40) {
  const l = new Ledger(W, H);
  welcome(l);
  l.box(true, 'Try "fix the failing retry test"', [], false);
  l.status();
  return l.f;
}

export function writing(W = 120, H = 40) {
  const l = screen(W, H, 4, (t) => {
    let y = turnOne(t, 0) + 1;
    y = turnTwoStart(t, y);
    y = stepOne(t, y) + 1;
    y = t.step(y, "done", "Checked where else the code reads the clock, in the background.", "1m 30s");
    y = t.act(y, "Explored", [["Find Date.now and setTimeout uses"]], [haze("4 matches in 2 files · 31s")]);
    y = t.act(y, "Ran", [["sleep 90 && echo warmed"]], [haze("exit 0 · 1m 30s")]) + 1;
    y = t.step(y, "failed", "Ran the whole suite; retry's attempts test still fails, as expected.", "16s");
    y = t.act(y, "Ran", [["bun test"]], [haze("exit 1 · "), teal("7 passed, "), rose("1 failed")]);
    y = t.under(y, [haze("retry.test.ts:23  "), ["expected 3 calls, got 4", { fg: P.text }]]) + 1;
    // The reply as it streams: words arrive, nothing else moves.
    return t.reply(y, "Cache takes an injectable clock now, and `bun test` shows 7 passing and 1 failing: retry's attempts test, which I left alone as you asked. `Date.now` and");
  });
  l.now([teal("◐ "), teal("Writing"), haze(" · 1m 31s · 2.9k tokens")]);
  l.box(true, "Claude is working. Type to queue a message.");
  l.status({ needsYou: 1 });
  return l.f;
}

/** A decision panel from `top` to the status bar, with your keys: a title, a body, options, hints. */
function decision(l: Ledger, top: number, title: Span[], waited: string) {
  l.panel(top, l.H - 1, true, 2);
  l.f.spans(4, top, title.map(([t, s]) => [t, { bg: P.surface, bold: true, fg: P.bright, ...s }]));
  l.f.right(l.edge, top, waited, { fg: P.gold, bg: P.surface });
}

export function permissionBash(W = 80, H = 24) {
  const panelRows = 9;
  const top = H - 1 - panelRows;
  const l = screen(W, H, panelRows + 2, (t) => {
    let y = t.you(0, "The tests in src/retry.test.ts fail. Fix retry so it tries exactly `attempts` times.") + 1;
    y = t.step(y, "done", "Reading retry and its tests to find the off-by-one", "0.4s");
    y = t.act(y, "Read", [["src/retry.ts"]], [haze("41 lines")]);
    y = t.act(y, "Read", [["src/retry.test.ts"]], [haze("49 lines")]) + 1;
    y = t.step(y, "waiting", "Running the suite to see the failure first");
    return t.act(y, "Run", [["bun test", { fg: P.gold }]], [], P.gold) + 1;
  }, true);
  decision(l, top, [["Run this command?", {}]], "waiting 4s");
  l.f.spans(4, top + 2, on([dust("$ "), ["bun test 2>&1 | tail -30", { fg: P.text, bg: P.surface }]], P.surface));
  l.f.put(4, top + 3, "Run the test suite", { fg: P.haze, bg: P.surface });
  l.options(top + 5, 4, l.edge, [["Yes"], ["Yes, and don't ask again for bun test here"], ["No, and tell Claude what to do instead", "esc"]]);
  l.hints(H - 2, 4, [["1–3", "choose"], ["enter", "confirm"], ["tab", "comment"], ["?", "keys"]], P.surface);
  l.status({ needsYou: 1 });
  return l.f;
}

export function question(W = 120, H = 40) {
  const panelRows = 14;
  const top = H - 1 - panelRows;
  const l = screen(W, H, panelRows + 2, (t) => {
    let y = turnOne(t, 0) + 1;
    y = t.you(y, "The cache should use the clock too. Ask me first if you find anything else wrong.") + 1;
    y = t.step(y, "done", "Reading the cache and the retry fix", "0.6s");
    y = t.act(y, "Read", [["src/cache.ts"]], [haze("25 lines")]);
    y = t.act(y, "Read", [["src/retry.ts"]], [haze("47 lines")]) + 1;
    y = t.step(y, "waiting", "retry's deadline check is off by one too; asking before I touch it");
    return t.act(y, "Ask", [["1 question", { fg: P.gold }]], [], P.gold) + 1;
  }, true);
  decision(l, top, [["Fix retry's deadline check now, or leave it for later?", {}]], "waiting 9s");
  const opts: [string, string[]][] = [
    ["Fix it now (Recommended)", ["Check the deadline before sleeping, so", "retry never sleeps past it."]],
    ["Leave it for later", ["Keep this change to the cache; I'll", "note the bug in the reply."]],
    ["Other…", ["Type your own answer"]],
  ];
  let y = top + 2;
  opts.forEach(([label, desc], i) => {
    const here = i === 0;
    const bg = here ? P.raised : P.surface;
    l.f.fill(4, y, 52, desc.length + 1, bg);
    l.f.put(4, y, here ? "›" : " ", { fg: P.gold, bg, bold: true });
    l.f.put(6, y, String(i + 1), { fg: P.haze, bg });
    l.f.put(9, y, label, { fg: here ? P.bright : P.text, bg, bold: here });
    desc.forEach((d, j) => l.f.put(9, y + 1 + j, d, { fg: P.haze, bg }));
    y += desc.length + 2;
  });
  // The chosen option's preview stands beside the options, and follows the cursor.
  l.f.put(60, top + 2, "preview", { fg: P.dust, bg: P.surface });
  l.diff(60, top + 3, l.edge - 60, [
    { kind: " ", n: 31, text: "if (options.deadlineMs) {" },
    { kind: "-", n: 32, text: "  if (clock.now() - started > options.deadlineMs)" },
    { kind: "+", n: 32, text: "  const left = options.deadlineMs - (clock.now() - started);" },
    { kind: "+", n: 33, text: "  if (left <= delay) throw new RetryError(…);" },
    { kind: " ", n: 34, text: "}" },
  ], P.raised);
  l.hints(H - 2, 4, [["↑↓", "or 1–3 choose"], ["enter", "answer"], ["n", "add a note"], ["esc", "dismiss"]], P.surface);
  l.status({ needsYou: 1 });
  return l.f;
}

export function failing(W = 120, H = 40) {
  const l = screen(W, H, 4, (t) => {
    let y = t.you(0, "The tests in src/retry.test.ts fail. Fix retry so it tries exactly `attempts` times, and give it an injectable clock so the tests run without real sleeping.") + 1;
    y = t.thinking(y, "Run the suite first so the failure is on record, then fix the loop bound, then the clock.") + 1;
    y = t.step(y, "done", "Reading retry and its tests to find the off-by-one", "0.4s");
    y = t.act(y, "Read", [["src/retry.ts"]], [haze("41 lines")]);
    y = t.act(y, "Read", [["src/retry.test.ts"]], [haze("49 lines")]) + 1;
    y = t.step(y, "failed", "Running the suite to see the failure first", "2.1s");
    y = t.act(y, "Ran", [["bun test"]], [haze("exit 1 · "), teal("3 passed, "), rose("1 failed")]);
    y = t.under(y, [haze("retry.test.ts:23  "), ["expected 3 calls, got 4", { fg: P.text }]]) + 1;
    y = t.step(y, "done", "The loop runs attempts + 1 times; making it stop at attempts", "3s");
    y = t.act(y, "Edited", [["src/retry.ts"]], size(1, 1)) + 1;
    y = t.step(y, "failed", "Running the suite again", "2.0s");
    y = t.act(y, "Ran", [["bun test"]], [haze("exit 1 · "), teal("3 passed, "), rose("1 failed")]);
    y = t.under(y, [haze("retry.test.ts:41  "), ["expected 1300 to be less than 50: it still sleeps for real", { fg: P.text }]]) + 1;
    y = t.step(y, "done", "Giving retry a clock and the tests a fake one", "24s");
    y = t.act(y, "Edited", [["src/retry.ts"]], size(14, 6));
    y = t.act(y, "Edited", [["src/retry.test.ts"]], size(17, 6)) + 1;
    y = t.step(y, "running", "Running the suite a third time");
    return t.act(y, "Running", [["bun test"]], [haze("2s")], P.teal);
  });
  l.now([teal("◐ "), teal("Running "), bright("bun test"), haze(" · 2s · 3.8k tokens")]);
  l.box(true, "Claude is working. Type to queue a message.");
  l.status();
  return l.f;
}

export function subagent(W = 200, H = 50) {
  const l = screen(W, H, 4, (t) => {
    let y = turnOne(t, 0) + 1;
    y = turnTwoStart(t, y);
    y = stepOne(t, y) + 1;
    y = t.step(y, "running", "Asking an Explore agent where else the code reads the clock");
    t.cursor(y);
    y = t.act(y, "Exploring", [["Find Date.now and setTimeout uses", { fg: P.bright, bold: true }]], [haze("6 calls · 1m 12s")], P.teal, P.raised);

    // Opened under its line, at every width: its own calls stream in as it makes them.
    const x = 4;
    const right = t.edge;
    const top = y;
    t.panel(top, top + 14, false, x, right);
    const tabs: [string, boolean][] = [["Calls", true], ["Prompt", false], ["Report", false]];
    let tx = x + 2;
    for (const [tab, open] of tabs) tx = t.f.put(tx, top + 1, ` ${tab} `, { fg: open ? P.bright : P.haze, bg: open ? P.raised : P.surface, bold: open }) + 1;
    t.f.right(right - 2, top + 1, "Explore · running", { fg: P.haze, bg: P.surface });
    const calls: [Mark, string, Span[], Span[]][] = [
      ["done", "Searched", [["Date.now", { fg: P.code }], haze(" in src")], [haze("4 matches in 2 files")]],
      ["done", "Searched", [["setTimeout", { fg: P.code }], haze(" in src")], [haze("1 match")]],
      ["done", "Read", [["src/retry.ts"]], [haze("47 lines")]],
      ["done", "Read", [["src/cache.ts"]], [haze("28 lines")]],
      ["done", "Read", [["src/http.ts"]], [haze("17 lines")]],
      ["running", "Searching", [["new Date", { fg: P.code }], haze(" in src")], []],
    ];
    calls.forEach(([mark, verb, target, result], i) => {
      const row = top + 3 + i;
      const bg = P.surface;
      t.f.put(x + 2, row, MARK[mark].ch, { fg: MARK[mark].fg, bg });
      t.f.put(x + 4, row, verb, { fg: mark === "running" ? P.teal : P.haze, bg });
      t.f.spans(x + 16, row, target.map(([text, st]) => [text, { fg: P.text, ...st, bg }]));
      if (result.length) t.f.rightSpans(right - 2, row, on(result, bg));
    });
    t.f.put(x + 2, top + 10, "∴ Both Date.now uses in cache.ts are gone; checking for new Date before reporting.", { fg: P.haze, italic: true, bg: P.surface });
    t.f.put(x + 2, top + 12, "It reports to Claude when it's done; the report opens here.", { fg: P.dust, bg: P.surface });
    return top + 15;
  });

  l.hints(H - 5, 2, [["↑↓", "move"], ["tab", "views"], ["enter", "close"], ["ctrl+b", "background"], ["x", "stop"], ["esc", "back to the box"]]);
  l.now([teal("◐ "), teal("Waiting on Explore"), haze(" · 1m 12s · 3.4k tokens")], [["esc", "stop"], ["ctrl+b", "background"]]);
  l.box(false, "Type to queue a message.");
  l.status({ needsYou: 1 });
  return l.f;
}

export function resume(W = 120, H = 40) {
  const l = new Ledger(W, H);
  welcome(l);
  const top = 15;
  l.panel(top, H - 3, true, 0);
  l.f.spans(2, top, on([bright("Resume a session", true), dust("   from claude and astrocode, in this folder")], P.surface));
  l.f.spans(2, top + 2, on([gold("❯ "), bright("retry")], P.surface));
  l.f.put(9, top + 2, "▏", { fg: P.gold, bg: P.surface });
  const rows: [Mark, string, Span[], string, string][] = [
    ["done", "Retry tries exactly attempts times", [haze("2 files "), plus(31), [" ", {}], minus(12), sep, haze("committed f535656")], "astrocode", "12 min ago"],
    ["done", "Retry gets a deadline", [haze("1 file "), plus(18), [" ", {}], minus(2), sep, haze("PR #11 merged")], "claude", "yesterday"],
    ["failed", "Retry with jitter", [haze("3 files "), plus(44), [" ", {}], minus(6), sep, rose("tests failing")], "claude", "3 days ago"],
  ];
  rows.forEach(([mark, name, what, app, when], i) => {
    const y = top + 4 + i;
    const here = i === 0;
    const bg = here ? P.raised : P.surface;
    l.f.fill(2, y, l.edge - 2, 1, bg);
    l.f.put(2, y, here ? "›" : " ", { fg: P.gold, bg, bold: true });
    l.f.put(4, y, MARK[mark].ch, { fg: MARK[mark].fg, bg });
    l.f.put(6, y, name, { fg: here ? P.bright : P.text, bg, bold: here });
    l.f.spans(44, y, on(what, bg));
    l.f.put(84, y, app, { fg: P.dust, bg });
    l.f.right(l.edge, y, when, { fg: P.dust, bg });
  });
  l.f.spans(4, top + 8, on([dust("Last said: "), haze("All 4 tests pass in 6 ms, down from 2 s. Committed as f535656; there's no remote.")], P.surface));
  l.f.spans(4, top + 9, on([dust("Opens with its turns folded, as they ended; ctrl+o goes through them.")], P.surface));
  l.hints(H - 4, 2, [["↑↓", "choose"], ["enter", "resume"], ["type", "to filter"], ["esc", "close"]], P.surface);
  l.status();
  return l.f;
}

export function conversations(W = 120, H = 40) {
  const l = new Ledger(W, H);
  l.f.spans(0, 0, [bright("Conversations", true), haze(`   new ones start in /tmp/retrykit · ${reading.model} ${reading.effort} · ${reading.mode}`)]);
  l.f.spans(0, 1, [gold("1 needs you"), sep, teal("2 working"), sep, haze("3 done"), sep, rose("1 failed")]);
  const groups: [string, [Mark, string, Span[], string, string, boolean?][]][] = [
    ["/tmp/retrykit", [
      ["waiting", "Exported names in src", [gold("asks: "), haze("include type-only exports?")], "", "4 min ago"],
      ["running", "Cache gets the clock", [teal("Running bun test"), sep, haze("3 files "), plus(58), [" ", {}], minus(3)], "", "now", true],
      ["done", "Line counts under src", [haze("replied with a table of 4 files")], "", "12 min ago"],
    ]],
    ["~/Projects/astrocode", [
      ["running", "astrocode UX redesign", [teal("Writing"), haze(" the spec · claude --bg")], "", "1 min ago"],
      ["done", "agents-dashboard-view", [haze("PR merged into main")], "#29", "20 h ago"],
    ]],
    ["~/Projects/printborn", [
      ["failed", "issue-34-worktree", [rose("tools/live.sh exit 2"), haze(" · zone 3 missing")], "#40", "1 h ago"],
    ]],
  ];
  let y = 3;
  let first = true;
  for (const [project, rows] of groups) {
    l.f.put(0, y++, project, { fg: P.haze });
    for (const [mark, name, what, pr, when, current] of rows) {
      const here = first;
      first = false;
      if (here) l.cursor(y, 0, W - 1);
      const bg = here ? P.raised : undefined;
      l.f.put(2, y, MARK[mark].ch, { fg: MARK[mark].fg, bg });
      l.f.put(4, y, name, { fg: here ? P.bright : P.text, bg, bold: here || current });
      if (current) l.f.put(4 + name.length, y, "  (this one)", { fg: P.dust, bg });
      l.f.spans(40, y, what.map(([s, st]) => [s, { ...st, bg }]));
      if (pr) l.f.put(96, y, pr, { fg: P.sky, bg });
      l.f.right(W - 2, y, when, { fg: P.dust, bg });
      y++;
    }
    y++;
  }
  l.f.put(4, y + 1, "Started here, they keep going while you're in another one; quitting hands them to claude --bg.", { fg: P.dust });
  l.hints(H - 4, 2, [["enter", "open"], ["space", "peek"], ["ctrl+x", "stop"], ["esc", "back to Cache gets the clock"]]);
  l.box(true, "Describe a task to start a conversation alongside");
  l.status({ needsYou: 1, running: 2 });
  return l.f;
}

export function keys(W = 120, H = 40) {
  const l = screen(W, H, 26, (t) => {
    const y = turnOne(t, 0) + 1;
    return t.you(y, "Give src/cache.ts the same injectable clock retry needs.");
  });
  const top = 14;
  l.panel(top, H - 3, true, 0);
  l.f.spans(2, top, on([bright("Keys", true), dust("   as your ~/.claude/keybindings.json sets them · the same list as /help")], P.surface));
  const columns: [string, [string, string][]][] = [
    ["In the box", [["enter", "send"], ["shift+enter", "new line"], ["ctrl+enter", "send now"], ["ctrl+x enter", "after the turn"], ["↑ ↓", "history"], ["ctrl+r", "search history"], ["ctrl+s", "put aside"], ["ctrl+g", "in $EDITOR"], ["esc esc", "clear, rewind"]]],
    ["Claude", [["esc", "stop"], ["shift+tab", "mode"], ["alt+p", "model, effort"], ["alt+t", "thinking"], ["alt+o", "fast mode"], ["ctrl+b", "background it"], ["ctrl+x ctrl+k", "stop all tasks"], ["ctrl+t", "to-do list"]]],
    ["Transcript", [["ctrl+o", "go there, back"], ["↑ ↓", "move"], ["enter", "open or close"], ["← →", "prev/next call"], ["tab", "next view"], ["a", "open all"], ["c", "copy"], ["e", "in $EDITOR"], ["/", "find"]]],
    ["Anywhere", [["/", "commands"], ["@", "files"], ["!", "shell command"], ["←", "conversations"], ["/diff", "what changed"], ["/resume", "a session"], ["/config", "settings"], ["?", "this list"]]],
  ];
  columns.forEach(([title, rows], c) => {
    const x = 2 + c * 29;
    l.f.put(x, top + 2, title, { fg: P.bright, bg: P.surface });
    rows.forEach(([key, does], r) => {
      l.f.put(x, top + 3 + r, key, { fg: P.haze, bg: P.surface });
      l.f.put(x + 14, top + 3 + r, does, { fg: P.dust, bg: P.surface });
    });
  });
  l.hints(H - 4, 2, [["esc", "close"], ["type", "to filter"]], P.surface);
  l.status();
  return l.f;
}

/** Every state each part can be in, on one sheet. */
export function states(W = 120, H = 40) {
  const l = new Ledger(W, H);
  let y = 0;
  const heading = (text: string, note = "") => {
    l.f.spans(0, y, [bright(text, true), dust(note ? `   ${note}` : "")]);
    y += 1;
  };
  heading("Gutter marks", "one per entry, one meaning each");
  const marks: [Mark, string][] = [
    ["you", "you"], ["thinking", "thinking"], ["reply", "reply"], ["running", "running"], ["waiting", "waits for you"],
    ["done", "done"], ["failed", "failed"], ["stopped", "stopped"], ["background", "background"], ["notice", "notice"], ["ledger", "ledger"],
  ];
  let x = 2;
  for (const [mark, name] of marks) {
    l.f.put(x, y, MARK[mark].ch, { fg: MARK[mark].fg, bold: mark === "you" });
    x = l.f.put(x + 2, y, name, { fg: P.haze }) + 2;
  }
  y += 2;

  heading("A call in each state", "the verb's tense says where it is");
  const calls: [string, (t: Ledger, y: number) => number][] = [
    ["running", (t, y) => t.act(y, "Running", [["bun test"]], [haze("8s")], P.teal)],
    ["waits for you", (t, y) => t.act(y, "Edit", [["src/cache.ts", { fg: P.gold }]], size(6, 1), P.gold)],
    ["done", (t, y) => t.act(y, "Edited", [["src/cache.ts"]], size(8, 3))],
    ["failed", (t, y) => t.under(t.act(y, "Ran", [["bun test"]], [haze("exit 1 · "), teal("7 passed, "), rose("1 failed")]), [haze("retry.test.ts:23  "), ["expected 3 calls, got 4", { fg: P.text }]])],
    ["stopped", (t, y) => t.act(y, "Stopped", [["bun test"]], [haze("after 12s")], P.ember)],
    ["denied", (t, y) => t.act(y, "Not run", [["rm -rf dist"]], [haze("you said no")], P.ember)],
    ["background", (t, y) => t.act(y, "Running", [["sleep 90 && echo warmed"]], [haze("in the background · 41s")], P.teal)],
    ["subagent", (t, y) => t.under(t.act(y, "Exploring", [["Find Date.now and setTimeout uses"]], [haze("6 calls · 1m 12s")], P.teal), [haze("Grep "), ["new Date", { fg: P.code }], haze(" in src")])],
  ];
  // The examples are drawn on a narrower ledger and set right of their labels.
  const sheet = new Ledger(W - 16, calls.length * 2);
  let row = 0;
  for (const [state, draw] of calls) {
    l.f.put(2, y + row, state, { fg: P.dust });
    row = draw(sheet, row);
  }
  for (let r = 0; r < row; r++) {
    sheet.f.cells[r]!.forEach((cell, i) => {
      if (i >= 2) l.f.cells[y + r]![i + 14] = { ...cell };
    });
  }
  y += row;
  y += 1;

  heading("The now line", "over the box while a turn runs; only its mark moves");
  const lines: [Span[], string][] = [
    [[teal("◐ "), teal("Thinking"), haze(" · 12s · 400 tokens")], "before the first word or call"],
    [[teal("◐ "), teal("Writing"), haze(" · 1m 31s · 2.9k tokens")], "a reply is streaming"],
    [[teal("◐ "), teal("Running "), bright("bun test"), haze(" · 8s")], "names the call, not just the tool"],
    [[teal("◐ "), teal("Waiting on Explore"), haze(" · 1m 12s")], "a subagent Claude waits for"],
    [[["◐ ", { fg: P.ember }], ["Retrying in 8s", { fg: P.ember }], haze(" · overloaded · attempt 2 of 10")], "the API asked to wait"],
    [[teal("◐ "), teal("Compacting"), haze(" · 41s")], "the context is being summarized"],
  ];
  for (const [spans, note] of lines) {
    l.f.spans(2, y, spans);
    l.f.put(60, y, note, { fg: P.dust });
    y += 1;
  }
  y += 1;

  heading("The status bar", "readings drop by rank as the width shrinks");
  for (const width of [120, 80]) {
    const bar = new Ledger(width, 1);
    bar.status({ needsYou: 1, running: 2 });
    l.f.cells[y] = l.f.cells[y]!.map((cell, i) => (i < width ? { ...bar.f.cells[0]![i]! } : cell));
    y += 1;
  }
  return l.f;
}
