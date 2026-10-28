// Markdown, Claude's and yours, and Claude's thinking, drawn in astrocode's own way. Prose sits on the terminal's
// background; code and anything a machine printed sits on a panel, a filled surface with soft
// half-block edges and its label set into the top edge. Headings are weight and color alone, tables
// have no grid, and quotes hang off a hairline.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { plural } from "../src/view/tools";
import { highlightCode } from "./highlight";
import {
  cellWidth,
  fitColumns,
  lastCells,
  parse,
  rowWidth,
  spans,
  takeCells,
  width as textWidth,
  wrapSpans,
  wrapText,
  type Block,
  type Callout,
  type Span,
} from "./markdown";
import { isDiagram } from "../src/canvas";
import { drawDiagram, drawnDiagram } from "./diagrams";
import { keywordsIn, paintKeywords } from "./keywords";
import { copyLink, hyperlink } from "./links";
import { Figure, type FigureLinks } from "./figure";
import { drawsImages, isReady } from "./pictures";
import { PALETTE } from "./theme";

const CALLOUTS: Record<Callout, { color: string; title: string }> = {
  note: { color: PALETTE.sky, title: "Note" },
  tip: { color: PALETTE.teal, title: "Tip" },
  important: { color: PALETTE.gold, title: "Important" },
  warning: { color: PALETTE.ember, title: "Warning" },
  caution: { color: PALETTE.rose, title: "Caution" },
};

/** The fewest lines a code panel names its length for; a shorter one is read at a glance. */
const LINE_COUNT_FROM = 5;

/** Whose words these are: Claude's reply, yours, or Claude's thinking. */
export type Voice = "claude" | "you" | "thinking";

/**
 * How each voice's prose is drawn under whatever marks it carries, and the color its strong
 * emphasis, first headings and task bullets take. Claude's words are the terminal's own text with
 * strong emphasis in teal, since bold alone barely shows against a light foreground. Yours are
 * bold and bright, with strong emphasis in gold and your indentation kept. Thinking is italic gray.
 */
const VOICES: Record<Voice, { text: { bold?: boolean; italic?: boolean; color?: string }; accent: string }> = {
  claude: { text: {}, accent: PALETTE.teal },
  you: { text: { bold: true, color: PALETTE.star }, accent: PALETTE.gold },
  thinking: { text: { italic: true, color: PALETTE.haze }, accent: PALETTE.haze },
};

/**
 * How Claude's diagram fences (mermaid, dot, d2, vega-lite) are drawn. `rows`: as figures at most
 * this tall, once they're drawn, with `links` under them. `start`: start drawing them, but show
 * their source meanwhile, as a reply still being written does.
 */
export type Diagrams = { rows: number; links?: FigureLinks } | "start";

/** `copyable`: code blocks get a `copy` a click acts on, in full screen, where the mouse is astrocode's. */
export function Markdown({ text, width, voice = "claude", copyable = false, diagrams }: { text: string; width: number; voice?: Voice; copyable?: boolean; diagrams?: Diagrams }) {
  return (
    <Box flexDirection="column" rowGap={1}>
      {parse(text).map((block, i) => (
        <BlockView key={i} block={block} width={width} voice={voice} copyable={copyable} diagrams={drawsImages ? diagrams : undefined} />
      ))}
    </Box>
  );
}

function BlockView({ block, width, voice, copyable, diagrams }: { block: Block; width: number; voice: Voice; copyable: boolean; diagrams?: Diagrams }) {
  switch (block.kind) {
    case "prose":
      return <Prose text={block.text} width={width} voice={voice} />;
    case "code": {
      const source = block.source.replace(/\n$/, "");
      const lines = source.split("\n").length;
      // Under a list item, the panel starts where the item's text does, but always keeps half the width.
      const indent = Math.min(block.indent ?? 0, Math.floor(width / 2));
      const action = copyable ? { text: "copy", href: copyLink(source) } : undefined;
      const diagram = diagrams && !block.isOpen && isDiagram(block.language) ? drawnDiagram(block.language, source) : undefined;
      if (diagrams === "start" && !block.isOpen && isDiagram(block.language) && !diagram) void drawDiagram(block.language, source);
      if (diagram && "image" in diagram && isReady(diagram.image) && typeof diagrams === "object") {
        return (
          <Box paddingLeft={indent}>
            <Figure shown={[{ image: diagram.image, caption: block.language, source }]} width={width - indent} rows={diagrams.rows} links={diagrams.links} />
          </Box>
        );
      }
      return (
        <Box paddingLeft={indent} flexDirection="column">
          <Panel label={block.language} note={lines >= LINE_COUNT_FROM ? plural(lines, "line") : undefined} action={action} width={width - indent}>
            <Text>{onPanel(highlightCode(source, block.language))}</Text>
          </Panel>
          {diagram && "error" in diagram ? (
            <Text color={PALETTE.rose} wrap="truncate-end">
              {`Couldn't draw this: ${diagram.error.split("\n")[0]}`}
            </Text>
          ) : null}
        </Box>
      );
    }
    case "heading":
      return (
        <Text bold color={block.level === 1 ? VOICES[voice].accent : block.level === 2 && voice !== "thinking" ? PALETTE.star : PALETTE.haze}>
          {inline(block.text, voice)}
        </Text>
      );
    case "table":
      return <Table block={block} width={width} voice={voice} />;
    case "quote":
      return <Quote block={block} width={width} voice={voice} />;
    case "rule":
      return <Text color={PALETTE.dust}>{"╌".repeat(width)}</Text>;
  }
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

/**
 * Paragraphs and lists, wrapped here rather than by Ink so no line starts with the space it broke
 * at. A list item's wrapped lines hang under its own text.
 */
function Prose({ text, width, voice }: { text: string; width: number; voice: Voice }) {
  return (
    <Box flexDirection="column" rowGap={1}>
      {text.split(/\n\s*\n/).map((paragraph, i) => (
        <Box key={i} flexDirection="column">
          {paragraph.split("\n").flatMap((line, j) => {
            const item = LIST_ITEM.exec(line);
            if (!item) {
              if (voice === "you") return rows(wrapSpans(spans(line.trimEnd()), width), `${j}`, voice);
              // A line indented two or more, such as one that goes on with a list item, keeps its indent on every row.
              const lead = /^ */.exec(line)![0].length;
              const indent = lead >= 2 ? Math.min(lead, Math.floor(width / 2)) : 0;
              return rows(wrapSpans(spans(line.trim()), width - indent), `${j}`, voice, indent);
            }
            const [, indent = "", marker = "", task, body = ""] = item;
            const bullet = task !== undefined ? (task === " " ? "○" : "●") : /\d/.test(marker) ? marker : "•";
            const color = task === undefined ? PALETTE.haze : VOICES[voice].accent;
            const hang = indent.length + cellWidth(bullet) + 1;
            return wrapSpans(spans(body), width - hang).map((row, k) => (
              <Text key={`${j}:${k}`} wrap="truncate-end" {...VOICES[voice].text}>
                {" ".repeat(indent.length)}
                {k === 0 ? <Text color={color}>{bullet} </Text> : " ".repeat(hang - indent.length)}
                {row.map((run, n) => (
                  <Styled key={n} run={run} voice={voice} />
                ))}
              </Text>
            ));
          })}
        </Box>
      ))}
    </Box>
  );
}

function rows(wrapped: Span[][], key: string, voice: Voice, indent = 0) {
  return wrapped.map((row, i) => (
    <Text key={`${key}:${i}`} wrap="truncate-end" {...VOICES[voice].text}>
      {" ".repeat(indent)}
      {row.map((run, n) => (
        <Styled key={n} run={run} voice={voice} />
      ))}
    </Text>
  ));
}

export function inline(text: string, voice: Voice = "claude") {
  return spans(text).map((run, i) => <Styled key={i} run={run} voice={voice} />);
}

function Styled({ run, voice = "claude" }: { run: Span; voice?: Voice }) {
  const text = run.href === undefined ? run.text : run.style === "url" ? linkInBrackets(run.text, run.href) : hyperlink(run.href, run.text);
  // In your words, `ultrathink` and `ultracode` keep the colors they had in the message box.
  const words = voice === "you" && run.href === undefined ? paintKeywords(text, 0, text.length, keywordsIn(text)) : text;
  switch (run.style) {
    case "code":
      return (
        <Text color={PALETTE.tealLight} backgroundColor={PALETTE.raised}>
          {text}
        </Text>
      );
    case "command":
      return (
        <Text bold color={PALETTE.tealLight} backgroundColor={PALETTE.raised}>
          {text}
        </Text>
      );
    case "bold":
      return (
        <Text bold color={VOICES[voice].accent}>
          {words}
        </Text>
      );
    case "italic":
      return <Text italic>{words}</Text>;
    case "strike":
      return (
        <Text strikethrough color={PALETTE.haze}>
          {text}
        </Text>
      );
    case "link":
      return (
        <Text color={PALETTE.sky} underline>
          {text}
        </Text>
      );
    case "url":
      return <Text color={PALETTE.dust}>{text}</Text>;
    case "image":
      return (
        <Text color={PALETTE.sky} backgroundColor={PALETTE.raised}>
          {text}
        </Text>
      );
    default:
      return <Text>{words}</Text>;
  }
}

/** The ` (address)` after a link's text, or a piece of it, with the address alone a link. */
function linkInBrackets(text: string, href: string) {
  const [, open = "", address = "", close = ""] = /^(\s*\()?(.*?)(\))?$/s.exec(text) ?? [];
  return address ? `${open}${hyperlink(href, address)}${close}` : text;
}

/**
 * A panel: a filled surface with soft edges, a half row of it above and below the content. A
 * label and a note sit in the top edge, on the left and the right. A panel that has your keys
 * gets a gold hairline (`accent`) for its top edge instead. One panel can run into another below
 * it: the upper one is `open`, with no bottom edge, and the lower one's top edge is drawn on the
 * upper one's surface (`behind`).
 */
export function Panel({
  label = "",
  note = "",
  width,
  accent,
  background = PALETTE.surface,
  paddingX = 1,
  open = false,
  behind,
  action,
  children,
}: {
  label?: string;
  note?: string;
  /** A word on the top edge, after the note, that's a link a click acts on, such as a code block's `copy`. */
  action?: { text: string; href: string };
  width: number;
  accent?: string;
  background?: string;
  paddingX?: number;
  open?: boolean;
  behind?: string;
  children: ReactNode;
}) {
  const room = Math.max(0, width - 2);
  const left = label ? ` ${takeCells(label, Math.max(1, room - 2))[0]} ` : "";
  const right = note && cellWidth(left) + cellWidth(note) + 3 <= room ? ` ${note} ` : "";
  const act = action && cellWidth(left) + cellWidth(right) + cellWidth(action.text) + 4 <= room ? action : undefined;
  const fill = Math.max(0, room - cellWidth(left) - cellWidth(right) - (act ? cellWidth(act.text) + 1 + (right ? 0 : 1) : 0));
  const edge = accent ?? background;
  const line = accent ? "▁" : "▄";
  return (
    <Box flexDirection="column" width={width}>
      <Text backgroundColor={behind}>
        <Text color={edge}>{line}</Text>
        <Text color={PALETTE.haze}>{left}</Text>
        <Text color={edge}>{line.repeat(fill)}</Text>
        <Text color={PALETTE.dust}>{right}</Text>
        {act ? <Text color={PALETTE.haze}>{`${right ? "" : " "}${hyperlink(act.href, act.text)} `}</Text> : null}
        <Text color={edge}>{line}</Text>
      </Text>
      <Box backgroundColor={background} paddingX={paddingX} width={width} flexDirection="column">
        {children}
      </Box>
      {open ? null : <Text color={background}>{"▀".repeat(width)}</Text>}
    </Box>
  );
}

/**
 * Text a tool or a highlighter colored, made safe for a panel: its background codes go, and a
 * full reset becomes a reset of everything but the background, so the panel shows through.
 */
export function onPanel(text: string) {
  return text.replace(/\x1b\[([0-9;]*)m/g, (_, codes: string) => {
    const kept: string[] = [];
    const list = codes === "" ? ["0"] : codes.split(";");
    for (let i = 0; i < list.length; i++) {
      const code = Number(list[i]);
      if (code === 0) kept.push("22", "23", "24", "27", "29", "39");
      else if (code === 38) {
        const span = list[i + 1] === "5" ? 3 : 5;
        kept.push(...list.slice(i, i + span));
        i += span - 1;
      } else if (code === 48) i += list[i + 1] === "5" ? 2 : 4;
      else if ((code >= 40 && code <= 49) || (code >= 100 && code <= 107)) continue;
      else kept.push(String(code));
    }
    return kept.length ? `\x1b[${kept.join(";")}m` : "";
  });
}

/** Text cut to `room` cells: a path keeps its end, anything else its start. */
export function fit(text: string, room: number, isPath: boolean) {
  if (room <= 1) return "";
  if (cellWidth(text) <= room) return text;
  return isPath ? `…${lastCells(text, room - 1)}` : `${takeCells(text, room - 1)[0]}…`;
}

function Quote({ block, width, voice }: { block: Extract<Block, { kind: "quote" }>; width: number; voice: Voice }) {
  const callout = block.callout ? CALLOUTS[block.callout] : null;
  const color = callout?.color ?? PALETTE.dust;
  return (
    <Box flexDirection="column">
      {callout ? (
        <Text>
          <Text color={color}>▏ </Text>
          <Text bold color={color}>
            {block.title || callout.title}
          </Text>
        </Text>
      ) : null}
      {wrapText(block.text, width - 2).map((row, i) => (
        <Text key={i}>
          <Text color={color}>▏ </Text>
          <Text italic={!callout} color={callout ? undefined : PALETTE.haze}>
            {row.map((run, j) => (
              <Styled key={j} run={run} voice={voice} />
            ))}
          </Text>
        </Text>
      ))}
    </Box>
  );
}

/** Columns this far apart, with nothing drawn between them. */
const COLUMN_GAP = 3;

/** A table without a grid: the header in bold over a short rule per column, cells wrapped to their column. */
function Table({ block, width, voice }: { block: Extract<Block, { kind: "table" }>; width: number; voice: Voice }) {
  const count = block.header.length;
  const natural = block.header.map((cell, column) => Math.max(textWidth(cell), ...block.rows.map((row) => textWidth(row[column] ?? ""))));
  const room = width - COLUMN_GAP * (count - 1);
  const widths = fitColumns(natural, room);
  // Too wide even at its narrowest: one record at a time, each cell under its header.
  if (widths.reduce((sum, one) => sum + one, 0) > room) {
    return (
      <Box flexDirection="column" rowGap={1}>
        {block.rows.map((values, i) => (
          <Box key={i} flexDirection="column">
            {block.header.map((head, column) =>
              values[column]
                ? wrapText(`**${head}:** ${values[column]}`, width).map((row, j) => (
                    <Text key={`${column}:${j}`} {...VOICES[voice].text}>
                      {row.map((run, k) => (
                        <Styled key={k} run={run} voice={voice} />
                      ))}
                    </Text>
                  ))
                : null,
            )}
          </Box>
        ))}
      </Box>
    );
  }
  const lines = (values: string[], isHeader: boolean, key: string) => {
    const cells = values.map((value, column) => wrapSpans(spans(value), widths[column] ?? 1));
    const height = Math.max(1, ...cells.map((rows) => rows.length));
    return Array.from({ length: height }, (_, index) => (
      <Text key={`${key}:${index}`} wrap="truncate-end" {...VOICES[voice].text}>
        {cells.map((rows, column) => {
          const row = rows[index] ?? [];
          const free = (widths[column] ?? 0) - rowWidth(row);
          const align = block.align[column] ?? "left";
          const before = align === "right" ? free : align === "center" ? Math.floor(free / 2) : 0;
          const after = column < count - 1 ? free - before + COLUMN_GAP : 0;
          return (
            <Text key={column}>
              {" ".repeat(Math.max(0, before))}
              {isHeader ? (
                <Text bold color={PALETTE.star}>
                  {row.map((run, k) => (
                    <Styled key={k} run={run} voice={voice} />
                  ))}
                </Text>
              ) : (
                row.map((run, k) => <Styled key={k} run={run} voice={voice} />)
              )}
              {" ".repeat(Math.max(0, after))}
            </Text>
          );
        })}
      </Text>
    ));
  };
  return (
    <Box flexDirection="column">
      {lines(block.header, true, "head")}
      <Text color={PALETTE.dust}>{widths.map((one) => "─".repeat(one)).join(" ".repeat(COLUMN_GAP))}</Text>
      {block.rows.flatMap((values, i) => lines(values, false, `row${i}`))}
    </Box>
  );
}
