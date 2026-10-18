// The model and its effort in one place, as Alt+P and /model open it in `claude`: ↑ and ↓ choose
// the model, ← and → its effort, and Enter switches to both. In full screen, click a model to switch
// to it, or an arrow to step the effort.
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text, useInput, type DOMElement } from "ink";
import { useRef, useState } from "react";
import type { ModelChoice } from "../src/events";
import { isCurrentModel } from "../src/view/format";
import { ChoiceRow } from "./choice";
import { Dial, EFFORT_NOTES, effortOn, effortsOf, ULTRACODE_NOTE, type EffortStop } from "./effort";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE } from "./theme";

type Props = {
  models: ModelChoice[];
  model?: string;
  /** The effort astrocode set, if it set one: Claude Code doesn't say what its default is. */
  effort?: EffortLevel;
  /** Ultracode is on, and whether the current model can have it, past the highest level. */
  ultracode: boolean;
  ultracodeAvailable: boolean;
  width: number;
  rows: number;
  /** What changed: a model to switch to, an effort to set, ultracode turned on or off. */
  onPick: (choice: { model?: string; effort?: EffortLevel; ultracode?: boolean }) => void;
  onCancel: () => void;
};

export function ModelPicker({ models, model, effort, ultracode, ultracodeAvailable, width, rows, onPick, onCancel }: Props) {
  const [selected, setSelected] = useState(() => Math.max(0, models.findIndex((choice) => isCurrentModel(model, choice))));
  const [wanted, setWanted] = useState<EffortStop>(ultracode ? "ultracode" : effort);
  const panel = useRef<DOMElement>(null);
  const list = useRef<DOMElement>(null);

  const index = Math.min(selected, Math.max(0, models.length - 1));
  const focused = models[index];
  const levels = effortsOf(focused);
  // Claude Code says whether ultracode can be on for the model in use, not for the others.
  const offersUltracode = ultracodeAvailable && focused !== undefined && isCurrentModel(model, focused);
  const shown: EffortStop = wanted === "ultracode" ? (offersUltracode ? "ultracode" : effortOn(levels, "max")) : effortOn(levels, wanted);
  // With no level set yet, the model's own default comes before the lowest level.
  const track: EffortStop[] = [...(effort === undefined ? [undefined] : []), ...levels, ...(offersUltracode ? (["ultracode"] as const) : [])];

  const step = (by: -1 | 1) => {
    const at = track.indexOf(shown);
    setWanted(track[Math.max(0, Math.min(track.length - 1, at + by))]);
  };

  const pick = (choice: ModelChoice | undefined) => {
    if (!choice) return;
    const current = isCurrentModel(model, choice);
    if (wanted === "ultracode" && current && ultracodeAvailable) return onPick({ ultracode: ultracode ? undefined : true });
    const on = effortOn(effortsOf(choice), wanted === "ultracode" ? "max" : wanted);
    const level = on !== undefined && on !== effort ? on : undefined;
    // A level turns ultracode off, even the level it was on.
    onPick({ model: current ? undefined : choice.value, effort: level, ultracode: ultracode && !level ? false : undefined });
  };

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.escape || (key.ctrl && input === "c")) return onCancel();
    if (key.upArrow) return setSelected(Math.max(0, index - 1));
    if (key.downArrow) return setSelected(Math.min(models.length - 1, index + 1));
    if (key.leftArrow) return step(-1);
    if (key.rightArrow) return step(1);
    if (key.return) return pick(focused);
  });

  const start = Math.min(Math.max(0, index - Math.floor(rows / 2)), Math.max(0, models.length - rows));
  const visible = models.slice(start, start + rows);
  const inner = width - 2;

  useMouse((event) => {
    if (event.type === "wheel" && hit(panel.current, event)) {
      event.handled = true;
      return setSelected(Math.max(0, Math.min(models.length - 1, index + event.wheel)));
    }
    if (event.type !== "press" || event.button !== "left" || !hit(panel.current, event)) return;
    const at = hit(list.current, event);
    const choice = at ? visible[at.y] : undefined;
    if (!choice) return;
    event.handled = true;
    setSelected(start + (at?.y ?? 0));
    pick(choice);
  });
  const hovered = useHover(list, (_, y) => (visible[y] ? { key: start + y, shape: "pointer" } : null));

  return (
    <Box ref={panel} flexDirection="column">
      <Panel width={width} accent={PALETTE.gold} note={models.length > rows ? `${index + 1} of ${models.length}` : undefined}>
        <Text bold color={PALETTE.star}>
          Model and effort
        </Text>
        <Box ref={list} flexDirection="column" marginTop={1}>
          {models.length === 0 ? (
            <Text color={PALETTE.haze}>Claude Code hasn't listed its models yet. Try again in a moment.</Text>
          ) : (
            visible.map((choice, i) => {
              const isFocused = start + i === index;
              return (
                <ChoiceRow key={choice.value} selected={isFocused} hovered={start + i === hovered} width={inner}>
                  <Text wrap="truncate-end">
                    <Text bold={isFocused} color={isFocused ? PALETTE.star : undefined}>
                      {choice.name}
                    </Text>
                    {isCurrentModel(model, choice) ? <Text color={PALETTE.teal}>{"  current"}</Text> : null}
                    {choice.description ? <Text color={PALETTE.haze}>{`   ${choice.description}`}</Text> : null}
                  </Text>
                </ChoiceRow>
              );
            })
          )}
        </Box>
        {focused ? (
          <Box marginTop={1}>
            <Text color={PALETTE.haze}>{"  effort  "}</Text>
            {levels.length ? (
              <>
                <Dial
                  value={shown ?? "default"}
                  focused
                  changed={shown !== (ultracode ? "ultracode" : effort)}
                  pips={shown ? { at: shown === "ultracode" ? levels.length : levels.indexOf(shown), of: levels.length + (offersUltracode ? 1 : 0) } : undefined}
                  onStep={step}
                />
                <Text color={PALETTE.haze} wrap="truncate-end">
                  {`   ${shown === "ultracode" ? ULTRACODE_NOTE : shown ? EFFORT_NOTES[shown] : "Whatever Claude Code picks for this model"}`}
                </Text>
              </>
            ) : (
              <Text color={PALETTE.haze}>This model doesn't take an effort level.</Text>
            )}
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text color={PALETTE.dust}>↑↓ model   ←→ effort   enter to switch   esc to cancel</Text>
        </Box>
      </Panel>
    </Box>
  );
}
