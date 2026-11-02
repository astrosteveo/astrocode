import { expect, test } from "bun:test";
import { moveAll } from "./fleet";
import { Store } from "./store";

const conversation = (key: string, task: string, knownId?: string) => {
  const store = new Store("/nonexistent/astrocode-fleet", "/nonexistent");
  store.emit({ kind: "prompt", text: task });
  return { key, store, session: { knownId }, cwd: "/nonexistent/astrocode-fleet" };
};

test("says where each conversation went as astrocode quits, and how to resume one the background service refused", async () => {
  const said = await moveAll([conversation("a", "fix the build", "id-a"), conversation("b", "add the tests", "id-b"), conversation("c", "")], async (one) => {
    if (one.key === "b") throw new Error("Workspace not trusted.");
    return one.key === "a" ? "7c5dcf5d" : undefined;
  });
  expect(said).toEqual([
    "“fix the build” carries on in the background as 7c5dcf5d: claude attach 7c5dcf5d, or astrocode agents.",
    "“add the tests” couldn't move to the background (Workspace not trusted.), so it ended here: astrocode --resume id-b",
  ]);
});
