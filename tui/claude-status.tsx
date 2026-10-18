// /status: what Claude Code says about itself, in its own sections (the session, the account, the
// model, MCP servers, settings sources), and where astrocode keeps its own settings. Esc closes it.
import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { StatusSection } from "../src/dialogs";
import type { AgentSession } from "../src/session";
import { cellWidth } from "./markdown";
import { fit, Panel } from "./markdown-view";
import { PALETTE } from "./theme";

type Props = {
  session: AgentSession;
  /** astrocode's own, after Claude Code's. */
  own: StatusSection;
  width: number;
  onClose: () => void;
};

export function StatusPanel({ session, own, width, onClose }: Props) {
  const [sections, setSections] = useState<StatusSection[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    session.status().then(setSections, (error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
  }, []);

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.escape || key.return || (key.ctrl && input === "c")) onClose();
  });

  const all = [...(sections ?? []), own];
  const labels = Math.min(24, Math.max(0, ...all.flatMap((section) => section.rows.map((row) => cellWidth(row.label)))));
  const inner = width - 2;
  return (
    <Panel width={width} accent={PALETTE.gold}>
      <Text bold color={PALETTE.star}>
        Status
      </Text>
      {failure ? (
        <Box marginTop={1}>
          <Text color={PALETTE.rose}>{`Couldn't ask Claude Code how it is: ${failure}`}</Text>
        </Box>
      ) : sections === null ? (
        <Box marginTop={1}>
          <Text color={PALETTE.haze}>Loading…</Text>
        </Box>
      ) : null}
      {(sections ? all : []).map((section) => (
        <Box key={section.title} marginTop={1} flexDirection="column">
          <Text color={PALETTE.haze}>{section.title}</Text>
          {section.rows.map((row) => (
            <Text key={row.label} wrap="truncate-end">
              <Text color={PALETTE.haze}>{`  ${fit(row.label, labels, false).padEnd(labels)}  `}</Text>
              <Text color={PALETTE.star}>{fit(row.value, Math.max(4, inner - labels - 4), false)}</Text>
            </Text>
          ))}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={PALETTE.dust}>esc to close</Text>
      </Box>
    </Panel>
  );
}
