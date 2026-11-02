// The session every mockup draws, taken from the audit's real run: turn 1 fixed retry's off-by-one,
// turn 2 gives the cache the same clock. Prose marks code with backticks; each direction decides
// how code in prose looks.

export const turn1 = {
  prompt: "The tests in src/retry.test.ts fail. Fix retry so it tries exactly `attempts` times, and give it an injectable clock so the tests run without real sleeping.",
  steps: [
    { said: "Reading retry and its tests to find the off-by-one", took: "0.4s" },
    { said: "Rewriting retry with a clock option, and the tests with a fake clock", took: "24s" },
    { said: "Committing on fix/retry-attempts", took: "12s" },
  ],
  reply:
    "All 4 tests pass in 6 ms, down from 2 s. The loop ran `attempts + 1` times; it now runs exactly `attempts` times and no longer sleeps after the last failure. Committed as `f535656`; there's no remote, so nothing is pushed.",
  took: "1m 39s",
};

export const turn2 = {
  prompt: "Give src/cache.ts the same injectable clock retry needs (Clock type in src/clock.ts), add src/cache.test.ts, then run bun test. Don't fix retry.",
  thinking: "Cache only needs `now()`; retry needs `now()` and `sleep()`. One Clock type with both, and Cache takes `Pick<Clock, \"now\">`, so a test can pass a bare `{ now }`.",
  step1: "I'll put the Clock type in its own file and give Cache an optional clock.",
  step2: "Checking where else the code reads the clock, in the background.",
  step3: "Running the whole suite; retry's attempts test should still fail.",
  reply:
    "Cache takes an injectable clock now, and `bun test` shows 7 passing and 1 failing: retry's attempts test, which I left alone as you asked. `Date.now` and `setTimeout` are left only in `retry.ts` (lines 22, 25 and 33). Nothing is committed.",
};

export type DiffRow = { kind: "+" | "-" | " " | "…"; n?: number; text: string };

/** The first edit to src/cache.ts, which the permission prompt asks about. */
export const firstEdit: DiffRow[] = [
  { kind: "+", n: 1, text: 'import { systemClock, type Clock } from "./clock";' },
  { kind: "+", n: 2, text: "" },
  { kind: " ", n: 3, text: "/** A small TTL cache keyed by string. */" },
  { kind: " ", n: 4, text: "export class Cache<V> {" },
  { kind: " ", n: 5, text: "  private entries = new Map<string, { value: V; expires: number }>();" },
  { kind: " ", n: 6, text: "" },
  { kind: "-", n: 5, text: "  constructor(private ttlMs: number) {}" },
  { kind: "+", n: 7, text: "  constructor(" },
  { kind: "+", n: 8, text: "    private ttlMs: number," },
  { kind: "+", n: 9, text: '    private clock: Pick<Clock, "now"> = systemClock,' },
  { kind: "+", n: 10, text: "  ) {}" },
];

/** Everything the turn changed in src/cache.ts, as the review shows it. */
export const cacheTurn: DiffRow[] = [
  { kind: "+", n: 1, text: 'import { systemClock, type Clock } from "./clock";' },
  { kind: "+", n: 2, text: "" },
  { kind: " ", n: 3, text: "/** A small TTL cache keyed by string. */" },
  { kind: "…", text: "3 lines" },
  { kind: "-", n: 5, text: "  constructor(private ttlMs: number) {}" },
  { kind: "+", n: 7, text: "  constructor(" },
  { kind: "+", n: 8, text: "    private ttlMs: number," },
  { kind: "+", n: 9, text: '    private clock: Pick<Clock, "now"> = systemClock,' },
  { kind: "+", n: 10, text: "  ) {}" },
  { kind: "…", text: "4 lines" },
  { kind: "-", n: 10, text: "    if (Date.now() > entry.expires) {" },
  { kind: "+", n: 15, text: "    if (this.clock.now() > entry.expires) {" },
  { kind: "…", text: "7 lines" },
  { kind: "-", n: 18, text: "    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });" },
  { kind: "+", n: 23, text: "    this.entries.set(key, { value, expires: this.clock.now() + this.ttlMs });" },
];

/** The new test file, as Follow shows it landing. */
export const cacheTest: string[] = [
  'import { expect, test } from "bun:test";',
  'import { Cache } from "./cache";',
  "",
  "const fakeClock = (start = 0) => {",
  "  let t = start;",
  "  return { now: () => t, advance: (ms: number) => (t += ms) };",
  "};",
  "",
  'test("returns a stored value before it expires", () => {',
  "  const clock = fakeClock();",
  "  const cache = new Cache<string>(100, clock);",
  '  cache.set("a", "x");',
  "  clock.advance(100);",
  '  expect(cache.get("a")).toBe("x");',
  "});",
];

export const status = {
  mode: "ask first",
  model: "Opus 5.5",
  effort: "xhigh",
  context: "18%",
  fiveHour: "31%",
  sevenDay: "24%",
  branch: "feat/cache-clock",
  changed: "±3",
};

/** Words wrapped to `width` columns, keeping backtick spans whole where they fit. */
export function wrap(text: string, width: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const visible = (s: string) => Array.from(s.replaceAll("`", "")).length;
    if (line && visible(`${line} ${word}`) > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  // A code span cut across lines would leave a lone backtick on each; close and reopen it.
  return lines.map((l, i) => {
    const before = lines.slice(0, i).join("").split("`").length - 1;
    const open = before % 2 === 1;
    const inside = (l.split("`").length - 1) % 2 === 1;
    return `${open ? "`" : ""}${l}${open !== inside ? "`" : ""}`;
  });
}
