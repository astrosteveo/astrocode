// What mods draw in the transcript: a tool call's result (`ToolResult`), such as a review's findings,
// and a slash command's output (`CommandOutput`). Each finished call and command output is asked
// about once, and the latest are asked about again whenever a mod says its drawings changed. What
// comes back goes on the item, which both layouts draw from.
import { useEffect, useReducer, useRef } from "react";
import type { AgentSession } from "../src/session";
import type { State, ViewEvent } from "../src/view/state";

/** How many of the latest calls and command outputs are asked about, as they come and as mods change. */
const RECENT = 40;
/** The most of a call's result handed to mods, as Claude Code caps it. */
const OUTPUT_MOST = 64 * 1024;

type Site = { id: string; of: { tool: string } | { command: string }; drawn: boolean; props: () => { component: string; props: Record<string, unknown> } };

export function useModCards(session: AgentSession, state: State, emit: (event: ViewEvent) => void) {
  const asked = useRef(new Set<string>());
  const [version, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => session.watchMods(changed), [session]);
  const seen = useRef(version);
  useEffect(() => {
    const again = seen.current !== version;
    seen.current = version;
    const sites = sitesOf(state);
    sites.forEach((site, i) => {
      const recent = i >= sites.length - RECENT;
      const fresh = !asked.current.has(site.id);
      if (!(fresh ? recent : again && (recent || site.drawn))) return;
      asked.current.add(site.id);
      const { component, props } = site.props();
      session
        .drawMod(component, site.id, props)
        .then((tree) => emit({ kind: "modDrawing", of: site.of, tree }))
        .catch(() => {});
    });
  }, [state.items, version]);
}

/** The transcript's finished tool calls and command outputs, oldest first. */
function sitesOf(state: State): Site[] {
  const sites: Site[] = [];
  for (const item of state.items) {
    if (item.kind === "tool" && item.call.status !== "running") {
      const { call } = item;
      sites.push({
        id: call.id,
        of: { tool: call.id },
        drawn: call.drawing !== undefined,
        props: () => ({
          component: "ToolResult",
          props: { tool_use_id: call.id, tool: call.name, output: outputOf(call.output, call.result), isErrored: call.status !== "done", isExpanded: false },
        }),
      });
    } else if (item.kind === "text" && item.command) {
      const { command } = item;
      sites.push({
        id: command.uuid,
        of: { command: command.uuid },
        drawn: item.drawing !== undefined,
        props: () => ({ component: "CommandOutput", props: { command: command.name, args: command.args, text: item.text, isErrored: false } }),
      });
    }
  }
  return sites;
}

/** A call's result as mods are handed it: Claude Code's structured result where it fits, else its text, cut to the cap. */
function outputOf(output: unknown, result: string | undefined) {
  if (output !== undefined) {
    const size = JSON.stringify(output)?.length ?? 0;
    if (size <= OUTPUT_MOST) return output;
  }
  return (result ?? "").slice(0, OUTPUT_MOST);
}
