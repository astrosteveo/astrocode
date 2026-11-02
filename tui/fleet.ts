// The conversations astrocode runs at once. The one on screen is one of them; the rest carry on
// while you're in the agents view or another conversation, as Claude Code's background sessions do
// while you're away from them in `claude agents`.
import { sessionTitle } from "../src/history";
import type { State } from "../src/view/state";
import type { Store } from "./store";

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

  /** The conversations in the order they started, a new array whenever that changes. */
  getSnapshot = () => this.members;

  private notify() {
    for (const listener of this.listeners) listener();
  }
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
