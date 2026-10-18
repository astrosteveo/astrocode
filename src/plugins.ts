// Claude Code's plugins and marketplaces. The Agent SDK can load and reload plugins but can't
// install, remove, or turn them on and off, so this runs Claude Code's own `claude plugin`
// commands with --json, using the same binary the SDK runs. The session reloads its plugins after.
import { join } from "node:path";
import { claude } from "./claude";
import { field } from "./view/tools";

/** Where a plugin is installed: for you everywhere, for everyone on the project, or just you here. */
export type Scope = "user" | "project" | "local";

export const SCOPES: readonly Scope[] = ["user", "project", "local"];

export type InstalledPlugin = {
  /** `name@marketplace`. */
  id: string;
  name: string;
  marketplace: string;
  description: string;
  version?: string;
  /** A Scope, or where else Claude Code got the plugin, such as "synced" from claude.ai. */
  scope: string;
  enabled: boolean;
};

export type AvailablePlugin = { id: string; name: string; marketplace: string; description: string; installs?: number };

/** `source` is where it comes from: a GitHub repository, a URL or a folder. */
export type Marketplace = { name: string; source: string };

export type PluginCatalog = { installed: InstalledPlugin[]; available: AvailablePlugin[]; marketplaces: Marketplace[] };

/** How a `claude plugin` command went, in Claude Code's own words. */
export type PluginResult = { ok: boolean; message: string };

/** What's installed, what the marketplaces offer (most installed first), and the marketplaces. */
export async function pluginCatalog(cwd: string): Promise<PluginCatalog> {
  const [plugins, marketplaces] = await Promise.all([
    claudeJson(cwd, ["plugin", "list", "--json", "--available"]),
    claudeJson(cwd, ["plugin", "marketplace", "list", "--json"]),
  ]);
  const installed = await Promise.all(
    list(field(plugins, "installed")).map(async (entry): Promise<InstalledPlugin> => {
      const id = text(field(entry, "id"));
      const [name = id, marketplace = ""] = id.split("@");
      const path = text(field(entry, "installPath"));
      return {
        id,
        name,
        marketplace,
        description: path ? await manifestDescription(path) : "",
        version: text(field(entry, "version")) || undefined,
        scope: text(field(entry, "scope")),
        enabled: field(entry, "enabled") === true,
      };
    }),
  );
  const available = list(field(plugins, "available")).map((entry) => {
    const installs = field(entry, "installCount");
    return {
      id: text(field(entry, "pluginId")),
      name: text(field(entry, "name")),
      marketplace: text(field(entry, "marketplaceName")),
      description: text(field(entry, "description")),
      installs: typeof installs === "number" ? installs : undefined,
    };
  });
  return {
    installed: installed.filter((plugin) => plugin.id).sort((a, b) => a.name.localeCompare(b.name)),
    available: available.filter((plugin) => plugin.id).sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0)),
    marketplaces: list(marketplaces).map((entry) => ({
      name: text(field(entry, "name")),
      source: text(field(entry, "repo")) || text(field(entry, "url")) || text(field(entry, "path")) || text(field(entry, "source")),
    })),
  };
}

export const install = (cwd: string, id: string, scope: Scope) => pluginCommand(cwd, ["install", id, "--scope", scope]);

export const uninstall = (cwd: string, plugin: InstalledPlugin) => pluginCommand(cwd, ["uninstall", plugin.id, ...scopeOf(plugin)]);

export const update = (cwd: string, plugin: InstalledPlugin) => pluginCommand(cwd, ["update", plugin.id, ...scopeOf(plugin)]);

/** Claude Code turns on any id it's given, installed or not, so this is only offered for installed plugins. */
export const setEnabled = (cwd: string, plugin: InstalledPlugin, enabled: boolean) =>
  pluginCommand(cwd, [enabled ? "enable" : "disable", plugin.id, ...scopeOf(plugin)]);

export const addMarketplace = (cwd: string, source: string) => pluginCommand(cwd, ["marketplace", "add", source]);

export const removeMarketplace = (cwd: string, name: string) => pluginCommand(cwd, ["marketplace", "remove", name]);

export const updateMarketplace = (cwd: string, name: string) => pluginCommand(cwd, ["marketplace", "update", name]);

/** A plugin's own scope, when Claude Code takes it as one. */
function scopeOf(plugin: InstalledPlugin) {
  return (SCOPES as readonly string[]).includes(plugin.scope) ? ["--scope", plugin.scope] : [];
}

/**
 * Runs `claude plugin <args> --json`. The result is the last line on stdout. A command that needs
 * a person to confirm something, such as a plugin that installs by running a command, isn't
 * confirmed here: it fails and says why.
 */
async function pluginCommand(cwd: string, args: string[]): Promise<PluginResult> {
  const { out, err, code } = await claude(cwd, ["plugin", ...args, "--json"]);
  const line = out.trim().split("\n").at(-1) ?? "";
  try {
    const result: unknown = JSON.parse(line);
    const message = text(field(result, "message"));
    if (message) return { ok: code === 0 && field(result, "outcome") !== "failed", message };
  } catch {
    // Not JSON: fall back to what it printed.
  }
  const said = (code === 0 ? out : err || out).replace(/^[✘✔]\s*/gm, "").trim();
  return { ok: code === 0, message: said || (code === 0 ? "Done." : `claude plugin ${args[0]} failed.`) };
}

async function claudeJson(cwd: string, args: string[]): Promise<unknown> {
  const { out, err, code } = await claude(cwd, args);
  if (code !== 0) throw new Error(err.trim() || `claude ${args.join(" ")} failed`);
  return JSON.parse(out);
}

async function manifestDescription(installPath: string) {
  try {
    return text(field(await Bun.file(join(installPath, ".claude-plugin", "plugin.json")).json(), "description"));
  } catch {
    return "";
  }
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
