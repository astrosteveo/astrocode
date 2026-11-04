// Where your keys are: always in exactly one of four places, which has the gold mark. The message
// box has them unless something else does; Ctrl+O or a click moves them to the transcript, where a
// cursor moves over its lines (scrollback's opens in a viewer of its own); an overlay (a picker, a
// panel) takes them while it's open, and a decision (a permission prompt, Claude's question, an MCP
// form) takes them from all of those until you answer it. Whatever had them before gets them back.
import type { Action } from "./keys";

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

/**
 * The box's actions whose keys work wherever your keys are, as in `claude`: they still reach the
 * box while the transcript has your keys. Ctrl+O isn't one, since the transcript toggles with it
 * itself, nor is anything that edits or sends the message.
 */
export const ANYWHERE: ReadonlySet<Action> = new Set<Action>([
  "app:interrupt",
  "app:exit",
  "app:toggleTodos",
  "chat:killAgents",
  "chat:cycleMode",
  "chat:modelPicker",
  "chat:increaseEffort",
  "chat:decreaseEffort",
  "chat:thinkingToggle",
  "chat:fastMode",
  "task:background",
]);
