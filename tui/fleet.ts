// The conversations astrocode runs at once. The one on screen is one of them; the rest carry on
// while you're in the agents view or another conversation, as Claude Code's background sessions do
// while you're away from them in `claude agents`.
import { useCallback, useSyncExternalStore } from "react";
import { runningAgents, waitsOnYou, type Agent } from "../src/agents";
import { sessionTitle } from "../src/history";
import { asksYou, type State } from "../src/view/state";
import type { Store } from "./store";

/** How often Claude Code's background sessions are read again while a conversation counts those waiting on you. */
const BACKGROUND_MS = 10_000;

export type Conversation = {
  /** Its row's key in the agents view. */
  key: string;
  store: Store;
  session: { readonly knownId: string | undefined };
  cwd: string;
};

export class Fleet<C extends Conversation = Conversation> {
  private members: readonly C[] = [];
  private listeners = new Set<() => void>();

  add(conversation: C) {
    this.members = [...this.members, conversation];
    this.notify();
    return conversation;
  }

  remove(conversation: C) {
    this.members = this.members.filter((member) => member !== conversation);
    this.notify();
  }

  get(key: string | undefined) {
    return this.members.find((member) => member.key === key);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Calls `listener` whenever a conversation joins or leaves, or anything in one changes. */
  watch = (listener: () => void) => {
    let stops: (() => void)[] = [];
    const follow = () => {
      for (const stop of stops) stop();
      stops = this.members.map((member) => member.store.subscribe(listener));
    };
    follow();
    const leave = this.subscribe(() => {
      follow();
      listener();
    });
    return () => {
      leave();
      for (const stop of stops) stop();
    };
  };

  /** The conversations in the order they started, a new array whenever that changes. */
  getSnapshot = () => this.members;

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

/** Where one of astrocode's conversations is: working, waiting on you, or idle and free to move to the background. */
export type LiveState = "working" | "blocked" | "idle";

export function liveState(state: State, shells: number): LiveState {
  if (asksYou(state)) return "blocked";
  // What runs in the background, Claude's or yours, would stop with this Claude Code.
  if (state.busy || state.tasks.length || shells) return "working";
  return "idle";
}

/**
 * How many conversations but the one whose store is `here` wait on you: astrocode's others, with a
 * tool call to allow, a question or a form, and Claude Code's background sessions in `agents`, but
 * those moved into astrocode, whose own conversations stand for them.
 */
export function needsYou(conversations: readonly Conversation[], here: Store, agents: readonly Agent[] = []) {
  const ids = new Set(conversations.flatMap((one) => one.session.knownId ?? []));
  const mine = conversations.filter((one) => one.store !== here && liveState(one.store.getSnapshot(), one.store.shells.size) === "blocked").length;
  return mine + agents.filter((agent) => waitsOnYou(agent) && !(agent.sessionId && ids.has(agent.sessionId))).length;
}

/** {@link needsYou} for the conversation whose store is `here`, kept current. */
export function useNeedsYou(fleet: Fleet, background: Background, here: Store) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = [fleet.watch(listener), background.subscribe(listener)];
      return () => {
        for (const stop of stops) stop();
      };
    },
    [fleet, background],
  );
  return useSyncExternalStore(subscribe, () => needsYou(fleet.getSnapshot(), here, background.getSnapshot()));
}

/**
 * Claude Code's background sessions that run now, read at once and then every `every` ms while
 * anything listens: a conversation's status bar counts those waiting on you. A `claude` that can't
 * list them has none waiting.
 */
export class Background {
  private agents: readonly Agent[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly list: () => Promise<Agent[]> = runningAgents,
    private readonly every = BACKGROUND_MS,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.timer) {
      void this.read();
      this.timer = setInterval(() => void this.read(), this.every);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size || !this.timer) return;
      clearInterval(this.timer);
      this.timer = undefined;
    };
  };

  getSnapshot = () => this.agents;

  private async read() {
    this.agents = await this.list().catch(() => []);
    for (const listener of this.listeners) listener();
  }
}

/** How many wait on you, in words: `1 needs you`, `2 need you`. */
export function needYou(count: number) {
  return `${count} ${count === 1 ? "needs" : "need"} you`;
}

/** What it's called: the name Claude Code gave it, else its first message. */
export async function titleOf(conversation: Conversation) {
  const id = conversation.session.knownId;
  const title = id ? await sessionTitle(id, conversation.cwd).catch(() => undefined) : undefined;
  return title ?? firstPrompt(conversation.store.getSnapshot()) ?? "New conversation";
}

/** The first line of your first message in it. */
export function firstPrompt(state: State) {
  const prompt = state.items.find((item) => item.kind === "prompt");
  return prompt?.kind === "prompt" ? prompt.text.trim().split("\n")[0] : undefined;
}

/**
 * Moves conversations to Claude Code's background service with `handOff`, which gives the id there
 * of each one that went, and says where each went. They're idle, so one the service refuses loses
 * nothing by ending here, and keeps astrocode from quitting no longer than it takes to say how to
 * resume it.
 */
export async function moveAll<C extends Conversation>(conversations: readonly C[], handOff: (conversation: C) => Promise<string | undefined>) {
  const said: string[] = [];
  for (const one of conversations) {
    const name = await titleOf(one);
    try {
      const job = await handOff(one);
      if (job) said.push(`“${name}” carries on in the background as ${job}: claude attach ${job}, or astrocode agents.`);
    } catch (error) {
      const id = one.session.knownId;
      said.push(`“${name}” couldn't move to the background (${error instanceof Error ? error.message : String(error)}), so it ended here${id ? `: astrocode --resume ${id}` : "."}`);
    }
  }
  return said;
}
