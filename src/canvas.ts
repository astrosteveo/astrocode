// Pictures drawn from text: diagrams, charts, SVG and HTML, as PNG. A headless Chromium does the
// drawing, started the first time it's needed and closed again after a while unused. It never
// reaches the network or the disk: a page gets only what's put in it.
import { instance as vizInstance } from "@viz-js/viz";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

/**
 * The colors a picture is drawn in, from astrocode's palette. `accents` are for series and
 * categories, in order; gold, which is the user's, isn't among them.
 */
export type CanvasColors = {
  dark: boolean;
  /** What a picture is drawn on, the panel it sits on in the transcript. */
  background: string;
  text: string;
  strong: string;
  muted: string;
  line: string;
  raised: string;
  accent: string;
  accents: string[];
};

/** The fence languages drawn as pictures, and the kind of picture each is. */
export const DIAGRAMS: Record<string, "mermaid" | "dot" | "d2" | "vega-lite" | "vega"> = {
  mermaid: "mermaid",
  dot: "dot",
  graphviz: "dot",
  d2: "d2",
  "vega-lite": "vega-lite",
  vegalite: "vega-lite",
  vega: "vega",
};

export const isDiagram = (language: string) => Object.hasOwn(DIAGRAMS, language);

/** A picture drawn, as PNG, and its size in pixels. */
export type Drawing = { png: Uint8Array; width: number; height: number };

/** One picture of several drawn side by side, with what it shows. */
export type Labeled = { label: string; png: Uint8Array };

/** How long Chromium stays up with nothing to draw. */
const IDLE_MS = 5 * 60_000;
/** The longest a picture may take. */
const DRAW_MS = 20_000;
/** The widest and tallest a page may be, in CSS pixels. */
const MAX_WIDTH = 2400;
const MAX_HEIGHT = 4000;
/** Room around a diagram, in CSS pixels. */
const PAD = 12;

const BROWSERS = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "chrome", "brave", "microsoft-edge"];

/** What the functions run inside the page see. astrocode's own code has no DOM. */
type Element = { innerHTML: string; querySelector(selector: string): Svg | null };
type Svg = { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void; removeAttribute(name: string): void; viewBox?: { baseVal?: { width: number; height: number } } };
declare const document: { getElementById(id: string): Element | null; documentElement: { scrollHeight: number } };
declare const window: unknown;

const require = createRequire(import.meta.url);
/** A browser build beside a package's entry point, which its `exports` don't list. */
const beside = (name: string, file: string) => join(dirname(require.resolve(name)), file);
const SCRIPTS = {
  mermaid: beside("mermaid", "mermaid.min.js"),
  vega: beside("vega", "vega.min.js"),
  vegaLite: beside("vega-lite", "vega-lite.min.js"),
};

/** The browser astrocode draws with: ASTROCODE_BROWSER, else the first Chromium on the PATH. */
export function browserPath() {
  const chosen = process.env.ASTROCODE_BROWSER?.trim();
  if (chosen) return Bun.which(chosen) ?? chosen;
  for (const name of BROWSERS) {
    const found = Bun.which(name);
    if (found) return found;
  }
  return null;
}

export class Canvas {
  private browser: Promise<Browser> | null = null;
  /** The page diagrams and charts are drawn on, with their libraries loaded, one picture at a time. */
  private page: Promise<Page> | null = null;
  private turn: Promise<unknown> = Promise.resolve();
  private idle: ReturnType<typeof setTimeout> | null = null;
  private busy = 0;

  /** `fontSize`: the terminal's text size in pixels, so a picture's words match the words around it. */
  constructor(
    private readonly colors: CanvasColors,
    private readonly fontSize: () => number,
  ) {}

  /** Whether there's a browser to draw with. A picture can't be drawn without one. */
  get available() {
    return browserPath() !== null;
  }

  /** A diagram or chart from a fence's source, in the palette's colors. */
  diagram(language: string, source: string): Promise<Drawing> {
    switch (DIAGRAMS[language]) {
      case "mermaid":
        return this.onPage((page) => this.mermaid(page, source));
      case "dot":
        return this.dot(source).then((svg) => this.svg(svg));
      case "d2":
        return this.d2(source).then((svg) => this.svg(svg));
      case "vega-lite":
      case "vega":
        return this.onPage((page) => this.vega(page, source, DIAGRAMS[language] === "vega-lite"));
      default:
        return Promise.reject(new Error(`astrocode doesn't draw ${language}.`));
    }
  }

  /** An SVG image, drawn on the palette's background where it has none of its own. */
  svg(markup: string): Promise<Drawing> {
    return this.onPage(async (page) => {
      await page.evaluate((markup: string) => {
        const out = document.getElementById("out")!;
        out.innerHTML = markup;
        // Some SVG gives its size only as a viewBox, which would leave it as wide as the page.
        const svg = out.querySelector("svg");
        if (svg && !svg.getAttribute("width") && svg.viewBox?.baseVal?.width) {
          svg.setAttribute("width", String(svg.viewBox.baseVal.width));
          svg.setAttribute("height", String(svg.viewBox.baseVal.height));
        }
      }, markup);
      return this.shoot(page);
    });
  }

  /**
   * An HTML page, as a browser `width` CSS pixels wide shows it, as tall as its content. It
   * runs its own scripts but reaches nothing outside itself.
   */
  html(markup: string, width = 1024): Promise<Drawing> {
    return this.withBrowser(async (browser) => {
      const page = await browser.newPage();
      try {
        await isolate(page);
        // A short window, so the page's height is its content's and not the window's.
        await page.setViewport({ width: clamp(width, 200, MAX_WIDTH), height: 1 });
        await page.setContent(markup, { waitUntil: "load", timeout: DRAW_MS });
        const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
        const shot = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: clamp(width, 200, MAX_WIDTH), height: clamp(height, 1, MAX_HEIGHT) }, captureBeyondViewport: true });
        return drawing(shot);
      } finally {
        await page.close().catch(() => {});
      }
    });
  }

  /** Pictures side by side, each under its label, as for a before and after. */
  compare(pictures: Labeled[]): Promise<Drawing> {
    const { colors } = this;
    const size = this.fontSize();
    const cells = pictures
      .map(
        ({ label, png }) =>
          `<figure><figcaption>${escape(label)}</figcaption><img src="data:image/png;base64,${Buffer.from(png).toString("base64")}"></figure>`,
      )
      .join("");
    const markup = `<!doctype html><style>
      body { margin: 0; background: ${colors.background}; color: ${colors.strong}; font: ${size}px monospace; }
      main { display: flex; gap: ${PAD * 2}px; padding: ${PAD}px; align-items: flex-start; width: max-content; }
      figure { margin: 0; display: flex; flex-direction: column; gap: ${PAD / 2}px; }
      figcaption { color: ${colors.muted}; }
      img { display: block; max-width: ${Math.floor(MAX_WIDTH / pictures.length) - PAD * 3}px; border: 1px solid ${colors.line}; }
    </style><main>${cells}</main>`;
    return this.withBrowser(async (browser) => {
      const page = await browser.newPage();
      try {
        await isolate(page);
        await page.setViewport({ width: MAX_WIDTH, height: 600 });
        await page.setContent(markup, { waitUntil: "load", timeout: DRAW_MS });
        const main = await page.$("main");
        return drawing(await main!.screenshot({ type: "png" }));
      } finally {
        await page.close().catch(() => {});
      }
    });
  }

  /** Closes the browser, as astrocode exits. */
  async close() {
    if (this.idle) clearTimeout(this.idle);
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    await (await browser?.catch(() => null))?.close().catch(() => {});
  }

  private async mermaid(page: Page, source: string) {
    const { colors } = this;
    const size = this.fontSize();
    await page.evaluate(
      async (source: string, theme: Record<string, unknown>, css: string, size: number) => {
        const mermaid = (window as unknown as { mermaid: { initialize(config: object): void; render(id: string, text: string): Promise<{ svg: string }> } }).mermaid;
        const font = { fontFamily: "monospace", fontSize: size };
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: theme,
          themeCSS: css,
          securityLevel: "strict",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          sequence: { actorFontSize: size, messageFontSize: size, noteFontSize: size, actorFontFamily: "monospace", messageFontFamily: "monospace", noteFontFamily: "monospace" },
          pie: { textPosition: 0.7 },
          gantt: { fontSize: size, sectionFontSize: size },
          ...font,
        });
        const { svg } = await mermaid.render(`m${Date.now()}`, source);
        const out = document.getElementById("out")!;
        out.innerHTML = svg;
        // Mermaid makes a diagram as wide as its container, which here is as wide as the diagram:
        // a wide one comes out a few hundred pixels across. Its viewBox has its natural size.
        const drawn = out.querySelector("svg");
        const box = drawn?.viewBox?.baseVal;
        if (drawn && box?.width) {
          drawn.removeAttribute("style");
          drawn.setAttribute("width", String(box.width));
          drawn.setAttribute("height", String(box.height));
        }
      },
      source,
      mermaidTheme(colors, size),
      // The base theme drops a shadow under nodes, which reads as blur on a terminal's flat panels.
      "* { filter: none !important; }",
      size,
    );
    return this.shoot(page);
  }

  private async vega(page: Page, source: string, lite: boolean) {
    const { colors } = this;
    const size = this.fontSize();
    const spec: unknown = JSON.parse(source);
    await page.evaluate(
      async (spec: Record<string, unknown>, lite: boolean, config: Record<string, unknown>) => {
        const scope = window as unknown as {
          vega: { parse(spec: object, config?: object): object; View: new (runtime: object, options: object) => { toSVG(): Promise<string> } };
          vegaLite: { compile(spec: object, options: object): { spec: object } };
        };
        const vegaSpec = lite ? scope.vegaLite.compile(spec, { config }).spec : spec;
        const view = new scope.vega.View(scope.vega.parse(vegaSpec, lite ? undefined : config), { renderer: "none" });
        document.getElementById("out")!.innerHTML = await view.toSVG();
      },
      spec as Record<string, unknown>,
      lite,
      vegaConfig(colors, size),
    );
    return this.shoot(page);
  }

  private async dot(source: string) {
    const { colors } = this;
    const font = { fontname: "monospace", fontsize: Math.round(this.fontSize() * 0.75), fontcolor: colors.strong };
    const viz = await (viz_ ??= vizInstance());
    const result = viz.render(source, {
      format: "svg",
      graphAttributes: { bgcolor: "transparent", ...font, color: colors.line },
      nodeAttributes: { ...font, color: colors.accent, fillcolor: colors.raised, style: "filled" },
      edgeAttributes: { ...font, fontcolor: colors.muted, color: colors.muted },
    });
    if (result.status !== "success") throw new Error(result.errors.map((error) => error.message).join(" ") || "Graphviz couldn't read it.");
    return result.output;
  }

  private async d2(source: string) {
    const binary = Bun.which("d2");
    if (!binary) throw new Error("d2 isn't installed.");
    const { colors } = this;
    // d2 merges a map given twice, so these overrides join any `vars` of the diagram's own.
    const theme = { N1: colors.strong, N2: colors.text, N3: colors.muted, N4: colors.line, N5: colors.raised, N6: colors.raised, N7: colors.background, B1: colors.accent, B2: colors.accent, B3: colors.line, B4: colors.raised, B5: colors.raised, B6: colors.background };
    const overrides = `vars: { d2-config: { theme-overrides: { ${Object.entries(theme).map(([key, value]) => `${key}: "${value}"`).join("; ")} } } }\n`;
    const run = async (text: string) => {
      const child = Bun.spawn([binary, `--theme=${colors.dark ? 200 : 0}`, "--pad=0", "-", "-"], { stdin: new Blob([text]), stdout: "pipe", stderr: "pipe" });
      const [svg, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(error.trim() || `d2 stopped with ${code}.`);
      return svg;
    };
    return run(overrides + source).catch(() => run(source));
  }

  /** The picture on the page, cut to its content. */
  private async shoot(page: Page) {
    const out = await page.$("#out");
    const box = await out!.boundingBox();
    if (!box || box.width < 2 || box.height < 2) throw new Error("It drew nothing.");
    return drawing(await out!.screenshot({ type: "png" }));
  }

  /** Runs `draw` on the diagram page, after whatever is being drawn on it now. */
  private onPage(draw: (page: Page) => Promise<Drawing>): Promise<Drawing> {
    const result = this.turn.then(() =>
      this.withBrowser(async (browser) => {
        this.page ??= this.newDiagramPage(browser);
        const page = await this.page.catch((error: unknown) => {
          this.page = null;
          throw error;
        });
        await page.evaluate(() => {
          document.getElementById("out")!.innerHTML = "";
        });
        return draw(page);
      }),
    );
    this.turn = result.catch(() => {});
    return result;
  }

  private async newDiagramPage(browser: Browser) {
    const { colors } = this;
    const page = await browser.newPage();
    await isolate(page);
    await page.setViewport({ width: MAX_WIDTH, height: 800 });
    await page.setContent(
      `<!doctype html><style>
        body { margin: 0; background: ${colors.background}; color: ${colors.strong}; font-family: monospace; }
        #out { display: inline-block; padding: ${PAD}px; }
        #out > svg { display: block; max-width: none; }
      </style><div id="out"></div>`,
    );
    for (const path of Object.values(SCRIPTS)) await page.addScriptTag({ path });
    return page;
  }

  /** Runs `use` with the browser, starting it if it's not up, under a time limit. */
  private async withBrowser<T>(use: (browser: Browser) => Promise<T>): Promise<T> {
    this.busy += 1;
    if (this.idle) clearTimeout(this.idle);
    try {
      this.browser ??= launch();
      const browser = await this.browser.catch((error: unknown) => {
        this.browser = null;
        throw error;
      });
      return await within(use(browser), DRAW_MS);
    } finally {
      this.busy -= 1;
      if (this.busy === 0) {
        this.idle = setTimeout(() => void this.close(), IDLE_MS);
        this.idle.unref();
      }
    }
  }
}

let viz_: ReturnType<typeof vizInstance> | undefined;

async function launch() {
  const executablePath = browserPath();
  if (!executablePath) throw new Error("There's no Chromium to draw with. Install chromium, or set ASTROCODE_BROWSER.");
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    pipe: true,
    // The browser's own output would land on the terminal behind Ink's back.
    dumpio: false,
    // astrocode decides what a signal does; the browser goes when astrocode does.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: ["--no-first-run", "--disable-extensions", "--disable-background-networking", "--disable-sync", "--mute-audio", "--hide-scrollbars"],
  });
  const child = browser.process();
  child?.unref();
  process.on("exit", () => child?.kill());
  return browser;
}

/** Keeps a page to itself: it may load what's in it (`data:` and `about:`), and nothing from outside. */
async function isolate(page: Page) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("about:") || url.startsWith("blob:")) void request.continue();
    else void request.abort("blockedbyclient");
  });
  await page.setJavaScriptEnabled(true);
}

/** A screenshot with its size, read from the PNG's header. */
function drawing(shot: Uint8Array): Drawing {
  const view = new DataView(shot.buffer, shot.byteOffset, shot.byteLength);
  return { png: shot, width: view.getUint32(16), height: view.getUint32(20) };
}

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`It took longer than ${ms / 1000} seconds to draw.`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Math.round(value)));

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

function mermaidTheme(colors: CanvasColors, size: number) {
  const scale = Object.fromEntries(colors.accents.flatMap((color, i) => [[`cScale${i}`, color], [`pie${i + 1}`, color]]));
  return {
    darkMode: colors.dark,
    background: colors.background,
    fontFamily: "monospace",
    fontSize: `${size}px`,
    primaryColor: colors.raised,
    primaryTextColor: colors.strong,
    primaryBorderColor: colors.accent,
    secondaryColor: colors.raised,
    secondaryTextColor: colors.strong,
    secondaryBorderColor: colors.line,
    tertiaryColor: colors.background,
    tertiaryTextColor: colors.text,
    tertiaryBorderColor: colors.line,
    lineColor: colors.muted,
    textColor: colors.text,
    mainBkg: colors.raised,
    nodeBorder: colors.accent,
    clusterBkg: colors.background,
    clusterBorder: colors.line,
    titleColor: colors.strong,
    edgeLabelBackground: colors.background,
    noteBkgColor: colors.raised,
    noteTextColor: colors.text,
    noteBorderColor: colors.line,
    actorBkg: colors.raised,
    actorBorder: colors.accent,
    actorTextColor: colors.strong,
    actorLineColor: colors.line,
    signalColor: colors.muted,
    signalTextColor: colors.text,
    labelBoxBkgColor: colors.raised,
    labelBoxBorderColor: colors.line,
    labelTextColor: colors.strong,
    loopTextColor: colors.text,
    activationBkgColor: colors.raised,
    activationBorderColor: colors.accent,
    sequenceNumberColor: colors.background,
    pieOpacity: "1",
    pieStrokeColor: colors.background,
    pieOuterStrokeColor: colors.line,
    pieTitleTextColor: colors.strong,
    pieSectionTextColor: colors.background,
    pieLegendTextColor: colors.text,
    ...scale,
  };
}

function vegaConfig(colors: CanvasColors, size: number) {
  const axis = {
    domainColor: colors.line,
    gridColor: colors.raised,
    tickColor: colors.line,
    labelColor: colors.muted,
    titleColor: colors.text,
    labelFont: "monospace",
    titleFont: "monospace",
    labelFontSize: Math.round(size * 0.8),
    titleFontSize: size,
  };
  return {
    background: colors.background,
    padding: PAD,
    font: "monospace",
    // Vega-Lite's own sizes are for a web page; a terminal is wide, and a bar 20 pixels across is a sliver in it.
    view: { stroke: "transparent", continuousWidth: 480, continuousHeight: 260, discreteWidth: { step: 56 } },
    axis,
    legend: { labelColor: colors.muted, titleColor: colors.text, labelFont: "monospace", titleFont: "monospace", labelFontSize: Math.round(size * 0.8), titleFontSize: size },
    title: { color: colors.strong, font: "monospace", fontSize: Math.round(size * 1.1) },
    header: { labelColor: colors.muted, titleColor: colors.text },
    mark: { color: colors.accent },
    range: { category: colors.accents },
    text: { color: colors.text },
  };
}
