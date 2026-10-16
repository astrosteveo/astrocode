// What the turn is doing: a spinner turning through the nebula colors, a label with light
// moving across it, the time so far and the tokens Claude has written.
import { Box, Text, useAnimation } from "ink";
import { compact, duration } from "../src/view/format";
import type { State } from "../src/view/state";
import { toolLabel } from "../src/view/tools";
import { ACCENT, COLOR, gradient, mix, NEBULA } from "./theme";

const SPINNER = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

/** Catppuccin Mocha's mauve, green and blue, so the shimmer has a hex to blend from. */
const HUES = { thinking: "#cba6f7", writing: "#a6e3a1", tools: "#89b4fa" };

export function Activity({ state }: { state: State }) {
  const active = state.busy || state.pending.length > 0 || state.questions.length > 0;
  const { frame, time } = useAnimation({ interval: 80, isActive: active });
  if (!active) return null;
  const { label, hue } = describe(state);
  const live = state.live?.blocks.slice(state.live.finalized).reduce((sum, block) => sum + (block?.text.length ?? 0), 0) ?? 0;
  const tokens = state.turnTokens + Math.round(live / 4);
  const waiting = state.pending.length > 0 || state.questions.length > 0;
  return (
    <Box marginTop={1}>
      <Text>
        <Text color={gradient(NEBULA, (Math.sin(frame / 8) + 1) / 2)}>{SPINNER[frame % SPINNER.length]}</Text>{" "}
        <Shimmer text={`${label}…`} hue={hue} frame={frame} still={waiting} />
        <Text color={COLOR.muted}>
          {`  ${duration(time)}${tokens > 0 ? ` · ↓ ${compact(tokens)} tokens` : ""}${waiting ? "" : " · esc to stop"}`}
        </Text>
      </Text>
    </Box>
  );
}

/** Light passing over the text, letter by letter. Still while Claude waits on you. */
function Shimmer({ text, hue, frame, still }: { text: string; hue: string; frame: number; still: boolean }) {
  const letters = [...text];
  if (still || !hue.startsWith("#")) return <Text color={hue}>{text}</Text>;
  const head = (frame % (letters.length + 10)) - 5;
  return (
    <>
      {letters.map((letter, i) => {
        const glow = Math.max(0, 1 - Math.abs(i - head) / 3);
        return (
          <Text key={i} color={glow > 0 ? mix(hue, "#ffffff", glow * 0.8) : hue}>
            {letter}
          </Text>
        );
      })}
    </>
  );
}

function describe(state: State) {
  if (state.questions.length > 0) return { label: "Waiting for your answer", hue: ACCENT };
  if (state.pending.length > 0) return { label: "Waiting for your OK", hue: ACCENT };
  const live = state.live;
  const block = live?.blocks.slice(live.finalized).findLast((b) => b !== undefined);
  if (block?.kind === "thinking") return { label: "Thinking", hue: HUES.thinking };
  if (block?.kind === "text") return { label: "Writing", hue: HUES.writing };
  if (block?.kind === "tool") return { label: `Preparing ${toolLabel(block.name ?? "a tool")}`, hue: HUES.tools };
  const running = state.items.findLast((item) => item.kind === "tool" && item.call.status === "running");
  if (running?.kind === "tool") return { label: `Running ${toolLabel(running.call.name)}`, hue: HUES.tools };
  return { label: "Working", hue: HUES.thinking };
}
