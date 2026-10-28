// One thing running alongside the conversation, opened from /tasks, the status bar or its card: a
// command's or Monitor's output as it streams, a subagent's progress and the end of its own
// transcript, or a workflow's phases and agents. Opening it never stops it. Only `x`, or a click on
// Stop in full screen, does; `b` moves a subagent Claude waits on to the background, ← goes back to
// the list and Esc closes.
import { Box, Text, useInput, type DOMElement } from "ink";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { AgentSession } from "../src/session";
import { compact, duration } from "../src/view/format";
import { agentLines, type AgentLine } from "../src/view/agents";
import type { Running } from "../src/view/runs";
import type { WorkflowAgent, WorkflowPhase } from "../src/view/state";
import { settle } from "../src/view/terminal";
import { plural } from "../src/view/tools";
import { highlightCode } from "./highlight";
import { cellWidth, printable, printableColored } from "./markdown";
import { fit, onPanel, Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { TONES } from "./shell-card";
import { PALETTE } from "./theme";

/** How often a running task's output is read again. */
const POLL_MS = 1000;
/** How often a running subagent's transcript is read again, from disk. */
const TRANSCRIPT_MS = 2000;

export const RUNNING_STATUS = {
  running: { glyph: "◌", tone: "claude" },
  completed: { glyph: "✓", tone: "claude" },
  failed: { glyph: "✕", tone: "failed" },
  stopped: { glyph: "■", tone: "stopped" },
} as const;

type Props = {
  /** What's open, as it is now; undefined once it's gone, as after /clear. */
  entry: Running | undefined;
  /** Your command's output, which astrocode has; a task's is read from Claude Code. */
  shellOutput?: string;
  /** A subagent's transcript as Claude Code forwarded it, where it did; else it's read from disk. */
  log?: AgentLine[];
  session: AgentSession;
  width: number;
  /** Rows of output shown. */
  rows: number;
  onStop: (entry: Running) => void;
  /** Moves a subagent Claude waits on to the background, so Claude goes on without it. */
  onBackground: (entry: Running) => void;
  onBack: () => void;
  onClose: () => void;
};

export function TaskView({ entry, shellOutput, log, session, width, rows, onStop, onBackground, onBack, onClose }: Props) {
  const running = entry?.status === "running";
  const now = useNow(running);
  const read = useTaskOutput(session, entry?.hasOutput ? entry.taskId : undefined, running);
  const saved = useSubagentTranscript(session, log?.length ? undefined : entry?.agentId, running);
  const transcript = log?.length ? log : saved;
  const [stopping, setStopping] = useState(false);
  const stopButton = useRef<DOMElement>(null);
  const backButton = useRef<DOMElement>(null);

  const stop = () => {
    if (!entry || !running || stopping) return;
    setStopping(true);
    onStop(entry);
  };

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.escape || (key.ctrl && input === "c")) return onClose();
    if (key.leftArrow || key.backspace) return onBack();
    if (input === "x") return stop();
    if (input === "b" && entry?.foreground && !stopping) return onBackground(entry);
  });

  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left") return;
    if (hit(stopButton.current, event)) {
      event.handled = true;
      return stop();
    }
    if (hit(backButton.current, event)) {
      event.handled = true;
      return onBack();
    }
  });
  const overStop = useHover(stopButton, () => ({ key: "stop", shape: "pointer" }), running);
  const overBack = useHover(backButton, () => ({ key: "back", shape: "pointer" }));

  const inner = width - 2;
  if (!entry) {
    return (
      <Panel width={width} accent={PALETTE.gold}>
        <Text color={PALETTE.haze}>That's no longer here.</Text>
        <Footer running={false} stopping={false} foreground={false} overStop={false} overBack={overBack !== null} stopRef={stopButton} backRef={backButton} />
      </Panel>
    );
  }

  const status = statusOf(entry, now, stopping);
  const room = inner - cellWidth(entry.kind) - cellWidth(status.text) - 6;
  const output = entry.shellId ? (shellOutput ?? "") : read?.text;
  const lines = output?.trim() ? output.replace(/\n+$/, "").split("\n") : [];
  const shown = lines.slice(-rows);
  const note = read?.truncated ? "the end of it" : lines.length > shown.length ? `last ${shown.length} of ${plural(lines.length, "line")}` : undefined;

  return (
    <Panel width={width} accent={PALETTE.gold}>
      <Box justifyContent="space-between" width={inner}>
        <Text wrap="truncate-end">
          <Text color={PALETTE.dust}>{`${entry.kind}  `}</Text>
          <Text bold color={PALETTE.star}>
            {fit(entry.title, room, false)}
          </Text>
        </Text>
        <Text color={TONES[status.tone]}>{status.text}</Text>
      </Box>
      {entry.command && entry.command !== entry.title ? (
        <Text wrap="truncate-end">
          <Text color={PALETTE.dust}>$ </Text>
          {onPanel(highlightCode(entry.command.split("\n")[0] ?? "", "bash"))}
        </Text>
      ) : null}
      {entry.hasOutput ? (
        <Box marginTop={1}>
          <Panel label="output" note={note} width={inner} background={PALETTE.raised}>
            {Array.from({ length: rows }, (_, i) => {
              const line = shown[i];
              if (line !== undefined) {
                return (
                  <Text key={i} wrap="truncate-end">
                    {onPanel(printableColored(line)) || " "}
                  </Text>
                );
              }
              return (
                <Text key={i} color={PALETTE.dust}>
                  {i === 0 && !shown.length ? (output === undefined ? "Reading…" : "Nothing printed yet.") : " "}
                </Text>
              );
            })}
          </Panel>
        </Box>
      ) : (
        <Progress entry={entry} quiet={transcript?.some((line) => line.kind === "text") ?? false} />
      )}
      {entry.workflow ? <Workflow phases={entry.workflow} width={inner} rows={rows} /> : null}
      {entry.agentId ? <Transcript lines={transcript} width={inner} rows={rows} /> : null}
      <Footer running={running} stopping={stopping} foreground={entry.foreground !== undefined} overStop={overStop !== null} overBack={overBack !== null} stopRef={stopButton} backRef={backButton} />
    </Panel>
  );
}

/**
 * A subagent's or workflow's progress, which has no output to read until it ends. `quiet`: its
 * transcript under it has its words, so there's no need to say it has said nothing.
 */
function Progress({ entry, quiet }: { entry: Running; quiet: boolean }) {
  const counts = [entry.toolUses ? plural(entry.toolUses, "tool call") : "", entry.tokens ? `${compact(entry.tokens)} tokens` : ""].filter(Boolean).join(" · ");
  return (
    <Box flexDirection="column" marginTop={1}>
      {entry.summary || !quiet ? (
        <Text color={entry.summary ? PALETTE.star : PALETTE.haze} wrap="truncate-end">
          {entry.summary?.split("\n")[0] ?? "No word from it yet."}
        </Text>
      ) : null}
      {entry.lastTool || counts ? (
        <Text color={PALETTE.haze}>
          {[entry.lastTool ? `last used ${entry.lastTool}` : "", counts].filter(Boolean).join("   ")}
        </Text>
      ) : null}
    </Box>
  );
}

/** Glyphs for a workflow agent's state, as Claude Code names them. */
const AGENT_STATE: Record<string, { glyph: string; color: string }> = {
  done: { glyph: "✓", color: PALETTE.teal },
  error: { glyph: "✕", color: PALETTE.rose },
  failed: { glyph: "✕", color: PALETTE.rose },
  queued: { glyph: "·", color: PALETTE.dust },
};

/** A workflow's phases, each with its agents and how each is going, the latest that fit. */
function Workflow({ phases, width, rows }: { phases: WorkflowPhase[]; width: number; rows: number }) {
  const lines = phases.flatMap((phase, i) => [
    { key: `p${i}`, phase },
    ...phase.agents.map((agent, j) => ({ key: `a${i}.${j}`, agent })),
  ]);
  const shown = lines.slice(-Math.max(rows, 4));
  const agentLine = (agent: WorkflowAgent) => {
    const { glyph, color } = AGENT_STATE[agent.state] ?? { glyph: "◌", color: PALETTE.teal };
    const about = agent.error ?? [agent.lastTool ? `last used ${agent.lastTool}` : "", agent.toolCalls ? plural(agent.toolCalls, "tool call") : "", agent.tokens ? `${compact(agent.tokens)} tokens` : ""].filter(Boolean).join(" · ");
    return (
      <Text wrap="truncate-end">
        <Text color={color}>{`  ${glyph} `}</Text>
        <Text color={PALETTE.star}>{agent.label}</Text>
        {about ? <Text color={agent.error ? PALETTE.rose : PALETTE.haze}>{`   ${about}`}</Text> : null}
      </Text>
    );
  };
  return (
    <Box marginTop={1}>
      <Panel label="phases" note={lines.length > shown.length ? `last ${shown.length} of ${lines.length}` : undefined} width={width} background={PALETTE.raised}>
        {shown.map((line) =>
          "phase" in line ? (
            <Text key={line.key} bold color={PALETTE.star} wrap="truncate-end">
              {line.phase.title || "Phase"}
            </Text>
          ) : (
            <Box key={line.key}>{agentLine(line.agent)}</Box>
          ),
        )}
      </Panel>
    </Box>
  );
}

/** The end of a subagent's transcript, as it stood at the last read. */
function Transcript({ lines, width, rows }: { lines: AgentLine[] | undefined; width: number; rows: number }) {
  const shown = lines?.slice(-rows) ?? [];
  const color = { prompt: PALETTE.gold, text: PALETTE.star, tool: PALETTE.teal } as const;
  return (
    <Box marginTop={1}>
      <Panel label="transcript" note={lines && lines.length > shown.length ? `last ${shown.length} of ${plural(lines.length, "line")}` : undefined} width={width} background={PALETTE.raised}>
        {Array.from({ length: rows }, (_, i) => {
          const line = shown[i];
          if (!line) {
            return (
              <Text key={i} color={PALETTE.dust}>
                {i === 0 && !shown.length ? (lines === undefined ? "Reading…" : "Nothing written yet.") : " "}
              </Text>
            );
          }
          return (
            <Text key={i} color={color[line.kind]} wrap="truncate-end">
              {printable(line.text) || " "}
            </Text>
          );
        })}
      </Panel>
    </Box>
  );
}

type FooterProps = {
  running: boolean;
  stopping: boolean;
  /** Claude waits on it, so it can go to the background. */
  foreground: boolean;
  overStop: boolean;
  overBack: boolean;
  stopRef: RefObject<DOMElement | null>;
  backRef: RefObject<DOMElement | null>;
};

/** Stop as a button, in rose, and the keys. Stop shows only while there's something to stop. */
function Footer({ running, stopping, foreground, overStop, overBack, stopRef, backRef }: FooterProps) {
  return (
    <Box marginTop={1}>
      {running ? (
        <Box ref={stopRef} marginRight={3}>
          <Text>
            <Text color={overStop ? PALETTE.star : PALETTE.rose}>▐</Text>
            <Text backgroundColor={overStop ? PALETTE.star : PALETTE.rose} color={PALETTE.ink} bold>
              {stopping ? "stopping…" : "■ stop  x"}
            </Text>
            <Text color={overStop ? PALETTE.star : PALETTE.rose}>▌</Text>
          </Text>
        </Box>
      ) : null}
      <Box ref={backRef}>
        <Text color={overBack ? PALETTE.star : PALETTE.dust}>← back to the list</Text>
      </Box>
      {foreground && !stopping ? <Text color={PALETTE.dust}>{"   b to the background"}</Text> : null}
      <Text color={PALETTE.dust}>{"   esc to close"}</Text>
    </Box>
  );
}

function statusOf(entry: Running, now: number, stopping: boolean): { text: string; tone: keyof typeof TONES } {
  const ran = entry.startedAt !== undefined ? (entry.endedAt ?? now) - entry.startedAt : undefined;
  const took = ran !== undefined && ran > 0 ? duration(ran) : "";
  switch (entry.status) {
    case "running":
      return { text: stopping ? "stopping" : took ? `running ${took}` : "running", tone: stopping ? "stopped" : "claude" };
    case "completed":
      return { text: took ? `✓ finished after ${took}` : "✓ finished", tone: "claude" };
    case "failed":
      return { text: took ? `✕ failed after ${took}` : "✕ failed", tone: "failed" };
    case "stopped":
      return { text: took ? `■ stopped after ${took}` : "■ stopped", tone: "stopped" };
  }
}

/** The time, every second while `ticking`. */
function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/**
 * What a task of Claude Code's printed, as its terminal would show it, read every second while it
 * runs and once more when it ends. Undefined until the first read comes back.
 */
function useTaskOutput(session: AgentSession, taskId: string | undefined, running: boolean) {
  const [read, setRead] = useState<{ text: string; truncated: boolean }>();
  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    const once = () =>
      void session.taskOutput(taskId).then((result) => {
        if (alive) setRead(result ? { text: settle(result.output), truncated: result.truncated } : { text: "", truncated: false });
      });
    once();
    if (!running) {
      return () => {
        alive = false;
      };
    }
    const timer = setInterval(once, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session, taskId, running]);
  return read;
}

/**
 * A subagent's transcript as lines, read from the file Claude Code keeps for it every two seconds
 * while it runs and once more when it ends: its brief, what it wrote, and each tool it used. Only
 * for one Claude Code didn't forward in this process, as after a resume.
 */
function useSubagentTranscript(session: AgentSession, agentId: string | undefined, running: boolean) {
  const [lines, setLines] = useState<AgentLine[]>();
  useEffect(() => {
    if (!agentId) return;
    let alive = true;
    const once = () =>
      void session.subagentMessages(agentId).then((messages) => {
        if (alive) setLines(messages.flatMap((message) => agentLines(message.type, message.message)));
      });
    once();
    if (!running) {
      return () => {
        alive = false;
      };
    }
    const timer = setInterval(once, TRANSCRIPT_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session, agentId, running]);
  return lines;
}
