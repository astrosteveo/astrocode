// astrocode's web front end: serves the page and bridges it to one Claude Code session.
import { homedir } from "node:os";
import type { ServerWebSocket } from "bun";
import page from "../web/index.html";
import { MODES, type ClientEvent, type Mode, type ServerEvent, type ServerFrame } from "./protocol";
import { AgentSession } from "./session";

export type WebOptions = { cwd: string; port: number; model?: string };

export function startWeb({ cwd, port, model }: WebOptions) {
  const clients = new Set<ServerWebSocket<unknown>>();
  let log: ServerEvent[] = [];

  const broadcast = (frame: ServerFrame) => {
    const text = JSON.stringify(frame);
    for (const ws of clients) ws.send(text);
  };

  const emit = (event: ServerEvent) => {
    log.push(event);
    broadcast(event);
  };

  const session = new AgentSession({ cwd, model, emit });

  // The page is the only thing allowed to drive the session. Browsers let any site open a
  // WebSocket to localhost, so without these checks a web page could run commands here.
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  const handle = async (event: ClientEvent) => {
    try {
      switch (event.kind) {
        case "prompt":
          session.send(event.text);
          break;
        case "decide":
          session.decide(event.id, event.decision);
          break;
        case "interrupt":
          await session.interrupt();
          break;
        case "mode":
          await session.setMode(event.mode);
          break;
        case "new_session":
          session.reset();
          log = [];
          broadcast({ kind: "reset" });
          emit({ kind: "hello", cwd, home: homedir() });
          session.start();
          break;
      }
    } catch (error) {
      emit({ kind: "notice", tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    development: process.env.NODE_ENV === "production" ? false : { hmr: true, console: false },
    routes: { "/": page },
    fetch(req, server) {
      if (new URL(req.url).pathname !== "/ws") return new Response("Not found", { status: 404 });
      const origin = req.headers.get("origin");
      const host = req.headers.get("host");
      if (!origin || !origins.has(origin) || !host || !origins.has(`http://${host}`)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (server.upgrade(req, { data: undefined })) return;
      return new Response("Expected a WebSocket", { status: 426 });
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ kind: "replay", events: log } satisfies ServerFrame));
      },
      close(ws) {
        clients.delete(ws);
      },
      message(_ws, data) {
        const event = parse(String(data));
        if (event) void handle(event);
      },
    },
  });

  emit({ kind: "hello", cwd, home: homedir() });
  session.start();

  console.log(`astrocode is running Claude Code in ${cwd}`);
  console.log(`Open ${server.url}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      session.close();
      void server.stop(true);
      process.exit(0);
    });
  }
}

/** Accepts only well-formed events from the page. */
function parse(text: string): ClientEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const event = value as Record<string, unknown>;
  switch (event.kind) {
    case "prompt":
      return typeof event.text === "string" && event.text.trim() ? { kind: "prompt", text: event.text } : null;
    case "decide":
      return typeof event.id === "string" && (event.decision === "allow" || event.decision === "always" || event.decision === "deny")
        ? { kind: "decide", id: event.id, decision: event.decision }
        : null;
    case "mode":
      return isMode(event.mode) ? { kind: "mode", mode: event.mode } : null;
    case "interrupt":
    case "new_session":
      return { kind: event.kind };
    default:
      return null;
  }
}

function isMode(value: unknown): value is Mode {
  return MODES.some((mode) => mode === value);
}
