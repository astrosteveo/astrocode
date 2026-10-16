// The status bar under the message box. On the left, the permission mode as a solid chip; on the
// right, readings: the model, what runs in the background, how full the context is, your plan's
// usage windows, the git branch and the plan, as many as fit, most important first. In full
// screen, clicking the chip changes the mode, clicking the model switches it, clicking the effort
// sets it, and clicking the background count lists what's running.
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text, type DOMElement } from "ink";
import { useRef, type ReactNode } from "react";
import { modelLabel, resetTime } from "../src/view/format";
import type { State, UsageWindow } from "../src/view/state";
import type { GitInfo } from "./git";
import { cellWidth } from "./markdown";
import { hit, useMouse } from "./mouse";
import { PALETTE, tone } from "./theme";

export const MODE_CHIPS: Record<PermissionMode, { label: string; color: string }> = {
  default: { label: "ask first", color: PALETTE.haze },
  acceptEdits: { label: "accept edits", color: PALETTE.teal },
  plan: { label: "plan", color: PALETTE.sky },
  auto: { label: "auto", color: PALETTE.gold },
  bypassPermissions: { label: "bypass permissions", color: PALETTE.rose },
  dontAsk: { label: "don't ask", color: PALETTE.ember },
};

/** Space between readings, which is all that separates them. */
const GAP = "   ";
/** Cells in the context gauge. */
const GAUGE = 10;

type Segment = { text: string; node: ReactNode; onClick?: () => void };

type Props = {
  state: State;
  mode: PermissionMode;
  git: GitInfo | null;
  width: number;
  exitArmed: boolean;
  /** A word on something just done, such as copying, in place of the readings for a moment. */
  toast?: string | null;
  onMode?: () => void;
  onModel?: () => void;
  onEffort?: () => void;
  onTasks?: () => void;
};

export function StatusBar({ state, mode, git, width, exitArmed, toast, onMode, onModel, onEffort, onTasks }: Props) {
  const bar = useRef<DOMElement>(null);
  const chip = MODE_CHIPS[mode];
  // The chip's caps are half blocks, so it reads as a solid lozenge.
  const left = exitArmed ? "Press Ctrl+C again to exit" : `▐${chip.label}▌`;
  const room = width - 2 - cellWidth(left) - (exitArmed ? 0 : cellWidth("  shift+tab")) - 2;

  // In order of importance: the bar keeps what fits from the start of this list.
  const segments: Segment[] = [];
  const model = state.model ? (state.models.find((one) => one.value === state.model)?.name ?? modelLabel(state.model)) : undefined;
  if (model) segments.push({ text: model, node: <Text color={PALETTE.star}>{model}</Text>, onClick: onModel });
  if (state.effort) {
    const text = `${state.effort} effort`;
    segments.push({ text, node: <Text color={PALETTE.haze}>{text}</Text>, onClick: onEffort });
  }
  if (state.tasks.length) {
    const text = `◌ ${state.tasks.length} in background`;
    segments.push({ text, node: <Text color={PALETTE.teal}>{text}</Text>, onClick: onTasks });
  }
  if (state.context) {
    const share = state.context.percentage / 100;
    const filled = Math.min(GAUGE, Math.round(share * GAUGE));
    const text = `context ${"━".repeat(GAUGE)} ${state.context.percentage}%`;
    segments.push({
      text,
      node: (
        <Text>
          <Text color={PALETTE.dust}>context </Text>
          <Text color={tone(share)}>{"━".repeat(filled)}</Text>
          <Text color={PALETTE.dust}>{"─".repeat(GAUGE - filled)}</Text>
          <Text color={PALETTE.haze}>{` ${state.context.percentage}%`}</Text>
        </Text>
      ),
    });
  }
  for (const [name, window] of [
    ["5h", state.limits.fiveHour],
    ["7d", state.limits.sevenDay],
  ] as const) {
    if (window) segments.push(usage(name, window));
  }
  if (git) {
    const text = `⎇ ${git.branch}${git.changes ? ` ±${git.changes}` : ""}`;
    segments.push({ text, node: <Text color={PALETTE.haze}>{text}</Text> });
  }
  if (state.plan) segments.push({ text: state.plan, node: <Text color={PALETTE.dust}>{state.plan}</Text> });

  const shown: Segment[] = toast ? [{ text: `✓ ${toast}`, node: <Text color={PALETTE.teal}>{`✓ ${toast}`}</Text> }] : [];
  let used = toast ? cellWidth(`✓ ${toast}`) : 0;
  for (const segment of toast ? [] : segments) {
    const cost = cellWidth(segment.text) + (shown.length ? GAP.length : 0);
    if (used + cost > room) break;
    shown.push(segment);
    used += cost;
  }

  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left") return;
    const at = hit(bar.current, event);
    if (!at) return;
    event.handled = true;
    // The chip starts after the bar's padding; the readings end before it, at the right.
    if (!exitArmed && at.x >= 1 && at.x < 1 + cellWidth(left)) return onMode?.();
    let x = width - 1 - used;
    for (const [i, segment] of shown.entries()) {
      if (i > 0) x += GAP.length;
      if (at.x >= x && at.x < x + cellWidth(segment.text)) return segment.onClick?.();
      x += cellWidth(segment.text);
    }
  });

  return (
    <Box ref={bar} width={width} paddingX={1} justifyContent="space-between">
      {exitArmed ? (
        <Text color={PALETTE.ember}>{left}</Text>
      ) : (
        <Text>
          <Text color={chip.color}>▐</Text>
          <Text backgroundColor={chip.color} color={PALETTE.ink} bold>
            {chip.label}
          </Text>
          <Text color={chip.color}>▌</Text>
          <Text color={PALETTE.dust}>{"  shift+tab"}</Text>
        </Text>
      )}
      <Text>
        {shown.map((segment, i) => (
          <Text key={i}>
            {i > 0 ? GAP : null}
            {segment.node}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

/** A usage window's share, colored by how full it is, with when it resets once it's getting full. */
function usage(name: string, window: UsageWindow): Segment {
  const percent = Math.round(window.utilization * 100);
  const resets = window.utilization >= 0.85 ? `, resets ${resetTime(window.resetsAt)}` : "";
  const text = `${name} ${percent}%${resets}`;
  return {
    text,
    node: (
      <Text>
        <Text color={PALETTE.dust}>{`${name} `}</Text>
        <Text color={tone(window.utilization)}>{`${percent}%`}</Text>
        {resets ? <Text color={PALETTE.haze}>{resets}</Text> : null}
      </Text>
    ),
  };
}
