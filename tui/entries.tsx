// The transcript's entries, each on the rail with its own node: a gold dot for what you sent, a
// teal diamond for Claude's replies, hexagons for tool calls, and a curve that closes the turn.
// The scrollback layout writes them through Ink's <Static>; full screen draws them as lines.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { ImageAttachment } from "../src/events";
import { compact, duration } from "../src/view/format";
import { runOfCall, runOfShell } from "../src/view/runs";
import type { Item, Live } from "../src/view/state";
import { cellWidth } from "./markdown";
import { Markdown } from "./markdown-view";
import { FullOutput, OutputBody } from "./output";
import { ImageView, isReady, Pictures } from "./pictures";
import { GUTTER, LIVE, Railed, type Rail } from "./rail";
import { ShellCard } from "./shell-card";
import { PALETTE } from "./theme";
import { DraftRow, picturesOf, toolNode, ToolRow } from "./tool-row";

/** `pictureRows`: how tall a picture in an entry may be. */
export type ViewProps = { cwd: string; home: string; width: number; pictureRows: number };

type ItemProps = {
  item: Item;
  rail: Rail;
  /** With what matters from a finished tool call's result under its row. */
  detailed?: boolean;
  waiting?: boolean;
  /** A tool call or a `!` command opened in full screen, with its whole output under its row. */
  expanded?: boolean;
} & ViewProps;

export function ItemView({ item, rail, detailed = false, waiting = false, expanded = false, ...view }: ItemProps) {
  const inner = { ...view, width: view.width - GUTTER };
  switch (item.kind) {
    case "prompt":
      return (
        <Railed node="●" color={PALETTE.gold} rail={rail}>
          <Message text={item.text} images={item.images} width={inner.width} rows={view.pictureRows} />
        </Railed>
      );
    case "shell":
      return (
        <Railed node="!" color={item.status === "error" ? PALETTE.rose : item.status === "stopped" ? PALETTE.ember : PALETTE.gold} rail={rail}>
          <ShellCard run={runOfShell(item)} width={inner.width} expanded={expanded} />
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
          <Markdown text={item.text} width={inner.width} voice="thinking" />
        </Railed>
      );
    case "tool": {
      const { glyph, color } = toolNode(item.call, waiting);
      if (item.call.name === "Bash") {
        return (
          <Railed node={glyph} color={color} rail={rail}>
            <ShellCard run={runOfCall(item.call, waiting)} width={inner.width} expanded={expanded} />
            {detailed || expanded ? <Pictures images={picturesOf(item.call)} width={inner.width} rows={view.pictureRows} /> : null}
          </Railed>
        );
      }
      return (
        <Railed node={glyph} color={color} rail={rail}>
          <ToolRow call={item.call} waiting={waiting} detailed={detailed && !expanded} {...inner} />
          {expanded ? <OutputBody call={item.call} width={inner.width} pictureRows={view.pictureRows} /> : null}
        </Railed>
      );
    }
    case "output": {
      const shown = item.of;
      if (shown.kind === "shell") {
        return (
          <Railed node="!" color={PALETTE.gold} rail={rail}>
            <ShellCard run={runOfShell(shown)} width={inner.width} expanded />
          </Railed>
        );
      }
      const { glyph, color } = toolNode(shown.call, false);
      return (
        <Railed node={glyph} color={color} rail={rail}>
          <FullOutput call={shown.call} {...inner} />
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

/**
 * What you sent, each image drawn under the line with the first `[Image #n]` that mentions it,
 * where the terminal draws images. The text breaks only at the ends of lines, so what follows a
 * picture can't turn into a list item or a heading.
 */
function Message({ text, images = {}, width, rows }: { text: string; images?: Record<number, ImageAttachment>; width: number; rows: number }) {
  const parts: ReactNode[] = [];
  const seen = new Set<number>();
  /** Where the text drawn so far ends, and the images waiting for the end of the line they're on. */
  let from = 0;
  let waiting: { n: number; image: ImageAttachment }[] = [];
  let lineEnd = -1;
  const flush = () => {
    if (!waiting.length) return;
    parts.push(<Markdown key={`text${from}`} text={text.slice(from, lineEnd)} width={width} voice="you" />);
    for (const { n, image } of waiting) parts.push(<ImageView key={`image${n}`} image={image} width={width} rows={rows} />);
    from = lineEnd + 1;
    waiting = [];
  };
  for (const match of text.matchAll(/\[Image #(\d+)\]/g)) {
    const n = Number(match[1]);
    const image = images[n];
    if (!image || seen.has(n) || !isReady(image)) continue;
    seen.add(n);
    const end = text.indexOf("\n", match.index);
    const line = end === -1 ? text.length : end;
    if (line !== lineEnd) flush();
    lineEnd = line;
    waiting.push({ n, image });
  }
  flush();
  const rest = text.slice(from);
  if (rest || !parts.length) parts.push(<Markdown key={`text${from}`} text={rest} width={width} voice="you" />);
  return <>{parts}</>;
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
