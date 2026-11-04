// Follow Claude: a panel that shows the tool call Claude is making as it makes it, drawn as the
// inspector draws it: an edit's diff, the lines a read looked at, a command's output, a search's
// matches, a subagent's transcript. On a wide full screen it's the inspector itself, beside the
// transcript; elsewhere it's a short dock above the message box, which shows the end of it. It
// moves to each call as it starts, at once when the call waits for you, and holds each a moment
// otherwise, so a burst of calls doesn't flicker. It never takes the message box's keys.
import { Box, Text, type DOMElement } from "ink";
import { useEffect, useRef, useState } from "react";
import type { AgentLine } from "../src/view/agents";
import type { State, ToolCall, ToolItem } from "../src/view/state";
import { firstTab, statusOf, tailsBody, titleOf, useBody } from "./inspector";
import { fit } from "./markdown-view";
import { hit, useMouse } from "./mouse";
import { PALETTE } from "./theme";

/** The least time a call stays in the panel before a newer one takes its place. */
export const FOLLOW_DWELL_MS = 1000;

/** The call to follow: the one waiting for you, else the one Claude started last. */
export function followedCall(state: State, waiting: ReadonlySet<string>) {
  for (const id of waiting) if (state.tools[id] !== undefined) return id;
  return state.items.findLast((item): item is ToolItem => item.kind === "tool")?.call.id;
}

/**
 * `target`, once whatever was shown before has had `dwell` ms: a newer target meanwhile takes its
 * place when the time is up. An `urgent` one, such as a call waiting for you, is shown at once, and
 * so is the first, with nothing shown before it.
 */
export function useDwell(target: string | undefined, urgent: boolean, dwell = FOLLOW_DWELL_MS) {
  const [shown, setShown] = useState(target);
  // When `shown` last changed, which for the first is as it's drawn.
  const since = useRef(Date.now());
  useEffect(() => {
    if (target === shown) return;
    const wait = urgent || shown === undefined ? 0 : Math.max(0, since.current + dwell - Date.now());
    const timer = setTimeout(() => {
      since.current = Date.now();
      setShown(target);
    }, wait);
    return () => clearTimeout(timer);
  }, [target, shown, urgent, dwell]);
  return shown;
}

/** What the panel says before Claude has made a call to show. */
export const NOTHING_YET = "Each tool call Claude makes shows here as it runs.";

/** The panel beside the transcript while there's no call to show yet. */
export function FollowEmpty({ width, height }: { width: number; height: number }) {
  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0}>
      <Text color={PALETTE.teal}>{"▁".repeat(width)}</Text>
      <Box flexDirection="column" backgroundColor={PALETTE.surface} paddingX={1} width={width} height={height - 1}>
        <Text color={PALETTE.teal}>◉ Following Claude</Text>
        <Text color={PALETTE.haze}>{NOTHING_YET}</Text>
      </Box>
    </Box>
  );
}

type DockProps = {
  call: ToolCall | undefined;
  /** It waits on a permission prompt or a question. */
  waiting: boolean;
  /** A subagent's transcript, for an Agent call. */
  log?: AgentLine[];
  width: number;
  /** Rows for what the call shows, under the dock's own two. */
  rows: number;
  cwd: string;
  home: string;
  /** A click on it, in full screen, which inspects the call. */
  onOpen: (id: string) => void;
};

/** The dock above the message box: what the call is and how it's going, over the end of what it shows. */
export function FollowDock({ call, waiting, log, width, rows, cwd, home, onOpen }: DockProps) {
  const box = useRef<DOMElement>(null);
  useMouse((event) => {
    if (!call || event.type !== "press" || event.button !== "left" || !hit(box.current, event)) return;
    event.handled = true;
    onOpen(call.id);
  });
  const inner = width - 2;
  const status = call ? statusOf(call, waiting) : undefined;
  const title = call ? titleOf(call, waiting, cwd, home) : undefined;
  const label = waiting ? "◆ Waiting for you" : "◉ Following";
  const room = Math.max(0, inner - label.length - 2 - (status ? status.text.length + 4 : 0));
  return (
    <Box ref={box} flexDirection="column" width={width}>
      <Text color={PALETTE.teal}>{"▁".repeat(width)}</Text>
      <Box flexDirection="column" backgroundColor={PALETTE.surface} paddingX={1} width={width}>
        <Box justifyContent="space-between" width={inner}>
          <Text wrap="truncate-end">
            <Text color={waiting ? PALETTE.gold : PALETTE.teal}>{label}</Text>
            {title ? (
              <Text color={PALETTE.star} bold>
                {`  ${fit(`${title.verb ? `${title.verb} ` : ""}${title.text}`, room, title.path)}`}
              </Text>
            ) : null}
          </Text>
          {status ? (
            <Text>
              <Text color={status.color}>▐</Text>
              <Text bold backgroundColor={status.color} color={PALETTE.ink}>
                {status.text}
              </Text>
              <Text color={status.color}>▌</Text>
            </Text>
          ) : null}
        </Box>
        {call ? <DockBody call={call} log={log} waiting={waiting} width={inner} rows={rows} /> : <Text color={PALETTE.haze}>{NOTHING_YET}</Text>}
      </Box>
    </Box>
  );
}

/** The tab the call opens on, as many rows of it as there's room for: its end for output that grows, else its start. */
function DockBody({ call, log, waiting, width, rows }: { call: ToolCall; log?: AgentLine[]; waiting: boolean; width: number; rows: number }) {
  const tab = firstTab(call, log, true, waiting);
  const body = useBody(call, tab, width, log);
  const lines = body?.lines ?? [];
  const shown = tailsBody(tab, true) ? lines.slice(-rows) : lines.slice(0, rows);
  return (
    <Box flexDirection="column" width={width} height={rows}>
      {Array.from({ length: rows }, (_, i) => (
        <Text key={i} wrap="truncate-end">
          {shown[i] || " "}
        </Text>
      ))}
    </Box>
  );
}
