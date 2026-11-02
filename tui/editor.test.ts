import { afterAll, beforeAll, expect, test } from "bun:test";
import { lendTerminal } from "./editor";

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
