// Checks every mockup before it's screenshotted: each frame is exactly the size it claims (Frame
// throws on text that runs off it), and every character it draws is in DejaVu Sans Mono, a font
// most systems have, so nothing depends on a Nerd Font.
import { MOCKUPS } from "./show";

const FONT = "DejaVu Sans Mono";
/** Glyphs claude itself draws, which direction C keeps because its point is to look like claude. */
const CLAUDES = new Set(["⎿", "⏸"]);
const used = new Set<string>();

for (const [name, mockup] of Object.entries(MOCKUPS)) {
  const rows = mockup.make().text();
  if (rows.length !== mockup.rows || rows.some((row) => Array.from(row).length !== mockup.cols)) {
    throw new Error(`${name} isn't ${mockup.cols}x${mockup.rows}`);
  }
  for (const ch of rows.join("")) {
    if (ch.codePointAt(0)! <= 0x7e) continue;
    if (CLAUDES.has(ch) && !name.startsWith("c-")) throw new Error(`${name} uses ${ch}, which only claude's look may`);
    if (!CLAUDES.has(ch)) used.add(ch);
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
console.log(`${Object.keys(MOCKUPS).length} mockups fit their sizes; all ${used.size} non-ASCII glyphs are in ${FONT}: ${[...used].sort().join(" ")}`);
