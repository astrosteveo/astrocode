// /plugins: what's installed, what the marketplaces offer, and the marketplaces themselves, on a
// panel with a gold top edge while it has your keys. Tab switches lists, typing filters, Enter opens
// what can be done to a row. Every change runs Claude Code's own `claude plugin` command; the app
// then reloads the session's plugins. In full screen, click a tab, a row or an action.
import { Box, Text, useInput, type DOMElement } from "ink";
import { useEffect, useReducer, useRef, useState } from "react";
import wrapAnsi from "wrap-ansi";
import {
  addMarketplace,
  install,
  pluginCatalog,
  removeMarketplace,
  setEnabled,
  uninstall,
  update,
  updateMarketplace,
  type AvailablePlugin,
  type InstalledPlugin,
  type Marketplace,
  type PluginCatalog,
  type PluginResult,
  type Scope,
} from "../src/plugins";
import { ChoiceRow } from "./choice";
import { cellWidth, takeCells } from "./markdown";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE } from "./theme";

const TABS = ["installed", "discover", "marketplaces"] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = { installed: "Installed", discover: "Discover", marketplaces: "Marketplaces" };

/** Where each install choice puts the plugin. */
const INSTALL_TO: { scope: Scope; label: string; note: string }[] = [
  { scope: "user", label: "Install for you", note: "in every project" },
  { scope: "project", label: "Install for this project", note: "for everyone, in .claude/settings.json" },
  { scope: "local", label: "Install for you, here only", note: "in .claude/settings.local.json" },
];

const SCOPE_WORDS: Record<string, string> = {
  user: "for you",
  project: "for this project",
  local: "for you, here only",
  synced: "from claude.ai",
};

type Row =
  | { kind: "installed"; key: string; plugin: InstalledPlugin }
  | { kind: "available"; key: string; plugin: AvailablePlugin }
  | { kind: "marketplace"; key: string; marketplace: Marketplace }
  /** The filter, in the marketplaces list, read as a marketplace to add. */
  | { kind: "add"; key: string; source: string };

/** Which list is showing, what it's filtered by, the focused row, and the row whose actions are open. */
type Nav = { tab: Tab; filter: string; selected: number; open: { row: Row; selected: number } | null };

/** Something to do to the open row. `doing` is what the panel says while it runs. */
type Action = { label: string; note?: string; doing?: string; run: () => Promise<PluginResult> | void };

type Props = {
  cwd: string;
  width: number;
  rows: number;
  /** A change went through, or didn't. */
  onResult: (result: PluginResult) => void;
  onClose: () => void;
};

export function PluginManager({ cwd, width, rows, onResult, onClose }: Props) {
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  // In a ref, like the message box's text, because keys can arrive faster than React re-renders.
  const nav = useRef<Nav>({ tab: "installed", filter: "", selected: 0, open: null });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const panel = useRef<DOMElement>(null);
  const list = useRef<DOMElement>(null);
  const tabs = useRef<(DOMElement | null)[]>([]);

  const go = (change: Partial<Nav>) => {
    nav.current = { ...nav.current, ...change };
    redraw();
  };

  const load = () =>
    pluginCatalog(cwd).then(
      (next) => {
        setCatalog(next);
        setFailure(null);
      },
      (error: unknown) => setFailure(messageOf(error)),
    );

  useEffect(() => {
    void load();
  }, [cwd]);

  const perform = (action: Action) => {
    const pending = action.run();
    if (!pending) return;
    const { tab } = nav.current;
    setWorking(action.doing ?? "Working…");
    void pending
      .catch((error: unknown): PluginResult => ({ ok: false, message: messageOf(error) }))
      .then((result) => {
        onResult(result);
        setWorking(null);
        if (!result.ok) return go({ open: null });
        // A marketplace that was just added clears the filter it was typed into, and an
        // installed plugin leaves Discover for Installed.
        go({ open: null, ...(tab === "marketplaces" ? { filter: "" } : tab === "discover" ? { tab: "installed" } : {}) });
        return load();
      });
  };

  const actionsOf = (row: Row): Action[] => {
    switch (row.kind) {
      case "installed": {
        const { plugin } = row;
        return [
          {
            label: plugin.enabled ? "Turn off" : "Turn on",
            doing: `Turning ${plugin.name} ${plugin.enabled ? "off" : "on"}…`,
            run: () => setEnabled(cwd, plugin, !plugin.enabled),
          },
          { label: "Update", note: "to its marketplace's latest version", doing: `Updating ${plugin.name}…`, run: () => update(cwd, plugin) },
          { label: "Uninstall", note: "and delete its saved data", doing: `Uninstalling ${plugin.name}…`, run: () => uninstall(cwd, plugin) },
        ];
      }
      case "available":
        return INSTALL_TO.map(({ scope, label, note }) => ({
          label,
          note,
          doing: `Installing ${row.plugin.name}…`,
          run: () => install(cwd, row.plugin.id, scope),
        }));
      case "marketplace": {
        const { name } = row.marketplace;
        return [
          { label: "Show its plugins", run: () => go({ open: null, tab: "discover", filter: name, selected: 0 }) },
          { label: "Update", note: "fetch its latest list of plugins", doing: `Updating ${name}…`, run: () => updateMarketplace(cwd, name) },
          { label: "Remove", doing: `Removing ${name}…`, run: () => removeMarketplace(cwd, name) },
        ];
      }
      case "add":
        return [{ label: `Add ${row.source}`, doing: `Adding ${row.source}…`, run: () => addMarketplace(cwd, row.source) }];
    }
  };

  /** What the latest state shows: the tab's matching rows, the focused one, and the open row's actions. */
  const current = () => {
    const { tab, filter, selected, open } = nav.current;
    const shown = catalog ? rowsOf(catalog, tab, filter) : [];
    const index = Math.min(selected, Math.max(0, shown.length - 1));
    const start = Math.min(Math.max(0, index - Math.floor(rows / 2)), Math.max(0, shown.length - rows));
    return { tab, filter, open, shown, index, start, focused: shown[index], actions: open ? actionsOf(open.row) : [] };
  };

  /** Enter on a row: adding a marketplace happens at once; anything else shows what can be done. */
  const choose = (row: Row) => {
    if (row.kind === "add") return perform(actionsOf(row)[0]!);
    go({ open: { row, selected: 0 } });
  };

  const moveRow = (step: number) => {
    const { shown, index } = current();
    go({ selected: Math.max(0, Math.min(shown.length - 1, index + step)) });
  };

  const moveAction = (step: number) => {
    const { open, actions } = current();
    if (open) go({ open: { ...open, selected: Math.max(0, Math.min(actions.length - 1, open.selected + step)) } });
  };

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.ctrl && input === "c") return onClose();
    const { tab, open, actions, focused } = current();
    if (open) {
      if (key.escape || key.leftArrow) return go({ open: null });
      if (working) return;
      if (key.upArrow || key.downArrow) return moveAction(key.upArrow ? -1 : 1);
      const action = actions[open.selected];
      if (key.return && action) perform(action);
      return;
    }
    if (key.escape) return onClose();
    if (key.tab || key.leftArrow || key.rightArrow) {
      const step = key.leftArrow || (key.tab && key.shift) ? -1 : 1;
      return go({ tab: TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]!, selected: 0 });
    }
    if (key.upArrow || key.downArrow) return moveRow(key.upArrow ? -1 : 1);
    if (key.pageUp || key.pageDown) return moveRow(key.pageUp ? -rows : rows);
    if (key.return) {
      if (focused && !working) choose(focused);
      return;
    }
    // Space turns an installed plugin on or off. Plugin names have no spaces to filter by.
    if (input === " " && focused?.kind === "installed") {
      if (!working) perform(actionsOf(focused)[0]!);
      return;
    }
    if (key.backspace) return go({ filter: nav.current.filter.slice(0, -1), selected: 0 });
    if (key.ctrl || key.meta || !input) return;
    go({ filter: nav.current.filter + input, selected: 0 });
  });

  useMouse((event) => {
    if (!hit(panel.current, event)) return;
    event.handled = true;
    if (event.type === "wheel") return nav.current.open ? moveAction(event.wheel) : moveRow(event.wheel);
    if (event.type !== "press" || event.button !== "left" || working) return;
    const { open, actions, shown, start } = current();
    const at = hit(list.current, event);
    if (open) {
      const action = at ? actions[at.y] : undefined;
      if (action) perform(action);
      return;
    }
    const clickedTab = TABS.find((_, i) => hit(tabs.current[i], event));
    if (clickedTab) return go({ tab: clickedTab, selected: 0 });
    const row = at ? shown[start + at.y] : undefined;
    if (!row) return;
    go({ selected: start + (at?.y ?? 0) });
    choose(row);
  });
  const hovered = useHover(panel, (_x, _y, pointer) => {
    if (working) return null;
    const { open, actions, shown, start } = current();
    const at = hit(list.current, pointer);
    if (open) return at && actions[at.y] ? { key: `action:${at.y}`, shape: "pointer" } : null;
    const overTab = TABS.find((_, i) => hit(tabs.current[i], pointer));
    if (overTab) return { key: `tab:${overTab}`, shape: "pointer" };
    return at && shown[start + at.y] ? { key: `row:${start + at.y}`, shape: "pointer" } : null;
  });

  const { tab, filter, open, shown, index, start, focused, actions } = current();
  const visible = shown.slice(start, start + rows);
  const inner = width - 2;

  const footer = working ? (
    <Text color={PALETTE.teal}>{working}</Text>
  ) : (
    <Text color={PALETTE.dust} wrap="truncate-end">
      {open
        ? "↑↓ to choose   enter to select   esc to go back"
        : `↑↓ to choose   ${focused?.kind === "installed" ? "space turns on or off   " : ""}enter for more   tab for the next list   esc to close`}
    </Text>
  );

  if (open) {
    const about = aboutOf(open.row);
    const labels = Math.max(...actions.map((action) => cellWidth(action.label)));
    return (
      <Box ref={panel} flexDirection="column">
        <Panel width={width} accent={PALETTE.gold}>
          <Text wrap="truncate-end">
            <Text color={PALETTE.haze}>{"Plugins › "}</Text>
            <Text bold color={PALETTE.star}>
              {titleOf(open.row)}
            </Text>
          </Text>
          <Box marginTop={1} flexDirection="column">
            {about.description ? <Text color={PALETTE.star}>{clip(about.description, inner - 2, 4)}</Text> : null}
            <Text color={PALETTE.haze} wrap="truncate-end">
              {about.facts}
            </Text>
          </Box>
          {open.row.kind === "available" ? (
            <Box marginTop={1}>
              <Text color={PALETTE.ember}>
                {clip("A plugin's hooks, commands and MCP servers run on this machine as you. Install only ones you trust.", inner - 2, 2)}
              </Text>
            </Box>
          ) : null}
          <Box ref={list} flexDirection="column" marginTop={1}>
            {actions.map((action, i) => {
              const isFocused = i === open.selected;
              return (
                <ChoiceRow key={action.label} selected={isFocused} hovered={hovered === `action:${i}`} width={inner}>
                  <Text wrap="truncate-end">
                    <Text bold={isFocused} color={isFocused ? PALETTE.star : undefined}>
                      {action.label.padEnd(labels)}
                    </Text>
                    {action.note ? <Text color={PALETTE.haze}>{`   ${action.note}`}</Text> : null}
                  </Text>
                </ChoiceRow>
              );
            })}
          </Box>
          <Box marginTop={1}>{footer}</Box>
        </Panel>
      </Box>
    );
  }

  const counts: Record<Tab, number | undefined> = {
    installed: catalog?.installed.length,
    discover: catalog?.available.length,
    marketplaces: catalog?.marketplaces.length,
  };
  const names = Math.min(28, Math.max(8, ...visible.map((row) => cellWidth(titleOf(row)))));
  const hint = tab === "marketplaces" ? "type to filter, or owner/repo to add" : "type to filter";
  const description = focused ? aboutOf(focused).description : "";
  return (
    <Box ref={panel} flexDirection="column">
      <Panel width={width} accent={PALETTE.gold} note={shown.length > rows ? `${(index + 1).toLocaleString("en-US")} of ${shown.length.toLocaleString("en-US")}` : undefined}>
        <Box>
          <Text bold color={PALETTE.star}>
            Plugins
          </Text>
          {TABS.map((name, i) => (
            <Box
              key={name}
              marginLeft={2}
              ref={(element: DOMElement | null) => {
                tabs.current[i] = element;
              }}
            >
              <Text
                color={name === tab ? PALETTE.gold : PALETTE.haze}
                backgroundColor={name !== tab && hovered === `tab:${name}` ? PALETTE.hover : undefined}
                bold={name === tab}
                underline={name === tab}
              >
                {TAB_NAMES[name]}
              </Text>
              {counts[name] !== undefined ? <Text color={PALETTE.dust}>{` ${counts[name].toLocaleString("en-US")}`}</Text> : null}
            </Box>
          ))}
          <Box flexGrow={1} />
          <Text color={filter ? PALETTE.gold : PALETTE.dust} wrap="truncate-start">
            {filter ? `  ${filter}` : `  ${hint}`}
          </Text>
        </Box>
        <Box ref={list} flexDirection="column" marginTop={1}>
          {failure ? (
            <Text color={PALETTE.rose}>{`Couldn't list plugins: ${failure}`}</Text>
          ) : catalog === null ? (
            <Text color={PALETTE.haze}>Loading plugins…</Text>
          ) : shown.length === 0 ? (
            <Text color={PALETTE.haze}>{filter ? "Nothing matches." : EMPTY[tab]}</Text>
          ) : (
            visible.map((row, i) => {
              const isFocused = start + i === index;
              return (
                <ChoiceRow key={row.key} selected={isFocused} hovered={hovered === `row:${start + i}`} width={inner}>
                  <RowView row={row} focused={isFocused} names={names} />
                </ChoiceRow>
              );
            })
          )}
        </Box>
        {description ? (
          <Box marginTop={1}>
            <Text color={PALETTE.haze}>{clip(description, inner - 2, 2)}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>{footer}</Box>
      </Panel>
    </Box>
  );
}

const EMPTY: Record<Tab, string> = {
  installed: "No plugins are installed. Tab over to Discover to find some.",
  discover: "The marketplaces offer nothing that isn't installed already.",
  marketplaces: "No marketplaces yet. Type owner/repo, a URL or a folder to add one.",
};

function RowView({ row, focused, names }: { row: Row; focused: boolean; names: number }) {
  const name = takeCells(titleOf(row), names)[0].padEnd(names);
  const label = (color?: string) => (
    <Text bold={focused} color={focused ? PALETTE.star : color}>
      {name}
    </Text>
  );
  switch (row.kind) {
    case "installed": {
      const { plugin } = row;
      return (
        <Text wrap="truncate-end">
          <Text color={plugin.enabled ? PALETTE.teal : PALETTE.dust}>{plugin.enabled ? "● " : "○ "}</Text>
          {label(plugin.enabled ? undefined : PALETTE.haze)}
          <Text color={PALETTE.haze}>
            {/* A plugin from claude.ai is in the "synced" marketplace, which its scope already says. */}
            {`   ${[plugin.marketplace === plugin.scope ? "" : plugin.marketplace, SCOPE_WORDS[plugin.scope] ?? plugin.scope, plugin.enabled ? "" : "off"].filter(Boolean).join(" · ")}`}
          </Text>
        </Text>
      );
    }
    case "available":
      return (
        <Text wrap="truncate-end">
          {label()}
          <Text color={PALETTE.haze}>{`   ${[row.plugin.marketplace, installsOf(row.plugin)].filter(Boolean).join(" · ")}`}</Text>
        </Text>
      );
    case "marketplace":
      return (
        <Text wrap="truncate-end">
          {label()}
          <Text color={PALETTE.haze}>{`   ${row.marketplace.source}`}</Text>
        </Text>
      );
    case "add":
      return (
        <Text wrap="truncate-end">
          <Text color={PALETTE.teal}>{"+ "}</Text>
          <Text bold={focused} color={PALETTE.star}>{`Add the marketplace ${row.source}`}</Text>
        </Text>
      );
  }
}

/** The tab's rows that match the filter: names that start with it, then names that contain it, then the rest. */
function rowsOf(catalog: PluginCatalog, tab: Tab, filter: string): Row[] {
  const wanted = filter.trim().toLowerCase();
  const rank = (name: string, ...more: string[]) => {
    if (!wanted) return 0;
    const lower = name.toLowerCase();
    if (lower.startsWith(wanted)) return 0;
    if (lower.includes(wanted)) return 1;
    return more.some((text) => text.toLowerCase().includes(wanted)) ? 2 : 3;
  };
  const ranked = <T,>(items: T[], ranker: (item: T) => number) =>
    items
      .map((item, i) => ({ item, rank: ranker(item), i }))
      .filter((entry) => entry.rank < 3)
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((entry) => entry.item);
  switch (tab) {
    case "installed":
      return ranked(catalog.installed, (p) => rank(p.name, p.marketplace, p.description)).map((plugin) => ({ kind: "installed", key: plugin.id, plugin }));
    case "discover":
      return ranked(catalog.available, (p) => rank(p.name, p.marketplace, p.description)).map((plugin) => ({ kind: "available", key: plugin.id, plugin }));
    case "marketplaces": {
      const rows: Row[] = ranked(catalog.marketplaces, (m) => rank(m.name, m.source)).map((marketplace) => ({
        kind: "marketplace",
        key: marketplace.name,
        marketplace,
      }));
      const source = filter.trim();
      const known = catalog.marketplaces.some((m) => m.source === source || m.name === source);
      return isSource(source) && !known ? [{ kind: "add", key: "+add", source }, ...rows] : rows;
    }
  }
}

/** Something `claude plugin marketplace add` takes: owner/repo, a URL, or a path. */
function isSource(text: string) {
  return /^(https?:\/\/|git@|~\/|\.{0,2}\/)\S+$|^[\w.-]+\/[\w.-]+$/.test(text);
}

function titleOf(row: Row) {
  switch (row.kind) {
    case "installed":
    case "available":
      return row.plugin.name;
    case "marketplace":
      return row.marketplace.name;
    case "add":
      return row.source;
  }
}

/** A row's description, and a line of facts about it. */
function aboutOf(row: Row): { description: string; facts: string } {
  switch (row.kind) {
    case "installed": {
      const { plugin } = row;
      const scope = SCOPE_WORDS[plugin.scope] ?? plugin.scope;
      const facts = [plugin.id, `installed ${scope}`, plugin.version ? `version ${plugin.version}` : "", plugin.enabled ? "on" : "off"];
      return { description: plugin.description, facts: facts.filter(Boolean).join(" · ") };
    }
    case "available":
      return { description: row.plugin.description, facts: [row.plugin.id, installsOf(row.plugin)].filter(Boolean).join(" · ") };
    case "marketplace":
      return { description: "", facts: row.marketplace.source };
    case "add":
      return { description: "", facts: "" };
  }
}

function installsOf(plugin: AvailablePlugin) {
  if (plugin.installs === undefined) return "";
  const count = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(plugin.installs);
  return `${count} ${plugin.installs === 1 ? "install" : "installs"}`;
}

/** `text` wrapped to `room`, no more than `lines` lines, with an ellipsis if it was cut. */
function clip(text: string, room: number, lines: number) {
  const wrapped = wrapAnsi(text.replace(/\s+/g, " ").trim(), Math.max(10, room), { hard: true }).split("\n");
  if (wrapped.length <= lines) return wrapped.join("\n");
  const kept = wrapped.slice(0, lines);
  kept[lines - 1] = `${takeCells(kept[lines - 1] ?? "", Math.max(1, room - 1))[0]}…`;
  return kept.join("\n");
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
