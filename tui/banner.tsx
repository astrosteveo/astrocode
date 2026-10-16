// The welcome: the James Webb Space Telescope's primary mirror, 18 gold hexagons in rows of 3, 4,
// 5, 4 and 3 with the center one missing, lit from the upper left; beside it, the wordmark and
// where you are.
import { Box, Text } from "ink";
import { shortPath } from "../src/view/tools";
import { fit } from "./markdown-view";
import { mix, PALETTE } from "./theme";

/** Each segment's column and row. Rows are offset by one column, as a hexagonal lattice is. */
const SEGMENTS = [
  [2, 0], [4, 0], [6, 0],
  [1, 1], [3, 1], [5, 1], [7, 1],
  [0, 2], [2, 2], [6, 2], [8, 2],
  [1, 3], [3, 3], [5, 3], [7, 3],
  [2, 4], [4, 4], [6, 4],
] as const;

const MIRROR_WIDTH = 9;
const MIRROR_ROWS = 5;
/** The mirror and the gap after it. */
const TEXT_AT = MIRROR_WIDTH + 4;
const LIGHT = "#FFE2A0";

type Props = { cwd: string; home: string; branch?: string; width: number; fullscreen?: boolean };

export function Banner({ cwd, home, branch, width, fullscreen = false }: Props) {
  const room = width - TEXT_AT;
  const where = fit(shortPath(cwd, "", home), room - (branch ? branch.length + 4 : 0), true);
  const hint = fullscreen ? "Drag to copy. Click a tool call to open it. /help for more." : "Type / for commands, /help for keys.";
  const lines = [
    null,
    <Text key="name" bold color={PALETTE.star}>
      astrocode
    </Text>,
    <Text key="where">
      <Text color={PALETTE.haze}>{where}</Text>
      {branch ? <Text color={PALETTE.dust}>{`  ⎇ ${branch}`}</Text> : null}
    </Text>,
    <Text key="hint" color={PALETTE.dust}>
      {fit(hint, room, false)}
    </Text>,
    null,
  ];
  if (room < 12) {
    return (
      <Box flexDirection="column">
        {lines.filter((line) => line !== null)}
      </Box>
    );
  }
  return (
    <Box>
      <Box flexDirection="column" width={TEXT_AT} flexShrink={0}>
        {Array.from({ length: MIRROR_ROWS }, (_, row) => (
          <Text key={row}>
            {Array.from({ length: MIRROR_WIDTH }, (_, col) => {
              if (col === 4 && row === 2) return <Text key={col} color={PALETTE.dust}>·</Text>;
              const lit = SEGMENTS.some(([x, y]) => x === col && y === row);
              if (!lit) return " ";
              // Light falls from the upper left, so those segments shine and the far ones deepen.
              const shade = (col / (MIRROR_WIDTH - 1) + row / (MIRROR_ROWS - 1)) / 2;
              return (
                <Text key={col} color={shade < 0.35 ? mix(LIGHT, PALETTE.gold, shade / 0.35) : mix(PALETTE.gold, PALETTE.goldDeep, (shade - 0.35) / 0.65)}>
                  ⬢
                </Text>
              );
            })}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        {lines.map((line, i) => line ?? <Text key={i}> </Text>)}
      </Box>
    </Box>
  );
}
