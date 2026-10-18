// Messages you sent while Claude works, above the message box until Claude takes them. ↑ in an empty
// box takes them back to edit, as long as Claude hasn't started on them.
import { Box, Text } from "ink";
import type { Queued } from "../src/view/state";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
import { PALETTE } from "./theme";

const HINT = "↑ edits";
/** After a message sent with Ctrl+X Enter, which waits for the turn to end rather than joining it. */
const LATER = "  after this turn";

export function QueuedMessages({ queue, width }: { queue: Queued[]; width: number }) {
  if (!queue.length) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {queue.map((queued, i) => {
        const last = i === queue.length - 1;
        const room = width - 2 - 2 - (last ? cellWidth(HINT) + 2 : 0);
        const [first = ""] = queued.text.split("\n");
        const more = queued.text.includes("\n") ? " …" : "";
        return (
          <Box key={queued.uuid} justifyContent="space-between" width={width} paddingX={1}>
            <Text wrap="truncate-end">
              <Text color={PALETTE.gold}>{"◌ "}</Text>
              <Text color={PALETTE.haze}>{fit(`${first}${more}`, room - (queued.later ? cellWidth(LATER) : 0), false)}</Text>
              {queued.later ? <Text color={PALETTE.dust}>{LATER}</Text> : null}
            </Text>
            {last ? <Text color={PALETTE.dust}>{HINT}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
