// A shell command as a card, the same for Claude's Bash calls and the commands you run with `!`.
// The headline says what it does and how it went; under it, on a band of the panel color, the
// command and the one line of output that says the most, with the last error lines when it
// failed. Opened, the band holds the whole command and then the whole output, one surface. A
// command of yours that's still the newest thing shows the end of its output as it streams.
import { Box, Text } from "ink";
import { FAILURE_LINES, failureLines, runInsight, runSize, runStatus, tailLines, type Run, type Tone } from "../src/view/runs";
import { highlightCode } from "./highlight";
import { linked } from "./links";
import { cellWidth, printable, printableColored, takeCells } from "./markdown";
import { fit, onPanel } from "./markdown-view";
import { PALETTE, sgr } from "./theme";
import { clip } from "./tool-row";

/** Lines of a running command's output its live card shows. */
const TAIL_LINES = 6;
/** The most lines an opened card shows of the output. */
const MAX_LINES = 2000;

export const TONES: Record<Tone, string> = {
  quiet: PALETTE.haze,
  claude: PALETTE.teal,
  you: PALETTE.gold,
  failed: PALETTE.rose,
  stopped: PALETTE.ember,
};

type Props = { run: Run; width: number; expanded?: boolean };

export function ShellCard({ run, width, expanded = false }: Props) {
  const status = runStatus(run);
  const insight = runInsight(run);
  // The result line can be the first of the error lines, which then aren't shown twice.
  const failures = expanded ? [] : failureLines(run, FAILURE_LINES).filter((line) => line !== insight.text);
  const room = width - cellWidth(status.text) - 2;
  const live = run.yours && run.status === "running" && !run.background;
  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between" width={width}>
        {/* Claude's commands step back from its prose; yours stand out as what you typed. */}
        <Text wrap="truncate-end" bold={run.yours} color={run.yours ? PALETTE.star : PALETTE.haze}>
          {fit(run.headline, room, false)}
        </Text>
        <Text color={TONES[status.tone]}>{status.text}</Text>
      </Box>
      <Box flexDirection="column" backgroundColor={PALETTE.surface} paddingX={1} width={width}>
        {run.yours ? null : <CommandRows command={run.command} expanded={expanded} width={width - 2} />}
        {live ? (
          <LiveTail run={run} width={width - 2} />
        ) : expanded && hasOutput(run) ? (
          <OutputRows run={run} spaced={!run.yours} />
        ) : (
          <Insight run={run} insight={insight} width={width - 2} open={expanded} />
        )}
        {failures.map((line, i) => (
          <Text key={i} wrap="truncate-end" color={PALETTE.rose}>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

/** Claude Code's words for a command that printed nothing. */
const NO_OUTPUT = /^\(\w+ completed with no output\)$/;

const hasOutput = (run: Run) => Boolean((NO_OUTPUT.test(run.stdout.trim()) ? "" : run.stdout.trim()) || run.stderr.trim());

/**
 * What a command printed, in the band under its command, a blank row apart when the command is
 * shown. When it failed, what it printed as errors follows in rose. When it succeeded, that's just
 * more output: git, curl and others print their progress and results to stderr. Past `MAX_LINES`,
 * a last line says how many more there were.
 */
function OutputRows({ run, spaced }: { run: Run; spaced: boolean }) {
  const said = NO_OUTPUT.test(run.stdout.trim()) ? "" : run.stdout;
  const failed = run.status === "error";
  const out = clip(failed ? printableColored(said).trimEnd() : [printableColored(said).trimEnd(), printable(run.stderr).trimEnd()].filter(Boolean).join("\n"), MAX_LINES);
  const err = failed ? clip(printable(run.stderr).trimEnd(), MAX_LINES) : null;
  return (
    <Box flexDirection="column">
      {spaced ? <Text> </Text> : null}
      {out.text ? <Text>{onPanel(linked(failed ? out.text : tintErrors(out.text)))}</Text> : null}
      {out.hidden ? <Text color={PALETTE.dust}>{`… ${out.note}`}</Text> : null}
      {err?.text ? <Text color={PALETTE.rose}>{linked(err.text)}</Text> : null}
      {err?.hidden ? <Text color={PALETTE.dust}>{`… ${err.note}`}</Text> : null}
    </Box>
  );
}

/** A line that starts like an error: `fatal:`, `error:`, `error[E0308]:`, `TypeError:`, `npm ERR!`. */
const ERROR_LINE = /^\s*(?:(?:fatal|error|\w*(?:Error|Exception))(?:\[[^\]]*\])?:|npm ERR!)/i;

/**
 * Error lines in rose, in the output of a command that succeeded overall: `git log; ls` exits 0
 * after git's `fatal:`. A line the command colored itself keeps its colors.
 */
function tintErrors(text: string) {
  return text
    .split("\n")
    .map((line) => (ERROR_LINE.test(line) && !line.includes("\x1b[") ? `${sgr(PALETTE.rose)}${line}\x1b[39m` : line))
    .join("\n");
}

/**
 * `$ command`: its first line, or all of it once the card is open. A first line too long for the
 * card is cut where a note on what's left fits, `… +80 chars`, as a longer command gets `… 3 more`.
 */
function CommandRows({ command, expanded, width }: { command: string; expanded: boolean; width: number }) {
  const lines = command.replace(/\n+$/, "").split("\n");
  if (expanded) {
    return (
      <Text>
        <Text color={PALETTE.dust}>$ </Text>
        {onPanel(highlightCode(lines.join("\n"), "bash"))}
      </Text>
    );
  }
  const first = lines[0] ?? "";
  const more = lines.length > 1 ? `${lines.length - 1} more` : "";
  const room = width - 2;
  const whole = cellWidth(first) + (more ? cellWidth(more) + 3 : 0) <= room;
  let shown = first;
  let note = more ? ` … ${more}` : "";
  if (!whole) {
    // The note's length depends on how much is cut, so it's measured with the most it could say.
    const widest = ` … +${[...first].length} chars${more ? `, ${more}` : ""}`;
    shown = takeCells(first, Math.max(1, room - cellWidth(widest)))[0].trimEnd();
    note = ` … +${[...first].length - [...shown].length} chars${more ? `, ${more}` : ""}`;
  }
  return (
    <Text wrap="truncate-end">
      <Text color={PALETTE.dust}>$ </Text>
      {onPanel(highlightCode(shown, "bash"))}
      {note ? <Text color={PALETTE.dust}>{note}</Text> : null}
    </Text>
  );
}

/** The line that says the most, and how much output there is, set against the right edge, with ▸ closed or ▾ open. */
function Insight({ run, insight, width, open }: { run: Run; insight: ReturnType<typeof runInsight>; width: number; open: boolean }) {
  const size = runSize(run);
  const room = width - (size ? cellWidth(size) + 4 : 0);
  return (
    <Box justifyContent="space-between" width={width}>
      <Text wrap="truncate-end" color={TONES[insight.tone]}>
        {fit(printable(insight.text), room, false)}
      </Text>
      {size ? <Text color={PALETTE.dust}>{`${size} ${open ? "▾" : "▸"}`}</Text> : null}
    </Box>
  );
}

/** The end of what a running command of yours has printed so far, as its terminal shows it. */
function LiveTail({ run, width }: { run: Run; width: number }) {
  const lines = run.stdout.trim() ? tailLines(run, TAIL_LINES) : [];
  return (
    <Box flexDirection="column" width={width}>
      {lines.length ? (
        lines.map((line, i) => (
          <Text key={i} wrap="truncate-end">
            {onPanel(printableColored(line)) || " "}
          </Text>
        ))
      ) : (
        <Text color={PALETTE.dust}>Waiting for output…</Text>
      )}
      <Box justifyContent="flex-end" width={width}>
        <Text color={PALETTE.dust}>/tasks to stop it</Text>
      </Box>
    </Box>
  );
}
