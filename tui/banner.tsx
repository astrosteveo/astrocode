// The welcome: the wordmark in block letters, washed with the nebula gradient, and where you are.
import { Box, Text } from "ink";
import { shortPath } from "../src/view/tools";
import { gradient, NEBULA, ACCENT } from "./theme";

const WORDMARK = ["▄▀█ █▀ ▀█▀ █▀█ █▀█ █▀▀ █▀█ █▀▄ █▀▀", "█▀█ ▄█  █  █▀▄ █▄█ █▄▄ █▄█ █▄▀ ██▄"];
const STARS = ["   ·   ✦      ˚    ·", "     ✧     ·    ✦"];
const WIDTH = [...(WORDMARK[0] ?? "")].length;

type Props = { cwd: string; home: string; branch?: string; width: number };

export function Banner({ cwd, home, branch, width }: Props) {
  return (
    <Box flexDirection="column">
      {width >= WIDTH + 2 ? (
        WORDMARK.map((line, row) => (
          <Text key={row}>
            {[...line].map((glyph, i) => (
              <Text key={i} color={gradient(NEBULA, i / (WIDTH - 1))}>
                {glyph}
              </Text>
            ))}
            {width >= WIDTH + 24 ? <Text dimColor>{STARS[row]}</Text> : null}
          </Text>
        ))
      ) : (
        <Text bold color={ACCENT}>
          ✦ astrocode
        </Text>
      )}
      <Box marginTop={1}>
        <Text>
          <Text>{shortPath(cwd, "", home)}</Text>
          {branch ? <Text dimColor>{`  ⎇ ${branch}`}</Text> : null}
        </Text>
      </Box>
      <Text dimColor>/help for keys · /resume · /model · ctrl+o for tool output</Text>
    </Box>
  );
}
