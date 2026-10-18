// The status bar under the message box. On the left, the permission mode as a solid chip, or for
// bypass, rose words without the fill, since it stays on all session and a solid rose block would
// outshout everything else; on the right, readings: how full the context is, the model, what runs
// in the background, your plan's usage windows once they're half used, the git branch and the
// plan, as many as fit, most important first. After the context, how long the prompt cache stays
// warm, `cache 54m`, with ↻ while astrocode keeps it warm, or `cache cold`. In full
// screen, clicking the chip changes the mode, clicking the model switches it, clicking the effort
// sets it, clicking "thinking off" turns it back on, clicking the cache turns keep-warm on or off,
// and clicking the running count opens what's running: Claude Code's background tasks and your
// `!` commands.
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text, type DOMElement } from "ink";
import { useRef, type ReactNode } from "react";
import { canStopThinking, modelLabel, resetTime } from "../src/view/format";
import { cacheLeft, keptWarm, minutesLeft, useNow } from "./cache";
import type { State, UsageWindow } from "../src/view/state";
import type { GitInfo } from "./git";
import { cellWidth } from "./markdown";
import { hit, useHover, useMouse } from "./mouse";
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
/** A usage window shows once it's this full; below it, it's noise. */
const USAGE_SHOWN = 0.5;

type Segment = { text: string; node: ReactNode; onClick?: () => void };

type Props = {
  state: State;
  mode: PermissionMode;
  git: GitInfo | null;
  width: number;
  /** A key pressed once that does something if pressed again, such as Ctrl+C to exit, in place of the mode. */
  armed: string | null;
  /** How many things run alongside the conversation. */
  running: number;
  /** A word on something just done, such as copying, in place of the readings for a moment. */
  toast?: string | null;
  /** Whether keep-warm is on. */
  keepWarm: boolean;
  onMode?: () => void;
  onModel?: () => void;
  onEffort?: () => void;
  onThinking?: () => void;
  onTasks?: () => void;
  onCache?: () => void;
};

export function StatusBar({ state, mode, git, width, armed, running, toast, keepWarm, onMode, onModel, onEffort, onThinking, onTasks, onCache }: Props) {
  const bar = useRef<DOMElement>(null);
  const now = useNow(15_000, state.cache !== undefined);
  const chip = MODE_CHIPS[mode];
  // The chip's caps are half blocks, so it reads as a solid lozenge.
  const left = armed ?? `▐${chip.label}▌`;
  const room = width - 2 - cellWidth(left) - (armed ? 0 : cellWidth("  shift+tab")) - 2;

  // In order of importance: the bar keeps what fits from the start of this list.
  const segments: Segment[] = [];
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
  if (state.cache) {
    const left = cacheLeft(state.cache, now);
    const kept = keptWarm(state.cache, keepWarm, now);
    const value = left > 0 ? `${minutesLeft(left)}${kept ? " ↻" : ""}` : "cold";
    segments.push({
      text: `cache ${value}`,
      node: (
        <Text>
          <Text color={PALETTE.dust}>cache </Text>
          <Text color={left > 0 ? PALETTE.teal : PALETTE.haze}>{value}</Text>
        </Text>
      ),
      onClick: onCache,
    });
  }
  const model = state.model ? (state.models.find((one) => one.value === state.model)?.name ?? modelLabel(state.model)) : undefined;
  if (model) segments.push({ text: model, node: <Text color={PALETTE.star}>{model}</Text>, onClick: onModel });
  if (state.effort) {
    const text = `${state.effort} effort`;
    segments.push({ text, node: <Text color={PALETTE.haze}>{text}</Text>, onClick: onEffort });
  }
  // Thinking is on unless turned off, so only off is worth a word, and only on a model that can stop.
  if (state.thinking === false && canStopThinking(state)) segments.push({ text: "thinking off", node: <Text color={PALETTE.ember}>thinking off</Text>, onClick: onThinking });
  if (running) {
    const text = `◌ ${running} running`;
    segments.push({ text, node: <Text color={PALETTE.teal}>{text}</Text>, onClick: onTasks });
  }
  for (const [name, window] of [
    ["5h", state.limits.fiveHour],
    ["7d", state.limits.sevenDay],
  ] as const) {
    if (window && window.utilization >= USAGE_SHOWN) segments.push(usage(name, window));
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

  /** What a click at cell `x` of the bar acts on: the chip, a reading by its place in `shown`, or nothing. */
  const targetAt = (x: number): "mode" | number | null => {
    // The chip starts after the bar's padding; the readings end before it, at the right.
    if (!armed && x >= 1 && x < 1 + cellWidth(left)) return onMode ? "mode" : null;
    let start = width - 1 - used;
    for (const [i, segment] of shown.entries()) {
      if (i > 0) start += GAP.length;
      if (x >= start && x < start + cellWidth(segment.text)) return segment.onClick ? i : null;
      start += cellWidth(segment.text);
    }
    return null;
  };

  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left") return;
    const at = hit(bar.current, event);
    if (!at) return;
    event.handled = true;
    const target = targetAt(at.x);
    if (target === "mode") onMode?.();
    else if (target !== null) shown[target]?.onClick?.();
  });
  const hovered = useHover(bar, (x) => {
    const target = targetAt(x);
    return target === null ? null : { key: target, shape: "pointer" };
  });
  const hover = (key: "mode" | number) => (hovered === key ? PALETTE.hover : undefined);

  return (
    <Box ref={bar} width={width} paddingX={1} justifyContent="space-between">
      {armed ? (
        <Text color={PALETTE.ember}>{left}</Text>
      ) : (
        <Text>
          <Text backgroundColor={hover("mode")}>
            {mode === "bypassPermissions" ? (
              <Text color={chip.color} bold>{` ${chip.label} `}</Text>
            ) : (
              <>
                <Text color={chip.color}>▐</Text>
                <Text backgroundColor={chip.color} color={PALETTE.ink} bold>
                  {chip.label}
                </Text>
                <Text color={chip.color}>▌</Text>
              </>
            )}
          </Text>
          <Text color={PALETTE.dust}>{"  shift+tab"}</Text>
        </Text>
      )}
      <Text>
        {shown.map((segment, i) => (
          <Text key={i}>
            {i > 0 ? GAP : null}
            <Text backgroundColor={hover(i)}>{segment.node}</Text>
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
