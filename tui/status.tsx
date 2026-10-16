// The status bar under the message box: the permission mode as a pill on the left; the model,
// how full the context is, your plan's usage windows and the git branch on the right, as many
// as fit.
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { modelLabel, resetTime } from "../src/view/format";
import type { State, UsageWindow } from "../src/view/state";
import type { GitInfo } from "./git";
import { cellWidth } from "./markdown";
import { COLOR, tone } from "./theme";

const MODE_PILLS: Record<PermissionMode, { label: string; color: string }> = {
  default: { label: "◉ ask first", color: "#9399b2" },
  acceptEdits: { label: "⏵⏵ accept edits", color: "#a6e3a1" },
  plan: { label: "⏸ plan", color: "#89b4fa" },
  auto: { label: "◎ auto", color: "#f9e2af" },
  bypassPermissions: { label: "⚠ bypass permissions", color: "#f38ba8" },
  dontAsk: { label: "◌ don't ask", color: "#fab387" },
};

type Segment = { text: string; node: ReactNode };

type Props = { state: State; mode: PermissionMode; git: GitInfo | null; width: number; exitArmed: boolean };

export function StatusBar({ state, mode, git, width, exitArmed }: Props) {
  const pill = MODE_PILLS[mode];
  const left = exitArmed ? "Press Ctrl+C again to exit" : ` ${pill.label} `;
  const room = width - 2 - cellWidth(left) - (exitArmed ? 0 : cellWidth("  shift+tab")) - 2;

  // In order of importance: the bar keeps what fits from the start of this list.
  const segments: Segment[] = [];
  const model = state.model ? (state.models.find((one) => one.value === state.model)?.name ?? modelLabel(state.model)) : undefined;
  if (model) segments.push({ text: `✦ ${model}`, node: <Text>{`✦ ${model}`}</Text> });
  if (state.context) {
    const share = state.context.percentage / 100;
    const filled = Math.min(8, Math.round(share * 8));
    const text = `ctx ${"▰".repeat(filled)}${"▱".repeat(8 - filled)} ${state.context.percentage}%`;
    segments.push({
      text,
      node: (
        <Text>
          <Text dimColor>ctx </Text>
          <Text color={tone(share)}>{"▰".repeat(filled)}</Text>
          <Text dimColor>{"▱".repeat(8 - filled)}</Text>
          <Text dimColor>{` ${state.context.percentage}%`}</Text>
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
    segments.push({ text, node: <Text dimColor>{text}</Text> });
  }
  if (state.plan) segments.push({ text: state.plan, node: <Text dimColor>{state.plan}</Text> });

  const fitting: Segment[] = [];
  let used = 0;
  for (const segment of segments) {
    const cost = cellWidth(segment.text) + (fitting.length ? 3 : 0);
    if (used + cost > room) break;
    fitting.push(segment);
    used += cost;
  }

  return (
    <Box width={width} paddingX={1} justifyContent="space-between">
      {exitArmed ? (
        <Text color={COLOR.warning}>{left}</Text>
      ) : (
        <Text>
          <Text inverse bold color={pill.color}>
            {left}
          </Text>
          <Text dimColor> shift+tab</Text>
        </Text>
      )}
      <Text>
        {fitting.map((segment, i) => (
          <Text key={i}>
            {i > 0 ? <Text dimColor>{" · "}</Text> : null}
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
  const resets = window.utilization >= 0.85 ? ` resets ${resetTime(window.resetsAt)}` : "";
  const text = `${name} ${percent}%${resets}`;
  return {
    text,
    node: (
      <Text>
        <Text dimColor>{`${name} `}</Text>
        <Text color={tone(window.utilization)}>{`${percent}%`}</Text>
        {resets ? <Text dimColor>{resets}</Text> : null}
      </Text>
    ),
  };
}
