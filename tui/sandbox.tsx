// /sandbox: whether the commands Claude runs are fenced in, writing only in the project and
// reaching only the domains allowed, and how: sandboxed and allowed without asking, sandboxed with
// the usual permissions, or not at all. Also whether a command that fails in it may run again
// outside it, the commands that always run outside it (typing one adds it), and what it lets
// through. Changes go through Claude Code's own `claude edit-sandbox-settings`, which keeps them
// for you in .claude/settings.local.json.
import { useEffect, useState } from "react";
import type { SandboxDialog, SandboxMode } from "../src/dialogs";
import { setSandbox } from "../src/edits";
import type { AgentSession } from "../src/session";
import { Manager, until, type Action, type Outcome, type Row } from "./manager";
import { PALETTE } from "./theme";

const MODES: { mode: SandboxMode; label: string; about: string }[] = [
  { mode: "auto-allow", label: "Sandboxed, without asking", about: "Commands run in the sandbox without asking first; one that needs more than it allows asks as usual." },
  { mode: "regular", label: "Sandboxed, asking as usual", about: "Commands run in the sandbox, and your permission rules and prompts apply as they would without it." },
  { mode: "disabled", label: "No sandbox", about: "Commands run with everything you can reach yourself." },
];

/** Claude Code's setting names for what the sandbox lets through. */
const RESTRICTIONS: Record<string, string> = {
  fs_deny_read: "Can't read",
  fs_allow_read: "Can read again",
  fs_allow_write: "Can also write",
  fs_deny_write: "Can't write",
  network_allowed_domains: "Can reach",
  network_denied_domains: "Can't reach",
  unix_sockets: "Sockets",
  ignored_glob_patterns: "Ignored patterns",
};

type Props = {
  session: AgentSession;
  cwd: string;
  width: number;
  rows: number;
  onOutcome: (outcome: Outcome) => void;
  onClose: () => void;
};

export function SandboxPanel({ session, cwd, width, rows, onOutcome, onClose }: Props) {
  const [dialog, setDialog] = useState<SandboxDialog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = () =>
    session.sandbox().then(
      (next) => {
        setDialog(next);
        setFailure(next.supported ? null : "Sandboxing isn't available on this platform.");
      },
      (error: unknown) => setFailure(`Couldn't ask Claude Code about the sandbox: ${error instanceof Error ? error.message : String(error)}`),
    );

  useEffect(() => {
    void load();
  }, []);

  /** Runs an edit, waits for Claude Code to see it, reads the sandbox again, and says how it went. */
  const change = (edit: Parameters<typeof setSandbox>[1], landed: (next: SandboxDialog) => boolean, said: string): Action["run"] => async () => {
    const result = await setSandbox(cwd, edit);
    if (!result.ok) return { ok: false, message: result.message };
    await until(async () => landed(await session.sandbox()));
    await load();
    return { ok: true, message: said };
  };

  const modeRows = (dialog: SandboxDialog): Row[] =>
    MODES.filter(({ mode }) => mode !== "auto-allow" || dialog.autoAllowAvailable || dialog.mode === mode).map(({ mode, label, about }): Row => {
      const current = dialog.mode === mode;
      return {
        key: mode,
        label,
        mark: current ? { glyph: "●", color: PALETTE.teal } : { glyph: "○", color: PALETTE.dust },
        note: current ? (dialog.running || mode === "disabled" ? "current" : "current, not running yet") : "",
        description: about,
        act:
          current || dialog.locked
            ? undefined
            : {
                label: "Use this",
                doing: "Changing the sandbox…",
                run: change({ mode }, (next) => next.mode === mode, mode === "disabled" ? "The sandbox is off for you in this project." : `Commands run ${label.toLowerCase()}, for you in this project.`),
              },
      };
    });

  /** Whether a failed command may run again outside the sandbox, and the commands that always run outside it. */
  const outsideRows = (dialog: SandboxDialog): Row[] => {
    const fallback: Action | undefined = dialog.fallbackLocked
      ? undefined
      : {
          label: dialog.fallback ? "Turn off" : "Turn on",
          doing: "Changing the sandbox…",
          run: change(
            { allowUnsandboxedCommands: !dialog.fallback },
            (next) => next.fallback === !dialog.fallback,
            dialog.fallback ? "A command that fails in the sandbox stays failed." : "A command that fails in the sandbox may run again outside it, asking first.",
          ),
        };
    return [
      {
        key: "fallback",
        label: "Retry what fails",
        mark: dialog.fallback ? { glyph: "●", color: PALETTE.teal } : { glyph: "○", color: PALETTE.dust },
        note: [dialog.fallback ? "on" : "off", dialog.fallbackLocked ? "set elsewhere" : ""].filter(Boolean).join(" · "),
        description: "A command that fails in the sandbox may run again outside it, asking you first.",
        dim: !dialog.fallback,
        act: fallback,
        space: fallback,
      },
      ...dialog.excluded.map(
        (pattern): Row => ({
          key: `excluded:${pattern}`,
          label: pattern,
          mark: { glyph: "·", color: PALETTE.dust },
          note: "always runs outside it",
        }),
      ),
    ];
  };

  const allowedRows = (dialog: SandboxDialog): Row[] =>
    dialog.restrictions.map(({ name, values }) => ({
      key: name,
      label: RESTRICTIONS[name] ?? name,
      note: values.join(", "),
      description: values.join(", "),
    }));

  const warning = dialog?.errors.length
    ? `The sandbox can't run until these are installed: ${dialog.errors.join("; ")}`
    : dialog?.warnings.length
      ? `It runs with less isolation without: ${dialog.warnings.join("; ")}`
      : undefined;
  const shown = dialog?.supported ? dialog : null;
  return (
    <Manager
      title="Sandbox"
      lists={[
        { key: "mode", name: "Mode", rows: shown ? modeRows(shown) : dialog ? [] : null, empty: "Sandboxing isn't available on this platform.", counted: false },
        {
          key: "outside",
          name: "Outside it",
          rows: shown ? outsideRows(shown) : dialog ? [] : null,
          empty: "Sandboxing isn't available on this platform.",
          hint: "type a command to run it outside",
          counted: false,
          add: (text) =>
            shown && !shown.excluded.includes(text)
              ? {
                  key: "add",
                  label: `Run ${text} outside the sandbox`,
                  mark: { glyph: "+", color: PALETTE.teal },
                  act: {
                    label: "Add it",
                    doing: `Adding ${text}…`,
                    run: change({ excludeCommand: text }, (next) => next.excluded.length > shown.excluded.length, `${text} runs outside the sandbox, for you in this project.`),
                  },
                }
              : null,
        },
        {
          key: "allowed",
          name: "Lets through",
          rows: shown ? allowedRows(shown) : dialog ? [] : null,
          empty: "Only its defaults. The sandbox section of a settings file adds paths, domains and sockets.",
        },
      ]}
      failure={failure}
      warning={warning}
      width={width}
      rows={rows}
      footnote={
        shown ? `${shown.locked ? "Higher-priority settings set the sandbox here, so its mode can't be changed. " : ""}Changes are kept for you in this project, in .claude/settings.local.json.` : undefined
      }
      onOutcome={onOutcome}
      onClose={onClose}
    />
  );
}
