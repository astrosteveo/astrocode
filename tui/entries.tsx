// The transcript's entries, each on the rail with its own node: a gold dot for what you sent, a
// teal diamond for Claude's replies, hexagons for tool calls, and a curve that closes the turn.
// The scrollback layout writes them through Ink's <Static>; full screen draws them as lines.
import { Box, Text } from "ink";
import { compact, duration } from "../src/view/format";
import type { Item, Live } from "../src/view/state";
import { cellWidth, wrapText } from "./markdown";
import { Markdown } from "./markdown-view";
import { FullOutput, OutputBody } from "./output";
import { GUTTER, LIVE, Railed, type Rail } from "./rail";
import { PALETTE } from "./theme";
import { DraftRow, toolNode, ToolRow } from "./tool-row";

export type ViewProps = { cwd: string; home: string; width: number };

type ItemProps = {
  item: Item;
  rail: Rail;
  /** With what matters from a finished tool call's result under its row. */
  detailed?: boolean;
  waiting?: boolean;
  /** A tool call opened in full screen, with its whole output under its row. */
  expanded?: boolean;
} & ViewProps;

export function ItemView({ item, rail, detailed = false, waiting = false, expanded = false, ...view }: ItemProps) {
  const inner = { ...view, width: view.width - GUTTER };
  switch (item.kind) {
    case "prompt":
      return (
        <Railed node="●" color={PALETTE.gold} rail={rail}>
          {wrapText(item.text, inner.width, true).map((row, i) => (
            <Text key={i} bold color={PALETTE.star}>
              {row.map((run) => run.text).join("")}
            </Text>
          ))}
        </Railed>
      );
    case "text":
      return (
        <Railed node="◆" color={PALETTE.teal} rail={rail}>
          <Markdown text={item.text} width={inner.width} />
        </Railed>
      );
    case "thinking":
      return (
        <Railed node="∴" color={PALETTE.haze} rail={rail}>
          <Text italic color={PALETTE.haze}>
            {item.text}
          </Text>
        </Railed>
      );
    case "tool": {
      const { glyph, color } = toolNode(item.call, waiting);
      return (
        <Railed node={glyph} color={color} rail={rail}>
          <ToolRow call={item.call} waiting={waiting} detailed={detailed && !expanded} {...inner} />
          {expanded ? <OutputBody call={item.call} width={inner.width} /> : null}
        </Railed>
      );
    }
    case "output": {
      const { glyph, color } = toolNode(item.call, false);
      return (
        <Railed node={glyph} color={color} rail={rail}>
          <FullOutput call={item.call} {...inner} />
        </Railed>
      );
    }
    case "turn":
      return (
        <Railed node="╰─" color={PALETTE.dust} rail={rail}>
          <TurnEnd item={item} />
        </Railed>
      );
    case "notice":
      return (
        <Railed node={item.tone === "error" ? "✕" : "○"} color={item.tone === "error" ? PALETTE.rose : PALETTE.dust} rail={rail}>
          <Text color={item.tone === "error" ? PALETTE.rose : PALETTE.haze}>{item.text}</Text>
        </Railed>
      );
  }
}

/** `╰── 42s   1.2k tokens`: how long the turn took and what Claude wrote, closing the rail. */
function TurnEnd({ item }: { item: Extract<Item, { kind: "turn" }> }) {
  const tokens = item.tokens > 0 ? `   ${compact(item.tokens)} tokens` : "";
  const said = {
    finished: { text: `${duration(item.durationMs)}${tokens}`, color: PALETTE.haze },
    stopped: { text: `stopped after ${duration(item.durationMs)}${tokens}`, color: PALETTE.ember },
    failed: { text: `failed after ${duration(item.durationMs)}`, color: PALETTE.rose },
  }[item.outcome];
  if (item.replayed) return <Text color={PALETTE.dust}>─</Text>;
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={PALETTE.dust}>─ </Text>
        <Text color={said.color}>{said.text}</Text>
      </Text>
      {item.detail ? <Text color={PALETTE.rose}>{item.detail}</Text> : null}
    </Box>
  );
}

/**
 * What Claude is writing right now, at the tip of the rail. In scrollback only the end fits,
 * `room` rows of it, and the whole reply lands there when it's done; full screen shows all of it.
 */
export function LiveView({ live, width, room }: { live: Live | null; width: number; room?: number }) {
  if (!live) return null;
  const blocks = live.blocks.slice(live.finalized);
  const text = blocks
    .filter((block) => block?.kind === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  const tool = blocks.findLast((block) => block?.kind === "tool");
  if (!text && !tool?.name) return null;
  const inner = width - GUTTER;
  return (
    <Box flexDirection="column">
      {text ? (
        <Railed node="◆" color={PALETTE.teal} rail={LIVE}>
          <Markdown text={room === undefined ? text : tail(text, inner, room)} width={inner} />
        </Railed>
      ) : null}
      {tool?.name ? (
        <Railed node="⬡" color={PALETTE.haze} rail={LIVE}>
          <DraftRow name={tool.name} />
        </Railed>
      ) : null}
    </Box>
  );
}

/** The last lines of `text` that fill about `room` rows at this width. */
function tail(text: string, width: number, room: number) {
  const lines = text.split("\n");
  let used = 0;
  let start = lines.length;
  while (start > 0) {
    const height = Math.max(1, Math.ceil(cellWidth(lines[start - 1] ?? "") / width));
    if (used + height > room) break;
    used += height;
    start -= 1;
  }
  return lines.slice(start).join("\n");
}
