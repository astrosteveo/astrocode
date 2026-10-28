// Claude's diagrams and charts: a fence in a diagram language (mermaid, dot, d2, vega-lite) drawn
// as a picture in the transcript, in the palette's colors. The source stays what's saved, so a
// terminal that can't show pictures, the phone and `claude` itself still have it.
import { Canvas, isDiagram, type CanvasColors } from "../src/canvas";
import type { ImageAttachment } from "../src/events";
import { fontPixels } from "./cells";
import { parse } from "./markdown";
import { isDark, mix, PALETTE } from "./theme";

/** The palette as a picture takes it. Gold is the user's, so a picture never uses it. */
export const CANVAS_COLORS: CanvasColors = {
  dark: isDark(PALETTE.surface),
  background: PALETTE.surface,
  strong: PALETTE.star,
  text: mix(PALETTE.star, PALETTE.haze, 0.3),
  muted: PALETTE.haze,
  line: PALETTE.dust,
  raised: PALETTE.raised,
  accent: PALETTE.teal,
  accents: [PALETTE.teal, PALETTE.sky, PALETTE.ember, PALETTE.rose, PALETTE.tealLight, mix(PALETTE.sky, PALETTE.rose, 0.5)],
};

/** The one browser astrocode draws with, for diagrams here and for Claude's show tool. */
export const canvas = new Canvas(CANVAS_COLORS, fontPixels);

/** A diagram as drawn: its image, or why it couldn't be. */
type Drawn = { image: ImageAttachment } | { error: string };

const drawn = new Map<string, Drawn>();
const drawing = new Map<string, Promise<Drawn>>();
const keyOf = (language: string, source: string) => `${language}\u0000${source}`;

/** A fence's source as it's drawn and keyed, without the newline that ends the fence's last line. */
export const fenceSource = (source: string) => source.replace(/\n$/, "");

/** Draws a diagram, once: later calls get the same drawing. */
export function drawDiagram(language: string, source: string): Promise<Drawn> {
  const key = keyOf(language, source);
  const done = drawn.get(key);
  if (done) return Promise.resolve(done);
  let pending = drawing.get(key);
  if (!pending) {
    pending = canvas.diagram(language, source).then(
      ({ png }): Drawn => ({ image: { mediaType: "image/png", data: Buffer.from(png).toString("base64") } }),
      (error: unknown): Drawn => ({ error: error instanceof Error ? error.message : String(error) }),
    );
    pending.then((result) => {
      drawn.set(key, result);
      drawing.delete(key);
    });
    drawing.set(key, pending);
  }
  return pending;
}

/** A diagram's drawing if it's done, else undefined. */
export const drawnDiagram = (language: string, source: string) => drawn.get(keyOf(language, source));

/** The finished diagram fences in a piece of markdown, in order. */
export function diagramsIn(text: string): { language: string; source: string }[] {
  if (!text.includes("```") && !text.includes("~~~")) return [];
  return parse(text).flatMap((block) =>
    block.kind === "code" && !block.isOpen && isDiagram(block.language) ? [{ language: block.language, source: fenceSource(block.source) }] : [],
  );
}

/** The images of a piece of markdown's diagrams that are drawn. */
export function diagramImages(text: string): ImageAttachment[] {
  return diagramsIn(text).flatMap(({ language, source }) => {
    const done = drawnDiagram(language, source);
    return done && "image" in done ? [done.image] : [];
  });
}
