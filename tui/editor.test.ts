import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { editorName, lendTerminal, readInEditor } from "./editor";

// The tests' stdin isn't a terminal, and what the program draws needn't reach the test's output.
const saved = { setRawMode: process.stdin.setRawMode, write: process.stdout.write };

beforeAll(() => {
  process.stdin.setRawMode = (() => process.stdin) as typeof process.stdin.setRawMode;
  process.stdout.write = (() => true) as typeof process.stdout.write;
});

afterAll(() => {
  process.stdin.setRawMode = saved.setRawMode;
  process.stdout.write = saved.write;
});

test(
  "takes the terminal back once the program turns into another, as `claude attach` does on ←",
  async () => {
    const started = Date.now();
    // The shell replaces itself with sleep, as `claude attach` replaces itself with `claude agents`.
    const code = await lendTerminal(["/bin/sh", "-c", "sleep 0.2; exec sleep 31.7"], undefined, (argv) => argv.join(" ") === "sleep 31.7");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(code).not.toBe(0);
    expect(Bun.spawnSync(["pgrep", "-f", "^sleep 31.7$"]).stdout.toString()).toBe("");
  },
  10000,
);

test("leaves a program that doesn't turn into another to finish", async () => {
  expect(await lendTerminal(["/bin/sh", "-c", "sleep 0.3; exit 3"], undefined, () => false)).toBe(3);
});

test("shows text in the editor from a file of its own, gone once the editor quits", async () => {
  const kept = mkdtempSync(join(tmpdir(), "astrocode-editor-"));
  const visual = process.env.VISUAL;
  // An editor that keeps a copy of what it was given, and says where that was.
  process.env.VISUAL = `sh -c 'cp "$1" ${kept}/seen; echo "$1" > ${kept}/path' sh`;
  try {
    await readInEditor("line 1\nline 2");
    expect(readFileSync(join(kept, "seen"), "utf8")).toBe("line 1\nline 2");
    expect(existsSync(dirname(readFileSync(join(kept, "path"), "utf8").trim()))).toBe(false);
  } finally {
    if (visual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = visual;
    rmSync(kept, { recursive: true, force: true });
  }
});

test("names your editor as claude's hint does: by its program, with its options and folder left off", () => {
  const before = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
  try {
    delete process.env.VISUAL;
    process.env.EDITOR = "/usr/bin/nvim";
    expect(editorName()).toBe("Nvim");
    process.env.VISUAL = "code --wait";
    expect(editorName()).toBe("Code");
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    expect(editorName()).toBe("Vi");
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
