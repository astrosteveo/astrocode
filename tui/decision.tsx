// Asking you before a tool runs, in the box's place, on a panel with a gold top edge: what Claude
// wants to do, and the choices, in `claude`'s words (src/view/permissions.ts). The panel is the one
// place that says Claude is waiting, and for how long. Tab on No opens a comment, which goes to
// Claude as the reason; a plan's last row is a comment of its own, saying what to change.
import { Box, renderToString, Text, useAnimation, useInput, type DOMElement } from "ink";
import { existsSync } from "node:fs";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import wrapAnsi from "wrap-ansi";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { Decision, PermissionRequest } from "../src/events";
import { duration } from "../src/view/format";
import { askFor, permissionNote, rowText, type Row } from "../src/view/permissions";
import { plural, shortPath } from "../src/view/tools";
import { ChoiceRow } from "./choice";
import { printable } from "./markdown";
import { Diff, diffLines } from "./diff";
import { Markdown, Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE } from "./theme";

/** Keys pressed this soon after the prompt appears were meant for something else, so Enter, digits and clicks wait. */
const GRACE_MS = 500;

/**
 * `pictureRows`: how tall a diagram in a plan may be. `rows`: the screen's height, half of which a
 * diff, command or plan may take, so the line that asks stays in view above. `agent`: the subagent
 * that asks, as `askedBy()` names it. `mode` and `modes`: the mode you're in and those a row may
 * switch to.
 */
type Props = {
  request: PermissionRequest;
  agent?: string;
  cwd: string;
  home: string;
  width: number;
  rows: number;
  pictureRows: number;
  mode: PermissionMode;
  modes: { bypass: boolean; auto: boolean };
  onDecide: (decision: Decision) => void;
};

/**
 * Choose with the arrow keys and Enter, press a number, or click a row. Esc or Ctrl+C says no.
 * Shift+Tab picks the row that names it. Claude Code may ask that no one key say yes
 * (`defaultToNo`): the prompt then starts on No, and numbers pick only the rows that say no.
 */
export function DecisionPrompt({ request, agent, cwd, home, width, rows, pictureRows, mode, modes, onDecide }: Props) {
  const [exists] = useState(() => (request.toolName === "Write" && typeof request.input.file_path === "string" ? existsSync(request.input.file_path) : undefined));
  const ask = askFor(request, { cwd, home, mode, modes, exists });
  // The rows you pick, then the plan's comment, which you pick by typing in it.
  const count = ask.rows.length + (ask.field ? 1 : 0);
  const no = ask.rows.findIndex((row) => !row.decision.allow);
  // In a ref, so keys that arrive faster than React draws see the latest: the row you're on, what
  // you've typed on No after Tab (null while that's closed), and in the plan's last row.
  const now = useRef({ selected: request.defaultToNo ? (no === -1 ? count - 1 : no) : 0, comment: null as string | null, change: "" });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const update = (next: Partial<typeof now.current>) => {
    now.current = { ...now.current, ...next };
    redraw();
  };
  const shownAt = useRef(Date.now());
  const { time } = useAnimation({ interval: 1000 });
  const options = useRef<(DOMElement | null)[]>([]);
  const list = useRef<DOMElement>(null);
  const early = () => Date.now() - shownAt.current < GRACE_MS;
  /** Where your keys are: on a row, in the plan's comment, or in No's. */
  const at = () => {
    const { selected, comment } = now.current;
    const row = ask.rows[selected];
    const onField = ask.field !== undefined && selected === ask.rows.length;
    return { row, onField, typing: onField || (row?.amend !== undefined && comment !== null) };
  };
  const type = (edit: (text: string) => string) => update(at().onField ? { change: edit(now.current.change) } : { comment: edit(now.current.comment ?? "") });

  const pick = (index: number) => {
    const chosen = ask.rows[index];
    if (!chosen) return update({ selected: index });
    const { selected, comment } = now.current;
    if (request.defaultToNo && chosen.decision.allow && index !== selected) return;
    const said = chosen.amend !== undefined ? comment?.trim() : undefined;
    onDecide(said ? { allow: false, comment: said } : chosen.decision);
  };

  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left") return;
    const index = options.current.findIndex((element, i) => i < count && hit(element, event));
    if (index === -1) return;
    event.handled = true;
    update({ selected: index });
    if (!early()) pick(index);
  });
  const hovered = useHover(list, (_x, _y, pointer) => {
    const index = options.current.findIndex((element, i) => i < count && hit(element, pointer));
    return index === -1 ? null : { key: index, shape: "pointer" };
  });

  useInput((input, key) => {
    if (key.eventType === "release") return;
    const { row, onField, typing } = at();
    if (key.escape || (key.ctrl && input === "c")) return onDecide({ allow: false });
    if (key.upArrow) return update({ selected: (now.current.selected + count - 1) % count });
    if (key.downArrow) return update({ selected: (now.current.selected + 1) % count });
    if (key.tab && !key.shift) {
      if (row?.amend !== undefined) update({ comment: now.current.comment === null ? "" : null });
      return;
    }
    if (typing && (key.backspace || key.delete)) return type((text) => text.slice(0, -1));
    if (early()) return;
    if (key.tab && key.shift) {
      const index = ask.rows.findIndex((one) => one.key === "shift+tab");
      if (index !== -1) pick(index);
      return;
    }
    if (key.return) {
      // An empty comment says nothing, so Enter waits for one; Esc is how to say no without it.
      if (onField) return void (now.current.change.trim() && onDecide({ allow: false, comment: now.current.change.trim() }));
      return pick(now.current.selected);
    }
    if (typing) {
      if (!key.ctrl && !key.meta && input) type((text) => text + input);
      return;
    }
    if (/^[1-9]$/.test(input) && Number(input) <= count) pick(Number(input) - 1);
  });

  const { selected, comment, change } = now.current;
  const { row, onField } = at();
  const inner = width - 2;
  const note = request.toolName === "Bash" ? undefined : permissionNote(request, cwd, home);
  const plan = typeof request.input.planFilePath === "string" ? shortPath(request.input.planFilePath, cwd, home) : "";
  const hint = ask.cancel ? `Esc to cancel${row?.amend !== undefined && comment === null ? " · Tab to amend" : ""}` : plan;
  // What the tool would do takes at most half the screen, and less where the rest of the panel
  // needs it, so the line that asks stays in view above, and the status bar below. Rows are
  // counted as they wrap.
  const chrome =
    5 +
    (agent !== undefined ? 1 : 0) +
    [ask.subject, note, ask.question].reduce((sum, text) => sum + (text ? rowsOf(text, inner) : 0), 0) +
    ask.rows.reduce((sum, one) => sum + rowsOf(one.amend !== undefined && comment !== null ? `${one.label}, ${comment || one.amend} ` : rowText(one), inner - 5), 0) +
    (ask.field !== undefined ? rowsOf(`${change || ask.field} `, inner - 5) : 0) +
    (hint ? 1 + rowsOf(hint, inner) : 0);
  const limit = Math.max(3, Math.min(Math.floor(rows / 2), rows - chrome - 3));
  const body = useMemo(() => details(request, cwd, home, inner, pictureRows), [request, cwd, home, inner, pictureRows]);
  const shown = useFitting(body, limit, inner);
  return (
    <Panel width={width} accent={PALETTE.gold}>
      {agent !== undefined ? (
        <Text wrap="truncate-end">
          <Text color={PALETTE.dust}>{"subagent  "}</Text>
          <Text color={PALETTE.teal}>{agent || "asks from inside a workflow"}</Text>
        </Text>
      ) : null}
      <Box justifyContent="space-between">
        <Text bold color={PALETTE.star}>
          {ask.header}
        </Text>
        <Text color={PALETTE.gold}>{`waiting ${duration(time)}`}</Text>
      </Box>
      {ask.subject ? <Text color={PALETTE.haze}>{ask.subject}</Text> : null}
      {note ? <Text color={PALETTE.haze}>{note}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {body.draw(shown)}
      </Box>
      {ask.question ? (
        <Box marginTop={1}>
          <Text>{ask.question}</Text>
        </Box>
      ) : null}
      <Box ref={list} flexDirection="column" marginTop={ask.question ? 0 : 1}>
        {ask.rows.map((one, i) => (
          <Box
            key={i}
            ref={(element) => {
              options.current[i] = element;
            }}
          >
            <ChoiceRow selected={i === selected} hovered={i === hovered} width={inner}>
              <Choice row={one} index={i} selected={i === selected} comment={one.amend !== undefined ? comment : null} />
            </ChoiceRow>
          </Box>
        ))}
        {ask.field !== undefined ? (
          <Box
            ref={(element) => {
              options.current[ask.rows.length] = element;
            }}
          >
            <ChoiceRow selected={onField} hovered={hovered === ask.rows.length} width={inner}>
              <Numbered index={ask.rows.length} selected={onField}>
                {change ? <Text color={PALETTE.star}>{change}</Text> : <Text color={PALETTE.dust} italic>{ask.field}</Text>}
                {onField ? <Caret /> : null}
              </Numbered>
            </ChoiceRow>
          </Box>
        ) : null}
      </Box>
      {hint ? (
        <Box marginTop={1}>
          <Text color={PALETTE.dust}>{hint}</Text>
        </Box>
      ) : null}
    </Panel>
  );
}

/** A row: its label, then its note and key, dim. With its comment open, what you type takes the label's place after the first word. */
function Choice({ row, index, selected, comment }: { row: Row; index: number; selected: boolean; comment: string | null }) {
  const color = selected ? PALETTE.star : undefined;
  if (comment !== null && row.amend !== undefined) {
    return (
      <Numbered index={index} selected={selected}>
        <Text bold={selected} color={color}>{`${row.label}, `}</Text>
        {comment ? <Text color={PALETTE.star}>{comment}</Text> : <Text color={PALETTE.dust} italic>{row.amend}</Text>}
        {selected ? <Caret /> : null}
      </Numbered>
    );
  }
  return (
    <Numbered index={index} selected={selected}>
      <Text bold={selected} color={color}>
        {row.label}
      </Text>
      {row.note ? <Text color={PALETTE.haze}>{` ${row.note}`}</Text> : null}
      {row.key ? <Text color={PALETTE.dust}>{` (${row.key})`}</Text> : null}
    </Numbered>
  );
}

/** A row's number, with what follows it wrapping clear of it. */
function Numbered({ index, selected, children }: { index: number; selected: boolean; children: ReactNode }) {
  return (
    <Box>
      {/* A long label would squeeze the number's spaces away. */}
      <Box flexShrink={0}>
        <Text bold={selected} color={selected ? PALETTE.star : undefined}>{`${index + 1}  `}</Text>
      </Box>
      <Text>{children}</Text>
    </Box>
  );
}

function Caret() {
  return (
    <Text backgroundColor={PALETTE.gold} color={PALETTE.ink}>
      {" "}
    </Text>
  );
}

/** The rows `text` takes in `room` columns, wrapped as Ink wraps it. */
function rowsOf(text: string, room: number) {
  return wrapAnsi(text, Math.max(1, room), { trim: false, hard: true }).split("\n").length;
}

/**
 * What the tool would do: how many lines it has, and a drawing of its first `limit`, with a line
 * saying how many more there are. A command shows once, then Claude's description of it, unless
 * that's only the command again.
 */
function details(request: PermissionRequest, cwd: string, home: string, width: number, pictureRows: number): Body {
  const text = (key: string) => {
    const value = request.input[key];
    return typeof value === "string" ? printable(value) : "";
  };
  const count = (some: string) => some.replace(/\n+$/, "").split("\n").length;
  switch (request.toolName) {
    case "Bash": {
      const command = text("command");
      const description = permissionNote({ ...request, description: text("description") || request.description }, cwd, home);
      return {
        lines: count(command),
        draw: (limit) => (
          <>
            <Text>
              <Text color={PALETTE.dust}>$ </Text>
              <Text color={PALETTE.star}>{preview(command, limit)}</Text>
            </Text>
            {description ? <Text color={PALETTE.haze}>{description}</Text> : null}
          </>
        ),
      };
    }
    case "Edit": {
      const lines = diffLines(text("old_string"), text("new_string"));
      return { lines: lines.length, draw: (limit) => <Diff lines={lines} width={width} limit={limit} path={text("file_path")} framed={false} /> };
    }
    case "Write":
      return { lines: count(text("content")), draw: (limit) => <Text color={PALETTE.haze}>{preview(text("content"), limit)}</Text> };
    case "WebFetch":
      return { lines: 1, draw: () => <Text color={PALETTE.sky}>{text("url")}</Text> };
    case "ExitPlanMode": {
      // The plan as Claude wrote it; the file Claude Code keeps it in is on the hint line.
      const lines = text("plan").replace(/\n+$/, "").split("\n");
      return {
        lines: lines.length,
        draw: (limit) => (
          <>
            {text("plan") ? <Markdown text={lines.slice(0, limit).join("\n")} width={width} diagrams={{ rows: pictureRows }} /> : null}
            {lines.length > limit ? <Text color={PALETTE.dust}>{`… ${plural(lines.length - limit, "more line")}${text("planFilePath") ? ", in the file below" : ""}`}</Text> : null}
          </>
        ),
      };
    }
    default: {
      const json = JSON.stringify(request.input, null, 2);
      return { lines: count(json), draw: (limit) => <Text color={PALETTE.haze}>{preview(json, limit)}</Text> };
    }
  }
}

type Body = { lines: number; draw: (limit: number) => ReactNode };

/**
 * How many of the body's lines fit in `rows` rows: worked out just after React commits, since Ink
 * can't render to a string in the middle of rendering. Until then, as many as fit before, or one.
 */
function useFitting(body: Body, rows: number, width: number) {
  const [fit, setFit] = useState<{ body: Body; rows: number; width: number; shown: number } | null>(null);
  const known = fit?.body === body && fit.rows === rows && fit.width === width;
  useEffect(() => {
    if (known) return;
    let alive = true;
    queueMicrotask(() => {
      if (alive) setFit({ body, rows, width, shown: fitting(body, rows, width) });
    });
    return () => {
      alive = false;
    };
  }, [body, rows, width, known]);
  return fit?.shown ?? 1;
}

/**
 * The most of the body's lines whose drawing, `width` wide, takes no more than `rows` rows, as
 * they wrap and as Markdown lays them out; one at least.
 */
function fitting(body: Body, rows: number, width: number) {
  const fits = (limit: number) =>
    renderToString(
      <Box flexDirection="column" width={width}>
        {body.draw(limit)}
      </Box>,
      { columns: width },
    ).split("\n").length <= rows;
  if (fits(body.lines)) return body.lines;
  let [low, high] = [1, body.lines - 1];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

function preview(text: string, limit: number) {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length <= limit) return lines.join("\n");
  return `${lines.slice(0, limit).join("\n")}\n… ${plural(lines.length - limit, "more line")}`;
}
