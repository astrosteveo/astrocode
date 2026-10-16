import { memo, useState } from "react";
import type { ToolCall } from "../../src/view/state";
import { toolLabel, toolSummary, toolTarget } from "../../src/view/tools";
import { Diff } from "./code";

const GLYPHS = { running: "●", waiting: "◆", done: "✓", error: "✗", denied: "⊘", stopped: "■" } as const;

type Props = { call: ToolCall; waiting: boolean; cwd: string; home: string };

/** One tool call as a single line. Click it to see what went in and what came back. */
export const ToolRow = memo(function ToolRow({ call, waiting, cwd, home }: Props) {
  const [open, setOpen] = useState(false);
  const status = waiting ? "waiting" : call.status;
  return (
    <div className="tool" data-status={status}>
      <button type="button" className="tool-row" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="tool-glyph" aria-hidden="true">
          {GLYPHS[status]}
        </span>
        <span className="tool-name">{toolLabel(call.name)}</span>
        <span className="tool-target">{toolTarget(call, cwd, home)}</span>
        <span className="tool-summary">{toolSummary(call, waiting)}</span>
      </button>
      {open ? <ToolDetail call={call} /> : null}
    </div>
  );
});

/** The row for a tool call Claude is still writing. */
export function DraftToolRow({ name }: { name: string }) {
  return (
    <div className="tool" data-status="running">
      <div className="tool-row">
        <span className="tool-glyph" aria-hidden="true">
          {GLYPHS.running}
        </span>
        <span className="tool-name">{toolLabel(name)}</span>
        <span className="tool-target" />
        <span className="tool-summary">writing</span>
      </div>
    </div>
  );
}

function ToolDetail({ call }: { call: ToolCall }) {
  const text = (key: string) => {
    const value = call.input[key];
    return typeof value === "string" ? value : "";
  };
  return (
    <div className="tool-detail">
      {call.name === "Bash" ? (
        <pre className="command">{`$ ${text("command")}`}</pre>
      ) : call.name === "Edit" ? (
        <Diff before={text("old_string")} after={text("new_string")} />
      ) : call.name === "Write" ? (
        <pre>{text("content")}</pre>
      ) : (
        <pre>{JSON.stringify(call.input, null, 2)}</pre>
      )}
      {call.result ? <pre className={call.status === "error" ? "result error" : "result"}>{call.result}</pre> : null}
    </div>
  );
}
