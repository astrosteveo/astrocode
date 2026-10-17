// The trajectory rail: each turn drawn as a path down the left edge. Your message starts it, every
// step Claude takes is a node on it, and the turn's numbers close it with a curve. Every entry
// draws its own piece, so the rail runs on whether entries are written to scrollback one at a
// time or drawn as lines in full screen.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { Item } from "../src/view/state";
import { PALETTE } from "./theme";
import { picturesOf } from "./tool-row";

/** The rail's column and the space after it. Content starts after this. */
export const GUTTER = 2;

export type Rail = {
  /** A row above the entry, between it and the one before. */
  spaced: boolean;
  /** Whether that row carries the rail, inside a turn, or is the gap between two turns. */
  joined: boolean;
  /** Whether the rail runs on past the entry's first line, to whatever comes next in the turn. */
  through: boolean;
};

/** Where each item sits on the rail: which turn it's in, and whether a row sets it apart. */
export function rails(items: Item[]): Rail[] {
  let inTurn = false;
  return items.map((item, i) => {
    const spaced = gap(items[i - 1], item);
    const joined = inTurn;
    if (item.kind === "prompt") inTurn = true;
    else if (item.kind === "turn") inTurn = false;
    return { spaced, joined, through: inTurn };
  });
}

/** The rail for what Claude is doing right now, which is always inside a turn. */
export const LIVE: Rail = { spaced: true, joined: true, through: true };

/**
 * A row between entries, except between tool calls, which stack as one run of nodes. A shell
 * command's card stands apart, and a picture under a call's row ends the run, so the next call
 * doesn't sit on the picture's edge.
 */
function gap(before: Item | undefined, item: Item) {
  if (before?.kind !== "tool" || item.kind !== "tool") return true;
  return before.call.name === "Bash" || item.call.name === "Bash" || picturesOf(before.call).length > 0;
}

type Props = { node: string; color: string; rail: Rail; children: ReactNode };

export function Railed({ node, color, rail, children }: Props) {
  return (
    <Box flexDirection="column">
      {rail.spaced ? <Text color={PALETTE.dust}>{rail.joined ? "│" : " "}</Text> : null}
      <Box>
        <Box flexDirection="column" width={GUTTER} flexShrink={0}>
          <Text color={color}>{node}</Text>
          {rail.through ? (
            <Box flexGrow={1} width={1} borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={PALETTE.dust} />
          ) : null}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
