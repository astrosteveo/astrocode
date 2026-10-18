// The tip of the rail while Claude works: a cell in orbit, what Claude is doing with light passing
// over the words, the time so far and the tokens written. While a tool runs, it names the call, so
// you needn't look for it above. While it waits on you, the tip turns gold and holds still.
import { Box, Text, useAnimation } from "ink";
import { compact, duration } from "../src/view/format";
import type { State } from "../src/view/state";
import { toolLabel, toolTarget } from "../src/view/tools";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
import { GUTTER } from "./rail";
import { mix, PALETTE } from "./theme";

/**
 * A gap going round a full braille cell. A single dot going round was too faint to see at most
 * font sizes; seven lit dots read as a solid mark that turns.
 */
const ORBIT = ["⣾", "⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽"];

export function Activity({ state, width }: { state: State; width: number }) {
  const waiting = state.pending.length > 0 || state.questions.length > 0;
  const active = state.busy || waiting;
  const { frame, time } = useAnimation({ interval: 90, isActive: active });
  if (!active) return null;
  const live = state.live?.blocks.slice(state.live.finalized).reduce((sum, block) => sum + (block?.text.length ?? 0), 0) ?? 0;
  const tokens = state.turnTokens + Math.round(live / 4);
  const stats = `   ${duration(time)}${tokens > 0 ? `   ${compact(tokens)} tokens` : ""}`;
  const label = fit(describe(state), width - GUTTER - cellWidth(stats) - (waiting ? 0 : cellWidth("esc to stop") + 2), false);
  return (
    <Box flexDirection="column">
      <Text color={PALETTE.dust}>│</Text>
      <Box justifyContent="space-between" width={width}>
        <Text>
          <Text color={waiting ? PALETTE.gold : PALETTE.teal}>{(waiting ? "◆" : (ORBIT[frame % ORBIT.length] ?? "")).padEnd(GUTTER)}</Text>
          {waiting ? <Text color={PALETTE.gold}>{label}</Text> : <Sweep text={label} frame={frame} />}
          <Text color={PALETTE.haze}>{stats}</Text>
        </Text>
        {waiting ? null : <Text color={PALETTE.dust}>esc to stop</Text>}
      </Box>
    </Box>
  );
}

/** Light passing over the words, letter by letter, from teal to starlight and back. */
function Sweep({ text, frame }: { text: string; frame: number }) {
  const letters = [...text];
  const head = (frame % (letters.length + 12)) - 6;
  return (
    <>
      {letters.map((letter, i) => {
        const glow = Math.max(0, 1 - Math.abs(i - head) / 4);
        return (
          <Text key={i} color={mix(PALETTE.teal, PALETTE.star, glow)}>
            {letter}
          </Text>
        );
      })}
    </>
  );
}

function describe(state: State) {
  if (state.questions.length > 0) return "Claude has a question for you";
  if (state.pending.length > 0) return "Waiting for your OK";
  const live = state.live;
  const block = live?.blocks.slice(live.finalized).findLast((b) => b !== undefined);
  if (block?.kind === "thinking") return "Thinking";
  if (block?.kind === "text") return "Writing";
  if (block?.kind === "tool") return `Getting ${toolLabel(block.name ?? "a tool")} ready`;
  const running = state.items.findLast((item) => item.kind === "tool" && item.call.status === "running");
  if (running?.kind === "tool") {
    const { call } = running;
    const what = call.name === "Bash" && typeof call.input.description === "string" ? call.input.description : toolTarget(call, state.cwd, state.home);
    return `Running ${toolLabel(call.name)}${what ? ` · ${what.split("\n")[0]}` : ""}`;
  }
  return "Working";
}
