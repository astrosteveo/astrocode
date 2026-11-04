// The line over the box while Claude works: a cell in orbit, what Claude is doing with light
// passing over the words, the time so far and the tokens written. While a tool runs, it names the
// call, so you needn't look for it above; while a request is tried again, it says when and why.
// While it waits on you there's no line: the decision in the box's place says so.
import { Box, Text, useAnimation } from "ink";
import { compact, duration } from "../src/view/format";
import type { Retry, State } from "../src/view/state";
import { toolLabel, toolTarget } from "../src/view/tools";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
import { GUTTER } from "./entries";
import { mix, PALETTE } from "./theme";

/**
 * A gap going round a full braille cell. A single dot going round was too faint to see at most
 * font sizes; seven lit dots read as a solid mark that turns.
 */
const ORBIT = ["⣾", "⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽"];

/** `stop`: the key that stops Claude where your keys are, Esc in the box. */
export function Activity({ state, width, stop = "esc" }: { state: State; width: number; stop?: string }) {
  const waiting = state.pending.length > 0 || state.questions.length > 0 || state.elicitations.length > 0;
  // The clock runs on while Claude waits on you, so the turn's time goes on from where it was.
  const { frame, time } = useAnimation({ interval: 90, isActive: state.busy || waiting });
  if (!state.busy || waiting) return null;
  const live = state.live?.blocks.slice(state.live.finalized).reduce((sum, block) => sum + (block?.text.length ?? 0), 0) ?? 0;
  const tokens = state.turnTokens + Math.round(live / 4);
  const stats = `   ${duration(time)}${tokens > 0 ? `   ${compact(tokens)} tokens` : ""}`;
  const hint = `${stop} to stop`;
  const label = fit(describe(state), width - GUTTER - cellWidth(stats) - cellWidth(hint) - 2, false);
  return (
    <Box justifyContent="space-between" width={width}>
      <Text>
        <Text color={PALETTE.teal}>{(ORBIT[frame % ORBIT.length] ?? "").padEnd(GUTTER)}</Text>
        <Sweep text={label} frame={frame} />
        <Text color={PALETTE.haze}>{stats}</Text>
      </Text>
      <Text color={PALETTE.dust}>{hint}</Text>
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

/** What Claude is doing, in a few words: "Thinking", "Running Bash · the test suite", "Waiting for your OK". */
export function describe(state: State) {
  if (state.questions.length > 0) return "Claude has a question for you";
  if (state.elicitations.length > 0) return `${state.elicitations[0]?.server ?? "An MCP server"} is asking you something`;
  if (state.pending.length > 0) return "Waiting for your OK";
  if (state.compacting) return "Compacting the conversation";
  if (state.retry) return retrying(state.retry);
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

/** A request Claude Code tries again: when, which attempt, and why, as `Retrying in 8s (2 of 10) · overloaded`. */
function retrying(retry: Retry) {
  const left = Math.max(0, Math.ceil((retry.at + retry.delayMs - Date.now()) / 1000));
  const why = retry.status === null ? "no connection" : `${retry.status} ${retry.error.replace(/_/g, " ")}`;
  return `${left > 0 ? `Retrying in ${left}s` : "Retrying"} (${retry.attempt} of ${retry.max}) · ${why}`;
}
