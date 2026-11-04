import { expect, test } from "bun:test";
import { patchLines, runsOf } from "./patch";

const PATCH = `diff --git a/old.ts b/src/cache.ts
similarity index 85%
rename from old.ts
rename to src/cache.ts
index 0fdf397..f9d9a01 100644
--- a/old.ts
+++ b/src/cache.ts
@@ -1,2 +1,3 @@
+import { clock } from "./clock";
 /** A cache. */
 export class Cache {
@@ -10,3 +11,3 @@ export class Cache {
   get(key: string) {
-    if (Date.now() > this.at) {
+    if (clock.now() > this.at) {
       return;
\\ No newline at end of file
`;

test("reads a patch's lines, numbered on each side from its hunks' headers", () => {
  expect(patchLines(PATCH)).toEqual([
    { kind: "added", text: 'import { clock } from "./clock";', new: 1 },
    { kind: "context", text: "/** A cache. */", old: 1, new: 2 },
    { kind: "context", text: "export class Cache {", old: 2, new: 3 },
    { kind: "context", text: "  get(key: string) {", old: 10, new: 11 },
    { kind: "removed", text: "    if (Date.now() > this.at) {", old: 11 },
    { kind: "added", text: "    if (clock.now() > this.at) {", new: 12 },
    { kind: "context", text: "      return;", old: 12, new: 13 },
  ]);
  // A binary file's patch has no lines.
  expect(patchLines("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n")).toEqual([]);
});

test("splits the lines where the diff leaves some out, counting them", () => {
  const runs = runsOf(patchLines(PATCH));
  expect(runs.map((run) => [run.skipped, run.lines.length])).toEqual([
    [0, 3],
    [7, 4],
  ]);
  // A hunk that starts by removing lines leaves out as many on each side.
  expect(runsOf(patchLines("@@ -5,2 +5,1 @@\n-a\n-b\n+c\n")).map((run) => run.skipped)).toEqual([4]);
  // Lines without numbers, as an edit's own diff can be, are one run.
  expect(runsOf([{ kind: "removed", text: "a" }, { kind: "added", text: "b" }])).toEqual([{ skipped: 0, lines: [{ kind: "removed", text: "a" }, { kind: "added", text: "b" }] }]);
});
