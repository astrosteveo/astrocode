// What a mod draws, from the plain data Claude Code hands a host (`ModNode`), drawn with Ink. The
// elements are the desktop's: boxes, text, buttons, links, code and Markdown are drawn as Claude
// Code's terminal draws them; a field or a picker shows its label and value, a picture its words,
// and a mod's own script nothing. Colors named for Claude Code's theme take astrocode's. In full
// screen a click on a button presses it.
import { Box, Text, type DOMElement } from "ink";
import { useRef, type ReactNode } from "react";
import type { ModElement, ModNode, ModPress } from "../src/session";
import { hyperlink, isWebLink } from "./links";
import { Markdown } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { PALETTE, TINT } from "./theme";

/** Runs what a press of a mod's button does. */
export type PressMod = (press: ModPress, key?: string) => void;

/** Claude Code's theme colors, by their names, in astrocode's palette. */
const THEME: Record<string, string | undefined> = {
  text: undefined,
  inverseText: PALETTE.ink,
  inactive: PALETTE.dust,
  subtle: PALETTE.dust,
  suggestion: PALETTE.sky,
  remember: PALETTE.gold,
  success: PALETTE.teal,
  error: PALETTE.rose,
  warning: PALETTE.ember,
  merged: PALETTE.sky,
  claude: PALETTE.teal,
  permission: PALETTE.gold,
  planMode: PALETTE.teal,
  autoAccept: PALETTE.sky,
  promptBorder: PALETTE.dust,
  bashBorder: PALETTE.ember,
  ide: PALETTE.sky,
  diffAdded: TINT.added,
  diffRemoved: TINT.removed,
  diffAddedDimmed: TINT.added,
  diffRemovedDimmed: TINT.removed,
  diffAddedWord: TINT.addedWords,
  diffRemovedWord: TINT.removedWords,
};

/** A color as Ink takes it: a theme name in astrocode's palette, else a hex or named color as given. */
const colorOf = (value: unknown) => (typeof value !== "string" ? undefined : value in THEME ? THEME[value] : value);

/** The named spaces, in cells. */
const SPACES: Record<string, number> = { xs: 0, sm: 1, md: 1, lg: 2, xl: 3 };
const spaceOf = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" ? SPACES[value] : undefined);

const BORDERS = new Set(["single", "double", "round", "bold", "singleDouble", "doubleSingle", "classic", "arrow"]);

/** Box props Ink takes as they are. */
const LAYOUT = [
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "flexDirection",
  "flexGrow",
  "flexShrink",
  "flexWrap",
  "alignItems",
  "alignSelf",
  "justifyContent",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "overflow",
  "display",
] as const;
const SPACING = [
  "gap",
  "columnGap",
  "rowGap",
  "margin",
  "marginX",
  "marginY",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "padding",
  "paddingX",
  "paddingY",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
] as const;

function boxProps(props: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const name of LAYOUT) if (props[name] !== undefined) out[name] = props[name];
  for (const name of SPACING) {
    const space = spaceOf(props[name]);
    if (space !== undefined) out[name] = space;
  }
  if (typeof props.borderStyle === "string" && BORDERS.has(props.borderStyle)) {
    out.borderStyle = props.borderStyle;
    out.borderColor = colorOf(props.borderColor) ?? PALETTE.dust;
    if (props.borderDimColor === true) out.borderDimColor = true;
  }
  const background = colorOf(props.backgroundColor);
  if (background) out.backgroundColor = background;
  return out;
}

function textProps(props: Record<string, unknown>) {
  const weight = props.weight;
  const size = props.size;
  return {
    color: colorOf(props.color),
    backgroundColor: colorOf(props.backgroundColor),
    dimColor: props.dimColor === true,
    bold: props.bold === true || weight === "semibold" || weight === "bold" || size === "heading" || size === "title",
    italic: props.italic === true,
    underline: props.underline === true,
    strikethrough: props.strikethrough === true,
    inverse: props.inverse === true,
    wrap: typeof props.wrap === "string" ? (props.wrap as "wrap") : undefined,
  };
}

/** Text inside a Text: strings, and Text or Link elements nested in it. */
function inlineOf(nodes: ModNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((node, i) => {
    if (typeof node === "string") return node;
    const props = node.props ?? {};
    if (node.type === "Text") return <Text key={i} {...textProps(props)}>{inlineOf(node.children)}</Text>;
    if (node.type === "Link") return <LinkText key={i} props={props} />;
    return null;
  });
}

function LinkText({ props }: { props: Record<string, unknown> }) {
  const href = typeof props.href === "string" ? props.href : "";
  const label = typeof props.label === "string" && props.label ? props.label : href;
  return <Text color={PALETTE.sky}>{isWebLink(href) ? hyperlink(href, label) : label}</Text>;
}

/** A mod's drawing, `width` cells wide. */
export function ModTree({ node, width, onPress }: { node: ModNode; width: number; onPress: PressMod }) {
  return <Node node={node} width={width} onPress={onPress} />;
}

function Node({ node, width, onPress }: { node: ModNode; width: number; onPress: PressMod }): ReactNode {
  if (typeof node === "string") return <Text>{node}</Text>;
  const props = node.props ?? {};
  const children = (node.children ?? []).map((child, i) => <Node key={i} node={child} width={width} onPress={onPress} />);
  switch (node.type) {
    case "Box":
      return <Box {...boxProps(props)}>{children}</Box>;
    case "Text":
      return <Text {...textProps(props)}>{inlineOf(node.children)}</Text>;
    case "Link":
      return <LinkText props={props} />;
    case "Button":
      return <ModButton element={node} onPress={onPress} />;
    case "Markdown":
      return <Markdown text={typeof props.text === "string" ? props.text : ""} width={width} />;
    case "Code": {
      const source = typeof props.source === "string" ? props.source : "";
      const language = props.format === "diff" ? "diff" : typeof props.language === "string" ? props.language : "";
      return <Markdown text={`\`\`\`${language}\n${source.replace(/\n$/, "")}\n\`\`\``} width={width} />;
    }
    case "Input":
    case "Select": {
      const label = typeof props.label === "string" ? `${props.label} ` : "";
      const value = typeof props.value === "string" ? props.value : typeof props.placeholder === "string" ? props.placeholder : "";
      return (
        <Text>
          <Text color={PALETTE.dust}>{label}</Text>
          <Text color={PALETTE.haze}>{value || "…"}</Text>
        </Text>
      );
    }
    case "Svg":
      return <Text color={PALETTE.dust}>{typeof props.alt === "string" ? props.alt : ""}</Text>;
    default:
      // A mod's own script, and what Claude Code would draw itself, which astrocode draws elsewhere.
      return null;
  }
}

/** `[ label ]`, gold for the main action and quiet otherwise. A click presses it. */
function ModButton({ element, onPress }: { element: ModElement; onPress: PressMod }) {
  const box = useRef<DOMElement>(null);
  const props = element.props ?? {};
  const label = typeof props.label === "string" ? props.label : "";
  const key = typeof props.key === "string" ? props.key : undefined;
  const press = element.press;
  useMouse((event) => {
    if (event.handled || event.type !== "press" || event.button !== "left" || !press || !hit(box.current, event)) return;
    event.handled = true;
    onPress(press, key);
  });
  const hovered = useHover(box, () => (press ? { key: "button", shape: "pointer" } : null));
  const color = props.dimColor === true ? PALETTE.dust : props.variant === "secondary" ? PALETTE.haze : PALETTE.gold;
  return (
    <Box ref={box} flexShrink={0}>
      <Text color={hovered ? PALETTE.glint : color}>{`[ ${label} ]`}</Text>
    </Box>
  );
}
