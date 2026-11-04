// The start screen, the transcript's first entry. Nothing is drawn large: astrocode's name and
// version and the Claude Code it runs on, where you are, what came from Claude Code, the latest
// sessions saved in this folder, and eight keys. Each part shows once it's known, so nothing on it
// is a guess.
import { Box, Text } from "ink";
import { basename } from "node:path";
import { version } from "../package.json";
import { ago, currentModel, modelLabel } from "../src/view/format";
import type { State } from "../src/view/state";
import { plural, shortPath } from "../src/view/tools";
import { ACTIONS, DEFAULT_KEYMAP, hintKey, type Action, type Keymap } from "./keys";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
import { MODE_CHIPS } from "./status";
import { PALETTE } from "./theme";

/** How many of the sessions saved here it lists. */
export const RECENT = 3;
/** Text runs no wider than this, at any width. */
const MEASURE = 110;
/** A key's column: four across where they fit, else two. */
const KEY_COLUMN = 27;
/** The least of a long branch the where line keeps. */
const BRANCH_LEAST = 16;

/** What the start screen says, as plain text, so a drawing of it is kept until any of it changes. */
export type Start = {
  /** Claude Code's version, once it has said. */
  engine?: string;
  /** Where you are: the folder, its branch, and then the model and effort, and the mode. */
  folder: string;
  branch?: string;
  setup: string[];
  /** What Claude Code loaded, such as `8 plugins`. */
  loaded: string[];
  recent: { title: string; when: string }[];
  keys: [key: string, does: string][];
};

export function startOf(state: State, branch: string | undefined, keymap: Keymap, now = Date.now()): Start {
  const { loaded } = state;
  const model = currentModel(state)?.name ?? (state.model ? modelLabel(state.model) : undefined);
  const effort = state.ultracode ? "ultracode" : state.effort;
  const count = (n: number | undefined, what: string) => (n ? [plural(n, what)] : []);
  const bound = (action: Action): [string, string][] => {
    const key = hintKey(keymap, action);
    return key ? [[key, ACTIONS[action]]] : [];
  };
  return {
    engine: loaded?.version,
    folder: shortPath(state.cwd, "", state.home),
    branch,
    setup: [
      ...(model ? [effort ? `${model} ${effort}` : model] : []),
      // Claude Code says its mode as it starts, before what it loaded; until then the mode is a guess.
      ...(loaded ? [MODE_CHIPS[state.mode].label] : []),
    ],
    loaded: [
      ...(loaded?.claudeMd === 1 ? ["CLAUDE.md"] : count(loaded?.claudeMd, "CLAUDE.md file")),
      ...count(loaded?.plugins, "plugin"),
      ...count(loaded?.mcpServers, "MCP server"),
      ...count(loaded?.skills, "skill"),
      // loadKeymap() hands back the defaults themselves when there's no keybindings.json, or it was turned down.
      ...(keymap === DEFAULT_KEYMAP ? [] : ["your keybindings"]),
    ],
    recent: (state.recent ?? []).map((saved) => ({ title: saved.title.replace(/\s+/g, " ").trim(), when: ago(saved.modified, now) })),
    keys: [
      ["/", "commands"],
      ["@", "files"],
      ["!", "shell command"],
      ["/help", "keys and commands"],
      ...bound("chat:cycleMode"),
      ...bound("app:toggleTranscript"),
      ["←", "agents"],
      ["esc", "stop Claude"],
    ],
  };
}

/** Whether all the start screen will say is known: what Claude Code loaded, and the sessions here. */
export function startReady(state: State) {
  return state.loaded !== undefined && state.recent !== undefined;
}

export function StartScreen({ start, width }: { start: Start; width: number }) {
  // Two columns in from each side, and no wider than the measure.
  const edge = Math.min(width - 2, MEASURE + 2);
  const room = edge - 2;
  const where = whereLine(start, room);
  const across = room - 2 >= 4 * KEY_COLUMN ? 4 : room - 2 >= 2 * KEY_COLUMN ? 2 : 1;
  const keyRows = Array.from({ length: Math.ceil(start.keys.length / across) }, (_, i) => start.keys.slice(i * across, (i + 1) * across));
  return (
    <Box flexDirection="column" paddingTop={1} paddingLeft={2} width={edge}>
      <Text wrap="truncate-end">
        <Text bold color={PALETTE.star}>
          astrocode
        </Text>
        <Text color={PALETTE.haze}>{`  ${version}${start.engine ? ` · Claude Code ${start.engine} underneath` : ""}`}</Text>
      </Text>
      <Text wrap="truncate-end" color={PALETTE.haze}>
        {where}
      </Text>
      {start.loaded.length ? (
        <Text wrap="truncate-end">
          <Text color={PALETTE.dust}>From Claude Code: </Text>
          <Text color={PALETTE.haze}>{start.loaded.join(" · ")}</Text>
        </Text>
      ) : null}
      {start.recent.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text wrap="truncate-end">
            <Text color={PALETTE.star}>Recent sessions here</Text>
            <Text color={PALETTE.dust}>   /resume picks one · astrocode -c continues the last</Text>
          </Text>
          {start.recent.map((one, i) => (
            <Box key={i} paddingLeft={2}>
              <Box flexGrow={1} flexShrink={1} marginRight={2}>
                <Text wrap="truncate-end">{one.title}</Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={PALETTE.dust}>{one.when}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        <Text color={PALETTE.star}>Keys</Text>
        {keyRows.map((row, i) => (
          <Box key={i} paddingLeft={2}>
            {row.map(([key, does]) => (
              <Box key={key} width={KEY_COLUMN} flexShrink={1}>
                <Text wrap="truncate-end">
                  <Text color={PALETTE.haze}>{key}</Text>
                  <Text color={PALETTE.dust}>{` ${does}`}</Text>
                </Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Where you are, in `room` columns. The model and mode stay whole; a long branch gives way first,
 * down to its start, and then the folder, down to its own name. Past that, the line is cut at its end.
 */
function whereLine({ folder, branch, setup }: Start, room: number) {
  const left = room - (setup.length ? cellWidth(setup.join(" · ")) + 3 : 0);
  const name = Math.max(2, Math.min(cellWidth(folder), cellWidth(basename(folder)) + 2));
  const cut = branch ? fit(branch, Math.max(left - name - 3, Math.min(cellWidth(branch), BRANCH_LEAST)), false) : "";
  return [fit(folder, Math.max(left - (cut ? cellWidth(cut) + 3 : 0), name), true), ...(cut ? [cut] : []), ...setup].join(" · ");
}
