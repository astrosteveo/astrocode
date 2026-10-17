// Markdown, Claude's and yours, drawn in astrocode's own way. Prose sits on the terminal's
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

/**
 * Your words (`yours`) are bold and bright, with your strong emphasis in gold and your indentation
 * kept. Claude's are the terminal's own text, with its strong emphasis in teal: bold alone barely
 * shows against a light foreground.
 */
export function Markdown({ text, width, yours = false }: { text: string; width: number; yours?: boolean }) {
  return (
    <Box flexDirection="column" rowGap={1}>
      {parse(text).map((block, i) => (
        <BlockView key={i} block={block} width={width} yours={yours} />
      ))}
    </Box>
  );
}

/** How your words are drawn, under whatever marks they carry. */
const YOURS = { bold: true, color: PALETTE.star };

function BlockView({ block, width, yours }: { block: Block; width: number; yours: boolean }) {
  switch (block.kind) {
    case "prose":
      return <Prose text={block.text} width={width} yours={yours} />;
    case "code": {
      const source = block.source.replace(/\n$/, "");
      const lines = source.split("\n").length;
      return (
        <Panel label={block.language} note={lines >= LINE_COUNT_FROM ? plural(lines, "line") : undefined} width={width}>
          <Text>{onPanel(highlightCode(source, block.language))}</Text>
        </Panel>
      );
    }
    case "heading":
      return (
        <Text bold color={block.level === 1 ? (yours ? PALETTE.gold : PALETTE.teal) : block.level === 2 ? PALETTE.star : PALETTE.haze}>
          {inline(block.text, yours)}
        </Text>
      );
    case "table":
      return <Table block={block} width={width} yours={yours} />;
    case "quote":
      return <Quote block={block} width={width} yours={yours} />;
    case "rule":
      return <Text color={PALETTE.dust}>{"╌".repeat(width)}</Text>;
  }
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

/**
 * Paragraphs and lists, wrapped here rather than by Ink so no line starts with the space it broke
 * at. A list item's wrapped lines hang under its own text.
 */
function Prose({ text, width, yours }: { text: string; width: number; yours: boolean }) {
  return (
    <Box flexDirection="column" rowGap={1}>
      {text.split(/\n\s*\n/).map((paragraph, i) => (
        <Box key={i} flexDirection="column">
          {paragraph.split("\n").flatMap((line, j) => {
            const item = LIST_ITEM.exec(line);
            if (!item) return rows(wrapSpans(spans(yours ? line.trimEnd() : line.trim()), width), `${j}`, yours);
            const [, indent = "", marker = "", task, body = ""] = item;
            const bullet = task !== undefined ? (task === " " ? "○" : "●") : /\d/.test(marker) ? marker : "•";
            const color = task === undefined ? PALETTE.haze : yours ? PALETTE.gold : PALETTE.teal;
            const hang = indent.length + cellWidth(bullet) + 1;
            return wrapSpans(spans(body), width - hang).map((row, k) => (
              <Text key={`${j}:${k}`} wrap="truncate-end" {...(yours ? YOURS : {})}>
                {" ".repeat(indent.length)}
                {k === 0 ? <Text color={color}>{bullet} </Text> : " ".repeat(hang - indent.length)}
                {row.map((run, n) => (
                  <Styled key={n} run={run} yours={yours} />
                ))}
              </Text>
            ));
          })}
        </Box>
      ))}
    </Box>
  );
}

function rows(wrapped: Span[][], key: string, yours: boolean) {
  return wrapped.map((row, i) => (
    <Text key={`${key}:${i}`} wrap="truncate-end" {...(yours ? YOURS : {})}>
      {row.map((run, n) => (
        <Styled key={n} run={run} yours={yours} />
      ))}
    </Text>
  ));
}

export function inline(text: string, yours = false) {
  return spans(text).map((run, i) => <Styled key={i} run={run} yours={yours} />);
}

function Styled({ run, yours = false }: { run: Span; yours?: boolean }) {
  switch (run.style) {
    case "code":
      return (
        <Text color={PALETTE.tealLight} backgroundColor={PALETTE.raised}>
          {run.text}
        </Text>
      );
    case "command":
      return (
        <Text bold color={PALETTE.tealLight} backgroundColor={PALETTE.raised}>
          {run.text}
        </Text>
      );
    case "bold":
      return (
        <Text bold color={yours ? PALETTE.gold : PALETTE.teal}>
          {run.text}
        </Text>
      );
    case "italic":
      return <Text italic>{run.text}</Text>;
    case "strike":
      return (
        <Text strikethrough color={PALETTE.haze}>
          {run.text}
        </Text>
      );
    case "link":
      return (
        <Text color={PALETTE.sky} underline>
          {run.text}
        </Text>
      );
    case "url":
      return <Text color={PALETTE.dust}>{run.text}</Text>;
    case "image":
      return (
        <Text color={PALETTE.sky} backgroundColor={PALETTE.raised}>
          {run.text}
        </Text>
      );
    default:
      return <Text>{run.text}</Text>;
  }
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
  children,
}: {
  label?: string;
  note?: string;
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
  const fill = Math.max(0, room - cellWidth(left) - cellWidth(right));
  const edge = accent ?? background;
  const line = accent ? "▁" : "▄";
  return (
    <Box flexDirection="column" width={width}>
      <Text backgroundColor={behind}>
        <Text color={edge}>{line}</Text>
        <Text color={PALETTE.haze}>{left}</Text>
        <Text color={edge}>{line.repeat(fill)}</Text>
        <Text color={PALETTE.dust}>{right}</Text>
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

function Quote({ block, width, yours }: { block: Extract<Block, { kind: "quote" }>; width: number; yours: boolean }) {
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
              <Styled key={j} run={run} yours={yours} />
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
function Table({ block, width, yours }: { block: Extract<Block, { kind: "table" }>; width: number; yours: boolean }) {
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
                    <Text key={`${column}:${j}`} {...(yours ? YOURS : {})}>
                      {row.map((run, k) => (
                        <Styled key={k} run={run} yours={yours} />
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
      <Text key={`${key}:${index}`} wrap="truncate-end" {...(yours ? YOURS : {})}>
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
                    <Styled key={k} run={run} yours={yours} />
                  ))}
                </Text>
              ) : (
                row.map((run, k) => <Styled key={k} run={run} yours={yours} />)
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
