import { expect, test } from "bun:test";
import { ledgerLine } from "./ledger";
import type { Item } from "./state";

type Turn = Extract<Item, { kind: "turn" }>;

const turn = (more: Partial<Turn> = {}): Turn => ({ kind: "turn", key: "t", outcome: "finished", durationMs: 100_000, tokens: 2900, ...more });
const read = (one: Turn) => ledgerLine(one).map((part) => part.text).join("");
const tones = (one: Turn) => Object.fromEntries(ledgerLine(one).map((part) => [part.text, part.tone]));

const files = [
  { path: "/work/src/clock.ts", added: 11, removed: 0 },
  { path: "/work/src/cache.ts", added: 8, removed: 3 },
  { path: "/work/src/cache.test.ts", added: 39, removed: 0 },
];

test("reads time · files with their totals · tests · commits, in that order", () => {
  const one = turn({ files, tests: { passed: 7, failed: 1 }, commits: [] });
  expect(read(one)).toBe("1m 40s · 3 files +58 −3 · 7 passed 1 failed · not committed");
  expect(tones(one)).toMatchObject({ "3 files": "bright", " +58": "added", " −3": "removed", "7 passed": "done", " 1 failed": "failed", "not committed": "stopped", " · ": "faint" });
});

test("names the commit the turn made, and says how many more it made", () => {
  expect(read(turn({ files, tests: { passed: 4, failed: 0 }, commits: ["f535656"] }))).toBe("1m 40s · 3 files +58 −3 · 4 passed · committed f535656");
  expect(read(turn({ files, commits: ["c0b6c78", "f535656", "af6fae3"] }))).toBe("1m 40s · 3 files +58 −3 · committed af6fae3 and 2 more");
  // Committed changes aren't the first thing to read.
  expect(tones(turn({ files, commits: ["f535656"] }))["3 files"]).toBe("quiet");
});

test("says what it pushed and the pull request it acted on", () => {
  expect(read(turn({ commits: ["f535656"], pushed: true, pr: { number: 12, action: "created" } }))).toBe("1m 40s · committed f535656 · pushed · PR #12");
  expect(read(turn({ pr: { number: 11, action: "auto-merge-enabled" } }))).toBe("1m 40s · PR #11 auto merge enabled");
  expect(tones(turn({ pr: { number: 12, action: "created" } }))["PR #12"]).toBe("elsewhere");
});

test("says nothing of commits where git couldn't say, and nothing of tests none ran", () => {
  expect(read(turn({ files }))).toBe("1m 40s · 3 files +58 −3");
  expect(read(turn({ files: [], commits: [] }))).toBe("1m 40s");
  expect(read(turn({ tests: { passed: 0, failed: 2 } }))).toBe("1m 40s · 2 failed");
});

test("counts a binary file, or one too big to read, without lines", () => {
  expect(read(turn({ files: [{ path: "/work/logo.png", added: 0, removed: 0 }], commits: [] }))).toBe("1m 40s · 1 file · not committed");
});

test("says a stopped turn stopped, and a failed one why, in place of its time", () => {
  expect(read(turn({ outcome: "stopped", durationMs: 41_000, files, commits: [] }))).toBe("stopped after 41s · 3 files +58 −3 · not committed");
  expect(tones(turn({ outcome: "stopped", durationMs: 41_000 }))["stopped after 41s"]).toBe("stopped");
  const failed = turn({ outcome: "failed", detail: "API Error: 529 overloaded\nretried 10 times", files: [files[1]!], commits: [] });
  expect(read(failed)).toBe("failed: API Error: 529 overloaded · 1 file +8 −3 · not committed");
  expect(tones(failed)["failed: API Error: 529 overloaded"]).toBe("failed");
  expect(read(turn({ outcome: "failed", durationMs: 3000 }))).toBe("failed after 3s");
});

test("leaves the time out of a resumed turn whose messages carried none", () => {
  expect(read(turn({ replayed: true, durationMs: 0, tests: { passed: 4, failed: 0 } }))).toBe("4 passed");
});
