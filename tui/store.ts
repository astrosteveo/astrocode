import { initialState, reducer, type State } from "../src/view/state";
import type { ServerEvent } from "../src/protocol";

/**
 * The session's events, folded into view state with the same reducer as the web page.
 * `epoch` counts resets, so the scrollback Ink has already written can start over.
 */
export class Store {
  epoch = 0;
  private state: State;
  private listeners = new Set<() => void>();

  constructor(
    private readonly cwd: string,
    private readonly home: string,
  ) {
    this.state = this.fresh();
  }

  emit = (event: ServerEvent) => {
    this.state = reducer(this.state, { type: "event", event });
    this.notify();
  };

  reset() {
    this.state = this.fresh();
    this.epoch += 1;
    this.notify();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  private fresh(): State {
    // The account outlives a reset; the model is reported again when the next session starts.
    return { ...initialState, connected: true, cwd: this.cwd, home: this.home, plan: this.state?.plan };
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
