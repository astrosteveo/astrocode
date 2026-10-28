import type { ImageAttachment } from "../src/events";
import type { Aside } from "../src/session";
import type { NotifyMode, TodoMode, UsageMode } from "../src/settings";
import type { Stash } from "../src/stash";
import { imageLabel } from "./images";
import { DEFAULT_KEYMAP, type Keymap } from "./keys";
import { prepare, whenReady } from "./pictures";
import type { TerminalWindow } from "./window";
import { initialState, reduce, type State, type ViewEvent } from "../src/view/state";

/**
 * The session's events folded into view state. `epoch` counts resets, so the scrollback Ink has
 * already written can start over. It outlives the interface, which starts again when it switches
 * between scrollback and full screen.
 */
export class Store {
  epoch = 0;
  /** What you've sent, oldest first, for ↑ in the message box. Kept through /clear, like a shell's history. */
  readonly sent: string[] = [];
  /** Images attached in the message box, by the number its `[Image #n]` shows. */
  readonly images = new Map<number, ImageAttachment>();
  /** A message put aside with Ctrl+S, until Ctrl+S brings it back. Kept through /clear, switching layouts and, on disk, quitting. */
  stash: string | null = null;
  /** When the pinned to-dos show: as /config set it, or as Ctrl+T last set it this session. */
  todos: TodoMode = "auto";
  /** How a turn's end or a prompt is announced while you're in another window, as /config set it. */
  notifyMode: NotifyMode = "desktop";
  /** When the status bar shows the plan's usage, as /config set it. */
  usageMode: UsageMode = "auto";
  /** Whether the prompt cache is kept warm while you're away, as /config or a click on the status bar set it. */
  keepWarm = false;
  /** Whether Claude Code reports what each subagent is doing, as /config set it. */
  agentSummaries = false;
  /** Whether sessions start with Remote Control on, as /config set it. */
  remoteControl = false;
  /** The terminal window's focus, title, progress and notifications. */
  window: TerminalWindow | null = null;
  /** What the message box's keys do, read from keybindings.json as astrocode starts. */
  keymap: Keymap = DEFAULT_KEYMAP;
  /** Side questions asked with /btw in this conversation, and their answers, for the next one to follow on from. */
  asides: Aside[] = [];
  /** Commands run with `!` that are still going, by id, to stop. They outlive a switch of layouts. */
  readonly shells = new Map<string, AbortController>();
  private nextImage = 1;
  private state: State;
  /**
   * Events not folded in yet, in order. Scrollback draws an entry once, so an event that brings
   * images waits until they're ready to draw, and those after it wait their turn.
   */
  private held: ViewEvent[] = [];
  private waiting = false;
  private listeners = new Set<() => void>();

  constructor(
    private readonly cwd: string,
    private readonly home: string,
  ) {
    this.state = initialState(cwd, home);
  }

  emit = (event: ViewEvent) => {
    this.held.push(event);
    if (!this.waiting) this.release();
  };

  /** Folds in the held events, in order, up to one whose images aren't ready yet. */
  private release() {
    this.waiting = false;
    while (this.held.length) {
      const wait = whenReady(this.held[0]!);
      if (wait) {
        this.waiting = true;
        void wait.then(() => this.release());
        return;
      }
      this.state = reduce(this.state, this.held.shift()!);
      this.notify();
    }
  }

  /** Starts over for a new or resumed session. What's known about the account and Claude Code stays. */
  reset() {
    const { plan, models, commands, limits, mode, model, effort, thinking, ultracode, ultracodeAvailable, fast } = this.state;
    // Whatever was still waiting on its images belongs to the conversation being left.
    this.held = [];
    this.asides = [];
    this.state = { ...initialState(this.cwd, this.home), plan, models, commands, limits, mode, model, effort, thinking, ultracode, ultracodeAvailable, fast };
    this.epoch += 1;
    this.notify();
  }

  /** Stops the commands run with `!` that are still going, and says how many there were. */
  stopShells() {
    const count = this.shells.size;
    for (const controller of this.shells.values()) controller.abort();
    return count;
  }

  /** Starts the scrollback over with the same conversation, as when coming back from full screen. */
  redraw() {
    this.epoch += 1;
  }

  /** Keeps an image for the message being written, and gives its number. */
  attach(image: ImageAttachment) {
    const n = this.nextImage++;
    this.images.set(n, image);
    return n;
  }

  /** A stash from an earlier run, its images attached again and its `[Image #n]` labels renumbered to match. */
  unstash({ text, images }: Stash) {
    const numbers = new Map<number, number>();
    this.stash = text.replace(/\[Image #(\d+)\]/g, (_, digits: string) => {
      const old = Number(digits);
      const image = images[old];
      // A label whose image is gone mustn't pick up whichever image gets that number next.
      if (!image) return "[Image missing]";
      void prepare(image);
      const n = numbers.get(old) ?? this.attach(image);
      numbers.set(old, n);
      return imageLabel(n);
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
