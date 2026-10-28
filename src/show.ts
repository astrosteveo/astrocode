// The `show` tool: Claude puts a picture in front of you in the transcript, a screenshot, a mockup,
// a chart or diagram, or several side by side. It runs inside astrocode, as an SDK MCP server, and
// answers with the picture, so Claude sees what you see and can check its own drawing.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { DIAGRAMS, type Canvas, type Drawing } from "./canvas";

export { SHOW_TOOL } from "./view/tools";

/** The server's name, the middle of `SHOW_TOOL`. */
export const SHOW_SERVER = "astrocode";

/** The most pictures shown side by side. */
const MOST = 4;
/** The largest side, in pixels, of an image read from a file, as kitty keeps each one decoded. */
const MAX_PIXELS = 2048;

const PICTURE = z.object({
  label: z.string().optional().describe("What this picture is, shown above it when there are several, such as 'Before' or 'Option B'."),
  path: z.string().optional().describe("An image file to show: PNG, JPEG, GIF or WebP, such as a screenshot you took. Relative to the project."),
  svg: z.string().optional().describe("SVG markup to draw."),
  html: z
    .string()
    .optional()
    .describe("A self-contained HTML page to draw, as a browser shows it: a UI mockup, a styled table, a layout. Inline all CSS and images; nothing outside the page loads."),
  width: z.number().int().min(200).max(2400).optional().describe("For html: how wide the browser is, in CSS pixels. Defaults to 1024."),
  diagram: z.string().optional().describe("Diagram or chart source, in the language `language` names."),
  language: z
    .enum(Object.keys(DIAGRAMS) as [string, ...string[]])
    .optional()
    .describe("The diagram's language: mermaid, dot (Graphviz), d2, vega-lite (a JSON spec) or vega."),
});

type Picture = z.infer<typeof PICTURE>;

export const SHOW_DESCRIPTION = `Show the user a picture in the conversation, drawn inline in their terminal. Use it when a picture makes your point better than words: a screenshot of a UI you built or changed, a mockup of a design you propose, a chart of numbers you measured, a diagram of a design. Give several pictures to show them side by side with their labels, as for a before and after, or design options to choose between. The result is the picture as the user sees it, so look at it and say what it shows; draw again if it came out wrong. For a diagram that belongs in your reply, a mermaid, dot, d2 or vega-lite code fence is drawn too, and needs no tool call.`;

/** The `show` tool's server, drawing with `canvas`. `cwd` is what a relative path is relative to. */
export function showServer(canvas: Canvas, cwd: string) {
  const show = tool(
    "show",
    SHOW_DESCRIPTION,
    {
      title: z.string().describe("What the user is looking at, in a few words."),
      pictures: z.array(PICTURE).min(1).max(MOST).describe(`The pictures, one to ${MOST}. Each has exactly one of path, svg, html or diagram.`),
    },
    async ({ title, pictures }) => {
      try {
        const drawn = await Promise.all(pictures.map((picture) => draw(canvas, picture, cwd)));
        const shown =
          drawn.length === 1 && !pictures[0]?.label
            ? drawn[0]!
            : await canvas.compare(drawn.map((drawing, i) => ({ label: pictures[i]?.label ?? `${i + 1}`, png: drawing.png })));
        return {
          content: [
            { type: "image", data: Buffer.from(shown.png).toString("base64"), mimeType: "image/png" },
            { type: "text", text: `Shown to the user: ${title} (${shown.width}×${shown.height} pixels).` },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Couldn't show it: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
    { annotations: { title: "Show", readOnlyHint: true, openWorldHint: false }, alwaysLoad: true },
  );
  return createSdkMcpServer({ name: SHOW_SERVER, version: "1.0.0", tools: [show], alwaysLoad: true });
}

async function draw(canvas: Canvas, picture: Picture, cwd: string): Promise<Drawing> {
  const given = [picture.path, picture.svg, picture.html, picture.diagram].filter((one) => one !== undefined);
  if (given.length !== 1) throw new Error("Each picture needs exactly one of path, svg, html or diagram.");
  if (picture.path !== undefined) return readImage(isAbsolute(picture.path) ? picture.path : resolve(cwd, picture.path));
  if (picture.svg !== undefined) return canvas.svg(picture.svg);
  if (picture.html !== undefined) return canvas.html(picture.html, picture.width);
  if (!picture.language) throw new Error("A diagram needs its language.");
  return canvas.diagram(picture.language, picture.diagram!);
}

/** An image file as PNG, no larger than kitty keeps. Anything that isn't an image is refused. */
async function readImage(path: string): Promise<Drawing> {
  if (!(await Bun.file(path).exists())) throw new Error(`There's no file at ${path}.`);
  try {
    const image = new Bun.Image(path).resize(MAX_PIXELS, MAX_PIXELS, { fit: "inside", withoutEnlargement: true }).png();
    const png = await image.bytes();
    return { png, width: image.width, height: image.height };
  } catch {
    throw new Error(`${path} isn't a PNG, JPEG, GIF or WebP image.`);
  }
}

/**
 * What Claude is told about drawing in astrocode, appended to Claude Code's system prompt.
 * `htmlPreviews`: AskUserQuestion's previews are HTML, drawn as pictures.
 */
export function visualInstructions({ dark, background }: { dark: boolean; background: string }, htmlPreviews: boolean) {
  return `# Showing your work

The user reads this conversation in astrocode, a terminal that draws pictures inline. Show work as a picture where a picture makes the point better than prose: structure, flow, layout, comparisons and numbers. Keep prose where prose is clearer, and don't draw what a sentence says as well.

- A \`mermaid\`, \`dot\`, \`d2\` or \`vega-lite\` code fence in your reply is drawn as a picture. Use one for architecture, data flow, state machines, sequences between components, dependency graphs and numbers worth comparing. The terminal is wide and short: prefer left-to-right layouts (\`flowchart LR\`, \`rankdir=LR\`) and keep a diagram to about a dozen nodes. Don't set colors, themes or fonts; astrocode sets them to match the terminal. Say in a sentence what the diagram shows.
- The \`show\` tool draws a screenshot, an HTML or SVG mockup, or a diagram, and lays up to four side by side with labels. Use it to show a UI you built or changed (take a screenshot first), to propose a design as an HTML mockup, to compare before and after or several options, and to present results you measured. Its result is the picture the user sees, so check it before you describe it.${
    htmlPreviews
      ? `
- AskUserQuestion's option previews are drawn as pictures. When options differ in how something looks or is laid out, give each a preview that shows it.`
      : ""
  }

Pictures sit on a ${dark ? "dark" : "light"} panel (${background}). An SVG or HTML mockup without a background of its own is drawn on it.`;
}
