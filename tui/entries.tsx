// The transcript's entries, each on the rail with its own node: a gold dot for what you sent, a
// teal diamond for Claude's replies, hexagons for tool calls, and a curve that closes the turn.
// The scrollback layout writes them through Ink's <Static>; full screen draws them as lines.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { ImageAttachment } from "../src/events";
import { foldSpan, foldSummary, type Fold } from "../src/view/folds";
import { compact, duration } from "../src/view/format";
import { runOfCall, runOfShell } from "../src/view/runs";
import { plural, shortPath, toolLabel, toolTarget } from "../src/view/tools";
import type { Item, Live } from "../src/view/state";
import { cellWidth } from "./markdown";
import { fit, Markdown } from "./markdown-view";
import { FullOutput, OutputBody } from "./output";
import { hyperlink } from "./links";
import { ImageView, isReady } from "./pictures";
import { GUTTER, LIVE, Railed, type Rail } from "./rail";
import { ShellCard } from "./shell-card";
import { PALETTE } from "./theme";
import { DraftRow, toolNode, ToolRow } from "./tool-row";
import { Figure, shownOf } from "./figure";
import { PROMPT_LINK } from "./window";

/** `pictureRows`: how tall a picture in an entry may be. */
export type ViewProps = { cwd: string; home: string; width: number; pictureRows: number };

type ItemProps = {
  item: Item;
  rail: Rail;
  /** With what matters from a finished tool call's result under its row. */
  detailed?: boolean;
  waiting?: boolean;
  /**
   * Whether a tool call, a `!` command or a turn's closer is open, with its whole output under its
   * row. Unset, it's as `opensByDefault()` says.
   */
  expanded?: boolean;
  /**
   * Written into the terminal's own scrollback, where the mouse is the terminal's: a message of
   * yours carries the mark the terminal jumps to, and the files tool calls act on are links.
   */
  scrollback?: boolean;
  /** Claude's code blocks get a `copy` a click acts on, in full screen. */
  copyable?: boolean;
} & ViewProps;

export function ItemView({ item, rail, detailed = false, waiting = false, expanded: open, scrollback = false, copyable = false, ...view }: ItemProps) {
  const inner = { ...view, width: view.width - GUTTER };
  const expanded = open ?? opensByDefault(item);
  const links = scrollback ? "scrollback" : copyable ? "screen" : undefined;
  switch (item.kind) {
    case "prompt":
      return (
        <Railed node={scrollback ? hyperlink(PROMPT_LINK, "●") : "●"} color={PALETTE.gold} rail={rail}>
          <Message text={item.text} images={item.images} width={inner.width} rows={view.pictureRows} />
          {item.remote ? <Text color={PALETTE.dust}>via Remote Control</Text> : null}
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
          {/* A diagram may take the whole screen, since shrinking it shrinks its words. */}
          <Markdown text={item.text} width={inner.width} copyable={copyable} diagrams={{ rows: view.pictureRows * 2, links }} />
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
            {detailed || expanded ? <Figure shown={shownOf(item.call)} width={inner.width} rows={view.pictureRows} links={links} /> : null}
          </Railed>
        );
      }
      return (
        <Railed node={glyph} color={color} rail={rail}>
          <ToolRow call={item.call} waiting={waiting} detailed={detailed && !expanded} fileLink={scrollback} links={links} {...inner} />
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
          <TurnEnd item={item} expanded={expanded} cwd={view.cwd} home={view.home} width={inner.width} />
        </Railed>
      );
    case "notice": {
      const { node, color, text } = NOTICE_TONES[item.tone];
      return (
        <Railed node={node} color={color} rail={rail}>
          <Text color={text}>{item.text}</Text>
        </Railed>
      );
    }
  }
}

/** A notice's node and colors: by the way in quiet gray, a warning in ember, a failure in rose. */
const NOTICE_TONES = {
  info: { node: "○", color: PALETTE.dust, text: PALETTE.haze },
  warning: { node: "▲", color: PALETTE.ember, text: PALETTE.ember },
  error: { node: "✕", color: PALETTE.rose, text: PALETTE.rose },
} as const;

/** The most calls a closed fold lists under its row; past that, a last line says how many more. */
const FOLD_LISTED = 8;

/**
 * A run of tool calls folded into one row: how many, of what kinds, and how long they took, with
 * ▸ closed or ▾ open. Closed, each call is a line under it, a command as `$ command` and anything
 * else as its tool and target. Open, the calls follow it on the rail, each as it would be drawn alone.
 */
export function FoldView({ fold, rail, open, cwd, home, width }: { fold: Fold; rail: Rail; open: boolean; cwd: string; home: string; width: number }) {
  const span = foldSpan(fold);
  const right = `${span !== undefined ? `${duration(span)}  ` : ""}${open ? "▾" : "▸"}`;
  const inner = width - GUTTER;
  return (
    <Railed node="⬢" color={PALETTE.teal} rail={rail}>
      <Box justifyContent="space-between" width={inner}>
        <Text wrap="truncate-end">
          <Text color={PALETTE.teal}>{`${fold.calls.length} tool calls`}</Text>
          <Text color={PALETTE.haze}>{`  ${fit(foldSummary(fold), inner - cellWidth(right) - 16, false)}`}</Text>
        </Text>
        <Text color={PALETTE.dust}>{right}</Text>
      </Box>
      {open
        ? null
        : fold.calls.slice(0, fold.calls.length > FOLD_LISTED ? FOLD_LISTED - 1 : FOLD_LISTED).map(({ key, call }) => (
            <Text key={key} wrap="truncate-end">
              {call.name === "Bash" && typeof call.input.command === "string" ? (
                <>
                  <Text color={PALETTE.dust}>{"$ "}</Text>
                  <Text color={PALETTE.haze}>{firstLine(call.input.command)}</Text>
                </>
              ) : (
                <>
                  <Text color={PALETTE.dust}>{`${toolLabel(call.name)}  `}</Text>
                  <Text color={PALETTE.haze}>{toolTarget(call, cwd, home)}</Text>
                </>
              )}
            </Text>
          ))}
      {!open && fold.calls.length > FOLD_LISTED ? <Text color={PALETTE.dust}>{`… ${fold.calls.length - FOLD_LISTED + 1} more`}</Text> : null}
    </Railed>
  );
}

/**
 * Whether an entry is open until you close it: a `!` command of yours once it has ended, its whole
 * output under it, as a terminal would show it. Claude's calls stay closed, and so does a command
 * still running, whose live card shows the end of its output; in scrollback one that went to the
 * background while running is drawn for good then, and open it would keep half its output.
 */
export function opensByDefault(item: Item) {
  return item.kind === "shell" && item.status !== "running";
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

/**
 * `╰── 42s   1.2k tokens   2 files · 3 commands`: how long the turn took, what Claude wrote and
 * what it did, closing the rail. Opened in full screen, the files and commands are listed under it.
 */
function TurnEnd({ item, expanded, cwd, home, width }: { item: Extract<Item, { kind: "turn" }>; expanded: boolean; cwd: string; home: string; width: number }) {
  const tokens = item.tokens > 0 ? `   ${compact(item.tokens)} tokens` : "";
  const said = {
    finished: { text: `${duration(item.durationMs)}${tokens}`, color: PALETTE.haze },
    stopped: { text: `stopped after ${duration(item.durationMs)}${tokens}`, color: PALETTE.ember },
    failed: { text: `failed after ${duration(item.durationMs)}`, color: PALETTE.rose },
  }[item.outcome];
  // A replayed turn whose messages carried no times says only what it did.
  const timed = !item.replayed || item.durationMs > 0;
  const work = turnWork(item);
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={PALETTE.dust}>─ </Text>
        {timed ? <Text color={said.color}>{said.text}</Text> : null}
        {work ? <Text color={PALETTE.dust}>{`${timed ? "   " : ""}${work}`}</Text> : null}
      </Text>
      {item.detail ? <Text color={PALETTE.rose}>{item.detail}</Text> : null}
      {expanded ? (
        <Box flexDirection="column" marginTop={1}>
          {item.files?.map((file) => (
            <Text key={`f${file}`} wrap="truncate-end">
              <Text color={PALETTE.haze}>{"changed  "}</Text>
              <Text color={PALETTE.star}>{fit(shortPath(file, cwd, home), width - 9, true)}</Text>
            </Text>
          ))}
          {item.commands?.map((command, i) => (
            <Text key={`c${i}`} wrap="truncate-end">
              <Text color={PALETTE.haze}>{"ran      "}</Text>
              <Text color={PALETTE.dust}>{"$ "}</Text>
              <Text>{firstLine(command)}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

/** What a turn did, counted: `2 files · 3 commands`, or empty when it changed and ran nothing. */
export function turnWork(item: Extract<Item, { kind: "turn" }>) {
  const files = item.files?.length ?? 0;
  const commands = item.commands?.length ?? 0;
  return [files ? `${plural(files, "file")} changed` : "", commands ? plural(commands, "command") : ""].filter(Boolean).join(" · ");
}

function firstLine(text: string) {
  const [first = ""] = text.split("\n");
  return text.includes("\n") ? `${first} …` : first;
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
          <Markdown text={room === undefined ? text : tail(text, inner, room)} width={inner} diagrams="start" />
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
