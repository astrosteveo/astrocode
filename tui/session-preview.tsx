// The end of a saved session, under /resume's list while it's chosen: your last message and
// Claude's last words. It's read once the choice settles, so holding ↓ doesn't read every session
// passed on the way, and kept for when the choice comes back to it.
import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { sessionPreview, type SessionPreview as Preview } from "../src/history";
import { plural } from "../src/view/tools";
import { PALETTE } from "./theme";

/** How long the choice has to stay on a session before it's read. */
const SETTLE_MS = 120;
/** Rows the preview always takes, so the list above it doesn't move as previews come and go. */
export const PREVIEW_ROWS = 3;

const read = new Map<string, Promise<Preview | null>>();

export function SessionPreview({ id, cwd, width }: { id: string; cwd: string; width: number }) {
  const [shown, setShown] = useState<{ id: string; preview: Preview | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      let pending = read.get(id);
      if (!pending) {
        pending = sessionPreview(id, cwd).catch(() => null);
        read.set(id, pending);
      }
      void pending.then((preview) => {
        if (alive) setShown({ id, preview });
      });
    };
    const timer = setTimeout(load, read.has(id) ? 0 : SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, cwd]);

  const preview = shown?.id === id ? shown.preview : undefined;
  const line = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
  return (
    <Box flexDirection="column" height={PREVIEW_ROWS} width={width}>
      {preview === undefined ? (
        <Text color={PALETTE.dust}>Reading…</Text>
      ) : preview === null ? (
        <Text color={PALETTE.dust}>Couldn't read this session.</Text>
      ) : (
        <>
          <Text wrap="truncate-end">
            <Text color={PALETTE.gold}>{"You     "}</Text>
            <Text>{line(preview.lastPrompt) || "nothing yet"}</Text>
            <Text color={PALETTE.dust}>{preview.prompts > 1 ? `   last of ${plural(preview.prompts, "message")}` : ""}</Text>
          </Text>
          <Box height={2} overflow="hidden">
            <Text wrap="wrap">
              <Text color={PALETTE.teal}>{"Claude  "}</Text>
              <Text color={PALETTE.haze}>{line(preview.lastReply) || "nothing yet"}</Text>
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
