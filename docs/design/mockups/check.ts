// Checks every mockup before it's screenshotted: each frame is exactly 120x40 cells (Frame throws
// on text that runs off it), and every character it draws is in DejaVu Sans Mono, a font most
// systems have, so nothing depends on a Nerd Font.
import { DIRECTIONS } from "./show";

const FONT = "DejaVu Sans Mono";
/** Glyphs claude itself draws, which direction C keeps because its point is to look like claude. */
const CLAUDES = new Set(["⎿", "⏸"]);
const used = new Set<string>();

for (const [direction, moments] of Object.entries(DIRECTIONS)) {
  for (const [moment, make] of Object.entries(moments)) {
    const frame = make();
    const rows = frame.text();
    if (rows.length !== 40 || rows.some((row) => Array.from(row).length !== 120)) {
      throw new Error(`${direction} ${moment} isn't 120x40`);
    }
    for (const ch of rows.join("")) {
      if (ch.codePointAt(0)! <= 0x7e) continue;
      if (CLAUDES.has(ch) && direction !== "c") throw new Error(`${direction} ${moment} uses ${ch}, which only claude's look may`);
      if (!CLAUDES.has(ch)) used.add(ch);
    }
  }
}

const missing = [...used].filter((ch) => {
  const hex = ch.codePointAt(0)!.toString(16);
  const found = Bun.spawnSync(["fc-list", `:charset=${hex}`, "family"]).stdout.toString();
  return !found.split("\n").some((family) => family.split(",").includes(FONT));
});
if (missing.length) {
  console.error(`Not in ${FONT}: ${missing.map((ch) => `${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`).join(", ")}`);
  process.exit(1);
}
console.log(`Every frame is 120x40; all ${used.size} non-ASCII glyphs are in ${FONT}: ${[...used].sort().join(" ")}`);
