// Full screen's empty state: the James Webb Space Telescope's primary mirror, drawn large. Its 18
// hexagonal segments interlock in rows of 3, 4, 5, 4 and 3, with the center one missing, and
// light up once when astrocode starts, the inner ring first, as if the mirror were coming into
// alignment. Under it, the wordmark, where you are, and how to start.
import { Box, Text, useAnimation } from "ink";
import { useEffect, useState } from "react";
import { shortPath } from "../src/view/tools";
import { fit } from "./markdown-view";
import { mix, PALETTE } from "./theme";

/** A pointy-top hexagon, five cells wide and three rows tall. Rows of them sit two rows apart, so the points interlock. */
const SHAPE = [" ▄█▄ ", "█████", " ▀█▀ "];
const ROWS = [3, 4, 5, 4, 3];
const PITCH = 6;
const WIDTH = 5 * PITCH - 1;
const HEIGHT = (ROWS.length - 1) * 2 + SHAPE.length;
const LIGHT = "#FFE2A0";

type Segment = { x: number; y: number; ring: number };

const SEGMENTS: Segment[] = ROWS.flatMap((count, row) =>
  Array.from({ length: count }, (_, column) => ({ x: ((5 - count) * PITCH) / 2 + column * PITCH, y: row * 2, row, column }))
    .filter(({ row, column }) => !(row === 2 && column === 2))
    .map(({ x, y, row }) => {
      // The inner ring touches the missing center: the middle three rows, next to it.
      const inner = Math.abs(row - 2) <= 1 && Math.abs(x + 2 - WIDTH / 2) <= PITCH + 1;
      return { x, y, ring: inner ? 0 : 1 };
    }),
);

/** Which segment covers each cell, or -1. */
const COVER: number[][] = (() => {
  const grid = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => -1));
  SEGMENTS.forEach((segment, index) =>
    SHAPE.forEach((line, dy) =>
      [...line].forEach((character, dx) => {
        if (character !== " ") grid[segment.y + dy]![segment.x + dx] = index;
      }),
    ),
  );
  return grid;
})();

/** The order segments light in: the inner ring, then the outer, each going round from the top. */
const ORDER = SEGMENTS.map((segment, index) => ({ index, ring: segment.ring, angle: Math.atan2(segment.y + 1 - HEIGHT / 2, segment.x + 2 - WIDTH / 2) }))
  .sort((a, b) => a.ring - b.ring || a.angle - b.angle)
  .map((one) => one.index);

/** When each segment starts to light, after the one before; and how long it takes. */
const STEP_MS = 55;
const FADE_MS = 260;
const DONE_MS = ORDER.length * STEP_MS + FADE_MS;

/** A segment's gold: light falls from the upper left, so those shine and the far ones deepen. */
function shade(segment: Segment) {
  const t = (segment.x / (WIDTH - 5) + segment.y / (HEIGHT - 3)) / 2;
  return t < 0.4 ? mix(LIGHT, PALETTE.gold, t / 0.4) : mix(PALETTE.gold, PALETTE.goldDeep, (t - 0.4) / 0.6);
}

function Mirror({ time }: { time: number }) {
  const colors = SEGMENTS.map((segment, index) => {
    const start = ORDER.indexOf(index) * STEP_MS;
    const lit = Math.min(1, Math.max(0, (time - start) / FADE_MS));
    return mix(PALETTE.raised, shade(segment), lit);
  });
  return (
    <Box flexDirection="column">
      {COVER.map((cells, y) => {
        // Runs of cells that share a color, so each row is a few pieces rather than one per cell.
        const runs: { text: string; color?: string }[] = [];
        cells.forEach((index, x) => {
          const character = index === -1 ? " " : (SHAPE[y - (SEGMENTS[index]?.y ?? 0)]?.[x - (SEGMENTS[index]?.x ?? 0)] ?? " ");
          const color = index === -1 ? undefined : colors[index];
          const last = runs.at(-1);
          if (last && last.color === color) last.text += character;
          else runs.push({ text: character, color });
        });
        return (
          <Text key={y}>
            {runs.map((run, i) => (
              <Text key={i} color={run.color}>
                {run.text}
              </Text>
            ))}
          </Text>
        );
      })}
    </Box>
  );
}

type Props = { cwd: string; home: string; branch?: string; width: number };

export function Welcome({ cwd, home, branch, width }: Props) {
  const [done, setDone] = useState(false);
  const { time } = useAnimation({ interval: 40, isActive: !done });
  useEffect(() => {
    if (time >= DONE_MS) setDone(true);
  }, [time]);
  const where = fit(shortPath(cwd, "", home), width - (branch ? branch.length + 4 : 0) - 4, true);
  return (
    <Box flexDirection="column" alignItems="center">
      <Mirror time={done ? DONE_MS : time} />
      <Box marginTop={2}>
        <Text bold color={PALETTE.star}>
          astrocode
        </Text>
      </Box>
      <Text>
        <Text color={PALETTE.haze}>{where}</Text>
        {branch ? <Text color={PALETTE.dust}>{`  ⎇ ${branch}`}</Text> : null}
      </Text>
      <Box marginTop={2}>
        <Text color={PALETTE.dust}>Type a message to start, / for commands, or @ for files.</Text>
      </Box>
    </Box>
  );
}

/** Rows the welcome needs, so full screen shows it only where it fits. */
export const WELCOME_HEIGHT = HEIGHT + 7;
export const WELCOME_WIDTH = WIDTH;
