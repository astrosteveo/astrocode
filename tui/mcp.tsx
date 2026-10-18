// /mcp: the MCP servers Claude Code knows, how each is doing, and the tools each serves. Enter on
// one reconnects it, turns it off or on for this project, or signs in or out. The list is read
// again every two seconds while it's open, since servers connect, fail and finish signing in on
// their own time.
import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text } from "ink";
import { useEffect, useRef, useState } from "react";
import { line } from "../src/dialogs";
import type { AgentSession, McpSignIn } from "../src/session";
import { plural, shortPath } from "../src/view/tools";
import { copy } from "./clipboard";
import { hyperlink } from "./links";
import { clip, Manager, type Action, type Outcome, type Page, type Row } from "./manager";
import { fit } from "./markdown-view";
import { PALETTE } from "./theme";

/** How often the list is read again while it's open. */
const REFRESH_MS = 2000;
/** The most tools a server's page lists. */
const TOOL_LINES = 8;

const STATUS: Record<McpServerStatus["status"], { glyph: string; color: string; words: string }> = {
  connected: { glyph: "●", color: PALETTE.teal, words: "connected" },
  pending: { glyph: "◌", color: PALETTE.haze, words: "connecting" },
  "needs-auth": { glyph: "●", color: PALETTE.gold, words: "needs you to sign in" },
  failed: { glyph: "✕", color: PALETTE.rose, words: "failed" },
  disabled: { glyph: "○", color: PALETTE.dust, words: "off" },
};

/** Where a server is set up, in the order the list shows them. */
const SCOPES: Record<string, string> = {
  local: "for you, here only",
  project: "for this project",
  user: "for you",
  plugin: "from a plugin",
  claudeai: "from claude.ai",
  dynamic: "for this session",
  agent: "for an agent",
  managed: "managed",
  enterprise: "managed",
  sdk: "in astrocode",
};

type Props = {
  session: AgentSession;
  cwd: string;
  home: string;
  width: number;
  rows: number;
  /** Opens a web address in the desktop's browser, and says whether it could. */
  onOpen: (url: string) => Promise<boolean>;
  onOutcome: (outcome: Outcome) => void;
  onClose: () => void;
};

export function McpPanel({ session, cwd, home, width, rows, onOpen, onOutcome, onClose }: Props) {
  const [servers, setServers] = useState<McpServerStatus[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** Sign-ins started here, by server, until the server connects. Opened: the browser came up. */
  const [signing, setSigning] = useState<Record<string, McpSignIn & { opened: boolean }>>({});
  const signingNow = useRef(signing);
  signingNow.current = signing;

  /** Reads the list again. A sign-in is over once its server connects, which is said unless what's reading it says so itself. */
  const load = (announce = true) =>
    session.mcpServers().then(
      (next) => {
        setServers(next);
        setFailure(null);
        const done = next.filter((server) => server.status === "connected" && signingNow.current[server.name]);
        if (done.length) {
          signingNow.current = Object.fromEntries(Object.entries(signingNow.current).filter(([name]) => !done.some((server) => server.name === name)));
          setSigning(signingNow.current);
          if (announce) for (const server of done) onOutcome({ ok: true, message: `Signed in to ${line(server.name)}.` });
        }
        return next;
      },
      (error: unknown) => {
        setFailure(`Couldn't ask Claude Code about its MCP servers: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      },
    );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  /** Runs a change to a server, with what was typed if it takes that, then reads the list again and says how the server is doing after it. */
  const change = (name: string, act: (text: string) => Promise<void>, said: (after: McpServerStatus | undefined) => Outcome) => async (text = "") => {
    let failed: unknown;
    try {
      await act(text);
    } catch (error) {
      failed = error;
    }
    const after = (await load(false))?.find((server) => server.name === name);
    if (failed !== undefined) return { ok: false, message: `${line(name)}: ${failed instanceof Error ? failed.message : String(failed)}` };
    return said(after);
  };

  const signIn = (server: McpServerStatus): Action => ({
    label: server.config?.type === "claudeai-proxy" ? "Sign in on claude.ai" : "Sign in",
    note: "in your browser",
    doing: `Starting to sign in to ${line(server.name)}…`,
    stay: true,
    run: async () => {
      const started = await session.signInMcp(server.name);
      if (!started.url) {
        await load();
        return { ok: true, message: `${line(server.name)} is signed in already.` };
      }
      const opened = await onOpen(started.url);
      setSigning((now) => ({ ...now, [server.name]: { ...started, opened } }));
    },
  });

  const pageOf = (server: McpServerStatus): Page => {
    const name = line(server.name);
    const sign = signing[server.name];
    const transport = server.config?.type ?? "stdio";
    const oauth = transport === "http" || transport === "sse";
    const actions: Action[] = [];
    if (sign?.url) {
      const url = sign.url;
      actions.push(
        { label: "Open the page again", note: "in your browser", run: () => void onOpen(url) },
        {
          label: "Copy its address",
          note: "to open it yourself",
          run: () => {
            copy(url);
            return Promise.resolve({ ok: true, message: `Copied the address to sign in to ${name}.` });
          },
          stay: true,
        },
      );
    } else if (server.status === "needs-auth") actions.push(signIn(server));
    if (server.status !== "disabled") {
      actions.push({
        label: "Reconnect",
        doing: `Reconnecting ${name}…`,
        stay: true,
        run: change(server.name, () => session.reconnectMcp(server.name), (after) =>
          after?.status === "connected"
            ? { ok: true, message: `${name} connected again.` }
            : { ok: false, message: `${name} ${after ? STATUS[after.status].words : "is gone"}${after?.error ? `: ${line(after.error)}` : "."}` },
        ),
      });
    }
    if (oauth && server.status !== "needs-auth" && server.status !== "disabled" && !sign) {
      actions.push({
        label: "Sign out",
        note: "forget its sign-in",
        doing: `Signing out of ${name}…`,
        stay: true,
        run: change(server.name, () => session.signOutMcp(server.name), () => ({ ok: true, message: `Signed out of ${name}.` })),
      });
    }
    // A server the SDK host runs itself isn't Claude Code's to turn off.
    if (server.scope !== "sdk" && server.source !== "sdk") {
      const on = server.status === "disabled";
      actions.push({
        label: on ? "Turn on" : "Turn off",
        note: "for this project",
        doing: `Turning ${name} ${on ? "on" : "off"}…`,
        run: change(server.name, () => session.toggleMcp(server.name, on), () => ({ ok: true, message: `Turned ${name} ${on ? "on" : "off"} for this project.` })),
      });
    }
    return {
      title: name,
      description: addressOf(server, cwd, home),
      facts: factsOf(server).join(" · "),
      body: <ServerBody server={server} sign={sign} width={width - 4} />,
      actions,
      field:
        sign?.waits && server.status !== "connected"
          ? {
              label: "Address it ended on",
              // Claude Code keeps the sign-in it was given this way, but doesn't connect with it by itself.
              submit: change(
                server.name,
                async (url) => {
                  await session.finishMcpSignIn(server.name, url);
                  await session.reconnectMcp(server.name);
                },
                (after) =>
                  after?.status === "connected"
                    ? { ok: true, message: `Signed in to ${name}.` }
                    : { ok: false, message: `${name} ${after ? STATUS[after.status].words : "is gone"}${after?.error ? `: ${line(after.error)}` : "."}` },
              ),
            }
          : undefined,
    };
  };

  const rowsOf = (list: McpServerStatus[]): Row[] =>
    [...list]
      .sort((a, b) => scopeRank(a) - scopeRank(b) || a.name.localeCompare(b.name))
      .map((server) => {
        const status = STATUS[server.status];
        const tools = server.status === "connected" && server.tools ? plural(server.tools.length, "tool") : "";
        return {
          key: server.name,
          label: line(server.name),
          mark: { glyph: status.glyph, color: status.color },
          note: [status.words, SCOPES[server.scope ?? ""] ?? server.scope, tools].filter(Boolean).join(" · "),
          description: server.status === "failed" && server.error ? line(server.error) : addressOf(server, cwd, home),
          dim: server.status === "disabled",
          page: () => pageOf(server),
        };
      });

  return (
    <Manager
      title="MCP servers"
      lists={[
        {
          key: "servers",
          name: "Servers",
          rows: servers ? rowsOf(servers) : null,
          empty: "There are no MCP servers. Add one with `claude mcp add` in a terminal, or in this project's .mcp.json.",
        },
      ]}
      failure={failure}
      width={width}
      rows={rows}
      onOutcome={onOutcome}
      onClose={onClose}
    />
  );
}

/** A server's error, where it is in its sign-in, and its tools. */
function ServerBody({ server, sign, width }: { server: McpServerStatus; sign: (McpSignIn & { opened: boolean }) | undefined; width: number }) {
  const tools = server.status === "connected" ? (server.tools ?? []) : [];
  const names = Math.min(28, Math.max(0, ...tools.map((tool) => tool.name.length)));
  return (
    <Box flexDirection="column">
      {server.status === "failed" && server.error ? <Text color={PALETTE.rose}>{clip(line(server.error), width, 4)}</Text> : null}
      {sign?.url && server.status !== "connected" ? (
        <Box flexDirection="column">
          <Text color={PALETTE.gold}>
            {sign.opened ? "Sign in on the page that opened in your browser." : "Open this address in a browser to sign in:"}
          </Text>
          {sign.opened ? null : <Text color={PALETTE.sky}>{hyperlink(sign.url, fit(sign.url, width, false))}</Text>}
          <Text color={PALETTE.haze}>
            {clip(
              sign.waits
                ? "Claude Code is waiting for the browser to come back to it on this machine. If the browser is on another machine, paste the address it ended on below."
                : "Once it's connected there, choose Reconnect.",
              width,
              4,
            )}
          </Text>
        </Box>
      ) : null}
      {tools.length ? (
        <Box flexDirection="column">
          <Text color={PALETTE.haze}>{plural(tools.length, "tool")}</Text>
          {tools.slice(0, TOOL_LINES).map((tool) => (
            <Text key={tool.name} wrap="truncate-end">
              <Text color={PALETTE.star}>{`  ${fit(line(tool.name), names, false).padEnd(names)}`}</Text>
              {tool.annotations?.destructive ? <Text color={PALETTE.ember}>{"  changes things"}</Text> : tool.annotations?.readOnly ? <Text color={PALETTE.teal}>{"  reads only"}</Text> : null}
              {tool.description ? <Text color={PALETTE.haze}>{`  ${line(tool.description)}`}</Text> : null}
            </Text>
          ))}
          {tools.length > TOOL_LINES ? <Text color={PALETTE.dust}>{`  and ${tools.length - TOOL_LINES} more`}</Text> : null}
        </Box>
      ) : null}
    </Box>
  );
}

/** Its status, where it's set up, how it's reached, and its version. */
function factsOf(server: McpServerStatus) {
  const version = server.serverInfo ? `${line(server.serverInfo.name)} ${line(server.serverInfo.version)}` : "";
  return [STATUS[server.status].words, SCOPES[server.scope ?? ""] ?? server.scope ?? "", server.config?.type ?? "", version].filter(Boolean);
}

/** Its URL, or the command that starts it. */
function addressOf(server: McpServerStatus, cwd: string, home: string) {
  const config = server.config;
  if (!config) return "";
  if ("url" in config && typeof config.url === "string") return line(config.url);
  if ("command" in config && typeof config.command === "string") return line([shortPath(config.command, cwd, home), ...(config.args ?? [])].join(" "));
  return "";
}

function scopeRank(server: McpServerStatus) {
  const at = Object.keys(SCOPES).indexOf(server.scope ?? "");
  return at === -1 ? Object.keys(SCOPES).length : at;
}
