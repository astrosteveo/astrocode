import { expect, test } from "bun:test";
import type { PermissionRequest } from "../events";
import { askFor, permissionNote, rowText, type Where } from "./permissions";

// Each request is what Claude Code 2.1.301 sent astrocode's canUseTool for the tool, in a project
// at /tmp/ac, with "don't ask again" cut to the narrowest kind of change, as the session cuts it.
// Each prompt's words are `claude` 2.1.318's: read from its screen, and for rows its screen didn't
// show, from its code. A row can still differ from claude's for the same call: for `touch
// marker.txt` Claude Code suggests a rule, a folder and a mode together, and claude offers the
// folder where astrocode offers the rule.
const CWD = "/tmp/ac";
const where: Where = { cwd: CWD, home: "/home/u", mode: "auto", modes: { bypass: true, auto: true } };

/** The prompt as `claude` draws it: header, the line under it, the question, then each row. */
const drawn = (request: PermissionRequest, at: Partial<Where> = {}) => {
  const ask = askFor(request, { ...where, ...at });
  return [ask.header, ask.subject, ask.question, ...ask.rows.map(rowText), ask.field && `[${ask.field}]`, ask.cancel ? "Esc to cancel" : undefined].filter(Boolean);
};

const BASH: PermissionRequest = {
  id: "b",
  toolName: "Bash",
  input: { command: "touch marker.txt", description: "Create empty marker.txt in the working directory" },
  description: "Create empty marker.txt in the working directory",
  displayName: "Bash",
  // Claude Code suggests the narrowest change first, and astrocode applies only that kind.
  alwaysAllow: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "touch marker.txt" }], behavior: "allow", destination: "localSettings" }],
};

test("Bash asks to proceed, offers to stop asking for the command here, and No takes a comment", () => {
  expect(drawn(BASH)).toEqual([
    "Bash command",
    "Do you want to proceed?",
    "Yes",
    "Yes, and don't ask again for touch marker.txt commands in /tmp/ac",
    "No",
    "Esc to cancel",
  ]);
  const rows = askFor(BASH, where).rows;
  expect(rows.map((row) => row.amend)).toEqual([undefined, undefined, "and tell Claude what to do differently"]);
  expect(rows[1]?.decision).toEqual({ allow: true, updates: BASH.alwaysAllow });
});

test("Bash offers auto mode where you ask first and auto mode is available, and folders as claude words them", () => {
  const folder: PermissionRequest = { ...BASH, alwaysAllow: [{ type: "addDirectories", directories: ["/tmp/ac"], destination: "session" }] };
  expect(drawn(folder, { mode: "default" })).toEqual([
    "Bash command",
    "Do you want to proceed?",
    "Yes",
    "Yes, and always allow access to /tmp/ac from this project",
    "Yes, and switch to auto mode · auto mode handles these prompts for you",
    "No",
    "Esc to cancel",
  ]);
  expect(askFor(folder, { ...where, mode: "default" }).rows[2]?.decision).toEqual({ allow: true, updates: [{ type: "setMode", mode: "auto", destination: "session" }] });
  // Already in auto mode, or with auto mode off in your settings, there's nothing to switch to.
  expect(drawn(folder, { mode: "default", modes: { bypass: true, auto: false } })).not.toContain("Yes, and switch to auto mode · auto mode handles these prompts for you");
  // A prefix rule reads without its wildcard, and several commands as a list.
  const prefixes: PermissionRequest = { ...BASH, alwaysAllow: [{ type: "addRules", rules: ["npm run:*", "git log:*", "ls *"].map((ruleContent) => ({ toolName: "Bash", ruleContent })), behavior: "allow", destination: "localSettings" }] };
  expect(drawn(prefixes)[3]).toBe("Yes, and don't ask again for npm run, git log, and ls commands in /tmp/ac");
  // A suggestion only to accept edits isn't one claude offers on a command.
  expect(drawn({ ...BASH, alwaysAllow: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] })).toEqual(["Bash command", "Do you want to proceed?", "Yes", "No", "Esc to cancel"]);
});

const WRITE: PermissionRequest = {
  id: "w",
  toolName: "Write",
  input: { file_path: "/tmp/ac/note.txt", content: "hi\n" },
  description: "note.txt",
  displayName: "Write",
  alwaysAllow: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
};

test("Write asks to create a new file, or to overwrite one, with accept edits on Shift+Tab", () => {
  expect(drawn(WRITE, { exists: false })).toEqual([
    "Create file",
    "note.txt",
    "Do you want to create note.txt?",
    "Yes",
    "Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)",
    "No",
    "Esc to cancel",
  ]);
  expect(drawn(WRITE, { exists: true }).slice(0, 3)).toEqual(["Overwrite file", "note.txt", "Do you want to overwrite note.txt?"]);
  const rows = askFor(WRITE, { ...where, exists: false }).rows;
  expect(rows[1]).toMatchObject({ key: "shift+tab", decision: { allow: true, updates: WRITE.alwaysAllow } });
  expect(rows[2]?.amend).toBe("and tell Claude what to do differently");
});

test("Edit asks to make this edit to the file", () => {
  const edit: PermissionRequest = { ...WRITE, id: "e", toolName: "Edit", input: { file_path: "/tmp/ac/src/edit-me.txt", old_string: "hi", new_string: "hello" }, description: "edit-me.txt" };
  expect(drawn(edit)).toEqual([
    "Edit file",
    "src/edit-me.txt",
    "Do you want to make this edit to edit-me.txt?",
    "Yes",
    "Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)",
    "No",
    "Esc to cancel",
  ]);
  const outside: PermissionRequest = { ...edit, alwaysAllow: [{ type: "addDirectories", directories: ["/tmp/other"], destination: "session" }] };
  expect(drawn(outside)[4]).toBe("Yes, and always allow access to /tmp/other for this session (shift+tab)");
});

test("WebFetch asks about the site, with no comment and no hint line", () => {
  const fetch: PermissionRequest = {
    id: "f",
    toolName: "WebFetch",
    input: { url: "https://example.com", prompt: "What is the title of this page?" },
    description: "https://example.com",
    displayName: "WebFetch",
    alwaysAllow: [{ type: "addRules", destination: "localSettings", rules: [{ toolName: "WebFetch", ruleContent: "domain:example.com" }], behavior: "allow" }],
  };
  expect(drawn(fetch)).toEqual([
    "Fetch",
    "Claude wants to fetch content from example.com",
    "Do you want to allow Claude to fetch this content?",
    "Yes",
    "Yes, and don't ask again for example.com",
    "No, and tell Claude what to do differently (esc)",
  ]);
  expect(askFor(fetch, where).rows.some((row) => row.amend)).toBe(false);
});

test("an MCP server's tool is named with its server, and No takes a comment", () => {
  const mcp: PermissionRequest = {
    id: "m",
    toolName: "mcp__hello__greet",
    input: { name: "Ada" },
    displayName: "Greet",
    server: "hello",
    alwaysAllow: [{ type: "addRules", rules: [{ toolName: "mcp__hello__greet" }], behavior: "allow", destination: "localSettings" }],
  };
  expect(drawn(mcp)).toEqual([
    "Tool use",
    "hello — Greet Tool: (MCP)",
    "Do you want to proceed?",
    "Yes",
    "Yes, and don't ask again for hello — Greet commands in /tmp/ac",
    "No",
    "Esc to cancel",
  ]);
  // Claude Code may leave "don't ask again" out, when the rule would allow more than this one call.
  expect(drawn({ ...mcp, alwaysAllow: undefined })).toEqual(["Tool use", "hello — Greet Tool: (MCP)", "Do you want to proceed?", "Yes", "No", "Esc to cancel"]);
});

const PLAN: PermissionRequest = {
  id: "p",
  toolName: "ExitPlanMode",
  input: { plan: "# Plan\n1. Create hello.txt containing hi.\n", planFilePath: "/home/u/.claude/plans/plan-only-this.md" },
  displayName: "ExitPlanMode",
};

test("a plan offers the first mode Claude Code can switch to, then manual approval, then what to change", () => {
  expect(drawn(PLAN)).toEqual([
    "Ready to code?",
    "Here is Claude's plan:",
    "Claude has written up a plan and is ready to execute. Would you like to proceed?",
    "Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session",
    "Yes, manually approve edits",
    "[Tell Claude what to change]",
  ]);
  const first = (modes: Where["modes"]) => askFor(PLAN, { ...where, modes }).rows.map((row) => [row.label, row.decision]);
  expect(first({ bypass: false, auto: true })).toEqual([
    ["Yes, and use auto mode", { allow: true, updates: [{ type: "setMode", mode: "auto", destination: "session" }] }],
    ["Yes, manually approve edits", { allow: true, updates: [{ type: "setMode", mode: "default", destination: "session" }] }],
  ]);
  expect(first({ bypass: false, auto: false })[0]).toEqual(["Yes, auto-accept edits", { allow: true, updates: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] }]);
  expect(first({ bypass: true, auto: true })[0]?.[1]).toEqual({ allow: true, updates: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }] });
  // With no plan, Claude Code only asks to leave plan mode.
  expect(drawn({ ...PLAN, input: { plan: "" } })).toEqual(["Exit plan mode?", "Claude wants to exit plan mode", "Yes", "No"]);
});

test("a description that only repeats the command, whole or cut short, isn't shown again", () => {
  expect(permissionNote(BASH, CWD, "/home/u")).toBe("Create empty marker.txt in the working directory");
  expect(permissionNote({ ...BASH, input: { command: "bun test 2>&1 | tail -30" }, description: "bun test 2>&1 | t…" }, CWD, "/home/u")).toBeUndefined();
  expect(permissionNote({ ...BASH, input: { command: "bun test" }, description: "bun test" }, CWD, "/home/u")).toBeUndefined();
  expect(permissionNote(WRITE, CWD, "/home/u")).toBeUndefined();
  // A file in a folder: the prompt shows its path, so its bare name says nothing more.
  expect(permissionNote({ ...WRITE, input: { file_path: "/tmp/ac/src/edit-me.txt" }, description: "edit-me.txt" }, CWD, "/home/u")).toBeUndefined();
});
