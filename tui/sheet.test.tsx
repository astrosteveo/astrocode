import { afterEach, beforeEach, expect, test } from "bun:test";
import { renderToString } from "ink";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { ANYWHERE } from "./focus";
import { ACTIONS, DEFAULT_KEYMAP, hintKey, loadKeymap, type Action, type Keymap } from "./keys";
import { cellWidth } from "./markdown";
import { scratchConfig } from "./scratch-config";
import { KeySheet, sheetOf, type Place } from "./sheet";

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
  // A decision and scrollback's inspector keep them from the box: there only Ctrl+L redraws.
  for (const sections of [sheetOf("decision", DEFAULT_KEYMAP, true), sheetOf("opened", DEFAULT_KEYMAP, false)]) {
    expect(sections.find((section) => section.title === "Anywhere")?.rows).toEqual([["ctrl+l", "redraw"]]);
    expect(sections.flatMap((section) => section.rows.map(([, does]) => does))).not.toContain("mode");
  }
  // Ctrl+L redraws wherever your keys are.
  for (const place of ["box", "transcript", "opened", "decision"] as const) expect(keysOn(place)).toContain("ctrl+l");
  // Every way to start a new line, Alt+Enter for terminals without the kitty keyboard protocol.
  expect(draw("box").join("\n")).toMatch(/shift\+enter, ctrl\+j +new line/);
  expect(draw("box").join("\n")).toMatch(/alt\+enter, \\ enter +new line/);
  // Full screen scrolls from the box too.
  for (const key of ["pgup, pgdn", "ctrl+home, ctrl+end", "alt+↑ ↓", "alt+shift+↑ ↓"]) {
    expect(keysOn("box")).toContain(key.split(", ")[0]!);
    expect(keysOn("box", DEFAULT_KEYMAP, false)).not.toContain(key.split(", ")[0]!);
  }
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
  const text = draw("box").join("\n");
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
  // A click on the box gives it your keys back from the transcript; in the box they're there already.
  expect(listed("transcript")).toContain("click the box  your keys back");
  expect(listed("box")).not.toContain("click the box  your keys back");
});
