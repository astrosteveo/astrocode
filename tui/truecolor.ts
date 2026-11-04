// For tests that read colors off what Ink draws. Ink colors through its own chalk, which colors only
// for a terminal that takes colors, and a test's output isn't one.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const chalk = (await import(require.resolve("chalk", { paths: [require.resolve("ink")] }))).default as { level: number };

/** What `draw` returns, drawn in true color. */
export function inColor<T>(draw: () => T): T {
  const before = chalk.level;
  chalk.level = 3;
  try {
    return draw();
  } finally {
    chalk.level = before;
  }
}
