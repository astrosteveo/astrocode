// Where your keys are: always in exactly one of four places, which has the gold mark. The message
// box has them unless something else does; Ctrl+O or a click moves them to the transcript, where a
// cursor moves over its lines; an overlay (a picker, a panel, scrollback's inspector) takes them
// while it's open, and a decision (a permission prompt, Claude's question, an MCP form) takes them
// from all of those until you answer it. Whatever had them before gets them back.
export type Focus = "box" | "transcript" | "overlay" | "decision";

export type Claims = {
  /** A decision is open. */
  decision: boolean;
  /** An overlay is open. */
  overlay: boolean;
  /** The transcript was given your keys and hasn't given them back. */
  transcript: boolean;
};

export function focusOf({ decision, overlay, transcript }: Claims): Focus {
  if (decision) return "decision";
  if (overlay) return "overlay";
  if (transcript) return "transcript";
  return "box";
}
