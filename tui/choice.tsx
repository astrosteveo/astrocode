// A row in a list you choose from: the command menu, pickers, permission options and Claude's
// questions. The chosen row is raised off the panel and marked in your color; the row under the
// pointer is raised halfway, with a dim mark.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { PALETTE } from "./theme";

export function ChoiceRow({ selected, hovered = false, width, children }: { selected: boolean; hovered?: boolean; width: number; children: ReactNode }) {
  return (
    <Box width={width} backgroundColor={selected ? PALETTE.raised : hovered ? PALETTE.hover : undefined}>
      <Text color={selected ? PALETTE.gold : PALETTE.dust}>{selected || hovered ? "› " : "  "}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {children}
      </Box>
    </Box>
  );
}
