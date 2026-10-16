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
  private state: State;
  private listeners = new Set<() => void>();

  constructor(
    private readonly cwd: string,
    private readonly home: string,
  ) {
    this.state = initialState(cwd, home);
  }

  emit = (event: ViewEvent) => {
    this.state = reduce(this.state, event);
    this.notify();
  };

  /** Starts over for a new or resumed session. What's known about the account and Claude Code stays. */
  reset() {
    const { plan, models, commands, limits, mode, model, effort } = this.state;
    this.state = { ...initialState(this.cwd, this.home), plan, models, commands, limits, mode, model, effort };
    this.epoch += 1;
    this.notify();
  }

  /** Starts the scrollback over with the same conversation, as when coming back from full screen. */
  redraw() {
    this.epoch += 1;
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
