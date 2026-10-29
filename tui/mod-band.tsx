// The band above the message box where mods draw, as Claude Code's terminal has one: whatever
// mods draw at its `AbovePrompt` site, asked for again whenever a mod says it changed, Claude starts
// or stops working, or the room for it changes. With no mod drawing there, it takes no room.
import { Box } from "ink";
import { useEffect, useReducer, useRef, useState } from "react";
import type { AgentSession, ModNode } from "../src/session";
import { ModTree } from "./mod-tree";

type Props = { session: AgentSession; width: number; rows: number; working: boolean };

export function ModBand({ session, width, rows, working }: Props) {
  // Claude Code's terminal gives the band up to half the screen, the message box's rows included.
  const maxRows = Math.max(3, Math.floor(rows / 2) - 6);
  const bodyColumns = Math.max(10, width - 2);
  const tree = useModDrawing(session, "AbovePrompt", "above-prompt", {
    hasSurvey: false,
    isWorking: working,
    maxRows,
    bodyColumns,
    scroll: { offset: 0, bodyRows: maxRows },
    view: {},
  });
  if (!tree) return null;
  return (
    <Box paddingX={1} marginTop={1} flexDirection="column">
      <Box flexDirection="column" width={bodyColumns}>
        <ModTree node={tree} width={bodyColumns} onPress={(press, key) => void session.pressMod(press, key).catch(() => {})} />
      </Box>
    </Box>
  );
}

/**
 * What mods draw at `component` for `instance`, asked again when the props change or a mod says
 * its drawing did. An ask while one is out waits for it, and only the latest is asked then.
 */
export function useModDrawing(session: AgentSession, component: string, instance: string, props: Record<string, unknown>) {
  const [tree, setTree] = useState<ModNode | null>(null);
  const [version, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => session.watchMods(changed), [session]);
  const asking = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false });
  const latest = useRef(props);
  latest.current = props;
  const key = JSON.stringify(props);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    const state = asking.current;
    if (state.busy) {
      state.again = true;
      return;
    }
    const ask = () => {
      state.busy = true;
      state.again = false;
      session
        .drawMod(component, instance, latest.current)
        .then((drawn) => {
          if (mounted.current && !state.again) setTree(drawn);
        })
        .catch(() => {})
        .finally(() => {
          state.busy = false;
          if (mounted.current && state.again) ask();
        });
    };
    ask();
  }, [session, component, instance, key, version]);
  return tree;
}
