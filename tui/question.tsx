// Claude's multiple-choice questions (the AskUserQuestion tool), one at a time.
import { Box, Text, useInput, usePaste } from "ink";
import { useRef, useState } from "react";
import type { Answers, QuestionRequest } from "../src/events";
import { Frame } from "./markdown-view";
import { ACCENT, COLOR } from "./theme";

/** Keys pressed this soon after a question appears were meant for something else, so Enter, Space and digits wait. */
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
    const pick = (i: number) => {
      if (i === other) return setTyping("");
      if (question.multiSelect) return toggle(i);
      finish(question.options[i]?.label ?? "");
    };
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

  const preview = question.options[selected]?.preview;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
      <Text>
        <Text bold color={ACCENT}>
          {questions.length === 1 ? "◆ Claude has a question" : `◆ Claude has ${questions.length} questions`}
        </Text>
        {questions.length > 1
          ? questions.map((one, i) => (
              <Text key={i}>
                {"  "}
                <Text inverse={i === step} color={i < step ? COLOR.success : i === step ? ACCENT : COLOR.muted}>
                  {` ${i < step ? "✓ " : ""}${one.header || `Question ${i + 1}`} `}
                </Text>
              </Text>
            ))
          : null}
      </Text>
      <Box marginTop={1}>
        <Text bold>{question.question}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {[...question.options, { label: "Other…", description: "Type your own answer" }].map((option, i) => {
          const isFocused = i === selected;
          const box = question.multiSelect && i !== other ? (checked.includes(i) ? "[✓] " : "[ ] ") : "";
          return (
            <Box key={i} flexDirection="column">
              <Text color={isFocused ? ACCENT : undefined} bold={isFocused}>
                {`${isFocused ? "❯" : " "} ${box}${i + 1}. ${option.label}`}
              </Text>
              {option.description ? <Text dimColor>{`     ${option.description}`}</Text> : null}
            </Box>
          );
        })}
      </Box>
      {typing !== null ? (
        <Box marginTop={1}>
          <Text>
            <Text color={ACCENT}>{"› "}</Text>
            {typing}
            <Text inverse> </Text>
          </Text>
        </Box>
      ) : null}
      {preview && typing === null ? (
        <Box marginTop={1}>
          <Frame label="preview" width={width - 4}>
            <Text>{preview}</Text>
          </Frame>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          {typing !== null
            ? "enter to answer · esc to go back"
            : `↑↓ to choose · ${question.multiSelect ? "space to check · enter when done" : "enter to answer"}${step > 0 ? " · ← back" : ""} · esc to dismiss`}
        </Text>
      </Box>
    </Box>
  );
}
