import { afterEach, beforeEach, expect, test } from "bun:test";
import { renderToString } from "ink";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { ANYWHERE } from "./focus";
import { ACTIONS, DEFAULT_KEYMAP, hintKey, loadKeymap, type Action, type Keymap } from "./keys";
import { cellWidth } from "./markdown";
import { scratchConfig } from "./scratch-config";
import { KeySheet, sheetOf, type Place, type Prompted } from "./sheet";

// keybindings.json is written to a scratch Claude Code folder, never yours.
const config = scratchConfig();
beforeEach(config.start);
afterEach(config.stop);

/** The sheet as plain lines, `width` columns wide, with room for `rows` rows of keys. */
const draw = (place: Place, keymap: Keymap = DEFAULT_KEYMAP, { width = 120, rows = 40, fullscreen = true } = {}) =>
  stripVTControlCharacters(
    renderToString(<KeySheet sections={sheetOf(place, keymap, fullscreen)} custom={keymap !== DEFAULT_KEYMAP} width={width} rows={rows} onClose={() => {}} />, { columns: width }),
  ).split("\n");

/** A keybindings.json in the scratch Claude Code folder, read as astrocode reads it when it starts. */
async function rebound(blocks: { context: string; bindings: Record<string, string | null> }[]) {
  const folder = process.env.CLAUDE_CONFIG_DIR!;
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "keybindings.json"), JSON.stringify({ bindings: blocks }));
  return (await loadKeymap()).keymap;
}

const keysOn = (place: Place, keymap: Keymap = DEFAULT_KEYMAP, fullscreen = true) => sheetOf(place, keymap, fullscreen).flatMap((section) => section.rows.flatMap(([key]) => key.split(", ")));

test("lists the keys as your keybindings.json binds them: a moved key where it went, an added one beside the default, an unbound one not at all", async () => {
  const keymap = await rebound([
    { context: "Global", bindings: { "ctrl+o": null } },
    { context: "Chat", bindings: { "shift+tab": null, "meta+m": "chat:cycleMode", "ctrl+k": "chat:stash", "ctrl+g": "chat:undo" } },
  ]);
  const text = draw("box", keymap).join("\n");
  expect(text).toContain("as your keybindings.json sets them");
  expect(text).toMatch(/alt\+m +mode/);
  expect(text).not.toContain("shift+tab");
  expect(text).toMatch(/ctrl\+s, ctrl\+k +stash/);
  // A default key moved to another action shows there, and its old action keeps its other key.
  expect(text).toMatch(/ctrl\+_, ctrl\+g +undo/);
  expect(text).toMatch(/ctrl\+x ctrl\+e +editor/);
  // Ctrl+K cuts to the line's end only while no binding takes it; Ctrl+U still cuts to its start.
  expect(text).not.toMatch(/ctrl\+u, ctrl\+k/);
  expect(text).toMatch(/ctrl\+u +cut to start/);
  // Ctrl+O is bound to nothing, so the transcript isn't offered under it.
  expect(text).not.toContain("ctrl+o");
  // With Claude Code's own keys it says nothing about a file.
  expect(draw("box").join("\n")).not.toContain("keybindings.json");
});

test("lists every action astrocode has, under the key bound to it, on the box's sheet", () => {
  const keys = keysOn("box");
  for (const action of Object.keys(ACTIONS) as Action[]) expect(keys).toContain(hintKey(DEFAULT_KEYMAP, action)!);
  // Arrows read as arrows, and Alt as Alt, as every hint writes them.
  expect(keys).toContain("shift+↑");
  expect(keys).toContain("alt+p");
});

test("puts first what has your keys: the box, the transcript, an opened call, a permission prompt", () => {
  // The row of keys under the title and a blank row.
  const first = (place: Place) => {
    const lines = draw(place);
    return lines[lines.findIndex((line) => line.trim().startsWith("Keys")) + 2]?.trim().split(/ {2,}/)[0];
  };
  expect(first("box")).toBe("In the box");
  expect(first("transcript")).toBe("In the transcript");
  expect(first("opened")).toBe("In an opened call");
  expect(first("decision")).toBe("In a permission prompt");
  // An opened call is in the transcript, whose keys still work around it.
  expect(sheetOf("opened", DEFAULT_KEYMAP, true).map((section) => section.title)).toContain("In the transcript");
});

test("offers only the keys that work where yours are", () => {
  // The box's own keys aren't the transcript's, and the transcript's ↑↓ isn't the box's history.
  expect(keysOn("transcript")).not.toContain("ctrl+s");
  expect(keysOn("transcript")).not.toContain("esc esc");
  // The keys that work anywhere reach the transcript.
  for (const action of ANYWHERE) expect(keysOn("transcript")).toContain(hintKey(DEFAULT_KEYMAP, action)!);
  // A decision keeps them from the box: there only Ctrl+L redraws.
  const decision = sheetOf("decision", DEFAULT_KEYMAP, true);
  expect(decision.find((section) => section.title === "Anywhere")?.rows).toEqual([["ctrl+l", "redraw"]]);
  expect(decision.flatMap((section) => section.rows.map(([, does]) => does))).not.toContain("mode");
  // Ctrl+L redraws wherever your keys are.
  for (const place of ["box", "transcript", "opened", "decision"] as const) expect(keysOn(place)).toContain("ctrl+l");
  // Every way to start a new line, Alt+Enter for terminals without the kitty keyboard protocol.
  expect(draw("box").join("\n")).toMatch(/shift\+enter, ctrl\+j +new line/);
  expect(draw("box").join("\n")).toMatch(/alt\+enter, \\ enter +new line/);
  // Full screen scrolls from the box too; in scrollback the terminal does, and these are the viewer's.
  const scrolling = (fullscreen: boolean) => sheetOf("box", DEFAULT_KEYMAP, fullscreen).find((section) => section.title === "Scrolling")?.rows.map(([key]) => key) ?? [];
  for (const key of ["pgup, pgdn", "ctrl+home, ctrl+end", "alt+↑ ↓", "alt+shift+↑ ↓"]) {
    expect(scrolling(true)).toContain(key);
    expect(scrolling(false)).not.toContain(key);
  }
  expect(keysOn("box", DEFAULT_KEYMAP, false)).not.toContain("ctrl+home");
  // The mouse, and the click on ← N needs you, are full screen's.
  expect(draw("box").join("\n")).toMatch(/click ← N needs you +conversations/);
  expect(draw("box", DEFAULT_KEYMAP, { fullscreen: false }).join("\n")).not.toContain("click");
});

test("fits 80 columns and the rows it's given, and says ↑↓ scrolls the rest", () => {
  const lines = draw("box", DEFAULT_KEYMAP, { width: 80, rows: 10 });
  for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(80);
  // Its edges, the title, a blank row, ten rows of keys, a blank row and the hint.
  expect(lines.length).toBe(16);
  expect(lines.at(-2)).toContain("↑↓ to scroll");
  // None cut short.
  expect(lines.join("\n")).not.toContain("…");
});

test("at 120 and 200 columns the box's keys stand side by side, and at 200 they fit in their rows whole", () => {
  for (const width of [120, 200]) {
    const lines = draw("box", DEFAULT_KEYMAP, { width, rows: 27 });
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(width);
    expect(lines.find((line) => line.includes("In the box"))).toMatch(/In the box {3,}\S/);
  }
  const lines = draw("box", DEFAULT_KEYMAP, { width: 200, rows: 27 });
  expect(lines.at(-2)).not.toContain("↑↓ to scroll");
  expect(lines.join("\n")).toContain("ctrl+y");
  expect(lines.join("\n")).toContain("triple click");
  // Wider, it's shorter.
  expect(draw("box", DEFAULT_KEYMAP, { width: 200, rows: 27 }).length).toBeLessThan(draw("box", DEFAULT_KEYMAP, { width: 120, rows: 27 }).length);
});

test("the box's own keys leave its sheet once a binding, or a chord that starts with them, takes their key", async () => {
  const keymap = await rebound([{ context: "Chat", bindings: { left: "chat:modelPicker", up: "chat:modelPicker", escape: "chat:modelPicker", "ctrl+a ctrl+b": "chat:stash" } }]);
  const text = draw("box", keymap).join("\n");
  expect(text).not.toMatch(/← +conversations/);
  expect(text).not.toContain("earlier messages");
  expect(text).not.toContain("edit what's queued");
  expect(text).not.toContain("stop Claude");
  expect(text).not.toContain("clear, or rewind");
  expect(text).not.toContain("line start");
  // Where they went, as the hints write them.
  expect(text).toMatch(/alt\+p, ←, ↑, esc +model/);
  expect(text).toMatch(/ctrl\+s, ctrl\+a ctrl\+b +stash/);
  expect(text).not.toContain("escape");
});

test("\\ makes the key that sends a new line, so it goes with that key", async () => {
  expect(draw("box").join("\n")).toMatch(/alt\+enter, \\ enter +new line/);
  const keymap = await rebound([{ context: "Chat", bindings: { enter: null, "meta+s": "chat:submit" } }]);
  const text = draw("box", keymap).join("\n");
  expect(text).toMatch(/alt\+s +send/);
  expect(text).toMatch(/alt\+enter, \\ alt\+s +new line/);
  expect(text).not.toContain("\\ enter");
});

test("lists every key Claude Code binds to an action, as Ctrl+X Ctrl+S sends now where Ctrl+Enter can't, but one key's other spellings once", () => {
  // Rows enough for all of it, which at 120 columns scrolls.
  const text = draw("box", DEFAULT_KEYMAP, { rows: 60 }).join("\n");
  expect(text).toMatch(/ctrl\+enter, ctrl\+x ctrl\+s +send now/);
  expect(text).toMatch(/ctrl\+g, ctrl\+x ctrl\+e +editor/);
  expect(text).toMatch(/ctrl\+b, ctrl\+x ctrl\+b +background/);
  // Ctrl+- and Ctrl+Shift+- are Ctrl+_ as other terminals send it.
  expect(text).toMatch(/ctrl\+_ +undo/);
  expect(text).not.toContain("ctrl+-");
});

/** Every row on a place's sheet, as `key  does`. */
const listed = (place: Place, fullscreen = true) => sheetOf(place, DEFAULT_KEYMAP, fullscreen).flatMap((section) => section.rows.map(([key, does]) => `${key}  ${does}`));

test("the mouse rows name every click target full screen has, where a click there does something", () => {
  for (const row of ["click an option  choose it", "click mode, model, effort  change it", "click ◌ N running  what's running", "click copy, ▶ run  a code block", "click a picture  enlarge it", "click a link  open it"]) {
    expect(listed("box")).toContain(row);
    expect(listed("transcript")).toContain(row);
  }
  // A click on the box gives it your keys back from the transcript, an opened ledger in it too; in the box they're there already.
  expect(listed("transcript")).toContain("click the box  your keys back");
  expect(listed("ledger")).toContain("click the box  your keys back");
  expect(listed("box")).not.toContain("click the box  your keys back");
});

test("a permission prompt's sheet in full screen lists what scrolls the conversation above it, and the mouse; the number keys as many as it has", () => {
  const rows = listed("decision");
  for (const row of ["pgup, pgdn  a page", "ctrl+home, ctrl+end  top, end", "wheel  scroll", "click an option  choose it", "1, 2, …  answer at once"]) expect(rows).toContain(row);
  // Alt+↑ and Alt+↓ move its choice as well as the view, and two options have no 3.
  expect(rows.some((row) => row.startsWith("alt+") || row.startsWith("1–3"))).toBe(false);
  // In scrollback the terminal scrolls, and has the mouse.
  expect(listed("decision", false).some((row) => row.startsWith("pgup") || row.startsWith("wheel"))).toBe(false);
});

test("a permission prompt's sheet has its keys as claude's prompt takes them: Tab a comment on No, Shift+Tab and Ctrl+G only where it takes them, Esc cancels", () => {
  const rows = (prompt?: Prompted) => sheetOf("decision", DEFAULT_KEYMAP, true, { prompt }).flatMap((section) => section.rows.map(([key, does]) => `${key}  ${does}`));
  expect(rows()).toContain("↑ ↓  choose");
  expect(rows()).toContain("esc, ctrl+c  cancel");
  // Tab doesn't choose: on No it opens a comment, as claude's `Tab to amend` says.
  expect(rows().some((row) => /^(tab|shift\+tab|ctrl\+g)\b|↑ ↓, tab|deny/.test(row))).toBe(false);
  const all = rows({ amend: true, shiftTab: true, plan: true });
  for (const row of ["tab  a comment on No", "shift+tab  yes, for this session", "ctrl+g  the plan in your editor"]) expect(all).toContain(row);
});

test("an opened ledger's sheet lists its keys first, then the transcript's, and says what [ ] switches there", () => {
  const ledger = (scopes: boolean) => sheetOf("ledger", DEFAULT_KEYMAP, true, { scopes });
  const rows = (scopes: boolean) => ledger(scopes).flatMap((section) => section.rows.map(([key, does]) => `${key}  ${does}`));
  expect(ledger(true)[0]?.title).toBe("In an opened ledger");
  expect(ledger(true).map((section) => section.title)).toContain("In the transcript");
  for (const row of ["← →  file before, after", "enter  open or close a diff", "a  every diff, or none", "esc  close the diff, then the ledger"]) expect(rows(true)).toContain(row);
  // In git [ ] switch what it lists; outside git they go to the ledger before or after, as anywhere in the transcript.
  expect(rows(true).filter((row) => row.startsWith("[ ]"))).toEqual(["[ ]  this turn, uncommitted, branch"]);
  expect(rows(false).filter((row) => row.startsWith("[ ]"))).toEqual(["[ ]  ledgers"]);
  // The transcript's own sheet, and the box's for after Ctrl+O, have [ ] and a click on a ledger's scope.
  for (const place of ["transcript", "box"] as const) {
    expect(listed(place)).toContain("[ ]  ledgers");
    expect(listed(place)).toContain("click a ledger's scope  switch to it");
  }
});

test("lists Tab and → for Claude Code's suggestion in the box, each while no binding takes it, as the box takes them", async () => {
  expect(listed("box")).toContain("tab, →  take the suggestion");
  const rows = (keymap: Keymap) => sheetOf("box", keymap, true).flatMap((section) => section.rows.map(([key, does]) => `${key}  ${does}`));
  const tab = await rebound([{ context: "Chat", bindings: { tab: "chat:thinkingToggle" } }]);
  expect(rows(tab)).toContain("→  take the suggestion");
  const both = await rebound([{ context: "Chat", bindings: { tab: "chat:thinkingToggle", right: "chat:fastMode" } }]);
  expect(rows(both).some((row) => row.endsWith("take the suggestion"))).toBe(false);
});

test("says ↑ in the box takes back what's queued, as it does before it goes back through earlier messages", () => {
  expect(listed("box")).toContain("↑  edit what's queued");
});

test("the box's sheet, which /help shows, lists the transcript's keys after the box's, for Ctrl+O to give it yours, in scrollback's viewer too", () => {
  const titles = (fullscreen: boolean) => sheetOf("box", DEFAULT_KEYMAP, fullscreen).map((section) => section.title);
  for (const fullscreen of [true, false]) {
    expect(titles(fullscreen)[0]).toBe("In the box");
    expect(titles(fullscreen)).toContain("In the transcript");
  }
  // The mouse reaches only full screen and the viewer, never scrollback's box.
  expect(titles(false)).not.toContain("Mouse");
});

test("the transcript's keys take in claude's viewer keys: / finds, n and N go on to the next and previous match, v opens the conversation in $EDITOR", () => {
  for (const place of ["transcript", "opened", "ledger"] as const) {
    for (const row of ["/  find", "n, N  next, previous", "v  all in $EDITOR"]) expect(listed(place)).toContain(row);
  }
  // Ctrl+F finds there too, in either layout, as scrollback's viewer is drawn full screen.
  expect(listed("transcript")).toContain("ctrl+f  find");
});
