// The mouse, in full screen. The terminal reports presses, drags, releases, the wheel and plain
// movement as SGR sequences (`ESC [ < button ; x ; y M`), which are lifted out of stdin before Ink
// reads it. Components listen with `useMouse`, find what was clicked with `hit`, and learn what the
// pointer is over with `useHover`, which also sets the pointer's shape where the terminal has one.
import type { DOMElement } from "ink";
import { createContext, useContext, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";

export type MouseEvent = {
  type: "press" | "drag" | "release" | "wheel" | "move";
  button: "left" | "middle" | "right" | "none";
  /** The screen cell, from 0 at the top left. */
  x: number;
  y: number;
  /** 1 for a click, 2 for a double click, 3 for a triple click. Left presses only. */
  clicks: number;
  /** -1 up, 1 down. Wheel only. */
  wheel: number;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
  /** Set by the listener that used the event, so the ones behind it leave it alone. */
  handled: boolean;
};

type Listener = { handle: (event: MouseEvent) => void; fallback: boolean };

/** Presses, releases, drags and plain movement (1000, 1002, 1003), in SGR's decimal coordinates (1006). */
const ENABLE = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";
const DISABLE = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

/**
 * What the pointer looks like over something: a hand where a click acts, a text beam where a drag
 * selects. Set with OSC 22, which kitty, foot, Ghostty and xterm understand and others ignore. It
 * draws nothing, so it can go to the terminal between Ink's frames.
 */
export type Shape = "pointer" | "text";
const shapeCode = (shape: Shape | "default") => `\x1b]22;${shape}\x1b\\`;
const REPORT = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
/** The start of a report cut off at the end of a chunk; the rest is in the next one. */
const PARTIAL = /\x1b\[<[\d;]*$/;
/** Presses this close together, on the same cell, count as a double or triple click. */
const MULTI_CLICK_MS = 400;

type Stdin = NodeJS.ReadStream;

export class Mouse {
  private listeners: Listener[] = [];
  private carry = "";
  private last = { time: 0, x: -1, y: -1, clicks: 0 };
  private read: Stdin["read"] | null = null;
  /** Where the pointer was last reported, and what's watching it. */
  private pointer: { x: number; y: number } | null = null;
  private watchers = new Set<() => void>();
  /** The shape each hovered element wants, and the one the terminal shows. */
  private shapes = new Map<object, Shape>();
  private shown: Shape | "default" = "default";

  constructor(
    private readonly stdin: Stdin,
    private readonly stdout: NodeJS.WriteStream,
  ) {}

  /** Turns reporting on and takes the reports out of what Ink reads. */
  start() {
    if (this.read) return;
    const read = this.stdin.read;
    this.read = read;
    this.stdin.read = ((size?: number) => {
      const chunk: unknown = read.call(this.stdin, size);
      if (chunk === null || chunk === undefined) return chunk;
      return this.take(typeof chunk === "string" ? chunk : String(chunk));
    }) as Stdin["read"];
    this.stdout.write(ENABLE);
    process.on("exit", this.stop);
  }

  /** Turns reporting off. Also runs when the process exits, so a crash doesn't leave the terminal reporting. */
  stop = () => {
    if (!this.read) return;
    this.stdin.read = this.read;
    this.read = null;
    this.carry = "";
    process.off("exit", this.stop);
    try {
      this.stdout.write(DISABLE + (this.shown === "default" ? "" : shapeCode("default")));
    } catch {}
    this.shown = "default";
    this.pointer = null;
  };

  /** Where the pointer was last reported, or null before it has been. */
  where() {
    return this.pointer;
  }

  /** Calls `update` whenever the pointer moves. */
  watch(update: () => void) {
    this.watchers.add(update);
    return () => {
      this.watchers.delete(update);
    };
  }

  /**
   * What `owner` wants the pointer to look like, or null when it's not under the pointer. A hand
   * wins over a text beam, as a link does over the text around it.
   */
  setShape(owner: object, shape: Shape | null) {
    if (shape) this.shapes.set(owner, shape);
    else this.shapes.delete(owner);
    const wanted = [...this.shapes.values()];
    const next = wanted.includes("pointer") ? "pointer" : wanted.length > 0 ? "text" : "default";
    if (next === this.shown || !this.read) return;
    this.shown = next;
    this.stdout.write(shapeCode(next));
  }

  listen(handle: (event: MouseEvent) => void, fallback = false) {
    const listener = { handle, fallback };
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((one) => one !== listener);
    };
  }

  /** The chunk without its mouse reports, which go to the listeners once Ink is done reading. */
  private take(chunk: string) {
    let text = this.carry + chunk;
    this.carry = "";
    const partial = PARTIAL.exec(text);
    if (partial) {
      this.carry = partial[0];
      text = text.slice(0, partial.index);
    }
    const events: MouseEvent[] = [];
    const rest = text.replace(REPORT, (_, code: string, x: string, y: string, final: string) => {
      const event = this.parse(Number(code), Number(x) - 1, Number(y) - 1, final === "m");
      if (event) events.push(event);
      return "";
    });
    if (events.length > 0) queueMicrotask(() => events.forEach((event) => this.dispatch(event)));
    return rest;
  }

  private parse(code: number, x: number, y: number, released: boolean): MouseEvent | null {
    const base = { x, y, clicks: 0, wheel: 0, shift: (code & 4) !== 0, meta: (code & 8) !== 0, ctrl: (code & 16) !== 0, handled: false };
    if (code & 64) {
      const direction = code & 3;
      // 66 and 67 are the horizontal wheel, which nothing here uses.
      return direction > 1 ? null : { ...base, type: "wheel", button: "none", wheel: direction === 0 ? -1 : 1 };
    }
    const button = (["left", "middle", "right", "none"] as const)[code & 3] ?? "none";
    if (released) return { ...base, type: "release", button };
    if (code & 32) return { ...base, type: button === "none" ? "move" : "drag", button };
    let clicks = 1;
    if (button === "left") {
      const now = Date.now();
      const again = now - this.last.time < MULTI_CLICK_MS && Math.abs(x - this.last.x) <= 1 && y === this.last.y;
      clicks = again ? Math.min(3, this.last.clicks + 1) : 1;
      this.last = { time: now, x, y, clicks };
    }
    return { ...base, type: "press", button, clicks };
  }

  /**
   * To each listener in turn, then to the fallbacks, which act on what nothing else used. Plain
   * movement only goes to what watches the pointer.
   */
  private dispatch(event: MouseEvent) {
    this.pointer = { x: event.x, y: event.y };
    for (const update of this.watchers) update();
    if (event.type === "move") return;
    for (const listener of this.listeners.filter((one) => !one.fallback)) listener.handle(event);
    for (const listener of this.listeners.filter((one) => one.fallback)) listener.handle(event);
  }
}

/** The mouse in full screen; null in the terminal's own scrollback, where the mouse stays the terminal's. */
export const MouseContext = createContext<Mouse | null>(null);

/**
 * Calls `handler` with each mouse event while `isActive`. A fallback listener hears an event after
 * the others, and checks `handled` to leave alone what they used.
 */
export function useMouse(handler: (event: MouseEvent) => void, { isActive = true, fallback = false } = {}) {
  const mouse = useContext(MouseContext);
  const onEvent = useEffectEvent(handler);
  useEffect(() => {
    if (!mouse || !isActive) return;
    return mouse.listen((event) => onEvent(event), fallback);
  }, [mouse, isActive, fallback]);
}

/** Where a box is on screen, from Ink's layout. Ancestors' content offsets scroll it. */
export function rect(element: DOMElement | null | undefined) {
  const layout = element?.yogaNode;
  if (!element || !layout) return null;
  let x = 0;
  let y = 0;
  for (let node: DOMElement | undefined = element; node; node = node.parentNode) {
    x += node.yogaNode?.getComputedLeft() ?? 0;
    y += node.yogaNode?.getComputedTop() ?? 0;
    x -= Math.trunc(node.parentNode?.style.contentOffsetX ?? 0);
    y -= Math.trunc(node.parentNode?.style.contentOffsetY ?? 0);
  }
  return { x, y, width: layout.getComputedWidth(), height: layout.getComputedHeight() };
}

/** The event's cell relative to the box, whether or not it's inside. */
export function relative(element: DOMElement | null | undefined, event: { x: number; y: number }) {
  const box = rect(element);
  if (!box) return null;
  const x = event.x - box.x;
  const y = event.y - box.y;
  return { x, y, inside: x >= 0 && y >= 0 && x < box.width && y < box.height };
}

/** The event's cell relative to the box, or null when it's outside it. */
export function hit(element: DOMElement | null | undefined, event: { x: number; y: number }) {
  const at = relative(element, event);
  return at?.inside ? { x: at.x, y: at.y } : null;
}

/**
 * What the pointer is over in `element`, as `at` names it from the pointer's cell there (and on
 * screen, for testing it against the element's parts with `hit`), or null. `at` returns a key for
 * what's under the pointer and the pointer's shape over it, or null where nothing answers to the
 * mouse. The component draws again only when the key changes. It's worked
 * out again after each render too, since what's under a pointer that holds still can change.
 */
export function useHover<Key extends string | number>(
  element: RefObject<DOMElement | null>,
  at: (x: number, y: number, pointer: { x: number; y: number }) => { key: Key; shape: Shape } | null,
  isActive = true,
): Key | null {
  const mouse = useContext(MouseContext);
  const [hovered, setHovered] = useState<Key | null>(null);
  const owner = useRef({}).current;
  const update = useEffectEvent(() => {
    const pointer = mouse?.where();
    const cell = isActive && pointer ? relative(element.current, pointer) : null;
    const found = pointer && cell?.inside ? at(cell.x, cell.y, pointer) : null;
    mouse?.setShape(owner, found?.shape ?? null);
    setHovered(found?.key ?? null);
  });
  useEffect(() => {
    if (!mouse) return;
    const stop = mouse.watch(update);
    return () => {
      stop();
      mouse.setShape(owner, null);
    };
  }, [mouse]);
  useEffect(() => update());
  return isActive ? hovered : null;
}
