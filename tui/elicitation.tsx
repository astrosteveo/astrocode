// An MCP server asking you for something, on a panel with a gold top edge: a form to fill in, or an
// address to open in the browser, as signing in to a service does. ↑ and ↓ move between fields,
// typing fills in text, ← and → step a choice or a yes/no, Space checks one of several, and Enter
// moves on until Send. Esc declines; Ctrl+C cancels. In full screen, clicking a row chooses it.
//
// The form's values and where you are in it live in a ref, since keys can arrive faster than React
// re-renders, as in the message box.
import { Box, Text, useInput, usePaste, type DOMElement } from "ink";
import { useReducer, useRef, type ReactNode } from "react";
import type { ElicitationAnswer, ElicitationField, ElicitationRequest } from "../src/events";
import { ChoiceRow } from "./choice";
import { Dial } from "./effort";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE } from "./theme";

/** Keys pressed this soon after the prompt appears were meant for something else, so Enter, Space, typing and clicks wait. */
const GRACE_MS = 500;

type Props = {
  request: ElicitationRequest;
  width: number;
  /** Opens the address of a sign-in in the browser. */
  onOpen: (url: string) => void;
  onAnswer: (answer: ElicitationAnswer) => void;
};

type Value = string | boolean | string[];

/** The form as it stands: each field's value, the row chosen, the option each multiple choice is on, and what's wrong. */
type Form = { values: Record<string, Value>; selected: number; at: Record<string, number>; problem: string | null };

export function ElicitationPrompt({ request, width, onOpen, onAnswer }: Props) {
  const { fields } = request;
  const form = useRef<Form>({ values: Object.fromEntries(fields.map((one) => [one.name, initial(one)])), selected: 0, at: {}, problem: null });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const shownAt = useRef(Date.now());
  const rows = useRef<(DOMElement | null)[]>([]);
  const list = useRef<DOMElement>(null);

  // A sign-in has two choices; a form has its fields, then Send and Decline.
  const actions = request.mode === "url" ? ["open", "decline"] : ["send", "decline"];
  const shownFields = request.mode === "url" ? [] : fields;
  const count = shownFields.length + actions.length;
  const fieldAt = (i: number) => shownFields[i];
  const actionAt = (i: number) => (i >= shownFields.length ? actions[i - shownFields.length] : undefined);

  const update = (change: Partial<Form>) => {
    form.current = { ...form.current, ...change };
    redraw();
  };
  const setValue = (name: string, value: Value) => update({ values: { ...form.current.values, [name]: value }, problem: null });
  const select = (i: number) => update({ selected: ((i % count) + count) % count });

  const act = (which: string | undefined) => {
    if (which === "decline") return onAnswer({ action: "decline" });
    if (which === "open") {
      if (request.url) onOpen(request.url);
      return onAnswer({ action: "accept" });
    }
    if (which === "send") {
      const content = filled(fields, form.current.values);
      if (typeof content === "string") return update({ problem: content });
      onAnswer({ action: "accept", content });
    }
  };

  /** ← and →: a choice or a yes/no steps, and one of several moves to the option before or after. */
  const step = (by: -1 | 1) => {
    const field = fieldAt(form.current.selected);
    if (!field) return;
    const value = form.current.values[field.name];
    if (field.type === "boolean") return setValue(field.name, !value);
    if (field.type === "enum") {
      const choices = choicesOf(field);
      const at = choices.findIndex((one) => one.value === value);
      const next = choices[Math.max(0, Math.min(choices.length - 1, at + by))];
      if (next) setValue(field.name, next.value);
    }
    if (field.type === "multi") {
      const last = (field.options?.length ?? 1) - 1;
      update({ at: { ...form.current.at, [field.name]: Math.max(0, Math.min(last, (form.current.at[field.name] ?? 0) + by)) } });
    }
  };

  /** Space on one of several: the option it's on is checked or unchecked. */
  const toggle = () => {
    const field = fieldAt(form.current.selected);
    if (field?.type !== "multi") return false;
    const option = field.options?.[form.current.at[field.name] ?? 0];
    if (!option) return true;
    const picked = (form.current.values[field.name] as string[] | undefined) ?? [];
    setValue(field.name, picked.includes(option.value) ? picked.filter((one) => one !== option.value) : [...picked, option.value]);
    return true;
  };

  const typed = (text: string) => {
    const field = fieldAt(form.current.selected);
    if (!field || !isText(field)) return;
    setValue(field.name, String(form.current.values[field.name] ?? "") + text);
  };

  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left") return;
    const index = rows.current.findIndex((row, i) => i < count && hit(row, event));
    if (index === -1) return;
    event.handled = true;
    select(index);
    if (Date.now() - shownAt.current < GRACE_MS) return;
    act(actionAt(index));
  });
  const hovered = useHover(list, (_x, _y, pointer) => {
    const index = rows.current.findIndex((row, i) => i < count && hit(row, pointer));
    return index === -1 ? null : { key: index, shape: "pointer" };
  });

  const selectedField = fieldAt(form.current.selected);
  usePaste((text) => typed(text.replace(/\s*\n\s*/g, " ")), { isActive: selectedField !== undefined && isText(selectedField) });

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.ctrl && input === "c") return onAnswer({ action: "cancel" });
    if (key.escape) return onAnswer({ action: "decline" });
    const { selected } = form.current;
    if (key.upArrow || (key.tab && key.shift)) return select(selected - 1);
    if (key.downArrow || key.tab) return select(selected + 1);
    if (key.leftArrow) return step(-1);
    if (key.rightArrow) return step(1);
    const field = fieldAt(selected);
    if (key.backspace) {
      if (field && isText(field)) setValue(field.name, String(form.current.values[field.name] ?? "").slice(0, -1));
      return;
    }
    // Enter, Space and typing this soon were meant for something else, such as the message box.
    if (Date.now() - shownAt.current < GRACE_MS) return;
    if (key.return) {
      const action = actionAt(selected);
      return action ? act(action) : select(Math.min(count - 1, selected + 1));
    }
    if (input === " " && field?.type === "boolean") return step(1);
    if (input === " " && toggle()) return;
    if (key.ctrl || key.meta || !input) return;
    typed(input);
  });

  const { values, selected, at, problem } = form.current;
  const inner = width - 2;
  const labels = Math.min(24, Math.max(0, ...shownFields.map((one) => one.label.length + (one.required ? 2 : 0))) + 2);
  const row = (i: number, content: ReactNode) => (
    <Box
      key={i}
      flexDirection="column"
      ref={(element) => {
        rows.current[i] = element;
      }}
    >
      <ChoiceRow selected={i === selected} hovered={i === hovered} width={inner}>
        {content}
      </ChoiceRow>
    </Box>
  );
  const actionLabel: Record<string, string> = { open: "Open it in the browser", send: "Send", decline: "Decline" };
  return (
    <Panel width={width} accent={PALETTE.gold} note={request.server}>
      <Text bold color={PALETTE.star}>
        {request.title ?? (request.mode === "url" ? `${request.server} asks you to open an address` : `${request.server} asks for some details`)}
      </Text>
      {request.message ? <Text color={PALETTE.haze}>{request.message}</Text> : null}
      {request.mode === "url" && request.url ? <Text color={PALETTE.sky}>{request.url}</Text> : null}
      <Box ref={list} flexDirection="column" marginTop={1}>
        {shownFields.map((one, i) =>
          row(
            i,
            <>
              <Box>
                <Box width={labels} flexShrink={0}>
                  <Text bold={i === selected} color={i === selected ? PALETTE.star : PALETTE.haze}>
                    {one.label}
                    {one.required ? <Text color={PALETTE.gold}> *</Text> : null}
                  </Text>
                </Box>
                <FieldValue field={one} value={values[one.name]} focused={i === selected} at={at[one.name] ?? 0} onStep={i === selected ? step : undefined} />
              </Box>
              {one.description && i === selected ? <Text color={PALETTE.dust}>{`${" ".repeat(labels)}${one.description}`}</Text> : null}
            </>,
          ),
        )}
        {actions.map((one, j) => {
          const i = shownFields.length + j;
          return row(
            i,
            <Text bold={i === selected} color={i === selected ? PALETTE.star : undefined}>
              {actionLabel[one]}
            </Text>,
          );
        })}
      </Box>
      {problem ? <Text color={PALETTE.rose}>{problem}</Text> : null}
      <Box marginTop={1}>
        <Text color={PALETTE.dust}>
          {request.mode === "url"
            ? "↑↓ to choose   enter to confirm   esc to decline"
            : `↑↓ to move   type to fill in   ←→ to change a choice${fields.some((one) => one.type === "multi") ? "   space to check" : ""}   enter for the next   esc to decline`}
        </Text>
      </Box>
    </Panel>
  );
}

/**
 * A field's value: text with a caret while it's being typed in, a dial for a choice or yes/no, or
 * the options of a multiple choice, each checked or not, the one ←→ is on underlined.
 */
function FieldValue({ field, value, focused, at, onStep }: { field: ElicitationField; value: Value | undefined; focused: boolean; at: number; onStep?: (by: -1 | 1) => void }) {
  if (field.type === "boolean") return <Dial value={value ? "yes" : "no"} focused={focused} onStep={onStep} />;
  if (field.type === "enum") {
    const label = choicesOf(field).find((one) => one.value === value)?.label ?? "";
    return <Dial value={label || "not set"} focused={focused} onStep={onStep} />;
  }
  if (field.type === "multi") {
    const picked = Array.isArray(value) ? value : [];
    return (
      <Text wrap="truncate-end">
        {(field.options ?? []).map((option, i) => (
          <Text key={option.value}>
            {i > 0 ? "  " : ""}
            <Text color={picked.includes(option.value) ? PALETTE.gold : PALETTE.dust}>{picked.includes(option.value) ? "● " : "○ "}</Text>
            <Text color={PALETTE.star} underline={focused && i === at}>
              {option.label}
            </Text>
          </Text>
        ))}
      </Text>
    );
  }
  const text = String(value ?? "");
  return (
    <Text>
      <Text color={PALETTE.star}>{text}</Text>
      {focused ? <Text backgroundColor={PALETTE.gold}> </Text> : !text ? <Text color={PALETTE.dust}>{field.type === "string" ? "—" : "a number"}</Text> : null}
    </Text>
  );
}

function isText(field: ElicitationField) {
  return field.type === "string" || field.type === "number" || field.type === "integer";
}

/** A choice's options, with "not set" first when it's optional and has no default. */
function choicesOf(field: ElicitationField) {
  const options = field.options ?? [];
  return field.required || field.default !== undefined ? options : [{ value: "", label: "" }, ...options];
}

function initial(field: ElicitationField): Value {
  if (field.type === "boolean") return field.default === true;
  if (field.type === "multi") return Array.isArray(field.default) ? field.default : [];
  if (field.type === "enum") return field.default !== undefined ? String(field.default) : (choicesOf(field)[0]?.value ?? "");
  return field.default !== undefined ? String(field.default) : "";
}

const FORMATS: Record<string, { test: (text: string) => boolean; says: string }> = {
  email: { test: (text) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text), says: "an email address" },
  uri: { test: (text) => URL.canParse(text), says: "a full address, such as https://…" },
  date: { test: (text) => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text)), says: "a date, as 2026-10-17" },
  "date-time": { test: (text) => !Number.isNaN(Date.parse(text)), says: "a date and time" },
};

/**
 * The form's values as the server asked for them, or what's wrong with them, checked against the
 * schema's limits as the server will check them. Empty optional fields are left out.
 */
function filled(fields: ElicitationField[], values: Record<string, Value>): Record<string, string | number | boolean | string[]> | string {
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.type === "boolean") {
      content[field.name] = value === true;
      continue;
    }
    if (field.type === "multi") {
      const picked = Array.isArray(value) ? value : [];
      if (!picked.length && !field.required && !field.min) continue;
      if (field.min !== undefined && picked.length < field.min) return `${field.label} needs at least ${field.min} picked.`;
      if (field.max !== undefined && picked.length > field.max) return `${field.label} takes at most ${field.max}.`;
      if (field.required && !picked.length) return `${field.label} needs at least one picked.`;
      content[field.name] = picked;
      continue;
    }
    const text = String(value ?? "").trim();
    if (!text) {
      if (field.required) return `${field.label} is needed.`;
      continue;
    }
    if (field.type === "number" || field.type === "integer") {
      const number = Number(text);
      if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) return `${field.label} takes ${field.type === "integer" ? "a whole number" : "a number"}.`;
      if (field.min !== undefined && number < field.min) return `${field.label} is ${field.min} or more.`;
      if (field.max !== undefined && number > field.max) return `${field.label} is ${field.max} or less.`;
      content[field.name] = number;
      continue;
    }
    if (field.min !== undefined && text.length < field.min) return `${field.label} takes at least ${field.min} characters.`;
    if (field.max !== undefined && text.length > field.max) return `${field.label} takes at most ${field.max} characters.`;
    const format = field.format ? FORMATS[field.format] : undefined;
    if (format && !format.test(text)) return `${field.label} takes ${format.says}.`;
    if (field.pattern && !matches(field.pattern, text)) return `${field.label} isn't in the form the server asks for.`;
    content[field.name] = text;
  }
  return content;
}

/** Whether text matches a schema's pattern; one JavaScript can't read is left to the server. */
function matches(pattern: string, text: string) {
  try {
    return new RegExp(pattern, "u").test(text);
  } catch {
    return true;
  }
}
