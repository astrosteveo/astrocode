import type { Decision as Choice, PermissionRequest } from "../../src/protocol";
import { alwaysLabel, permissionNote, permissionTitle } from "../../src/view/permissions";
import { shortPath } from "../../src/view/tools";
import { Diff } from "./code";

type Props = { request: PermissionRequest; cwd: string; home: string; onDecide: (choice: Choice) => void };

/** A tool call that needs the user's OK. Nothing is focused automatically, so a stray Enter can't approve it. */
export function Decision({ request, cwd, home, onDecide }: Props) {
  const always = alwaysLabel(request.alwaysAllow, home);
  const note = permissionNote(request, cwd, home);
  const primary = request.defaultToNo ? "deny" : "allow";
  return (
    <section className="decision" aria-label="Permission request">
      <p className="decision-title">{permissionTitle(request)}</p>
      {note ? <p className="decision-note">{note}</p> : null}
      <Details request={request} cwd={cwd} home={home} />
      <div className="decision-actions">
        <button type="button" className={primary === "allow" ? "btn primary" : "btn"} onClick={() => onDecide("allow")}>
          Allow
        </button>
        {always ? (
          <button type="button" className="btn" onClick={() => onDecide("always")}>
            {always}
          </button>
        ) : null}
        <button type="button" className={primary === "deny" ? "btn primary" : "btn"} onClick={() => onDecide("deny")}>
          Deny
        </button>
      </div>
    </section>
  );
}

function Details({ request, cwd, home }: Omit<Props, "onDecide">) {
  const text = (key: string) => {
    const value = request.input[key];
    return typeof value === "string" ? value : "";
  };
  switch (request.toolName) {
    case "Bash":
      return (
        <>
          <pre className="command">{`$ ${text("command")}`}</pre>
          {text("description") ? <p className="decision-note">{text("description")}</p> : null}
        </>
      );
    case "Edit":
      return (
        <>
          <p className="decision-path">{shortPath(text("file_path"), cwd, home)}</p>
          <Diff before={text("old_string")} after={text("new_string")} />
        </>
      );
    case "Write":
      return (
        <>
          <p className="decision-path">{shortPath(text("file_path"), cwd, home)}</p>
          <pre>{text("content")}</pre>
        </>
      );
    case "WebFetch":
      return <p className="decision-path">{text("url")}</p>;
    default:
      return <pre>{JSON.stringify(request.input, null, 2)}</pre>;
  }
}
