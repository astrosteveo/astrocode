// /hooks: what runs when Claude Code does something, such as before each tool call: each hook's
// event, what it matches, where it's set and what it runs. It only shows them, as `claude`'s own
// /hooks does; they're changed in the settings files or plugins they come from.
import { Text } from "ink";
import { useEffect, useState } from "react";
import type { Hook, HooksListing } from "../src/dialogs";
import type { AgentSession } from "../src/session";
import { highlightCode } from "./highlight";
import { Manager, type Outcome, type Row } from "./manager";
import { onPanel, Panel } from "./markdown-view";
import { PALETTE } from "./theme";

type Props = {
  session: AgentSession;
  width: number;
  rows: number;
  onOutcome: (outcome: Outcome) => void;
  onClose: () => void;
};

export function HooksPanel({ session, width, rows, onOutcome, onClose }: Props) {
  const [listing, setListing] = useState<HooksListing | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    session.hooks().then(setListing, (error: unknown) => setFailure(`Couldn't ask Claude Code for its hooks: ${error instanceof Error ? error.message : String(error)}`));
  }, []);

  const rowOf = (hook: Hook, i: number): Row => {
    const summary = listing?.events[hook.event] ?? "";
    return {
      key: `${i}`,
      label: hook.event,
      note: [hook.matcher || "every time", hook.plugin || hook.where].join(" · "),
      description: hook.text,
      page: () => ({
        title: `${hook.event}${hook.matcher ? ` · ${hook.matcher}` : ""}`,
        description: summary ? `${summary}.` : undefined,
        facts: [hook.type, hook.plugin ? `from the plugin ${hook.plugin}` : "", hook.where, hook.timeout ? `stops after ${hook.timeout} s` : ""].filter(Boolean).join(" · "),
        body: (
          <Panel label={hook.label.toLowerCase()} width={width - 2} background={PALETTE.raised}>
            <Text>{hook.type === "command" ? onPanel(highlightCode(hook.text, "bash")) : hook.text}</Text>
          </Panel>
        ),
        actions: [],
        none: hook.plugin ? "It comes with its plugin: /plugins turns the plugin off." : "Hooks are changed in the settings file they're set in.",
      }),
    };
  };

  return (
    <Manager
      title="Hooks"
      lists={[{ key: "hooks", name: "Hooks", rows: listing ? listing.hooks.map(rowOf) : null, empty: "No hooks are set. They go under hooks in a settings file, or come with plugins." }]}
      failure={failure}
      width={width}
      rows={rows}
      onOutcome={onOutcome}
      onClose={onClose}
    />
  );
}
