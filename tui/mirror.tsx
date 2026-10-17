// Full screen's empty state: the James Webb Space Telescope's primary mirror, drawn large. Its 18
// hexagonal segments interlock in rows of 3, 4, 5, 4 and 3, with the center one missing, and
// light up once when astrocode starts, the inner ring first, as if the mirror were coming into
// alignment. Under it, the wordmark, where you are, and how to start.
//
// Clicking a segment sends a ripple of light across the mirror and swaps the hint for a fact about
// Webb for a while. Click all 18 and the mirror reaches first light.
import { Box, Text, useAnimation, type DOMElement } from "ink";
import { useEffect, useReducer, useRef, useState } from "react";
import { shortPath } from "../src/view/tools";
import { fit } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { mix, PALETTE } from "./theme";

/** A pointy-top hexagon, five cells wide and three rows tall. Rows of them sit two rows apart, so the points interlock. */
const SHAPE = [" ▄█▄ ", "█████", " ▀█▀ "];
const ROWS = [3, 4, 5, 4, 3];
const PITCH = 6;
const WIDTH = 5 * PITCH - 1;
const HEIGHT = (ROWS.length - 1) * 2 + SHAPE.length;
const LIGHT = "#FFE2A0";

type Segment = { x: number; y: number; ring: number };

const SEGMENTS: Segment[] = ROWS.flatMap((count, row) =>
  Array.from({ length: count }, (_, column) => ({ x: ((5 - count) * PITCH) / 2 + column * PITCH, y: row * 2, row, column }))
    .filter(({ row, column }) => !(row === 2 && column === 2))
    .map(({ x, y, row }) => {
      // The inner ring touches the missing center: the middle three rows, next to it.
      const inner = Math.abs(row - 2) <= 1 && Math.abs(x + 2 - WIDTH / 2) <= PITCH + 1;
      return { x, y, ring: inner ? 0 : 1 };
    }),
);

/** Which segment covers each cell, or -1. */
const COVER: number[][] = (() => {
  const grid = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => -1));
  SEGMENTS.forEach((segment, index) =>
    SHAPE.forEach((line, dy) =>
      [...line].forEach((character, dx) => {
        if (character !== " ") grid[segment.y + dy]![segment.x + dx] = index;
      }),
    ),
  );
  return grid;
})();

/** The order segments light in: the inner ring, then the outer, each going round from the top. */
const ORDER = SEGMENTS.map((segment, index) => ({ index, ring: segment.ring, angle: Math.atan2(segment.y + 1 - HEIGHT / 2, segment.x + 2 - WIDTH / 2) }))
  .sort((a, b) => a.ring - b.ring || a.angle - b.angle)
  .map((one) => one.index);

/** When each segment starts to light, after the one before; and how long it takes. */
const STEP_MS = 55;
const FADE_MS = 260;
const DONE_MS = ORDER.length * STEP_MS + FADE_MS;

/** The missing center segment's place, which is a hole in the real mirror too. */
const CENTER = { x: 2 * PITCH, y: 4 };
const isCenter = (x: number, y: number) => (SHAPE[y - CENTER.y]?.[x - CENTER.x] ?? " ") !== " ";

/** What a ripple brightens toward, and how a segment under the pointer glows. */
const FLARE = "#FFF4D6";
const HOVER_GLOW = 0.25;
/** How long a ripple takes to reach the next segment out, to flare, and to fade. */
const WAVE_MS = 70;
const RISE_MS = 60;
const DECAY_MS = 420;
/** First light: the whole mirror at once, slower to fade. */
const BLOOM_DECAY_MS = 1400;
const FACT_MS = 6000;

/** Clicking a segment brings up the next of these; the center has its own. */
const FACTS = [
  "18 gold-coated beryllium segments, 6.5 meters across.",
  "The gold is about 100 nanometers thick: 48 grams in all.",
  "Launched on December 25, 2021, folded up to fit the rocket.",
  "It works from L2, about 1.5 million kilometers from Earth.",
  "Its segments were aligned to act as one mirror in 2022.",
  "Its first full-color images came out on July 12, 2022.",
];
const CENTER_FACT = "The center is open: light passes through to the instruments.";
const FIRST_LIGHT = "All 18 segments aligned. First light.";

type Ripple = { at: number; x: number; y: number; bloom: boolean };

/** How far a segment is from a point, in steps from one segment to the next. Rows are two cells apart and half a segment over. */
function steps(segment: Segment, x: number, y: number) {
  return Math.hypot((segment.x + 2 - x) / PITCH, ((segment.y + 1 - y) / 2) * 0.866);
}

/** A ripple's light on a segment `delay` ms after it set out: a quick flare, then a fade. */
function pulse(delay: number, decay: number) {
  if (delay < 0) return 0;
  return delay < RISE_MS ? delay / RISE_MS : Math.max(0, 1 - (delay - RISE_MS) / decay);
}

/** A segment's gold: light falls from the upper left, so those shine and the far ones deepen. */
function shade(segment: Segment) {
  const t = (segment.x / (WIDTH - 5) + segment.y / (HEIGHT - 3)) / 2;
  return t < 0.4 ? mix(LIGHT, PALETTE.gold, t / 0.4) : mix(PALETTE.gold, PALETTE.goldDeep, (t - 0.4) / 0.6);
}

/** The mirror `time` ms into its first lighting, each segment brightened toward white by its `glow`. */
function Mirror({ time, glow }: { time: number; glow: number[] }) {
  const colors = SEGMENTS.map((segment, index) => {
    const start = ORDER.indexOf(index) * STEP_MS;
    const lit = Math.min(1, Math.max(0, (time - start) / FADE_MS));
    return mix(mix(PALETTE.raised, shade(segment), lit), FLARE, Math.min(1, glow[index] ?? 0));
  });
  return (
    <Box flexDirection="column">
      {COVER.map((cells, y) => {
        // Runs of cells that share a color, so each row is a few pieces rather than one per cell.
        const runs: { text: string; color?: string }[] = [];
        cells.forEach((index, x) => {
          const character = index === -1 ? " " : (SHAPE[y - (SEGMENTS[index]?.y ?? 0)]?.[x - (SEGMENTS[index]?.x ?? 0)] ?? " ");
          const color = index === -1 ? undefined : colors[index];
          const last = runs.at(-1);
          if (last && last.color === color) last.text += character;
          else runs.push({ text: character, color });
        });
        return (
          <Text key={y}>
            {runs.map((run, i) => (
              <Text key={i} color={run.color}>
                {run.text}
              </Text>
            ))}
          </Text>
        );
      })}
    </Box>
  );
}

type Props = { cwd: string; home: string; branch?: string; width: number };

export function Welcome({ cwd, home, branch, width }: Props) {
  const [done, setDone] = useState(false);
  const { time } = useAnimation({ interval: 40, isActive: !done });
  useEffect(() => {
    if (time >= DONE_MS) setDone(true);
  }, [time]);

  const mirror = useRef<DOMElement>(null);
  const ripples = useRef<Ripple[]>([]);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  /** The facts shown so far, and the segments clicked since the last first light. */
  const told = useRef(0);
  const clicked = useRef(new Set<number>());
  const [fact, setFact] = useState<string | null>(null);
  useEffect(() => {
    if (!fact) return;
    const timer = setTimeout(() => setFact(null), FACT_MS);
    return () => clearTimeout(timer);
  }, [fact]);

  const now = Date.now();
  ripples.current = ripples.current.filter((ripple) => now - ripple.at < 6 * WAVE_MS + RISE_MS + (ripple.bloom ? BLOOM_DECAY_MS : DECAY_MS));
  useAnimation({ interval: 40, isActive: ripples.current.length > 0 });

  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left") return;
    const at = hit(mirror.current, event);
    const index = at ? (COVER[at.y]?.[at.x] ?? -1) : -1;
    if (!at || (index === -1 && !isCenter(at.x, at.y))) return;
    event.handled = true;
    const segment = SEGMENTS[index];
    if (!segment) {
      ripples.current.push({ at: Date.now(), x: CENTER.x + 2, y: CENTER.y + 1, bloom: false });
      setFact(CENTER_FACT);
    } else {
      clicked.current.add(index);
      const all = clicked.current.size === SEGMENTS.length;
      ripples.current.push(all ? { at: Date.now(), x: CENTER.x + 2, y: CENTER.y + 1, bloom: true } : { at: Date.now(), x: segment.x + 2, y: segment.y + 1, bloom: false });
      if (all) clicked.current.clear();
      setFact(all ? FIRST_LIGHT : (FACTS[told.current++ % FACTS.length] ?? null));
    }
    redraw();
  });
  // A segment under the pointer glows a little, and the pointer is a hand, the only hint there is.
  const hovered = useHover(mirror, (x, y) => {
    const index = COVER[y]?.[x] ?? -1;
    return index !== -1 ? { key: index, shape: "pointer" } : isCenter(x, y) ? { key: -1, shape: "pointer" } : null;
  });

  const glow = SEGMENTS.map((segment, index) => {
    let light = index === hovered ? HOVER_GLOW : 0;
    for (const ripple of ripples.current) {
      const away = steps(segment, ripple.x, ripple.y);
      light += ripple.bloom
        ? pulse(now - ripple.at - away * WAVE_MS, BLOOM_DECAY_MS)
        : pulse(now - ripple.at - away * WAVE_MS, DECAY_MS) * Math.max(0.3, 1 - away * 0.18);
    }
    return light;
  });

  const where = fit(shortPath(cwd, "", home), width - (branch ? branch.length + 4 : 0) - 4, true);
  return (
    <Box flexDirection="column" alignItems="center">
      <Box ref={mirror}>
        <Mirror time={done ? DONE_MS : time} glow={glow} />
      </Box>
      <Box marginTop={2}>
        <Text bold color={PALETTE.star}>
          astrocode
        </Text>
      </Box>
      <Text>
        <Text color={PALETTE.haze}>{where}</Text>
        {branch ? <Text color={PALETTE.dust}>{`  ⎇ ${branch}`}</Text> : null}
      </Text>
      <Box marginTop={2}>
        {fact ? (
          <Text color={PALETTE.haze}>{fit(fact, width - 4, false)}</Text>
        ) : (
          <Text color={PALETTE.dust}>Type a message to start, / for commands, or @ for files.</Text>
        )}
      </Box>
    </Box>
  );
}

/** Rows the welcome needs, so full screen shows it only where it fits. */
export const WELCOME_HEIGHT = HEIGHT + 7;
export const WELCOME_WIDTH = WIDTH;
