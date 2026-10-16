// Claude's Markdown drawn for the terminal, after nebula-ui: framed code with its language on the
// border, tables redrawn with rounded box lines, glyph headings, and barred quotes and callouts.
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
import { ACCENT, COLOR } from "./theme";

const HEADINGS = ["◆", "◇", "›"];

const CALLOUTS: Record<Callout, { glyph: string; color: string; title: string }> = {
  note: { glyph: "ℹ", color: COLOR.info, title: "Note" },
  tip: { glyph: "✦", color: COLOR.success, title: "Tip" },
  important: { glyph: "◆", color: ACCENT, title: "Important" },
  warning: { glyph: "▲", color: COLOR.warning, title: "Warning" },
  caution: { glyph: "✗", color: COLOR.error, title: "Caution" },
};

/** The fewest lines a code frame names its length for; a shorter one is read at a glance. */
const LINE_COUNT_FROM = 5;

export function Markdown({ text, width }: { text: string; width: number }) {
  return (
    <Box flexDirection="column" rowGap={1}>
      {parse(text).map((block, i) => (
        <BlockView key={i} block={block} width={width} />
      ))}
    </Box>
  );
}

function BlockView({ block, width }: { block: Block; width: number }) {
  switch (block.kind) {
    case "prose":
      return <Prose text={block.text} width={width} />;
    case "code": {
      const source = block.source.replace(/\n$/, "");
      const lines = source.split("\n").length;
      return (
        <Frame label={block.language || "text"} note={lines >= LINE_COUNT_FROM ? plural(lines, "line") : undefined} width={width}>
          <Text>{highlightCode(source, block.language)}</Text>
        </Frame>
      );
    }
    case "heading":
      return (
        <Text bold color={ACCENT}>
          {HEADINGS[block.level - 1] ?? HEADINGS[2]} {inline(block.text)}
        </Text>
      );
    case "table":
      return <Table block={block} width={width} />;
    case "quote":
      return <Quote block={block} width={width} />;
    case "rule":
      return <Text color={COLOR.muted}>{"─".repeat(width)}</Text>;
  }
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

/**
 * Paragraphs and lists, wrapped here rather than by Ink so no line starts with the space it broke
 * at. A list item's wrapped lines hang under its own text.
 */
function Prose({ text, width }: { text: string; width: number }) {
  return (
    <Box flexDirection="column" rowGap={1}>
      {text.split(/\n\s*\n/).map((paragraph, i) => (
        <Box key={i} flexDirection="column">
          {paragraph.split("\n").flatMap((line, j) => {
            const item = LIST_ITEM.exec(line);
            if (!item) return rows(wrapSpans(spans(line.trim()), width), `${j}`);
            const [, indent = "", marker = "", task, body = ""] = item;
            const bullet = task !== undefined ? (task === " " ? "☐" : "☒") : /\d/.test(marker) ? marker : "•";
            const hang = indent.length + cellWidth(bullet) + 1;
            return wrapSpans(spans(body), width - hang).map((row, k) => (
              <Text key={`${j}:${k}`} wrap="truncate-end">
                {" ".repeat(indent.length)}
                {k === 0 ? <Text color={ACCENT}>{bullet} </Text> : " ".repeat(hang - indent.length)}
                {row.map((run, n) => (
                  <Styled key={n} run={run} />
                ))}
              </Text>
            ));
          })}
        </Box>
      ))}
    </Box>
  );
}

function rows(wrapped: Span[][], key: string) {
  return wrapped.map((row, i) => (
    <Text key={`${key}:${i}`} wrap="truncate-end">
      {row.map((run, n) => (
        <Styled key={n} run={run} />
      ))}
    </Text>
  ));
}

export function inline(text: string) {
  return spans(text).map((run, i) => <Styled key={i} run={run} />);
}

function Styled({ run }: { run: Span }) {
  switch (run.style) {
    case "code":
      return <Text color={ACCENT}>{run.text}</Text>;
    case "command":
      return (
        <Text bold color={ACCENT}>
          {run.text}
        </Text>
      );
    case "bold":
      return <Text bold>{run.text}</Text>;
    case "italic":
      return <Text italic>{run.text}</Text>;
    case "strike":
      return <Text strikethrough>{run.text}</Text>;
    case "link":
      return (
        <Text color={COLOR.info} underline>
          {run.text}
        </Text>
      );
    case "url":
      return <Text color={COLOR.muted}>{run.text}</Text>;
    default:
      return <Text>{run.text}</Text>;
  }
}

/**
 * A rounded frame with a label and a note set into its top border. The top line is drawn as
 * text so the words can sit on it; the Box draws the sides and bottom.
 */
export function Frame({
  label = "",
  note = "",
  width,
  color = COLOR.muted,
  labelColor = ACCENT,
  children,
}: {
  label?: string;
  note?: string;
  width: number;
  color?: string;
  labelColor?: string;
  children: ReactNode;
}) {
  const room = Math.max(0, width - 4);
  const left = label ? ` ${takeCells(label, Math.max(1, room - 2))[0]} ` : "";
  const right = note && cellWidth(left) + cellWidth(note) + 2 <= room ? ` ${note} ` : "";
  const fill = Math.max(0, room - cellWidth(left) - cellWidth(right));
  return (
    <Box flexDirection="column" width={width}>
      <Text>
        <Text color={color}>╭─</Text>
        <Text color={labelColor}>{left}</Text>
        <Text color={color}>{"─".repeat(fill)}</Text>
        <Text color={COLOR.muted}>{right}</Text>
        <Text color={color}>─╮</Text>
      </Text>
      <Box borderStyle="round" borderTop={false} borderColor={color} paddingX={1} width={width} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

/** Text cut to `room` cells: a path keeps its end, anything else its start. */
export function fit(text: string, room: number, isPath: boolean) {
  if (room <= 1) return "";
  if (cellWidth(text) <= room) return text;
  return isPath ? `…${lastCells(text, room - 1)}` : `${takeCells(text, room - 1)[0]}…`;
}

function Quote({ block, width }: { block: Extract<Block, { kind: "quote" }>; width: number }) {
  const callout = block.callout ? CALLOUTS[block.callout] : null;
  const color = callout?.color ?? COLOR.muted;
  return (
    <Box flexDirection="column">
      {callout ? (
        <Text>
          <Text color={color}>▌ </Text>
          <Text bold color={color}>
            {callout.glyph} {block.title || callout.title}
          </Text>
        </Text>
      ) : null}
      {wrapText(block.text, width - 2).map((row, i) => (
        <Text key={i}>
          <Text color={color}>▌ </Text>
          <Text dimColor={!callout}>
            {row.map((run, j) => (
              <Styled key={j} run={run} />
            ))}
          </Text>
        </Text>
      ))}
    </Box>
  );
}

/** A table as lines of text: each cell wrapped to its column, dividers written into each line. */
function Table({ block, width }: { block: Extract<Block, { kind: "table" }>; width: number }) {
  const count = block.header.length;
  const natural = block.header.map((cell, column) => Math.max(textWidth(cell), ...block.rows.map((row) => textWidth(row[column] ?? ""))));
  const room = width - (3 * count + 1);
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
                    <Text key={`${column}:${j}`}>
                      {row.map((run, k) => (
                        <Styled key={k} run={run} />
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
  const border = (left: string, middle: string, right: string) => (
    <Text color={COLOR.muted}>{left + widths.map((one) => "─".repeat(one + 2)).join(middle) + right}</Text>
  );
  const lines = (values: string[], isHeader: boolean, key: string) => {
    const cells = values.map((value, column) => wrapSpans(spans(value), widths[column] ?? 1));
    const height = Math.max(1, ...cells.map((rows) => rows.length));
    return Array.from({ length: height }, (_, index) => (
      <Text key={`${key}:${index}`} wrap="truncate-end">
        {cells.map((rows, column) => {
          const row = rows[index] ?? [];
          const free = (widths[column] ?? 0) - rowWidth(row);
          const align = block.align[column] ?? "left";
          const before = align === "right" ? free : align === "center" ? Math.floor(free / 2) : 0;
          return (
            <Text key={column}>
              <Text color={COLOR.muted}>│ </Text>
              {" ".repeat(Math.max(0, before))}
              {isHeader ? (
                <Text bold color={ACCENT}>
                  {row.map((run, k) => (
                    <Styled key={k} run={run} />
                  ))}
                </Text>
              ) : (
                row.map((run, k) => <Styled key={k} run={run} />)
              )}
              {" ".repeat(Math.max(0, free - before))}{" "}
            </Text>
          );
        })}
        <Text color={COLOR.muted}>│</Text>
      </Text>
    ));
  };
  return (
    <Box flexDirection="column">
      {border("╭", "┬", "╮")}
      {lines(block.header, true, "head")}
      {border("├", "┼", "┤")}
      {block.rows.flatMap((values, i) => lines(values, false, `row${i}`))}
      {border("╰", "┴", "╯")}
    </Box>
  );
}
