// Claude's multiple-choice questions (the AskUserQuestion tool), one at a time, on a panel with a
// gold top edge. In full screen, clicking an option is pressing its number.
import { Box, Text, useInput, usePaste, type DOMElement } from "ink";
import { useRef, useState } from "react";
import type { Answers, QuestionRequest } from "../src/events";
import { ChoiceRow } from "./choice";
import { wrapText } from "./markdown";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE } from "./theme";

/** Keys pressed this soon after a question appears were meant for something else, so Enter, Space, digits and clicks wait. */
const GRACE_MS = 500;

type Props = { request: QuestionRequest; width: number; onAnswer: (answers: Answers | null) => void };

export function QuestionPrompt({ request, width, onAnswer }: Props) {
  const { questions } = request;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState<number[]>([]);
  /** What's typed for "Other", or null while choosing. */
  const [typing, setTyping] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const rows = useRef<(DOMElement | null)[]>([]);
  const list = useRef<DOMElement>(null);

  const question = questions[step] ?? questions[0]!;
  const other = question.options.length;
  const labels = (indexes: number[]) => [...indexes].sort((a, b) => a - b).map((i) => question.options[i]?.label ?? "");

  const goTo = (next: number) => {
    setStep(next);
    setSelected(0);
    setChecked([]);
    setTyping(null);
    shownAt.current = Date.now();
  };

  const finish = (answer: string) => {
    const next = { ...answers, [question.question]: answer };
    setAnswers(next);
    if (step + 1 < questions.length) goTo(step + 1);
    else onAnswer(next);
  };

  const toggle = (i: number) => setChecked((list) => (list.includes(i) ? list.filter((one) => one !== i) : [...list, i]));

  /** Option `i`, chosen: "Other" opens the box to type in, a multi-select checks or unchecks, and anything else answers. */
  const pick = (i: number) => {
    if (i === other) return setTyping("");
    if (question.multiSelect) return toggle(i);
    finish(question.options[i]?.label ?? "");
  };

  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left") return;
    const index = rows.current.findIndex((row, i) => i <= other && hit(row, event));
    if (index === -1) return;
    event.handled = true;
    setSelected(index);
    if (Date.now() - shownAt.current < GRACE_MS) return;
    if (typing !== null) setTyping(null);
    pick(index);
  });
  const hovered = useHover(list, (_x, _y, pointer) => {
    const index = rows.current.findIndex((row, i) => i <= other && hit(row, pointer));
    return index === -1 ? null : { key: index, shape: "pointer" };
  });

  usePaste((text) => setTyping((typed) => (typed === null ? typed : typed + text.replace(/\s*\n\s*/g, " "))), { isActive: typing !== null });

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (typing !== null) {
      if (key.escape) return setTyping(null);
      if (key.return) {
        if (typing.trim()) finish([...(question.multiSelect ? labels(checked) : []), typing.trim()].join(", "));
        return;
      }
      if (key.backspace) return setTyping(typing.slice(0, -1));
      if (key.ctrl || key.meta || !input) return;
      return setTyping(typing + input);
    }
    if (key.escape || (key.ctrl && input === "c")) return onAnswer(null);
    if (key.upArrow) return setSelected((i) => (i + other) % (other + 1));
    if (key.downArrow || (key.tab && !key.shift)) return setSelected((i) => (i + 1) % (other + 1));
    if (key.leftArrow && step > 0) return goTo(step - 1);
    if (Date.now() - shownAt.current < GRACE_MS) return;
    if (input === " " && question.multiSelect) return pick(selected);
    if (key.return) {
      if (selected === other) return setTyping("");
      if (question.multiSelect) return finish(labels(checked.length ? checked : [selected]).join(", "));
      return pick(selected);
    }
    if (/^[1-9]$/.test(input) && Number(input) <= other + 1) {
      setSelected(Number(input) - 1);
      pick(Number(input) - 1);
    }
  });

  const inner = width - 2;
  // The preview follows the pointer, else the chosen option. It's as tall as the tallest of them,
  // so the options above it don't move as it changes: in full screen this panel is pinned to the
  // bottom, and a taller preview would push another option under a pointer that held still.
  const room = inner - 2;
  const tallest = Math.max(0, ...question.options.map((option) => previewRows(option.preview, room).length));
  const previewed = hovered !== null && hovered !== other ? hovered : selected;
  const preview = previewRows(question.options[previewed]?.preview, room);
  return (
    <Panel width={width} accent={PALETTE.gold} note={questions.length > 1 ? `${step + 1} of ${questions.length}` : undefined}>
      {questions.length > 1 ? (
        <Text>
          {questions.map((one, i) => (
            <Text key={i} bold={i === step} color={i < step ? PALETTE.teal : i === step ? PALETTE.gold : PALETTE.dust}>
              {`${i > 0 ? "   " : ""}${i < step ? "✓ " : ""}${one.header || `Question ${i + 1}`}`}
            </Text>
          ))}
        </Text>
      ) : null}
      <Text bold color={PALETTE.star}>
        {question.question}
      </Text>
      <Box ref={list} flexDirection="column" marginTop={1}>
        {[...question.options, { label: "Other…", description: "Type your own answer" }].map((option, i) => {
          const isFocused = i === selected;
          const box = question.multiSelect && i !== other ? (checked.includes(i) ? "● " : "○ ") : "";
          return (
            <Box
              key={i}
              flexDirection="column"
              ref={(element) => {
                rows.current[i] = element;
              }}
            >
              <ChoiceRow selected={isFocused} hovered={i === hovered} width={inner}>
                <Text>
                  <Text color={PALETTE.dust}>{`${i + 1}  `}</Text>
                  {box ? <Text color={checked.includes(i) ? PALETTE.gold : PALETTE.dust}>{box}</Text> : null}
                  <Text bold={isFocused} color={isFocused ? PALETTE.star : undefined}>
                    {option.label}
                  </Text>
                </Text>
                {option.description ? <Text color={PALETTE.haze}>{`${" ".repeat(3 + box.length)}${option.description}`}</Text> : null}
              </ChoiceRow>
            </Box>
          );
        })}
      </Box>
      {typing !== null ? (
        <Box marginTop={1}>
          <Text>
            <Text color={PALETTE.gold}>{"❯ "}</Text>
            <Text color={PALETTE.star}>{typing}</Text>
            <Text backgroundColor={PALETTE.gold}> </Text>
          </Text>
        </Box>
      ) : null}
      {tallest > 0 && typing === null ? (
        <Box marginTop={1}>
          <Panel label="preview" width={inner} background={PALETTE.raised}>
            {Array.from({ length: tallest }, (_, i) => (
              <Text key={i} color={preview.length ? undefined : PALETTE.dust}>
                {preview.length ? preview[i] || " " : i === 0 ? "No preview for this one." : " "}
              </Text>
            ))}
          </Panel>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={PALETTE.dust}>
          {typing !== null
            ? "enter to answer   esc to go back"
            : `↑↓ to choose   ${question.multiSelect ? "space to check   enter when done" : "enter to answer"}${step > 0 ? "   ← back" : ""}   esc to dismiss`}
        </Text>
      </Box>
    </Panel>
  );
}

/** An option's preview as the rows it takes at `room` cells: none when it has no preview. */
function previewRows(preview: string | undefined, room: number) {
  if (!preview?.trim()) return [];
  return wrapText(preview.replace(/\n+$/, ""), room, true).map((row) => row.map((run) => run.text).join(""));
}
