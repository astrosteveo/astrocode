// The now line, over the box while Claude works: the running mark, what Claude is doing, how long
// that has gone on and the turn's tokens. A call is named as its activity line names it, in the
// present tense (`Running the tests`, `Reading src/retry.ts`), and Claude waits on a subagent. A
// request tried again says when and why, in ember. While Claude waits on you there's no now line:
// the decision in the box's place says so.
import { Box, Text } from "ink";
import { useRef } from "react";
import { activityRows } from "../src/view/activity";
import { compact, duration } from "../src/view/format";
import type { Retry, State, ToolCall } from "../src/view/state";
import { toolLabel } from "../src/view/tools";
import { markTurns, useMark } from "./mark";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
import { GUTTER } from "./rail";
import { PALETTE } from "./theme";

/**
 * What Claude is doing: `what`, in the mark's color, then what it acts on, in bright. `key` names
 * it, and its clock starts over as that changes; a call has run for `elapsed` seconds, as its
 * activity line says. `about` takes the place of the clock and tokens, as a retry's reason does.
 */
type Doing = { what: string; target?: string; path?: boolean; key: string; elapsed?: number; about?: string; color?: string };

const NOTHING: ReadonlySet<string> = new Set();

/** `stop`: the key that stops Claude where your keys are, Esc in the box. `background`: the one that moves what Claude waits on to the background. */
export function Activity({ state, width, stop = "esc", background = "ctrl+b" }: { state: State; width: number; stop?: string; background?: string | null }) {
  const shown = markTurns(state);
  const mark = useMark(shown);
  const doing = now(state);
  // Its clock starts when the line shows, so neither the wait between turns nor one for your OK counts.
  const since = useSince(shown ? doing.key : null);
  if (!shown) return null;
  const live = state.live?.blocks.slice(state.live.finalized).reduce((sum, block) => sum + (block?.text.length ?? 0), 0) ?? 0;
  const tokens = state.turnTokens + Math.round(live / 4);
  // Claude Code reports a call's seconds now and then, if at all, so the clock counts on between.
  const time = Math.max((doing.elapsed ?? 0) * 1000, Date.now() - since);
  const after = doing.about ?? ` · ${duration(time)}${tokens > 0 ? ` · ${compact(tokens)} tokens` : ""}`;
  const hint = [`${stop} to stop`, ...(background && movable(state) ? [`${background} background`] : [])].join("   ");
  const target = doing.target ? fit(doing.target, width - GUTTER - cellWidth(doing.what) - cellWidth(after) - cellWidth(hint) - 3, doing.path ?? false) : "";
  return (
    <Box justifyContent="space-between" width={width}>
      <Text wrap="truncate-end">
        <Text color={doing.color ?? PALETTE.teal}>{`${mark} ${doing.what}`}</Text>
        {target ? <Text color={PALETTE.star}>{` ${target}`}</Text> : null}
        <Text color={PALETTE.haze}>{after}</Text>
      </Text>
      <Text color={PALETTE.dust}>{hint}</Text>
    </Box>
  );
}

/**
 * Whether Claude waits on a command or subagent that can move to the background: Claude Code says
 * so once it has made it a task, in the foreground, a few seconds into a command.
 */
function movable(state: State) {
  return Object.values(state.taskInfo).some(
    (task) => MOVABLE.has(task.type) && task.status === "running" && !task.background && task.toolUseId !== undefined && state.tools[task.toolUseId] !== undefined,
  );
}

/** The tasks Ctrl+B moves; Claude Code says which of them are in the foreground. */
const MOVABLE = new Set(["local_bash", "local_agent"]);

/** When what `key` names started, as far as the now line has seen it. */
function useSince(key: string | null) {
  const since = useRef({ key, at: Date.now() });
  if (since.current.key !== key) since.current = { key, at: Date.now() };
  return since.current.at;
}

/** What Claude is doing, in a few words, as the now line says it: "Thinking", "Running the tests", "Waiting on Explore". */
export function describe(state: State) {
  const { what, target, about = "" } = now(state);
  return `${what}${target ? ` ${target}` : ""}${about}`;
}

function now(state: State): Doing {
  if (state.compacting) return { what: "Compacting", key: "compacting" };
  if (state.retry) return retrying(state.retry);
  const live = state.live;
  const block = live?.blocks.slice(live.finalized).findLast((b) => b !== undefined);
  if (block?.kind === "thinking") return { what: "Thinking", key: `thinking:${live!.messageId}` };
  if (block?.kind === "text") return { what: "Writing", key: `writing:${live!.messageId}` };
  if (block?.kind === "tool") return { what: `Getting ${toolLabel(block.name ?? "a tool")} ready`, key: `tool:${live!.messageId}` };
  const running = state.items.findLast((item) => item.kind === "tool" && item.call.status === "running");
  if (running?.kind !== "tool") return { what: "Working", key: "working" };
  const { call } = running;
  if (call.name === "Agent" || call.name === "Task") return { what: `Waiting on ${subagent(call)}`, key: call.id, elapsed: call.elapsed };
  const [row] = activityRows([call], NOTHING, state.cwd, state.home);
  // The faint `$ ` that tells a bare command from a description on its line would read as part of the command here.
  const parts = call.name === "Bash" && row!.target[0]?.text === "$ " ? row!.target.slice(1) : row!.target;
  return { what: row!.verb, target: parts.map((part) => part.text).join(""), path: row!.path, key: call.id, elapsed: call.elapsed };
}

/** The subagent a call started, by its kind (`Explore`), or `a subagent` for the general one. */
function subagent(call: ToolCall) {
  const type = call.input.subagent_type;
  return typeof type === "string" && type && type !== "general-purpose" ? type : "a subagent";
}

/** A request Claude Code tries again: when, then why and which attempt, as `Retrying in 8s · overloaded · attempt 2 of 10`. */
function retrying(retry: Retry): Doing {
  const left = Math.max(0, Math.ceil((retry.at + retry.delayMs - Date.now()) / 1000));
  const why = retry.status === null ? "no connection" : retry.error === "unknown" ? `error ${retry.status}` : retry.error.replace(/_/g, " ");
  return { what: left > 0 ? `Retrying in ${left}s` : "Retrying", about: ` · ${why} · attempt ${retry.attempt} of ${retry.max}`, key: "retry", color: PALETTE.ember };
}
