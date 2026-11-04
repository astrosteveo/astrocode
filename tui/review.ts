// What full screen's opened ledgers show: each one's scope, what the scopes besides the turn list,
// and each file's diff, read as it's opened. A turn's diffs come from git's trees for its edges
// while the session keeps them, else from its edits' own diffs. The other scopes are read from the
// working tree as it is each time you switch to one, since it moves on.
import { useEffect, useRef, useState } from "react";
import type { FileChange, Trees } from "../src/events";
import type { Changes } from "../src/snapshots";
import { callsOf } from "../src/view/ledger";
import { patchLines, type DiffLine } from "../src/view/patch";
import type { Item, ToolCall } from "../src/view/state";
import { editedFile, field } from "../src/view/tools";
import { editLines } from "./diff";
import { fileTarget, SCOPES, type FileDiff, type Listed, type Scope, type TurnItem } from "./ledger";

/** Where the ledger's git comes from: the session, which keeps the turns' trees. */
export type Reader = {
  changes(scope: "uncommitted" | "branch"): Promise<Changes | null>;
  patch(trees: Trees, file: FileChange): Promise<string | null>;
};

export type Review = {
  /** Each ledger's scope, by its turn's key, where it isn't the turn. */
  scopes: ReadonlyMap<string, Scope>;
  /** What the other scopes list, once asked. */
  lists: ReadonlyMap<Scope, Listed>;
  /** Each file's diff read so far, by `diffKey()`. */
  diffs: ReadonlyMap<string, FileDiff>;
  /** Whether there's git to switch scopes in. */
  git: boolean;
  /** Counts changes, so what's drawn from it is drawn again. */
  version: number;
};

export const NO_REVIEW: Review = { scopes: new Map(), lists: new Map(), diffs: new Map(), git: false, version: 0 };

/** A turn's file's diffs are its own; the other scopes' are the same whichever ledger shows them. */
export const diffKey = (scope: Scope, turn: string, path: string) => (scope === "turn" ? `turn\n${turn}\n${path}` : `${scope}\n${path}`);

export const scopeOf = (review: Review, turn: string): Scope => (review.git ? (review.scopes.get(turn) ?? "turn") : "turn");

/** What the ledger closing `turn` lists in `scope`. */
export function listedIn(review: Review, turn: TurnItem, scope: Scope): Listed {
  return scope === "turn" ? { files: turn.files ?? [] } : (review.lists.get(scope) ?? "reading");
}

/**
 * The opened ledgers' scopes and what they show, read from `reader` as files open, which `expanded`
 * holds by `fileTarget()`. A new `epoch` starts over, as a new conversation does.
 */
export function useReview(reader: Reader, items: Item[], expanded: ReadonlySet<string>, git: boolean, epoch: number) {
  const [state, setState] = useState<Omit<Review, "git">>(NO_REVIEW);
  /** What's been asked of git, by list and by diff, so nothing is asked twice while it's read. */
  const asked = useRef(new Set<string>());
  /** Counts new conversations, so what was read for one doesn't land in the next. */
  const conversation = useRef(0);
  const review: Review = { ...state, git };
  const update = (change: (now: Omit<Review, "git">) => Partial<Omit<Review, "git">>) => setState((now) => ({ ...now, ...change(now), version: now.version + 1 }));
  /** What `scopes` besides the turn listed, and their diffs, forgotten, to be read again from the working tree as it is now. */
  const forget = (scopes: Scope[]) => {
    const theirs = (key: string) => scopes.some((scope) => key === scope || key.startsWith(`${scope}\n`));
    for (const key of asked.current) if (theirs(key)) asked.current.delete(key);
    return (now: Omit<Review, "git">) => ({
      lists: new Map([...now.lists].filter(([scope]) => !theirs(scope))),
      diffs: new Map([...now.diffs].filter(([key]) => !theirs(key))),
    });
  };

  useEffect(() => {
    conversation.current += 1;
    asked.current = new Set();
    setState((now) => ({ ...NO_REVIEW, version: now.version + 1 }));
  }, [epoch]);

  // Each turn may change the working tree, so what isn't committed, and the branch, are read again.
  const ended = items.filter((item) => item.kind === "turn").length;
  useEffect(() => {
    if (state.lists.size) update(forget(["uncommitted", "branch"]));
  }, [ended]);

  useEffect(() => {
    const now = conversation.current;
    items.forEach((turn, index) => {
      if (turn.kind !== "turn" || !expanded.has(turn.key)) return;
      const scope = scopeOf(review, turn.key);
      if (scope !== "turn" && !asked.current.has(scope)) {
        asked.current.add(scope);
        const done = (listed: Listed) => conversation.current === now && update((state) => ({ lists: new Map(state.lists).set(scope, listed) }));
        reader.changes(scope).then((changes) => done(changes ?? "failed"), () => done("failed"));
      }
      const listed = listedIn(review, turn, scope);
      if (typeof listed !== "object") return;
      for (const file of listed.files) {
        const key = diffKey(scope, turn.key, file.path);
        if (!expanded.has(fileTarget(turn.key, file.path)) || file.big || file.binary || asked.current.has(key)) continue;
        asked.current.add(key);
        const read = scope === "turn" ? turnDiff(reader, turn, file, callsOf(items, index)) : listed.trees ? reader.patch(listed.trees, file).then(linesOf) : Promise.resolve("gone" as const);
        const done = (diff: FileDiff) => conversation.current === now && update((state) => ({ diffs: new Map(state.diffs).set(key, diff) }));
        read.then(done, () => done("gone"));
      }
    });
  }, [items, expanded, state, git]);

  /** `[` or `]`, or a click on a scope: the ledger closing `turn` lists another, read afresh. */
  const setScope = (turn: string, to: Scope | -1 | 1) => {
    if (!git) return;
    const now = scopeOf(review, turn);
    const next = typeof to === "string" ? to : SCOPES[(SCOPES.indexOf(now) + to + SCOPES.length) % SCOPES.length]!;
    if (next === now) return;
    const fresh = forget(next === "turn" ? [] : [next]);
    update((state) => ({ ...fresh(state), scopes: new Map(state.scopes).set(turn, next) }));
  };

  return { review, setScope };
}

const linesOf = (patch: string | null): FileDiff => {
  const lines = patch === null ? [] : patchLines(patch);
  return lines.length ? lines : "gone";
};

/** A file's diff for the turn: git's between its edges, else what the turn's edits to it changed. */
export async function turnDiff(reader: Reader, turn: TurnItem, file: FileChange, calls: ToolCall[]): Promise<FileDiff> {
  const patch = turn.trees ? await reader.patch(turn.trees, file) : null;
  const lines = patch === null ? [] : patchLines(patch);
  if (lines.length) return lines;
  const edits = calls.filter((call) => call.status === "done" && editedFile(call.name, call.input) === file.path).flatMap(editedLines);
  return edits.length ? edits : "gone";
}

/** What an edit changed, by Claude Code's patch; a file written new is all added. */
function editedLines(call: ToolCall): DiffLine[] {
  const hunks = field(call.output, "structuredPatch");
  const content = call.input.content;
  if (call.name === "Write" && !(Array.isArray(hunks) && hunks.length) && typeof content === "string") {
    return content
      .replace(/\n$/, "")
      .split("\n")
      .map((text, i) => ({ kind: "added", text, new: i + 1 }));
  }
  return editLines(call);
}
