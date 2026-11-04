// A tool call opened in full screen: what the inspector shows, drawn under the call's own line in the
// transcript at every width, so nothing opens beside the column. A header says what the call did,
// how it went, how long it took and which of the turn's calls it is (`‹ 3 of 10 ›`); under it are
// the tool's tabs, and the open tab's first 12 and last 8 lines with `⋯ N lines` between, which
// opens the rest. Its rows are the transcript's own, so they scroll and select with it.
import { Box, renderToString, Text } from "ink";
import type { AgentLine } from "../src/view/agents";
import type { ToolCall } from "../src/view/state";
import { plural } from "../src/view/tools";
import { callTarget } from "./entries";
import { bodyFor, firstTab, LABELS, spentOn, statusOf, tabsOf, titleOf, type Place, type TabId } from "./inspector";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
import { GUTTER, Railed } from "./rail";
import { PALETTE } from "./theme";

/** The call open under its line, the tab it shows (unset, its first) and whether that tab is whole rather than folded. */
export type Opened = { id: string; tab?: TabId; whole?: boolean };

/** Cells of a row that a click acts on in a way of their own, such as a tab's name. */
export type Spot = { from: number; to: number; target: string };

/** Where an opened call starts: under the activity line's verb, as opened entries indent. */
export const OPEN_INSET = 4;
/** A long tab's rows shown before and after its `⋯ N lines`. */
const HEAD = 12;
const TAIL = 8;

/** What a click or Enter on an opened call's rows does besides closing it: the whole tab, another tab, or the call before or after. */
export const WHOLE = "opened:whole";
export const tabTarget = (tab: TabId) => `opened:tab:${tab}`;
export const targetTab = (target: string) => (target.startsWith("opened:tab:") ? (target.slice("opened:tab:".length) as TabId) : undefined);
export const moveTarget = (by: -1 | 1) => `opened:move:${by}`;
export const targetMove = (target: string): -1 | 1 | undefined => (target === moveTarget(-1) ? -1 : target === moveTarget(1) ? 1 : undefined);

type Input = {
  call: ToolCall;
  opened: Opened;
  place: Place;
  waiting: boolean;
  /** A subagent's transcript, for an Agent call. */
  log?: AgentLine[];
  /** The transcript's width. */
  width: number;
  /** Whether the rail runs on down the left edge past the call. */
  through: boolean;
  cwd: string;
  home: string;
};

export type OpenedRows = {
  lines: string[];
  /** What Enter or a click on each row acts on. */
  targets: string[];
  spots: (Spot[] | undefined)[];
  tabs: TabId[];
  tab: TabId;
  /** The tab's text, for `c` and `e`. */
  copy: string;
};

/** Each call's rows as drawn, kept until it changes. Calls are replaced, not changed, when they change. */
const drawn = new WeakMap<ToolCall, { drawnFor: string; rows: OpenedRows }>();

/** The opened call's rows. Must run outside React's render, since renderToString renders with the same reconciler. */
export function openedRows({ call, opened, place, waiting, log, width, through, cwd, home }: Input): OpenedRows {
  const tabs = tabsOf(call, log);
  const tab = opened.tab && tabs.includes(opened.tab) ? opened.tab : firstTab(call, log, false, waiting);
  const drawnFor = `${width}|${tab}|${opened.whole}|${waiting}|${place.index}/${place.count}|${through}|${tab === "transcript" ? log?.length : ""}`;
  const kept = drawn.get(call);
  if (kept?.drawnFor === drawnFor) return kept.rows;

  const panel = width - OPEN_INSET;
  const inner = panel - 2;
  const body = bodyFor(call, tab, inner, log);
  const hidden = opened.whole ? 0 : body.lines.length - HEAD - TAIL;
  // A fold of one line would take as much room as the line.
  const folded = hidden > 1;
  const status = statusOf(call, waiting);
  const spent = spentOn(call);
  const title = titleOf(call, waiting, cwd, home);
  const position = `‹ ${place.index} of ${place.count} ›`;
  const right = `▐${status.text}▌${spent ? `  ${spent}` : ""}   ${position}`;
  const verb = title.verb ? `${title.verb} ` : "";
  const element = (
    <Railed node="│" color={PALETTE.dust} rail={{ spaced: false, joined: true, through }}>
      <Box paddingLeft={OPEN_INSET - GUTTER}>
        <Box flexDirection="column" backgroundColor={PALETTE.surface} paddingX={1} width={panel}>
          <Box justifyContent="space-between" width={inner}>
            <Text bold color={PALETTE.star} wrap="truncate-end">
              {verb}
              {fit(title.text, Math.max(1, inner - cellWidth(right) - 2 - cellWidth(verb)), title.path)}
            </Text>
            <Text>
              <Text color={status.color}>▐</Text>
              <Text bold backgroundColor={status.color} color={PALETTE.ink}>
                {status.text}
              </Text>
              <Text color={status.color}>▌</Text>
              {spent ? <Text color={PALETTE.dust}>{`  ${spent}`}</Text> : null}
              <Text color={PALETTE.haze}>{`   ${position}`}</Text>
            </Text>
          </Box>
          <Text wrap="truncate-end">
            {tabs.map((one) =>
              one === tab ? (
                <Text key={one}>
                  <Text color={PALETTE.raised}>▐</Text>
                  <Text bold backgroundColor={PALETTE.raised} color={PALETTE.star}>
                    {LABELS[one]}
                  </Text>
                  <Text color={PALETTE.raised}>▌</Text>{" "}
                </Text>
              ) : (
                <Text key={one} color={PALETTE.haze}>{` ${LABELS[one]}  `}</Text>
              ),
            )}
          </Text>
          {(folded ? body.lines.slice(0, HEAD) : body.lines).map((line, i) => (
            <Text key={`head${i}`} wrap="truncate-end">
              {line || " "}
            </Text>
          ))}
          {folded ? <Text color={PALETTE.dust}>{`⋯ ${plural(hidden, "line")}`}</Text> : null}
          {folded
            ? body.lines.slice(-TAIL).map((line, i) => (
                <Text key={`tail${i}`} wrap="truncate-end">
                  {line || " "}
                </Text>
              ))
            : null}
        </Box>
      </Box>
    </Railed>
  );
  const lines = renderToString(element, { columns: width }).split("\n");
  const close = callTarget(call.id);
  const targets = lines.map((_, i) => (folded && i === 2 + HEAD ? WHOLE : close));
  // The tabs' names from the panel's padding on, each with a space after it; `‹` and `›` at the right edge.
  let x = OPEN_INSET + 1;
  const tabSpots = tabs.map((one) => {
    const from = x;
    x += cellWidth(LABELS[one]) + 3;
    return { from, to: from + cellWidth(LABELS[one]) + 2, target: tabTarget(one) };
  });
  const end = width - 1;
  const moves = [
    { from: end - position.length, to: end - position.length + 2, target: moveTarget(-1) },
    { from: end - 2, to: end, target: moveTarget(1) },
  ];
  const rows: OpenedRows = { lines, targets, spots: lines.map((_, i) => (i === 0 ? moves : i === 1 ? tabSpots : undefined)), tabs, tab, copy: body.copy };
  drawn.set(call, { drawnFor, rows });
  return rows;
}
