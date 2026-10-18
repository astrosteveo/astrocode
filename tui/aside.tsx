// /btw: a question on the side, answered from the conversation so far while Claude carries on with
// its turn. Neither the question nor the answer goes into the conversation. The answer scrolls with
// ↑↓ and the wheel when it's taller than the room; Esc closes it.
import { Box, Text, useBoxMetrics, useInput, type DOMElement } from "ink";
import { useEffect, useRef, useState } from "react";
import type { Aside, AgentSession } from "../src/session";
import { Markdown, Panel } from "./markdown-view";
import { hit, useMouse } from "./mouse";
import { PALETTE } from "./theme";

type Props = {
  session: AgentSession;
  question: string;
  /** The side questions before it this session, and their answers, which Claude reads first. */
  earlier: Aside[];
  width: number;
  /** The most rows the answer takes before it scrolls. */
  rows: number;
  onAnswered: (aside: Aside) => void;
  onClose: () => void;
};

export function AsidePanel({ session, question, earlier, width, rows, onAnswered, onClose }: Props) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [top, setTop] = useState(0);
  const panel = useRef<DOMElement>(null);
  const content = useRef<DOMElement>(null);
  const { height } = useBoxMetrics(content);

  // Closing before the answer comes takes the question back.
  useEffect(() => {
    const controller = new AbortController();
    session.askAside(question, earlier, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return;
        if (response === null) return setFailure("Claude Code had no answer to that.");
        setAnswer(response);
        onAnswered({ question, response });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => controller.abort();
  }, [question]);

  const room = Math.max(3, rows);
  const most = Math.max(0, height - room);
  const scrolled = Math.min(top, most);
  const scroll = (by: number) => setTop(Math.max(0, Math.min(most, scrolled + by)));

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.escape || key.return || (key.ctrl && input === "c")) return onClose();
    if (key.upArrow || key.downArrow) return scroll(key.upArrow ? -1 : 1);
    if (key.pageUp || key.pageDown) return scroll(key.pageUp ? -room : room);
  });

  useMouse((event) => {
    if (event.type !== "wheel" || !hit(panel.current, event)) return;
    event.handled = true;
    scroll(event.wheel);
  });

  const inner = width - 2;
  return (
    <Box ref={panel} flexDirection="column">
      <Panel width={width} accent={PALETTE.gold} label="btw">
        <Markdown text={question} width={inner} voice="you" />
        <Box marginTop={1}>
          <Panel label="on the side" note={most ? `${scrolled + room >= height ? "end" : `${Math.round(((scrolled + room) / height) * 100)}%`}` : undefined} width={inner} background={PALETTE.raised}>
            {failure ? (
              <Text color={PALETTE.rose}>{`Couldn't ask: ${failure}`}</Text>
            ) : answer === null ? (
              <Text color={PALETTE.teal}>Thinking it over…</Text>
            ) : (
              <Box height={Math.min(room, Math.max(1, height))} overflow="hidden" contentOffsetY={scrolled} flexDirection="column">
                <Box ref={content} flexDirection="column" flexShrink={0}>
                  <Markdown text={answer} width={inner - 2} />
                </Box>
              </Box>
            )}
          </Panel>
        </Box>
        <Box marginTop={1}>
          <Text color={PALETTE.dust}>{most ? "↑↓ to scroll   esc to close" : "esc to close"}</Text>
        </Box>
      </Panel>
    </Box>
  );
}
