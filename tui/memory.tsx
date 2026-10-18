// /memory: the CLAUDE.md files Claude Code reads and what auto-memory has saved for this project,
// each opened in your editor with Enter, and auto-memory itself, turned on or off for all your
// sessions with Claude Code's own `claude edit-memory-settings`.
import { useEffect, useState } from "react";
import { line, type MemoryDialog, type MemoryToggle } from "../src/dialogs";
import { setMemorySettings } from "../src/edits";
import type { AgentSession } from "../src/session";
import { ago } from "../src/view/format";
import { shortPath } from "../src/view/tools";
import { Manager, until, type Action, type Outcome, type Row } from "./manager";
import { PALETTE } from "./theme";

type Props = {
  session: AgentSession;
  cwd: string;
  home: string;
  width: number;
  rows: number;
  /** Opens a file in your editor, and resolves once the editor quits. */
  onEdit: (path: string) => Promise<void>;
  onOutcome: (outcome: Outcome) => void;
  onClose: () => void;
};

export function MemoryPanel({ session, cwd, home, width, rows, onEdit, onOutcome, onClose }: Props) {
  const [dialog, setDialog] = useState<MemoryDialog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = () =>
    session.memoryDialog().then(
      (next) => {
        setDialog(next);
        setFailure(null);
        return next;
      },
      (error: unknown) => {
        setFailure(`Couldn't ask Claude Code about its memory: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      },
    );

  useEffect(() => {
    void load();
  }, []);

  const edit = (path: string): Action => ({
    label: "Open in your editor",
    run: async () => {
      await onEdit(path);
      await load();
    },
  });

  const toggleRow = (key: "autoMemoryEnabled" | "autoDreamEnabled", label: string, toggle: MemoryToggle, about: string): Row => {
    const change: Action | undefined = toggle.toggleable
      ? {
          label: toggle.on ? "Turn off" : "Turn on",
          doing: `Turning ${label.toLowerCase()} ${toggle.on ? "off" : "on"}…`,
          run: async () => {
            const result = await setMemorySettings(cwd, { [key]: !toggle.on });
            if (!result.ok) return { ok: false, message: result.message };
            const which = key === "autoMemoryEnabled" ? "autoMemory" : "autoDream";
            await until(async () => (await session.memoryDialog())[which]?.on === !toggle.on);
            await load();
            return { ok: true, message: `${label} is ${toggle.on ? "off" : "on"} for all your sessions.` };
          },
        }
      : undefined;
    return {
      key,
      label,
      mark: toggle.on ? { glyph: "●", color: PALETTE.teal } : { glyph: "○", color: PALETTE.dust },
      note: [toggle.status, toggle.detail, toggle.toggleable ? "" : "can't be changed here"].filter(Boolean).join(" · "),
      description: about,
      dim: !toggle.on,
      act: change,
      space: change,
    };
  };

  const rowsOf = (dialog: MemoryDialog): Row[] => [
    ...dialog.files.map(
      (file): Row => ({
        key: `file:${file.path}`,
        label: file.label,
        mark: file.exists ? { glyph: "●", color: PALETTE.teal } : { glyph: "○", color: PALETTE.dust },
        note: [shortPath(file.path, cwd, home), file.exists ? "" : "not made yet"].filter(Boolean).join(" · "),
        description: file.description,
        act: edit(file.path),
      }),
    ),
    ...dialog.memories.map(
      (memory): Row => ({
        key: `memory:${memory.path}`,
        label: memory.name,
        mark: { glyph: "·", color: PALETTE.dust },
        note: [memory.type, memory.modified ? ago(memory.modified) : ""].filter(Boolean).join(" · "),
        description: memory.description,
        act: edit(memory.path),
      }),
    ),
    toggleRow("autoMemoryEnabled", "Auto-memory", dialog.autoMemory, "Claude saves what's worth remembering about you and this project, and reads it back in later sessions."),
    ...(dialog.autoDream ? [toggleRow("autoDreamEnabled", "Auto-dream", dialog.autoDream, "Claude tidies its saved memories now and then, in the background.")] : []),
  ];

  return (
    <Manager
      title="Memory"
      lists={[{ key: "memory", name: "Memory", rows: dialog ? rowsOf(dialog) : null, empty: "Claude Code has no memory files here.", counted: false }]}
      failure={failure}
      width={width}
      rows={rows}
      footnote={
        dialog
          ? `Claude Code reads these as a session starts.${dialog.folder ? ` Auto-memory keeps its notes in ${line(shortPath(dialog.folder, cwd, home))}.` : ""}`
          : undefined
      }
      onOutcome={onOutcome}
      onClose={onClose}
    />
  );
}
