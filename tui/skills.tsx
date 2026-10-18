// /skills: the skills Claude Code has loaded, where each comes from and what its listing costs in
// the system prompt, and how much of each Claude sees. Space turns one on or off; Enter offers all
// four states. A change goes through Claude Code's own `claude edit-skill-overrides`, which keeps
// it for you in this project's .claude/settings.local.json, as `claude`'s /skills does.
import { useEffect, useState } from "react";
import { type Skill, type SkillState } from "../src/dialogs";
import { setSkillState } from "../src/edits";
import type { AgentSession } from "../src/session";
import { Manager, until, type Action, type Outcome, type Row } from "./manager";
import { PALETTE } from "./theme";

const STATES: Record<SkillState, { label: string; note: string; words: string; glyph: string; color: string }> = {
  on: { label: "On", note: "Claude sees its name and description", words: "on", glyph: "●", color: PALETTE.teal },
  "name-only": { label: "Name only", note: "Claude sees its name, without the description", words: "name only", glyph: "◐", color: PALETTE.teal },
  "user-invocable-only": { label: "Yours only", note: "hidden from Claude; its /command still runs it", words: "yours only", glyph: "◑", color: PALETTE.haze },
  off: { label: "Off", note: "hidden from Claude and the / menu", words: "off", glyph: "○", color: PALETTE.dust },
};

const LOCKS: Record<string, string> = {
  author: "Its own file keeps Claude from using it, so its state can't be changed here.",
  plugin: "It comes with a plugin: /plugins turns the plugin off.",
  policy: "Managed settings set its state.",
  flag: "Settings passed with --settings set its state.",
  "reserved-name": "Settings can't keep a state under its name; renaming its folder or file would let them.",
};

type Props = {
  session: AgentSession;
  cwd: string;
  width: number;
  rows: number;
  onOutcome: (outcome: Outcome) => void;
  onClose: () => void;
};

export function SkillsPanel({ session, cwd, width, rows, onOutcome, onClose }: Props) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = () =>
    session.skills().then(
      (next) => {
        setSkills(next);
        setFailure(null);
      },
      (error: unknown) => setFailure(`Couldn't ask Claude Code for its skills: ${error instanceof Error ? error.message : String(error)}`),
    );

  useEffect(() => {
    void load();
  }, []);

  const set = (skill: Skill, state: SkillState): Action => ({
    label: STATES[state].label,
    note: STATES[state].note,
    current: skill.state === state,
    doing: `Setting ${skill.title} to ${STATES[state].words}…`,
    run: async () => {
      if (skill.state === state) return;
      const result = await setSkillState(cwd, skill, state);
      if (!result.ok) return { ok: false, message: result.message };
      await until(async () => (await session.skills()).find((one) => one.name === skill.name)?.state === state);
      await load();
      return { ok: true, message: `${skill.title} is ${STATES[state].words} in this project.` };
    },
  });

  const rowOf = (skill: Skill): Row => {
    const state = STATES[skill.state];
    const lock = skill.lockedBy ? (LOCKS[skill.lockedBy] ?? "Its state is set somewhere that can't be changed here.") : undefined;
    return {
      key: skill.name,
      label: skill.title,
      mark: { glyph: state.glyph, color: state.color },
      note: [skill.source, skill.tokens ? `~${tokens(skill.tokens)} tokens` : "", skill.state === "on" ? "" : state.words, lock ? "locked" : ""].filter(Boolean).join(" · "),
      description: skill.description,
      dim: skill.state === "off",
      space: lock ? undefined : { ...set(skill, skill.state === "on" ? "off" : "on"), label: skill.state === "on" ? "Turn off" : "Turn on" },
      page: () => ({
        title: skill.title,
        description: skill.description,
        facts: [skill.name, skill.source, skill.tokens ? `~${tokens(skill.tokens)} tokens in the system prompt` : "", state.words].filter(Boolean).join(" · "),
        actions: lock ? [] : (Object.keys(STATES) as SkillState[]).map((one) => set(skill, one)),
        none: lock,
      }),
    };
  };

  const listed = skills?.filter((skill) => skill.state === "on" || skill.state === "name-only").reduce((sum, skill) => sum + skill.tokens, 0) ?? 0;
  return (
    <Manager
      title="Skills"
      lists={[{ key: "skills", name: "Skills", rows: skills ? skills.map(rowOf) : null, empty: "Claude Code has no skills loaded here." }]}
      failure={failure}
      width={width}
      rows={rows}
      footnote={skills?.length ? `Their listings take ~${tokens(listed)} tokens of the system prompt. Changes are kept for you in this project, in .claude/settings.local.json.` : undefined}
      onOutcome={onOutcome}
      onClose={onClose}
    />
  );
}

function tokens(count: number) {
  return count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${count}`;
}
