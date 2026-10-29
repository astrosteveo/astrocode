import { expect, test } from "bun:test";
import { Mouse, type MouseEvent } from "./mouse";

/** A mouse on a fake terminal: `feed` hands it a chunk of input, as one read of stdin. */
function mouse() {
  const chunks: string[] = [];
  const stdin = { read: () => chunks.shift() ?? null } as unknown as NodeJS.ReadStream;
  const stdout = { write: () => true } as unknown as NodeJS.WriteStream;
  const one = new Mouse(stdin, stdout);
  const heard: MouseEvent[] = [];
  one.listen((event) => heard.push(event));
  one.start();
  const feed = async (chunk: string) => {
    chunks.push(chunk);
    const rest = stdin.read();
    await Promise.resolve();
    return rest;
  };
  return { one, heard, feed };
}

const drag = (x: number, y: number) => `\x1b[<32;${x + 1};${y + 1}M`;

test("handles only the last of the drags that arrive together", async () => {
  const { one, heard, feed } = mouse();
  const rest = await feed(`${drag(1, 1)}${drag(2, 1)}${drag(3, 2)}\x1b[<0;4;3m`);
  expect(rest).toBe("");
  expect(heard.map(({ type, x, y }) => [type, x, y])).toEqual([
    ["drag", 3, 2],
    ["release", 3, 2],
  ]);
  one.stop();
});

test("keeps a press between drags, in order", async () => {
  const { one, heard, feed } = mouse();
  await feed(`${drag(1, 1)}${drag(2, 1)}\x1b[<0;3;2M${drag(4, 1)}${drag(5, 1)}`);
  expect(heard.map(({ type, x }) => [type, x])).toEqual([
    ["drag", 2],
    ["press", 2],
    ["drag", 5],
  ]);
  one.stop();
});

test("leaves typed text for the keyboard", async () => {
  const { one, heard, feed } = mouse();
  expect(await feed(`a${drag(1, 1)}b`)).toBe("ab");
  expect(heard).toHaveLength(1);
  one.stop();
});
