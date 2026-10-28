// Claude's multiple-choice questions (the AskUserQuestion tool), one at a time, on a panel with a
// gold top edge, each option's preview beside the options or under them. In full screen, clicking an option is pressing its number.
import { Box, Text, useInput, usePaste, type DOMElement } from "ink";
import { useRef, useState } from "react";
import type { Answers, ImageAttachment, QuestionRequest } from "../src/events";
import { ChoiceRow } from "./choice";
import { drawnPreview, isHtmlPreview, PREVIEW_GAP, previewLayout } from "./diagrams";
import { wrapText } from "./markdown";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { ImageView, pictureSize } from "./pictures";
import { PALETTE } from "./theme";

/** Keys pressed this soon after a question appears were meant for something else, so Enter, Space, digits and clicks wait. */
const GRACE_MS = 500;

/** `rows`: the terminal's height, which a drawn preview shares with the options and the message box. */
type Props = { request: QuestionRequest; width: number; rows: number; onAnswer: (answers: Answers | null) => void };

export function QuestionPrompt({ request, width, rows: screenRows, onAnswer }: Props) {
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

  // On a wide screen the preview stands beside the options, and the question fits on one screen;
  // on a narrow one it goes under them.
  const layout = previewLayout(width, question.options.some((option) => !!option.preview?.trim()));
  const { beside, list: listWidth, preview: previewWidth, room } = layout;
  // The preview follows the pointer, else the chosen option. It's as tall as the tallest of them,
  // so the options don't move as it changes: in full screen this panel is pinned to the bottom,
  // and a taller preview would push another option under a pointer that held still.
  // A drawn preview gets what the panel's other lines and the message box leave, and under the
  // options, what they leave too.
  const around = questions.length > 1 ? 13 : 12;
  const most = Math.max(4, beside ? screenRows - around + 1 : screenRows - 2 * (other + 1) - around);
  const shapes = question.options.map((option) => previewShape(option.preview, room, most));
  const tallest = Math.max(0, ...shapes.map((shape) => shape.rows));
  const previewed = hovered !== null && hovered !== other ? hovered : selected;
  const shape = shapes[previewed];
  const options = (
    <Box ref={list} flexDirection="column" width={listWidth} flexShrink={0}>
      {[...question.options, { label: "Other…", description: "Type your own answer" }].map((option, i) => {
        const isFocused = i === selected;
        const box = question.multiSelect && i !== other ? (checked.includes(i) ? "● " : "○ ") : "";
        const indent = " ".repeat(3 + box.length);
        // Wrapped here, so its lines hang under the label rather than under the number.
        const description = option.description ? wrapText(option.description, Math.max(8, listWidth - 2 - indent.length), true) : [];
        return (
          <Box
            key={i}
            flexDirection="column"
            ref={(element) => {
              rows.current[i] = element;
            }}
          >
            <ChoiceRow selected={isFocused} hovered={i === hovered} width={listWidth}>
              <Text>
                <Text color={PALETTE.dust}>{`${i + 1}  `}</Text>
                {box ? <Text color={checked.includes(i) ? PALETTE.gold : PALETTE.dust}>{box}</Text> : null}
                <Text bold={isFocused} color={isFocused ? PALETTE.star : undefined}>
                  {option.label}
                </Text>
              </Text>
              {description.map((line, j) => (
                <Text key={j} color={PALETTE.haze}>
                  {indent + line.map((run) => run.text).join("")}
                </Text>
              ))}
            </ChoiceRow>
          </Box>
        );
      })}
    </Box>
  );
  const preview =
    tallest > 0 && typing === null ? (
      <Panel label={beside ? undefined : "preview"} width={previewWidth} background={PALETTE.raised}>
        {shape?.kind === "picture" ? (
          <Box height={tallest} flexDirection="column">
            <ImageView image={shape.image} width={room} rows={most} />
          </Box>
        ) : (
          Array.from({ length: tallest }, (_, i) => {
            const lines = shape?.kind === "text" ? shape.lines : [];
            const empty = shape?.kind === "error" ? `Couldn't draw this preview: ${shape.error}` : "No preview for this one.";
            return (
              <Text key={i} wrap="truncate-end" color={lines.length ? undefined : shape?.kind === "error" ? PALETTE.rose : PALETTE.dust}>
                {lines.length ? lines[i] || " " : i === 0 ? empty : " "}
              </Text>
            );
          })
        )}
      </Panel>
    ) : null;
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
      {beside ? (
        <Box marginTop={1} columnGap={PREVIEW_GAP}>
          {options}
          {preview}
        </Box>
      ) : (
        <Box marginTop={1}>{options}</Box>
      )}
      {typing !== null ? (
        <Box marginTop={1}>
          <Text>
            <Text color={PALETTE.gold}>{"❯ "}</Text>
            <Text color={PALETTE.star}>{typing}</Text>
            <Text backgroundColor={PALETTE.gold}> </Text>
          </Text>
        </Box>
      ) : null}
      {preview && !beside ? <Box marginTop={1}>{preview}</Box> : null}
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

/** An option's preview: Markdown as the lines it takes at `room` cells, or HTML as its picture, at most `most` rows tall. */
type Shape = { kind: "text"; lines: string[]; rows: number } | { kind: "picture"; image: ImageAttachment; rows: number } | { kind: "error"; error: string; rows: number };

function previewShape(preview: string | undefined, room: number, most: number): Shape {
  if (isHtmlPreview(preview)) {
    const done = drawnPreview(preview);
    const size = done && "image" in done ? pictureSize(done.image, room, most) : null;
    if (done && "image" in done && size) return { kind: "picture", image: done.image, rows: size.rows };
    // Drawn before the question shows, so a preview not drawn by now is one that couldn't be.
    if (done && "error" in done) return { kind: "error", error: done.error.split("\n")[0] ?? "", rows: 1 };
  }
  if (!preview?.trim()) return { kind: "text", lines: [], rows: 0 };
  const lines = wrapText(preview.replace(/\n+$/, ""), room, true).map((row) => row.map((run) => run.text).join(""));
  return { kind: "text", lines, rows: lines.length };
}
