// A value stepped with ← and →, drawn `◀ value ▶`, for effort and the settings in /config. In full
// screen, clicking an arrow steps it.
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text, type DOMElement } from "ink";
import { useRef } from "react";
import { EFFORTS, type ModelChoice } from "../src/events";
import { cellWidth } from "./markdown";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE } from "./theme";

export const EFFORT_NOTES: Record<EffortLevel, string> = {
  low: "Quick answers, least thinking",
  medium: "Balanced",
  high: "Thinks things through",
  xhigh: "Thinks harder still",
  max: "As much as it takes, for this session only",
};

/**
 * Ultracode, past the highest level: Claude Code's standing workflow of agents on every substantive
 * task, for this session only. A level picked after it turns it off.
 */
export const ULTRACODE_NOTE = "A workflow of agents on every substantive task, for this session only";

/** A stop on the effort dial: a level, ultracode past them, or the model's own default. */
export type EffortStop = EffortLevel | "ultracode" | undefined;

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
  // The arrow under the pointer lights up in your color, bold.
  const hovered = useHover(box, (x) => (onStep && (x === 0 || x === cellWidth(value) + 3) ? { key: x === 0 ? -1 : 1, shape: "pointer" } : null));
  const arrow = (side: -1 | 1) => ({
    color: !onStep ? PALETTE.surface : focused || hovered === side ? PALETTE.gold : PALETTE.dust,
    bold: hovered === side,
  });
  return (
    <Box ref={box} flexShrink={0}>
      <Text>
        <Text {...arrow(-1)}>◀</Text>{" "}
        <Text bold={focused} color={changed ? PALETTE.gold : PALETTE.star}>
          {value}
        </Text>{" "}
        <Text {...arrow(1)}>▶</Text>
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
