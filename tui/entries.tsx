// The transcript's entries, each on the rail with its own node: a gold dot for what you sent, a
// teal diamond for Claude's replies, hexagons for tool calls, and a curve that closes the turn.
// The scrollback layout writes them through Ink's <Static>; full screen draws them as lines.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { ImageAttachment } from "../src/events";
import type { ActivityRow, Part, Tone } from "../src/view/activity";
import { compact, duration, timed, took } from "../src/view/format";
import { runOfCall, runOfShell } from "../src/view/runs";
import { plural, shortPath } from "../src/view/tools";
import type { Item, Live } from "../src/view/state";
import { cellWidth } from "./markdown";
import { fit, Markdown } from "./markdown-view";
import { FullOutput, OutputBody } from "./output";
import { hyperlink } from "./links";
import { ImageView, isReady } from "./pictures";
import { GUTTER, LIVE, Railed, type Rail } from "./rail";
import { ShellCard } from "./shell-card";
import { mix, PALETTE } from "./theme";
import { DraftRow, SubagentLines, toolNode, ToolRow } from "./tool-row";
import { Figure, hasPictures, shownOf, type FigureLinks } from "./figure";
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

/** A step's node by how it went: a check once done, a cross when its last call failed. */
export const STEP_NODES = {
  done: { node: "✓", color: PALETTE.teal },
  running: { node: "●", color: PALETTE.teal },
  waiting: { node: "●", color: PALETTE.gold },
  failed: { node: "✗", color: PALETTE.rose },
  stopped: { node: "■", color: PALETTE.ember },
} as const;

/** What an activity line's targets are drawn in: a step back from the title, which is the brightest. */
const BODY = mix(PALETTE.star, PALETTE.haze, 0.3);

const TONES: Record<Tone, string> = {
  plain: BODY,
  bright: PALETTE.star,
  quiet: PALETTE.haze,
  faint: PALETTE.dust,
  code: PALETTE.tealLight,
  added: PALETTE.teal,
  removed: PALETTE.rose,
  done: PALETTE.teal,
  failed: PALETTE.rose,
  stopped: PALETTE.ember,
  waiting: PALETTE.gold,
};

/** Cells before an activity line's verb, and the verb's column, so targets line up down a step. */
const INDENT = 2;
const VERB = 10;
/** Where a line's target starts: what goes under a line (why it failed, a subagent's calls, pictures) starts there too. */
const UNDER = INDENT + VERB;
/** Lines a closed step shows; past that, the first two and the last three, and a line for the rest. */
const MOST_ROWS = 6;

/** Thinking, Claude's words and progress lines between a step's calls, and the calls as activity lines, in order. */
export type Flow =
  | { kind: "row"; row: ActivityRow }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "notice"; key: string; text: string; tone: "info" | "warning" | "error" };

export type StepRow = {
  key: string;
  title: string;
  /** Made from the calls, for want of a sentence from Claude: drawn quieter. */
  made: boolean;
  /** Claude's whole sentence, when there's more of it than the title, shown once the step opens. */
  more?: string;
  status: keyof typeof STEP_NODES;
  span?: number;
  flow: Flow[];
};

/** A piece of a step as full screen lays it out: what it draws, and what a click on it acts on. */
export type Piece = { key: string; target?: string; node: ReactNode };

/** What a click on an activity line acts on: the first of the calls it stands for, to inspect. */
export const callTarget = (id: string) => `call:${id}`;
export const targetCall = (target: string) => (target.startsWith("call:") ? target.slice(5) : undefined);

type StepProps = {
  step: StepRow;
  rail: Rail;
  open: boolean;
  width: number;
  /** The call the inspector shows, whose line is marked. */
  picked?: string;
  pictureRows: number;
  links?: FigureLinks;
  cwd: string;
  home: string;
  /** Whether a click acts on it, as in full screen, which the marks for opening and inspecting say. */
  clickable?: boolean;
};

/** Whether the step has more to show open than closed: Claude's words, thinking, or lines past the most a closed step shows. */
export function opens(step: StepRow) {
  return Boolean(step.more) || step.flow.some((one) => one.kind !== "row") || step.flow.length > MOST_ROWS;
}

/**
 * A step as an activity log: what Claude set out to do, with how long it took, and under it a line
 * for each thing it did, what that acted on and what came of it. A failure says why under its line,
 * a running subagent shows its latest calls, and pictures a call returned show under it. Open, the
 * step shows Claude's thinking between its calls too, and every line.
 */
export function StepView(props: StepProps) {
  return (
    <Box flexDirection="column">
      {stepPieces(props).map((piece) => (
        <Box key={piece.key} flexDirection="column">
          {piece.node}
        </Box>
      ))}
    </Box>
  );
}

/** The step's pieces, top to bottom, each with what a click on it acts on. */
export function stepPieces({ step, rail, open, width, picked, pictureRows, links, cwd, home, clickable = true }: StepProps): Piece[] {
  const { node, color } = STEP_NODES[step.status];
  const inner = width - GUTTER;
  const openable = clickable && opens(step);
  const tail = `${timed(step.span) ? took(step.span) : ""}${openable ? `  ${open ? "▾" : "▸"}` : ""}`;
  const live = step.status === "running" || step.status === "waiting";
  const on: Rail = { spaced: false, joined: true, through: rail.through };
  const railed = (key: string, child: ReactNode, target?: string): Piece => ({
    key,
    target,
    node: (
      <Railed node="│" color={PALETTE.dust} rail={on}>
        {child}
      </Railed>
    ),
  });
  const pieces: Piece[] = [
    {
      key: "title",
      target: openable ? step.key : undefined,
      node: (
        <Railed node={node} color={color} rail={rail}>
          <Box justifyContent="space-between" width={inner}>
            <Text wrap="truncate-end" color={step.made ? PALETTE.haze : PALETTE.star} italic={step.made} bold={live && !step.made}>
              {fit(step.title, inner - cellWidth(tail) - 2, false)}
            </Text>
            <Text color={PALETTE.dust}>{tail}</Text>
          </Box>
          {open && step.more ? <Markdown text={step.more} width={inner} /> : null}
        </Railed>
      ),
    },
  ];
  // Closed, a step leaves out its thinking, and the lines between its first two and last three.
  const rows = step.flow.filter((one) => one.kind === "row");
  let shown: Flow[] = step.flow;
  let hidden: ActivityRow[] = [];
  if (!open) {
    shown = rows;
    if (rows.length > MOST_ROWS) {
      hidden = rows.slice(2, -3).map((one) => one.row);
      shown = [...rows.slice(0, 2), ...rows.slice(-3)];
    }
  }
  /** The verb of the line just drawn: a line that does the same leaves its verb out, so a run of commands reads as one. */
  let verb = "";
  shown.forEach((one, i) => {
    if (one.kind !== "row") verb = "";
    if (one.kind === "thinking") {
      pieces.push(
        railed(
          one.key,
          <Box paddingLeft={INDENT}>
            <Text color={PALETTE.haze}>∴ </Text>
            <Markdown text={one.text} width={inner - INDENT - 2} voice="thinking" />
          </Box>,
        ),
      );
      return;
    }
    if (one.kind === "notice") {
      pieces.push(railed(one.key, <Box paddingLeft={INDENT}><Text color={one.tone === "error" ? PALETTE.rose : one.tone === "warning" ? PALETTE.ember : PALETTE.haze}>{one.text}</Text></Box>));
      return;
    }
    const { row } = one;
    const id = row.calls[0]!.id;
    const target = callTarget(id);
    // A closed step's line for what it leaves out goes after its first two lines.
    if (hidden.length && i === 2) {
      verb = "";
      const failed = hidden.filter((one) => one.status === "error").length;
      pieces.push(
        railed(
          "more",
          <Text wrap="truncate-end">
            <Text color={PALETTE.dust}>{`${" ".repeat(INDENT)}… ${hidden.length} more`}</Text>
            {failed ? <Text color={PALETTE.rose}>{` · ${failed} failed`}</Text> : null}
          </Text>,
          step.key,
        ),
      );
    }
    const isPicked = picked !== undefined && row.calls.some((call) => call.id === picked);
    pieces.push(railed(`row:${id}`, <ActivityLine row={row} width={inner} picked={isPicked} again={row.verb === verb} clickable={clickable} />, target));
    // What goes under the line sets the next one apart, which then says its verb again.
    verb = row.failure || row.calls.some((call) => (call.status === "running" && call.subagent) || hasPictures(call)) ? "" : row.verb;
    if (row.failure) {
      pieces.push(
        railed(
          `why:${id}`,
          <Text wrap="truncate-end" color={PALETTE.rose}>
            {`${" ".repeat(UNDER)}${fit(row.failure, inner - UNDER, false)}`}
          </Text>,
          target,
        ),
      );
    }
    const agent = row.calls.find((call) => call.status === "running" && call.subagent);
    if (agent) {
      pieces.push(
        railed(
          `agent:${id}`,
          <Box paddingLeft={UNDER}>
            <SubagentLines call={agent} cwd={cwd} home={home} width={inner - UNDER} />
          </Box>,
          target,
        ),
      );
    }
    for (const call of row.calls.filter(hasPictures)) {
      pieces.push(
        railed(
          `pictures:${call.id}`,
          <Box paddingLeft={UNDER}>
            <Figure shown={shownOf(call)} width={inner - UNDER} rows={Math.max(4, Math.floor(pictureRows / 2))} links={links} />
          </Box>,
        ),
      );
    }
  });
  return pieces;
}

/**
 * `  Edited    src/retry.ts            +9 −4  ■■■■□  ›`: the verb, what the calls acted on, and what
 * came of them against the right edge. `again`: the line above has the same verb, which this one
 * leaves out. The line the inspector shows is banded, with a gold mark.
 */
function ActivityLine({ row, width, picked, again, clickable }: { row: ActivityRow; width: number; picked: boolean; again: boolean; clickable: boolean }) {
  const verbColor = row.status === "waiting" ? PALETTE.gold : row.status === "running" ? PALETTE.teal : PALETTE.dust;
  const named = row.verb.length >= VERB ? `${row.verb} ` : row.verb.padEnd(VERB);
  // A verb the line above has is left out, unless how the line is going colors it.
  const verb = again && row.status !== "waiting" && row.status !== "running" ? " ".repeat(cellWidth(named)) : named;
  const result = row.result.reduce((sum, part) => sum + cellWidth(part.text), 0);
  const bars = row.diff && row.diff.added + row.diff.removed > 0 ? 7 : 0;
  const right = result + bars + (clickable ? 3 : 0);
  const room = Math.max(4, width - INDENT - cellWidth(verb) - right - 2);
  const target = fitParts(row.target, room, row.path);
  return (
    <Box justifyContent="space-between" width={width} backgroundColor={picked ? PALETTE.hover : undefined}>
      <Text wrap="truncate-end">
        <Text color={PALETTE.gold}>{picked ? "▌ " : "  "}</Text>
        <Text color={verbColor}>{verb}</Text>
        {target.map((part, i) => (
          <Text key={i} color={TONES[part.tone]}>
            {part.text}
          </Text>
        ))}
      </Text>
      <Text>
        {row.result.map((part, i) => (
          <Text key={i} color={TONES[part.tone]}>
            {part.text}
          </Text>
        ))}
        {bars ? <Diffstat added={row.diff!.added} removed={row.diff!.removed} /> : null}
        {clickable ? <Text color={picked ? PALETTE.gold : PALETTE.dust}>{"  ›"}</Text> : null}
      </Text>
    </Box>
  );
}

/** Five squares, teal for the share added and rose for the share removed, more of them for a bigger change. */
function Diffstat({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  const filled = Math.min(5, Math.max(1, Math.ceil(Math.log2(total + 1))));
  const teal = added ? Math.max(1, Math.round((filled * added) / total)) : 0;
  const rose = Math.min(filled - teal, removed ? Math.max(1, filled - teal) : 0);
  return (
    <Text>
      <Text>{"  "}</Text>
      <Text color={PALETTE.teal}>{"■".repeat(teal)}</Text>
      <Text color={PALETTE.rose}>{"■".repeat(rose)}</Text>
      <Text color={PALETTE.raised}>{"■".repeat(5 - teal - rose)}</Text>
    </Text>
  );
}

/** Parts cut to `room` cells: paths keep their ends, anything else its start. */
function fitParts(parts: Part[], room: number, isPath: boolean): Part[] {
  const whole = parts.map((part) => part.text).join("");
  if (cellWidth(whole) <= room) return parts;
  if (isPath) {
    // Cut from the start, keeping the last parts whole as far as they go.
    const out: Part[] = [];
    let left = room - 1;
    for (let i = parts.length - 1; i >= 0 && left > 0; i--) {
      const part = parts[i]!;
      const cells = cellWidth(part.text);
      if (cells <= left) {
        out.unshift(part);
        left -= cells;
      } else {
        out.unshift({ ...part, text: fit(part.text, left + 1, true).slice(1) });
        left = 0;
      }
    }
    return [{ text: "…", tone: "faint" }, ...out];
  }
  const out: Part[] = [];
  let left = room;
  for (const part of parts) {
    const cells = cellWidth(part.text);
    if (cells < left) {
      out.push(part);
      left -= cells;
      continue;
    }
    out.push({ ...part, text: fit(part.text, left, false) });
    break;
  }
  return out;
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
