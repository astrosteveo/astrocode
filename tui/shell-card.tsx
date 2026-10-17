// A shell command as a card, the same for Claude's Bash calls and the commands you run with `!`.
// The headline says what it does and how it went; under it, on a band of the panel color, the
// command and the one line of output that says the most, with the last error lines when it
// failed. Opened, the band holds the whole command and the whole output follows it. A command of
// yours that's still the newest thing shows the end of its output as it streams.
import { Box, Text } from "ink";
import { FAILURE_LINES, failureLines, runInsight, runSize, runStatus, tailLines, type Run, type Tone } from "../src/view/runs";
import { highlightCode } from "./highlight";
import { cellWidth, printable, printableColored } from "./markdown";
import { fit, onPanel } from "./markdown-view";
import { PALETTE } from "./theme";
import { ShellOutput } from "./tool-row";

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
        <Text wrap="truncate-end" bold color={PALETTE.star}>
          {fit(run.headline, room, false)}
        </Text>
        <Text color={TONES[status.tone]}>{status.text}</Text>
      </Box>
      <Box flexDirection="column" backgroundColor={PALETTE.surface} paddingX={1} width={width}>
        {run.yours ? null : <CommandRows command={run.command} expanded={expanded} />}
        {live ? <LiveTail run={run} width={width - 2} /> : <Insight run={run} insight={insight} width={width - 2} />}
        {failures.map((line, i) => (
          <Text key={i} wrap="truncate-end" color={PALETTE.rose}>
            {line}
          </Text>
        ))}
      </Box>
      {expanded && !live ? (
        <ShellOutput stdout={run.stdout} stderr={run.stderr} failed={run.status === "error"} width={width} limit={MAX_LINES} />
      ) : null}
    </Box>
  );
}

/** `$ command`: its first line, or all of it once the card is open. */
function CommandRows({ command, expanded }: { command: string; expanded: boolean }) {
  const lines = command.replace(/\n+$/, "").split("\n");
  if (expanded) {
    return (
      <Text>
        <Text color={PALETTE.dust}>$ </Text>
        {onPanel(highlightCode(lines.join("\n"), "bash"))}
      </Text>
    );
  }
  return (
    <Text wrap="truncate-end">
      <Text color={PALETTE.dust}>$ </Text>
      {onPanel(highlightCode(lines[0] ?? "", "bash"))}
      {lines.length > 1 ? <Text color={PALETTE.dust}>{` … ${lines.length - 1} more`}</Text> : null}
    </Text>
  );
}

/** The line that says the most, and how much there is to open, set against the right edge. */
function Insight({ run, insight, width }: { run: Run; insight: ReturnType<typeof runInsight>; width: number }) {
  const size = runSize(run);
  const room = width - (size ? cellWidth(size) + 4 : 0);
  return (
    <Box justifyContent="space-between" width={width}>
      <Text wrap="truncate-end" color={TONES[insight.tone]}>
        {fit(printable(insight.text), room, false)}
      </Text>
      {size ? <Text color={PALETTE.dust}>{`${size} ▸`}</Text> : null}
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
