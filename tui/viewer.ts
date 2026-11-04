// Scrollback's transcript viewer, as `claude` opens one with Ctrl+O: the transcript full screen, with
// full screen's cursor, keys and mouse, on the terminal's alternate screen, so the scrollback under it
// stays exactly as it was. Ink lends the terminal out around each switch, as it does to an editor:
// its frame is erased from the screen being left and drawn whole on the other, and kitty's keyboard
// modes, which each screen keeps apart, go along. What scrollback writes for good waits while the
// viewer is open, as the alternate screen would take it, and goes into the scrollback once it closes.
import { useApp, useStdout } from "ink";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Mouse } from "./mouse";
import { forgetSent } from "./pictures";

/** Onto the alternate screen, at its top; and back to the scrollback, with the cursor where it was. */
const ENTER = "\x1b[?1049h\x1b[H";
const LEAVE = "\x1b[?1049l";

/** Whether the viewer is drawn, and how many entries scrollback had written, which it keeps to until the viewer has closed. */
type Viewer = { open: boolean; held: number } | null;

export function useViewer(mouse: Mouse | null) {
  const { suspendTerminal } = useApp();
  const { stdout } = useStdout();
  const [viewer, setViewer] = useState<Viewer>(null);
  /** Whether the terminal is on the alternate screen, which runs ahead of what's drawn while it switches. */
  const away = useRef(false);
  /** The switch under way, which the next waits for. */
  const switched = useRef(Promise.resolve());
  const written = useRef(0);

  // Ink draws only what's committed, and React commits an update made outside an event a moment
  // later, on its own schedule, so each step of a switch waits for its render to be committed.
  const committed = useRef<{ done: (now: Viewer) => boolean; then: () => void } | null>(null);
  useLayoutEffect(() => {
    const waiting = committed.current;
    if (!waiting?.done(viewer)) return;
    committed.current = null;
    waiting.then();
  });
  const commit = (update: (now: Viewer) => Viewer, done: (now: Viewer) => boolean) =>
    new Promise<void>((then) => {
      committed.current = { done, then };
      setViewer(update);
    });

  /**
   * Back to the scrollback, as astrocode stops or crashes with the viewer open. Ink lets go of kitty's
   * keyboard mode only after this, on the screen it's then on, so the ways out astrocode takes itself
   * close the viewer first (`show(false)`).
   */
  const restore = useRef(() => {
    if (!away.current) return;
    away.current = false;
    mouse?.stop();
    stdout.write(LEAVE);
  }).current;
  useEffect(
    () => () => {
      process.off("exit", restore);
      restore();
    },
    [],
  );

  /**
   * Opens or closes the viewer, once the switch under way, if any, is done. In order: scrollback
   * stops writing for good, Ink lets go of the terminal, which goes to the other screen, the frame
   * for that screen is drawn whole once Ink takes it back, and only then, on the scrollback's screen,
   * does scrollback write what waited.
   */
  const show = (open: boolean) => {
    const done = switched.current.then(() => toggle(open));
    switched.current = done.catch(() => {});
    return done;
  };
  const toggle = async (open: boolean) => {
    if (away.current === open) return;
    // As of the render that commits it, so it's what scrollback has written, however late that is.
    if (open) setViewer(() => ({ open: false, held: written.current }));
    const suspension = await suspendTerminal();
    if (!open) mouse?.stop();
    stdout.write(open ? ENTER : LEAVE);
    away.current = open;
    if (open) {
      mouse?.start();
      process.on("exit", restore);
    } else process.off("exit", restore);
    // kitty keeps each screen's pictures apart, so they're sent again to the one now showing.
    forgetSent();
    // Ink draws the other screen's frame whole as it takes the terminal back.
    await commit(
      (now) => now && { ...now, open },
      (now) => now?.open === open,
    );
    await suspension.resume();
    if (!open) await commit(() => null, (now) => now === null);
  };

  /**
   * Ink's suspendTerminal, for an editor or Ctrl+Z, which get the scrollback's screen, as they
   * would without the viewer: an editor's own way out of the alternate screen would take the viewer
   * with it. The viewer's screen is taken back before Ink draws again.
   */
  const suspend = async () => {
    const suspension = await suspendTerminal();
    const viewing = away.current;
    if (viewing) stdout.write(LEAVE);
    return {
      resume: async () => {
        if (viewing) stdout.write(ENTER);
        await suspension.resume();
      },
    };
  };

  /** Of what scrollback writes for good, as much as it may write now: all of it, or while the viewer is open, what it had. */
  const hold = <T>(entries: T[]) => {
    const shown = viewer ? entries.slice(0, viewer.held) : entries;
    written.current = shown.length;
    return shown;
  };

  return { open: viewer?.open ?? false, show, suspend, hold };
}
