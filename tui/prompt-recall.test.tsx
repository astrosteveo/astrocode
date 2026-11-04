import { expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { DEFAULT_KEYMAP } from "./keys";
import { Prompt } from "./prompt";

const UP = "\x1b[A";
const CTRL_R = "\x12";

/** A paste of 300 lines, as claude's history keeps them. */
const LONG = Array.from({ length: 300 }, (_, n) => `log line ${n} with some content`).join("\n");

/** The message box on a fake terminal, going back through `history` on ↑ and `everywhere` on Ctrl+R, and what it sent. */
function box(history: string[], everywhere: string[], width = 60) {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: width, rows: 30 });
  let drawn = "";
  stdout.on("data", (chunk: Buffer) => {
    drawn += chunk.toString();
  });
  const sent: string[] = [];
  const none = () => {};
  const app = render(
    <Prompt
      active
      fullscreen={false}
      busy={false}
      width={width}
      cwd="/tmp"
      history={history}
      everywhere={everywhere}
      commands={[]}
      onSubmit={(text) => sent.push(text)}
      onSendQueuedNow={none}
      onInterrupt={none}
      onCycleMode={none}
      onCtrlC={none}
      onExit={none}
      onOpenOutput={none}
      prefill={null}
      onAttach={() => 1}
      onNotice={none}
      onEdit={none}
      onBackground={none}
      onToggleTodos={none}
      onRewind={none}
      onSuspend={none}
      keymap={DEFAULT_KEYMAP}
      onStepEffort={none}
      onToggleThinking={none}
      onModelPicker={none}
      onFastMode={none}
      onStopTasks={none}
      stash={null}
      onStash={none}
      workflows
    />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  return {
    press: async (keys: string) => {
      stdin.write(keys);
      await Bun.sleep(60);
    },
    /** The rows last drawn: each frame is drawn as one synchronized update. */
    frame: () => stripVTControlCharacters(drawn.split("\x1b[?2026h").at(-1) ?? "").split("\n").map((row) => row.trimEnd()).filter(Boolean),
    sent,
    app,
  };
}

test("↑ goes back through this folder's messages, and Ctrl+R searches every folder's", async () => {
  const { press, frame, sent, app } = box(["older here", "newer here"], ["from another folder", "older here", "newer here"]);
  await Bun.sleep(60);
  await press(UP);
  expect(frame()).toContain(" ❯ newer here");
  await press(UP);
  expect(frame()).toContain(" ❯ older here");
  await press(UP);
  expect(frame()).toContain(" ❯ older here");
  await press(CTRL_R);
  await press("another");
  expect(frame()).toContain("   from another folder");
  await press("\r");
  await press("\r");
  app.unmount();
  expect(sent).toEqual(["from another folder"]);
});

test("Ctrl+R shows a long match on one row, with the place it found in view", async () => {
  const { press, frame, app } = box([], ["first", `look at this ${LONG}`, "last"], 60);
  await Bun.sleep(60);
  await press(CTRL_R);
  await press("line 150 with");
  const rows = frame();
  app.unmount();
  expect(rows.length).toBeLessThanOrEqual(4);
  expect(rows[0]).toContain("1 of 1");
  expect(rows[1]).toContain("⌕ line 150 with");
  expect(rows[2]).toContain("log line 150 with some content");
  expect(rows[2]).toContain("+299 lines");
});

test("Ctrl+R keeps the place it found in view on a line wider than the box", async () => {
  const wide = `${"a".repeat(200)} needle ${"b".repeat(200)}`;
  const { press, frame, app } = box([], [wide], 40);
  await Bun.sleep(60);
  await press(CTRL_R);
  await press("needle");
  const rows = frame();
  app.unmount();
  expect(rows.length).toBeLessThanOrEqual(4);
  expect(rows[2]).toContain("…aaa");
  expect(rows[2]).toContain("needle");
  expect(rows[2]).toMatch(/b…$/);
});
