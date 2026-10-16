// A row in a list you choose from: the command menu, pickers, permission options and Claude's
// questions. The chosen row is raised off the panel and marked in your color.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { PALETTE } from "./theme";

export function ChoiceRow({ selected, width, children }: { selected: boolean; width: number; children: ReactNode }) {
  return (
    <Box width={width} backgroundColor={selected ? PALETTE.raised : undefined}>
      <Text color={PALETTE.gold}>{selected ? "› " : "  "}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {children}
      </Box>
    </Box>
  );
}
