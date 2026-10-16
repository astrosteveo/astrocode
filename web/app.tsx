import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { MODES, type ClientEvent, type Mode, type ServerFrame } from "../src/protocol";
import { Composer } from "./components/composer";
import { Decision } from "./components/decision";
import { Markdown } from "./components/markdown";
import { DraftToolRow, ToolRow } from "./components/tool-row";
import { initialState, reducer, type Action, type Item, type Live, type State } from "../src/view/state";
import { duration, modelLabel } from "../src/view/format";
import { shortPath, toolLabel } from "../src/view/tools";

const MODE_LABELS: Record<Mode, string> = {
  default: "Ask first",
  acceptEdits: "Accept edits",
  plan: "Plan",
  auto: "Auto",
  bypassPermissions: "Bypass permissions",
};

const MODE_HINTS: Partial<Record<PermissionMode, string>> = {
  default: "Claude checks with you before it edits files or runs commands.",
  acceptEdits: "Claude edits files without asking, and checks with you before it runs commands.",
  plan: "Claude reads and plans, and changes nothing until you approve the plan.",
  auto: "A safety check approves routine actions and asks you about the rest.",
  bypassPermissions: "Claude edits files and runs commands without asking.",
};

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const send = useSocket(dispatch);
  const scroll = useStickToBottom([state.items, state.live, state.pending]);
  const waiting = new Set(state.pending.map((request) => request.id));
  const empty = state.items.length === 0 && !state.live;

  return (
    <div className="shell">
      <TopBar state={state} send={send} />
      <main className="transcript" ref={scroll.ref} onScroll={scroll.onScroll}>
        <div className="column">
          {empty ? (
            <EmptyState state={state} />
          ) : (
            <div className="log">
              {state.items.map((item) => (
                <ItemView
                  key={item.key}
                  item={item}
                  cwd={state.cwd}
                  home={state.home}
                  waiting={item.kind === "tool" && waiting.has(item.call.id)}
                />
              ))}
              <LiveView live={state.live} />
            </div>
          )}
        </div>
      </main>
      <footer className="dock">
        <div className="column">
          {state.pending.map((request) => (
            <Decision
              key={request.id}
              request={request}
              cwd={state.cwd}
              home={state.home}
              onDecide={(decision) => send({ kind: "decide", id: request.id, decision })}
            />
          ))}
          <Activity state={state} />
          <Composer
            busy={state.busy}
            connected={state.connected}
            onSend={(text) => send({ kind: "prompt", text })}
            onStop={() => send({ kind: "interrupt" })}
          />
        </div>
      </footer>
    </div>
  );
}

function TopBar({ state, send }: { state: State; send: (event: ClientEvent) => void }) {
  const offered = MODES.some((mode) => mode === state.mode);
  return (
    <header className="topbar">
      <span className="wordmark">astrocode</span>
      <span className="path" title={state.cwd}>
        {shortPath(state.cwd, "", state.home)}
      </span>
      <span className="spacer" />
      {state.model ? <span className="meta">{modelLabel(state.model)}</span> : null}
      {state.plan ? <span className="meta">{state.plan}</span> : null}
      <label className="mode">
        <span className="sr-only">Permission mode</span>
        <select
          value={state.mode}
          onChange={(event) => {
            const mode = MODES.find((m) => m === event.target.value);
            if (mode) send({ kind: "mode", mode });
          }}
        >
          {MODES.map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
          {offered ? null : (
            <option value={state.mode} disabled>
              {state.mode}
            </option>
          )}
        </select>
      </label>
      <button type="button" className="btn quiet" onClick={() => send({ kind: "new_session" })}>
        New session
      </button>
    </header>
  );
}

function EmptyState({ state }: { state: State }) {
  if (!state.cwd) return null;
  const name = state.cwd.split("/").filter(Boolean).pop() ?? state.cwd;
  return (
    <div className="empty">
      <h1 className="empty-name">{name}</h1>
      <p className="empty-path">{shortPath(state.cwd, "", state.home)}</p>
      <p className="empty-hint">Ask Claude to read, change or run anything in this project. {MODE_HINTS[state.mode] ?? ""}</p>
    </div>
  );
}

function ItemView({ item, cwd, home, waiting }: { item: Item; cwd: string; home: string; waiting: boolean }) {
  switch (item.kind) {
    case "prompt":
      return <div className="prompt">{item.text}</div>;
    case "text":
      return <Markdown text={item.text} />;
    case "thinking":
      return (
        <details className="thinking">
          <summary>Thinking</summary>
          <Markdown text={item.text} />
        </details>
      );
    case "tool":
      return <ToolRow call={item.call} waiting={waiting} cwd={cwd} home={home} />;
    case "turn":
      return <TurnEnd item={item} />;
    case "notice":
      return (
        <p className="notice" data-tone={item.tone}>
          {item.text}
        </p>
      );
  }
}

/** What Claude is writing right now, before the finished message arrives. */
function LiveView({ live }: { live: Live | null }) {
  if (!live) return null;
  return (
    <>
      {live.blocks.slice(live.finalized).map((block, i) => {
        const key = `${live.messageId}:${live.finalized + i}`;
        if (block.kind === "text" && block.text) return <Markdown key={key} text={block.text} />;
        if (block.kind === "tool" && block.name) return <DraftToolRow key={key} name={block.name} />;
        return null;
      })}
    </>
  );
}

function TurnEnd({ item }: { item: Extract<Item, { kind: "turn" }> }) {
  const verb = { finished: "Finished in", stopped: "Stopped after", failed: "Failed after" }[item.outcome];
  return (
    <div className="turn-end" data-outcome={item.outcome}>
      <p className="turn">{`${verb} ${duration(item.durationMs)}`}</p>
      {item.detail ? <p className="turn-detail">{item.detail}</p> : null}
    </div>
  );
}

function Activity({ state }: { state: State }) {
  if (!state.connected) {
    return (
      <p className="activity" data-tone="error">
        Lost the connection to astrocode. Reconnecting…
      </p>
    );
  }
  const text = activity(state);
  return (
    <p className="activity" data-active={text ? "" : undefined} data-waiting={state.pending.length > 0 ? "" : undefined}>
      {text}
    </p>
  );
}

function activity(state: State) {
  if (state.pending.length === 1) return "Waiting for your decision";
  if (state.pending.length > 1) return `Waiting for ${state.pending.length} decisions`;
  const live = state.live;
  const block = live?.blocks.slice(live.finalized).findLast((b) => b !== undefined);
  if (block?.kind === "thinking") return "Thinking";
  if (block?.kind === "text") return "Writing";
  if (block?.kind === "tool") return `Preparing ${toolLabel(block.name ?? "a tool")}`;
  const running = state.items.findLast((item) => item.kind === "tool" && item.call.status === "running");
  if (running?.kind === "tool") return `Running ${toolLabel(running.call.name)}`;
  return state.busy ? "Working" : null;
}

function useSocket(dispatch: (action: Action) => void) {
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        dispatch({ type: "connected", connected: true });
      };
      ws.onmessage = (message) => {
        const frame = JSON.parse(String(message.data)) as ServerFrame;
        if (frame.kind === "replay") dispatch({ type: "replay", events: frame.events });
        else if (frame.kind === "reset") dispatch({ type: "reset" });
        else dispatch({ type: "event", event: frame });
      };
      ws.onclose = () => {
        dispatch({ type: "connected", connected: false });
        if (!stopped) timer = setTimeout(connect, Math.min(5000, 250 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [dispatch]);

  return useCallback((event: ClientEvent) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }, []);
}

/** Keeps the transcript scrolled to the bottom, unless you've scrolled up to read. */
function useStickToBottom(deps: unknown[]) {
  const ref = useRef<HTMLElement>(null);
  const pinned = useRef(true);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, deps);
  return { ref, onScroll };
}
