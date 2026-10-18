// /permissions: the rules that decide what Claude may do without asking, what it must ask about
// and what it may never do, with where each comes from, and the folders it may work in besides the
// project. Type a rule to add it to a settings file; Enter on one in a settings file removes it.
// Both go through Claude Code's own `claude edit-permission-rules`, which checks the rule's form.
import { useEffect, useState } from "react";
import { line, type Behavior, type PermissionRule, type PermissionRules, type SettingsFile } from "../src/dialogs";
import { addRule, removeRule } from "../src/edits";
import type { AgentSession } from "../src/session";
import { shortPath } from "../src/view/tools";
import { Manager, until, type List, type Outcome, type Row } from "./manager";
import { PALETTE } from "./theme";

/** Where a rule or folder came from. */
const SOURCES: Record<string, string> = {
  localSettings: "for you, here only",
  projectSettings: "for this project",
  userSettings: "for you",
  session: "for this session",
  cliArg: "from the command line",
  command: "from a command",
  flagSettings: "from --settings",
  policySettings: "managed",
};

/** Where an added rule can go, and the file that is. */
const DESTINATIONS: { file: SettingsFile; label: string; note: string }[] = [
  { file: "localSettings", label: "Add for you, here only", note: ".claude/settings.local.json" },
  { file: "projectSettings", label: "Add for this project", note: "for everyone, in .claude/settings.json" },
  { file: "userSettings", label: "Add for you, in every project", note: "~/.claude/settings.json" },
];

const LISTS: { behavior: Behavior; name: string; words: string; empty: string }[] = [
  { behavior: "allow", name: "Allow", words: "allowed without asking", empty: "No allow rules. Type one, such as Bash(npm test:*), to let Claude do that without asking." },
  { behavior: "ask", name: "Ask", words: "asked about every time", empty: "No ask rules. Type one, such as Bash(git push:*), to have Claude ask every time." },
  { behavior: "deny", name: "Deny", words: "never allowed", empty: "No deny rules. Type one, such as Read(./.env), to keep Claude from it." },
];

type Props = {
  session: AgentSession;
  cwd: string;
  home: string;
  width: number;
  rows: number;
  onOutcome: (outcome: Outcome) => void;
  onClose: () => void;
};

export function PermissionsPanel({ session, cwd, home, width, rows, onOutcome, onClose }: Props) {
  const [rules, setRules] = useState<PermissionRules | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = () =>
    session.permissionRules().then(
      (next) => {
        setRules(next);
        setFailure(null);
      },
      (error: unknown) => setFailure(`Couldn't ask Claude Code for its rules: ${error instanceof Error ? error.message : String(error)}`),
    );

  useEffect(() => {
    void load();
  }, []);

  /** Runs an edit, waits for Claude Code to see it, reads the rules again, and says how it went. */
  const edit = (run: () => ReturnType<typeof addRule>, said: string, landed: (next: PermissionRules) => boolean) => async (): Promise<Outcome> => {
    const result = await run();
    if (result.ok) await until(async () => landed(await session.permissionRules()));
    await load();
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: [said, ...(result.warnings ?? [])].join(" ") };
  };

  const ruleRow = (rule: PermissionRule, words: string): Row => {
    const shown = line(rule.rule);
    const reading = rule.reading ? `${rule.reading.prefix}${rule.reading.emphasis}${rule.reading.suffix}` : "";
    const where = SOURCES[rule.source] ?? rule.source;
    return {
      key: `${rule.behavior}:${rule.source}:${rule.rule}`,
      label: shown,
      note: [where, rule.ignored ? "ignored" : ""].filter(Boolean).join(" · "),
      description: reading,
      dim: rule.ignored,
      page: () => ({
        title: shown,
        description: reading || undefined,
        facts: [words, where, rule.ignored ? "ignored, since managed settings allow only their own rules" : ""].filter(Boolean).join(" · "),
        actions: rule.removable
          ? [
              {
                label: "Remove",
                note: `from ${fileOf(rule.source)}`,
                doing: `Removing ${shown}…`,
                run: edit(
                  () => removeRule(cwd, rule.rule, rule.behavior, rule.source),
                  `Removed ${shown} from the ${rule.behavior} rules.`,
                  (next) => !next.rules.some((one) => one.behavior === rule.behavior && one.source === rule.source && one.rule === rule.rule),
                ),
              },
            ]
          : [],
        none:
          rule.source === "session"
            ? "This rule is for this session only, and goes when it ends."
            : `This rule comes ${where === rule.source ? `from ${rule.source}` : where}, which can't be changed here.`,
      }),
    };
  };

  const addRow = (behavior: Behavior, words: string) => (text: string): Row | null => {
    if (!rules || rules.managedOnly) return null;
    if (rules.rules.some((rule) => rule.behavior === behavior && rule.rule === text)) return null;
    const shown = line(text);
    return {
      key: "add",
      label: `Add ${shown}`,
      mark: { glyph: "+", color: PALETTE.teal },
      page: () => ({
        title: `Add ${shown}`,
        facts: words,
        actions: DESTINATIONS.map(({ file, label, note }) => ({
          label,
          note,
          doing: `Adding ${shown}…`,
          run: edit(
            () => addRule(cwd, text, behavior, file),
            `Added ${shown} to the ${behavior} rules in ${fileOf(file)}.`,
            // Claude Code may store the rule in another spelling, so it's known by the count.
            (next) => count(next, behavior, file) > count(rules, behavior, file),
          ),
        })),
      }),
    };
  };

  const lists: List[] = [
    ...LISTS.map(({ behavior, name, words, empty }) => ({
      key: behavior,
      name,
      rows: rules ? rules.rules.filter((rule) => rule.behavior === behavior).map((rule) => ruleRow(rule, words)) : null,
      empty,
      hint: rules?.managedOnly ? "type to filter" : "type to filter, or a rule to add",
      add: addRow(behavior, words),
    })),
    {
      key: "folders",
      name: "Folders",
      rows: rules
        ? rules.directories.map((folder) => {
            const where = SOURCES[folder.source] ?? folder.source;
            const path = shortPath(folder.path, cwd, home);
            return {
              key: `${folder.source}:${folder.path}`,
              label: line(path),
              note: where,
              page: () => ({
                title: line(path),
                facts: `Claude may work here besides the project · ${where}`,
                actions: [],
                none: "Folders come from additionalDirectories in a settings file, --add-dir, or an answer this session.",
              }),
            };
          })
        : null,
      empty: "Claude works only in the project's own folder.",
    },
  ];

  return (
    <Manager
      title="Permissions"
      lists={lists}
      failure={failure}
      width={width}
      rows={rows}
      footnote={rules?.managedOnly ? "Managed settings allow only their own rules, so rules from other settings are ignored and none can be added here." : undefined}
      onOutcome={onOutcome}
      onClose={onClose}
    />
  );
}

function count(rules: PermissionRules, behavior: Behavior, source: string) {
  return rules.rules.filter((rule) => rule.behavior === behavior && rule.source === source).length;
}

/** The settings file a source is, as the project sees it. */
function fileOf(source: string) {
  switch (source) {
    case "localSettings":
      return ".claude/settings.local.json";
    case "projectSettings":
      return ".claude/settings.json";
    case "userSettings":
      return "~/.claude/settings.json";
    default:
      return SOURCES[source] ?? source;
  }
}
