// The status bar under the message box. On the left, the permission mode as a solid chip, or for
// bypass, rose words without the fill, since it stays on all session and a solid rose block would
// outshout everything else; on the right, readings: how full the context is, the model, what runs
// in the background, your plan's usage windows once they're half used (or always, or never, as
// /config says), the git branch and the
// plan, as many as fit, most important first. After the context, how long the prompt cache stays
// warm, `cache 54m`, with ↻ while astrocode keeps it warm, or `cache cold`; then `⇄ remote` while
// Remote Control is on, teal once connected and rose if it failed. In full
// screen, clicking the chip changes the mode, clicking the model switches it, clicking the effort
// sets it, clicking "thinking off" turns it back on, clicking the cache turns keep-warm on or off,
// clicking `⇄ remote` opens Remote Control's link and QR code, and clicking the running count opens what's running: Claude Code's background tasks and your
// `!` commands. A mod's toast takes the readings' place for a moment, as the app's own do, and
// the lines mods pin show above the bar, one to a mod.
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text, type DOMElement } from "ink";
import { useRef, type ReactNode } from "react";
import { canStopThinking, modelLabel, resetTime } from "../src/view/format";
import { cacheLeft, keptWarm, minutesLeft, useNow } from "./cache";
import type { State, UsageWindow } from "../src/view/state";
import type { UsageMode } from "../src/settings";
import type { GitInfo } from "./git";
import { keywordsIn, paintKeywords } from "./keywords";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
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

/** Remote Control while it's on, by how its connection is doing. */
const REMOTE = {
  connecting: { text: "⇄ connecting", color: PALETTE.haze },
  connected: { text: "⇄ remote", color: PALETTE.teal },
  failed: { text: "⇄ remote failed", color: PALETTE.rose },
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
  /** A mod's toast, shown the same way under the mod's name when the app has none of its own. */
  modToast?: { plugin: string; text: string } | null;
  /** Whether keep-warm is on. */
  keepWarm: boolean;
  /** When the plan's usage windows show: once half used, always, or never. */
  usageMode: UsageMode;
  onMode?: () => void;
  onModel?: () => void;
  onEffort?: () => void;
  onThinking?: () => void;
  onFast?: () => void;
  onTasks?: () => void;
  onCache?: () => void;
  onRemote?: () => void;
};

export function StatusBar({ state, mode, git, width, armed, running, toast, modToast, keepWarm, usageMode, onMode, onModel, onEffort, onThinking, onFast, onTasks, onCache, onRemote }: Props) {
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
  if (state.remote) {
    const { text, color } = REMOTE[state.remote.status];
    segments.push({ text, node: <Text color={color}>{text}</Text>, onClick: onRemote });
  }
  const model = state.model ? (state.models.find((one) => one.value === state.model)?.name ?? modelLabel(state.model)) : undefined;
  if (model) segments.push({ text: model, node: <Text color={PALETTE.star}>{model}</Text>, onClick: onModel });
  // Ultracode takes the effort's place: Claude Code runs it at its own level.
  if (state.ultracode) {
    segments.push({ text: "ultracode", node: <Text>{paintKeywords("ultracode", 0, 9, keywordsIn("ultracode"))}</Text>, onClick: onEffort });
  } else if (state.effort) {
    const text = `${state.effort} effort`;
    segments.push({ text, node: <Text color={PALETTE.haze}>{text}</Text>, onClick: onEffort });
  }
  // Fast mode is off unless turned on; after a rate limit it pauses for a while.
  if (state.fast?.state === "on") segments.push({ text: "↯ fast", node: <Text color={PALETTE.teal}>↯ fast</Text>, onClick: onFast });
  if (state.fast?.state === "cooldown") segments.push({ text: "↯ fast paused", node: <Text color={PALETTE.ember}>↯ fast paused</Text>, onClick: onFast });
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
    if (window && (usageMode === "on" || (usageMode === "auto" && window.utilization >= USAGE_SHOWN))) segments.push(usage(name, window));
  }
  if (git) {
    const text = `⎇ ${git.branch}${git.changes ? ` ±${git.changes}` : ""}`;
    segments.push({ text, node: <Text color={PALETTE.haze}>{text}</Text> });
  }
  if (state.plan) segments.push({ text: state.plan, node: <Text color={PALETTE.dust}>{state.plan}</Text> });

  const flash = toast ? { text: `✓ ${toast}`, node: <Text color={PALETTE.teal}>{`✓ ${toast}`}</Text> } : modToast ? modFlash(modToast, room) : null;
  const shown: Segment[] = flash ? [flash] : [];
  let used = flash ? cellWidth(flash.text) : 0;
  for (const segment of flash ? [] : segments) {
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

/** A mod's toast as the bar's one reading: the mod's name, quiet, then its words, cut to the room there is. */
function modFlash({ plugin, text }: { plugin: string; text: string }, room: number): Segment {
  const words = fit(text.split("\n")[0]!, Math.max(0, room - cellWidth(plugin) - 1), false);
  return {
    text: `${plugin} ${words}`,
    node: (
      <Text>
        <Text color={PALETTE.dust}>{plugin} </Text>
        <Text color={PALETTE.star}>{words}</Text>
      </Text>
    ),
  };
}

/** The lines mods pin under the message box (`$.ui.status`), one to a mod: its name, then its first line. */
export function ModStatus({ lines, width }: { lines: Record<string, string>; width: number }) {
  const mods = Object.entries(lines);
  if (mods.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1}>
      {mods.map(([plugin, text]) => (
        <Text key={plugin} wrap="truncate-end">
          <Text color={PALETTE.dust}>{plugin} </Text>
          <Text color={PALETTE.haze}>{fit(text.split("\n")[0]!, Math.max(0, width - 2 - cellWidth(plugin) - 1), false)}</Text>
        </Text>
      ))}
    </Box>
  );
}
