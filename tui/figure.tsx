// Pictures as figures: each at its own size on the terminal's background, with its label above it
// and a quiet line under it saying what it is and what can be done with it. Several pictures, as
// a before and after, sit side by side, their labels in the terminal's own text. In full screen a
// click on a picture enlarges it; in scrollback, `open` and `browser` are files the terminal opens.
import { Box, Text } from "ink";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageAttachment } from "../src/events";
import type { Item, ToolCall } from "../src/view/state";
import { field, SHOW_TOOL, toolLabel } from "../src/view/tools";
import { diagramsIn, drawnDiagram } from "./diagrams";
import { copyLink, fileUrl, hyperlink } from "./links";
import { cellWidth } from "./markdown";
import { drawsImages, ImageView, isReady, pictureSize, pngOf } from "./pictures";
import { isDark, PALETTE } from "./theme";

/** A picture as a figure shows it. */
export type Shown = {
  image: ImageAttachment;
  /** Above the picture: what Claude named it, such as "Before". */
  label?: string;
  /** Under it, quiet: the language a diagram was written in. */
  caption?: string;
  /** What the lightbox calls it besides its label, such as the `show` call's title. */
  title?: string;
  /** The HTML it was drawn from, which `browser` opens. */
  html?: string;
  /** The source it was drawn from, which `copy` copies. */
  source?: string;
};

/**
 * What a figure's links are: astrocode's own in full screen, where a click is astrocode's, or
 * files the terminal opens in scrollback. Without either, a figure has none.
 */
export type FigureLinks = "screen" | "scrollback";

/** Columns between pictures side by side. */
const GAP = 3;

/** Pictures side by side, each as large as fits its share of `width` and `rows` rows, once it's ready. */
export function Figure({ shown, width, rows, links }: { shown: readonly Shown[]; width: number; rows: number; links?: FigureLinks }) {
  const ready = shown.filter((one) => isReady(one.image));
  if (!ready.length) return null;
  const share = Math.max(8, Math.floor((width - GAP * (ready.length - 1)) / ready.length));
  return (
    <Box columnGap={GAP} width={width}>
      {ready.map((one, i) => {
        const parts = captionOf(one, links);
        // As wide as the picture, its label or its caption, so the next picture follows close.
        const cells = Math.max(pictureSize(one.image, share, rows)?.cols ?? share, cellWidth(one.label ?? ""), widthOf(parts));
        const column = Math.min(share, cells);
        return (
          <Box key={i} flexDirection="column" width={column} flexShrink={0}>
            {one.label ? (
              <Text bold color={PALETTE.star} wrap="truncate-end">
                {one.label}
              </Text>
            ) : null}
            <ImageView image={one.image} width={column} rows={rows} />
            <Caption parts={parts} width={column} />
          </Box>
        );
      })}
    </Box>
  );
}

type Part = { text: string; href?: string };

/** The line under a picture: its caption, then its links. */
const captionOf = (shown: Shown, links?: FigureLinks): Part[] => [...(shown.caption ? [{ text: shown.caption }] : []), ...actionsOf(shown, links)];

const widthOf = (parts: Part[]) => parts.reduce((sum, part, i) => sum + cellWidth(part.text) + (i ? 3 : 0), 0);

/** The caption's parts, as many as fit in `width`. */
function Caption({ parts, width }: { parts: Part[]; width: number }) {
  const kept: Part[] = [];
  for (const part of parts) {
    if (widthOf([...kept, part]) > width) break;
    kept.push(part);
  }
  if (!kept.length) return null;
  return (
    <Text>
      {kept.map((part, i) => (
        <Text key={i}>
          {i > 0 ? <Text color={PALETTE.dust}>{" · "}</Text> : null}
          <Text color={part.href ? PALETTE.haze : PALETTE.dust}>{part.href ? hyperlink(part.href, part.text) : part.text}</Text>
        </Text>
      ))}
    </Text>
  );
}

function actionsOf(shown: Shown, links?: FigureLinks): { text: string; href: string }[] {
  if (links === "screen") {
    return [
      { text: "enlarge", href: pictureLink(shown.image) },
      ...(shown.html ? [{ text: "browser", href: pageLink(shown.html) }] : []),
      ...(shown.source ? [{ text: "copy", href: copyLink(shown.source) }] : []),
    ];
  }
  if (links === "scrollback") {
    const file = pictureFile(shown.image);
    return [...(file ? [{ text: "open", href: fileUrl(file) }] : []), ...(shown.html ? [{ text: "browser", href: fileUrl(pageFile(shown.html)) }] : [])];
  }
  return [];
}

/**
 * Pictures and pages a link in full screen opens, by its address. Like `copyLink()`'s, the
 * address is astrocode's own and only ever drawn in full screen.
 */
const linked = new Map<string, { image: ImageAttachment } | { html: string }>();

/** The address of a link that enlarges `image` in the lightbox. */
function pictureLink(image: ImageAttachment) {
  const url = `astrocode:picture:${Bun.hash(image.data).toString(36)}`;
  linked.set(url, { image });
  return url;
}

/** The address of a link that opens `html` in the browser. */
function pageLink(html: string) {
  const url = `astrocode:page:${Bun.hash(html).toString(36)}`;
  linked.set(url, { html });
  return url;
}

/** What a link from a figure in full screen opens, or undefined for any other link. */
export const linkedBy = (url: string) => linked.get(url);

/** Where astrocode writes the pictures and pages a figure opens: the session's runtime folder, else a folder of its own in /tmp. */
let folder: string | null = null;
function write(name: string, data: string | Uint8Array) {
  folder ??= process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, "astrocode") : join(tmpdir(), `astrocode-${process.getuid?.() ?? "user"}`);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, name);
  if (!existsSync(path)) writeFileSync(path, data, { mode: 0o600 });
  return path;
}

/** `image` as a PNG file, for the desktop's image viewer, once it's ready. */
export function pictureFile(image: ImageAttachment) {
  const png = pngOf(image);
  return png ? write(`${Bun.hash(png).toString(36)}.png`, Buffer.from(png, "base64")) : undefined;
}

/**
 * `html` as a page for the browser. As in astrocode's own drawing, it reaches nothing outside
 * itself, and a page without colors of its own gets the panel's.
 */
export function pageFile(html: string) {
  const fence = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">`;
  const base = `<style>:where(html) { color: ${PALETTE.star}; font-family: system-ui, sans-serif; } :where(body) { margin: 0; color-scheme: ${isDark(PALETTE.surface) ? "dark" : "light"}; }</style><script>addEventListener("DOMContentLoaded", () => { const bare = (element) => getComputedStyle(element).backgroundColor === "rgba(0, 0, 0, 0)"; if (bare(document.documentElement) && bare(document.body)) document.documentElement.style.background = "${PALETTE.surface}"; });</script>`;
  // After the doctype, if there is one, or the page would lose its standards mode.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? "";
  return write(`${Bun.hash(html).toString(36)}.html`, doctype + fence + base + html.slice(doctype.length));
}

/** The pictures a finished tool call's result carried, with what the call said of them. */
export function shownOf(call: ToolCall): Shown[] {
  if (call.status !== "done") return [];
  const images = call.images ?? [];
  const inputs = Array.isArray(call.input.pictures) ? call.input.pictures : [];
  // A `show` call has an image for each picture asked for. An older one drew them as one.
  if (call.name !== SHOW_TOOL || inputs.length !== images.length) return images.map((image) => ({ image }));
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  const title = text(call.input.title);
  return images.map((image, i) => {
    const input = inputs[i];
    const label = text(field(input, "label")) ?? (images.length > 1 ? `${i + 1}` : undefined);
    const diagram = text(field(input, "diagram"));
    return { image, label, title, html: text(field(input, "html")), source: diagram ?? text(field(input, "svg")), caption: diagram ? text(field(input, "language")) : undefined };
  });
}

/** Whether a finished call's row draws pictures under it. */
export const hasPictures = (call: ToolCall) => shownOf(call).some((one) => isReady(one.image));

/** Every picture in the conversation that's ready to draw, in order, for the lightbox to go through. */
export function galleryOf(items: readonly Item[]): Shown[] {
  if (!drawsImages) return [];
  const all: Shown[] = [];
  for (const item of items) {
    if (item.kind === "prompt") all.push(...Object.entries(item.images ?? {}).map(([n, image]) => ({ image, label: `Your image #${n}` })));
    else if (item.kind === "text") {
      for (const { language, source } of diagramsIn(item.text)) {
        const done = drawnDiagram(language, source);
        if (done && "image" in done) all.push({ image: done.image, caption: language, source });
      }
    } else if (item.kind === "tool") {
      const shown = shownOf(item.call);
      all.push(...(item.call.name === SHOW_TOOL ? shown : shown.map((one) => ({ ...one, title: toolLabel(item.call.name) }))));
    }
  }
  return all.filter((one, i) => isReady(one.image) && all.findIndex((other) => other.image === one.image) === i);
}
