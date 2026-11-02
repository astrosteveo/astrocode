import { expect, mock, test } from "bun:test";
import * as sdk from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "./queue";

/** What a stand-in Claude Code was sent, in order: each message's text, and each control request. */
let sent: unknown[] = [];

// A stand-in Claude Code, in place of the SDK's query: it queues every message, as Claude Code does
// while Claude works, and keeps what it was sent. It never finishes starting, so it's asked nothing else.
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  ...sdk,
  query: ({ prompt }: { prompt: AsyncIterable<SDKUserMessage> }) => {
    const out = new AsyncQueue<unknown>();
    void (async () => {
      for await (const message of prompt) {
        sent.push(message.message.content);
        out.push({ type: "command_lifecycle", command_uuid: message.uuid, state: "queued" });
      }
    })();
    return Object.assign(out, {
      request: async (body: Record<string, unknown>) => {
        sent.push(body);
        return { response: { still_queued: [], send_now: "stopped" } };
      },
      initializationResult: () => new Promise(() => {}),
      close: () => out.close(),
    });
  },
}));

const { AgentSession } = await import("./session");

const session = () => {
  sent = [];
  return new AgentSession({ cwd: "/tmp", emit: () => {} });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a message sent now goes, then what's queued goes now, once Claude Code has queued it", async () => {
  session().send("this instead", new Map(), { now: true });
  await settle();
  expect(sent).toEqual(["this instead", { subtype: "interrupt", send_now: true }]);
});

test("a message sent as usual waits in the queue", async () => {
  session().send("after that", new Map());
  await settle();
  expect(sent).toEqual(["after that"]);
});

test("what's queued goes now with nothing typed", async () => {
  const one = session();
  one.send("queued", new Map());
  await settle();
  await one.sendQueuedNow();
  expect(sent).toEqual(["queued", { subtype: "interrupt", send_now: true }]);
});
