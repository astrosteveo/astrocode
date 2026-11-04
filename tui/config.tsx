// /config: astrocode's settings as a menu. ↑ and ↓ choose a setting, ← and → (or Enter) change
// it, and closing with Esc applies what changed and writes it to the settings file in one go.
// Ctrl+C closes without changing anything. In full screen, click a setting to choose it, or an
// arrow to step it.
import type { EffortLevel, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text, useInput, type DOMElement } from "ink";
import { useRef, useState } from "react";
import { MODES, type ModelChoice } from "../src/events";
import type { NotifyMode, TodoMode, UsageMode } from "../src/settings";
import { isCurrentModel, modelLabel } from "../src/view/format";
import { ChoiceRow } from "./choice";
import { Dial, EFFORT_NOTES, effortOn, effortsOf, ULTRACODE_NOTE, type EffortStop } from "./effort";
import { cellWidth } from "./markdown";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { MODE_CHIPS } from "./status";
import { PALETTE } from "./theme";

export type ConfigValues = {
  model?: string;
  effort?: EffortLevel;
  /** For this session only, past the highest effort level. */
  ultracode: boolean;
  thinking: boolean;
  mode: PermissionMode;
  todos: TodoMode;
  fullscreen: boolean;
  notify: NotifyMode;
  usage: UsageMode;
  keepWarm: boolean;
  agentSummaries: boolean;
  /** Every session starts with Remote Control on. */
  remoteControl: boolean;
};

const TODOS: { mode: TodoMode; label: string; note: string }[] = [
  { mode: "auto", label: "while some are left", note: "Pinned above the message box until every to-do is done" },
  { mode: "on", label: "always", note: "Pinned above the message box, done or not" },
  { mode: "off", label: "hidden", note: "Ctrl+T still shows it, for this session" },
];

const NOTIFY: { mode: NotifyMode; label: string; note: string }[] = [
  { mode: "desktop", label: "desktop", note: "When a turn ends or Claude needs you while you're in another window" },
  { mode: "bell", label: "bell", note: "The terminal's bell, at the same moments" },
  { mode: "off", label: "off", note: "Only the window title says when Claude needs you" },
];

const USAGE: { mode: UsageMode; label: string; note: string }[] = [
  { mode: "auto", label: "past half", note: "The 5-hour and 7-day usage show in the status bar once half used" },
  { mode: "on", label: "always", note: "The 5-hour and 7-day usage always show in the status bar" },
  { mode: "off", label: "hidden", note: "The status bar never shows the plan's usage" },
];

const MODE_NOTES: Partial<Record<PermissionMode, string>> = {
  default: "Asks before edits and commands",
  acceptEdits: "Edits without asking, asks before commands",
  plan: "Plans without changing anything, for this session only",
  auto: "A classifier decides, and asks when it can't",
  bypassPermissions: "Never asks. Anything Claude tries runs",
};

/** The label column, wide enough for the longest label and a gap. */
const LABELS = 15;

type Row = { label: string; value: string; changed: boolean; note: string; pips?: { at: number; of: number }; step?: (by: -1 | 1) => void };

type Props = {
  models: ModelChoice[];
  initial: ConfigValues;
  /** Where the settings are written, to say so. */
  path: string;
  /** Whether ultracode can be on with the model in use. */
  ultracodeAvailable: boolean;
  width: number;
  /** What changed, on Esc; null when Ctrl+C threw the changes away. */
  onClose: (changes: Partial<ConfigValues> | null) => void;
};

export function ConfigMenu({ models, initial, path, ultracodeAvailable, width, onClose }: Props) {
  const [values, setValues] = useState(initial);
  const [selected, setSelected] = useState(0);
  const list = useRef<DOMElement>(null);

  const modelAt = models.findIndex((choice) => isCurrentModel(values.model, choice));
  const model = models[modelAt];
  const levels = effortsOf(model);
  const effort = effortOn(levels, values.effort);
  // Claude Code says whether ultracode can be on for the model in use, not for another one picked here.
  const offersUltracode = ultracodeAvailable && (model === undefined || isCurrentModel(initial.model, model));
  const ultracode = values.ultracode && offersUltracode;
  const stop: EffortStop = ultracode ? "ultracode" : effort;
  // With no level set yet, the model's own default comes before the lowest level; ultracode comes past the highest.
  const track: EffortStop[] = [...(initial.effort === undefined ? [undefined] : []), ...levels, ...(offersUltracode ? (["ultracode"] as const) : [])];
  const modeAt = MODES.findIndex((mode) => mode === values.mode);
  const todosAt = TODOS.findIndex((one) => one.mode === values.todos);
  const notifyAt = NOTIFY.findIndex((one) => one.mode === values.notify);
  const usageAt = USAGE.findIndex((one) => one.mode === values.usage);
  const update = (change: Partial<ConfigValues>) => setValues((now) => ({ ...now, ...change }));
  const clamp = (at: number, length: number) => Math.max(0, Math.min(length - 1, at));

  const rows: Row[] = [
    {
      label: "Model",
      value: model?.name ?? (values.model ? modelLabel(values.model) : "default"),
      changed: model !== undefined && !isCurrentModel(initial.model, model),
      note: model?.description ?? (models.length ? "" : "Claude Code hasn't listed its models yet"),
      step: models.length ? (by) => update({ model: models[clamp(modelAt + by, models.length)]?.value }) : undefined,
    },
    {
      label: "Effort",
      value: levels.length ? (stop ?? "default") : "none",
      changed: effort !== initial.effort || ultracode !== initial.ultracode,
      note: !levels.length ? "This model doesn't take an effort level" : ultracode ? ULTRACODE_NOTE : effort ? EFFORT_NOTES[effort] : "Whatever Claude Code picks for this model",
      pips: stop ? { at: stop === "ultracode" ? levels.length : levels.indexOf(stop), of: levels.length + (offersUltracode ? 1 : 0) } : undefined,
      step: levels.length
        ? (by) => {
            const next = track[clamp(track.indexOf(stop) + by, track.length)];
            update(next === "ultracode" ? { ultracode: true } : { effort: next, ultracode: false });
          }
        : undefined,
    },
    model?.thinkingOff === false
      ? { label: "Thinking", value: "always on", changed: false, note: "This model always thinks, and effort sets how much" }
      : {
          label: "Thinking",
          value: values.thinking ? "on" : "off",
          changed: values.thinking !== initial.thinking,
          note: values.thinking ? "Claude thinks first when it helps" : "Claude answers straight away, without thinking first",
          step: () => update({ thinking: !values.thinking }),
        },
    {
      label: "Mode",
      value: MODE_CHIPS[values.mode].label,
      changed: values.mode !== initial.mode,
      note: MODE_NOTES[values.mode] ?? "",
      step: (by) => update({ mode: MODES[clamp(modeAt + by, MODES.length)] }),
    },
    {
      label: "To-do list",
      value: TODOS[todosAt]?.label ?? "",
      changed: values.todos !== initial.todos,
      note: TODOS[todosAt]?.note ?? "",
      step: (by) => update({ todos: TODOS[clamp(todosAt + by, TODOS.length)]?.mode }),
    },
    {
      label: "Full screen",
      value: values.fullscreen ? "on" : "off",
      changed: values.fullscreen !== initial.fullscreen,
      note: values.fullscreen ? "The whole terminal, with the mouse" : "The terminal's own scrollback",
      step: () => update({ fullscreen: !values.fullscreen }),
    },
    {
      label: "Plan usage",
      value: USAGE[usageAt]?.label ?? "",
      changed: values.usage !== initial.usage,
      note: USAGE[usageAt]?.note ?? "",
      step: (by) => update({ usage: USAGE[clamp(usageAt + by, USAGE.length)]?.mode }),
    },
    {
      label: "Keep warm",
      value: values.keepWarm ? "on" : "off",
      changed: values.keepWarm !== initial.keepWarm,
      note: values.keepWarm
        ? "Refreshes the cache before it expires while you're away, up to 8 hours"
        : "The cache expires an hour after Claude's last answer",
      step: () => update({ keepWarm: !values.keepWarm }),
    },
    {
      label: "Agent progress",
      value: values.agentSummaries ? "on" : "off",
      changed: values.agentSummaries !== initial.agentSummaries,
      note: values.agentSummaries
        ? "A line every half minute on what each subagent is doing, in /tasks, from the next session (/clear)"
        : "Subagents in /tasks show their last tool and their transcript",
      step: () => update({ agentSummaries: !values.agentSummaries }),
    },
    {
      label: "Remote Control",
      value: values.remoteControl ? "on" : "off",
      changed: values.remoteControl !== initial.remoteControl,
      note: values.remoteControl
        ? "Every session can be continued from claude.ai or the Claude app; /remote-control shows the link"
        : "Off until /remote-control turns it on, for one session",
      step: () => update({ remoteControl: !values.remoteControl }),
    },
    {
      label: "Notifications",
      value: NOTIFY[notifyAt]?.label ?? "",
      changed: values.notify !== initial.notify,
      note: NOTIFY[notifyAt]?.note ?? "",
      step: (by) => update({ notify: NOTIFY[clamp(notifyAt + by, NOTIFY.length)]?.mode }),
    },
  ];

  const close = () => {
    const changes: Partial<ConfigValues> = {};
    if (model && !isCurrentModel(initial.model, model)) changes.model = model.value;
    if (effort !== undefined && effort !== initial.effort) changes.effort = effort;
    if (ultracode !== initial.ultracode) changes.ultracode = ultracode;
    if (values.thinking !== initial.thinking) changes.thinking = values.thinking;
    if (values.mode !== initial.mode) changes.mode = values.mode;
    if (values.todos !== initial.todos) changes.todos = values.todos;
    if (values.fullscreen !== initial.fullscreen) changes.fullscreen = values.fullscreen;
    if (values.notify !== initial.notify) changes.notify = values.notify;
    if (values.usage !== initial.usage) changes.usage = values.usage;
    if (values.keepWarm !== initial.keepWarm) changes.keepWarm = values.keepWarm;
    if (values.agentSummaries !== initial.agentSummaries) changes.agentSummaries = values.agentSummaries;
    if (values.remoteControl !== initial.remoteControl) changes.remoteControl = values.remoteControl;
    onClose(changes);
  };

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.ctrl && input === "c") return onClose(null);
    if (key.escape) return close();
    if (key.upArrow) return setSelected((at) => clamp(at - 1, rows.length));
    if (key.downArrow) return setSelected((at) => clamp(at + 1, rows.length));
    const row = rows[selected];
    if (key.leftArrow) return row?.step?.(-1);
    if (key.rightArrow || key.return || input === " ") return row?.step?.(1);
  });

  useMouse((event) => {
    // Before or after a dial steps the setting, the row it's on is the one chosen.
    if (event.type !== "press" || event.button !== "left") return;
    const at = hit(list.current, event);
    if (!at || !rows[at.y]) return;
    event.handled = true;
    setSelected(at.y);
  });
  const hovered = useHover(list, (_, y) => (rows[y] ? { key: y, shape: "pointer" } : null));

  const inner = width - 2;
  // The dials line up, as wide as the widest one.
  const dials = Math.max(...rows.map((row) => cellWidth(row.value) + 4 + (row.pips ? row.pips.of + 2 : 0)));
  return (
    <Panel width={width} accent={PALETTE.gold} note="esc saves">
      <Text bold color={PALETTE.star}>
        Settings
      </Text>
      <Box ref={list} flexDirection="column" marginTop={1}>
        {rows.map((row, i) => (
          <ChoiceRow key={row.label} selected={i === selected} hovered={i === hovered} width={inner}>
            <Box>
              <Box width={LABELS} flexShrink={0}>
                <Text bold={i === selected} color={i === selected ? PALETTE.star : PALETTE.haze}>
                  {row.label}
                </Text>
              </Box>
              <Box width={dials + 3} flexShrink={0}>
                <Dial value={row.value} focused={i === selected} changed={row.changed} pips={row.pips} onStep={row.step} />
              </Box>
              <Box flexShrink={1}>
                <Text color={PALETTE.haze} wrap="truncate-end">
                  {row.note}
                </Text>
              </Box>
            </Box>
          </ChoiceRow>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={PALETTE.dust} wrap="truncate-start">{`Kept for next time in ${path}, except plan mode, max effort and ultracode.`}</Text>
      </Box>
      <Text color={PALETTE.dust}>↑↓ to choose   ←→ to change   esc saves and closes   ctrl+c discards</Text>
    </Panel>
  );
}
