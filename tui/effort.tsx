// A value stepped with ← and →, drawn `◀ value ▶`, for effort and the settings in /config. In full
// screen, clicking an arrow steps it.
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text, type DOMElement } from "ink";
import { useRef } from "react";
import { EFFORTS, type ModelChoice } from "../src/events";
import { cellWidth } from "./markdown";
import { hit, useMouse } from "./mouse";
import { PALETTE } from "./theme";

export const EFFORT_NOTES: Record<EffortLevel, string> = {
  low: "Quick answers, least thinking",
  medium: "Balanced",
  high: "Thinks things through",
  xhigh: "Thinks harder still",
  max: "As much as it takes, for this session only",
};

/** The effort levels a model takes: none for a model that doesn't take one. */
export function effortsOf(model: ModelChoice | undefined): readonly EffortLevel[] {
  return model ? (model.efforts ?? []) : EFFORTS;
}

/**
 * The level a model runs `wanted` at: the same level if it takes it, else the nearest one below,
 * as Claude Code runs max as high on a model without max. Undefined is the model's own default.
 */
export function effortOn(levels: readonly EffortLevel[], wanted: EffortLevel | undefined): EffortLevel | undefined {
  if (wanted === undefined || !levels.length || levels.includes(wanted)) return levels.length ? wanted : undefined;
  const rank = EFFORTS.indexOf(wanted);
  return [...levels].reverse().find((level) => EFFORTS.indexOf(level) <= rank) ?? levels[0];
}

type Props = {
  value: string;
  /** Gold while it's yours to change, dim when there's nothing to step to. */
  focused: boolean;
  changed?: boolean;
  /** Pips after the value: how far along the choices it is, out of how many. */
  pips?: { at: number; of: number };
  onStep?: (step: -1 | 1) => void;
};

export function Dial({ value, focused, changed, pips, onStep }: Props) {
  const box = useRef<DOMElement>(null);
  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left" || !onStep) return;
    const at = hit(box.current, event);
    if (!at) return;
    event.handled = true;
    if (at.x === 0) onStep(-1);
    else if (at.x === cellWidth(value) + 3) onStep(1);
  });
  const arrow = onStep ? (focused ? PALETTE.gold : PALETTE.dust) : PALETTE.surface;
  return (
    <Box ref={box} flexShrink={0}>
      <Text>
        <Text color={arrow}>◀ </Text>
        <Text bold={focused} color={changed ? PALETTE.gold : PALETTE.star}>
          {value}
        </Text>
        <Text color={arrow}> ▶</Text>
        {pips && pips.at >= 0 ? (
          <Text>
            {"  "}
            <Text color={PALETTE.teal}>{"▮".repeat(pips.at + 1)}</Text>
            <Text color={PALETTE.dust}>{"▯".repeat(Math.max(0, pips.of - pips.at - 1))}</Text>
          </Text>
        ) : null}
      </Text>
    </Box>
  );
}
