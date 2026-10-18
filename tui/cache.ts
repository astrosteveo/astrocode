// The conversation's prompt cache: how long it stays warm, and keeping it warm while you're away.
// Claude Code caches the conversation for a TTL after each request, an hour on a subscription
// within its limits, and the first message after it expires writes the whole conversation to the
// cache again, which costs far more than reading it. Kept warm, a short request on an unsaved copy
// of the conversation reads the cache shortly before it expires (`AgentSession.warm()`).
import { useEffect, useRef, useState } from "react";
import type { SessionEvent } from "../src/events";
import type { AgentSession } from "../src/session";
import type { Cache, State } from "../src/view/state";

/** How long after Claude last answered you the cache is kept warm. Past that, it's let go. */
export const KEEP_WARM_FOR = 8 * 60 * 60_000;

/** How long before the cache expires a keep-warm request goes: a fifth of the TTL, at most 5 minutes. */
const margin = (ttl: number) => Math.min(5 * 60_000, ttl / 5);

/** Ms the cache has left, which is 0 or less once it's cold. */
export const cacheLeft = (cache: Cache, now = Date.now()) => cache.at + cache.ttl - now;

/** Whether keep-warm is still looking after this cache: it's warm, and you've not been away too long. */
export const keptWarm = (cache: Cache, on: boolean, now = Date.now()) => on && cacheLeft(cache, now) > 0 && now - cache.workedAt < KEEP_WARM_FOR;

/** `54m`, `<1m`: what's left, in whole minutes. */
export function minutesLeft(ms: number) {
  return ms < 60_000 ? "<1m" : `${Math.floor(ms / 60_000)}m`;
}

/** The time now, again every `every` ms while `active`, for readings that count down. */
export function useNow(every: number, active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every, active]);
  return now;
}

type KeepWarm = {
  on: boolean;
  state: State;
  session: AgentSession;
  emit: (event: SessionEvent) => void;
  notice: (tone: "info" | "error", text: string) => void;
  /** Turns keep-warm off, for a request that didn't read the cache and so costs instead of saving. */
  turnOff: () => void;
};

/**
 * While keep-warm is on and Claude isn't working, a request goes just before the cache would
 * expire, for up to `KEEP_WARM_FOR` after Claude last answered you. A cache already cold, as after
 * the computer slept, is left cold: warming it would write the whole conversation, which is what
 * your next message does anyway.
 */
export function useKeepWarm({ on, state, session, emit, notice, turnOff }: KeepWarm) {
  const busy = useRef(false);
  const latest = useRef({ session, emit, notice, turnOff });
  latest.current = { session, emit, notice, turnOff };
  const cache = state.cache;
  useEffect(() => {
    if (!on || !cache || state.busy) return;
    const due = cache.at + cache.ttl - margin(cache.ttl);
    if (due - cache.workedAt > KEEP_WARM_FOR) return;
    const timer = setTimeout(() => {
      const { session, emit, notice, turnOff } = latest.current;
      if (busy.current || cacheLeft(cache) <= 0) return;
      busy.current = true;
      const at = Date.now();
      session
        .warm()
        .then((warmed) => {
          if (!warmed) return;
          // The system prompt is cached across conversations, so a request that missed this one's
          // still reads a little; one that hit it reads far more than it writes.
          if (warmed.read > warmed.written) return emit({ kind: "cache-warmed", at });
          turnOff();
          notice("error", "Keeping the cache warm didn't read the conversation's cache, so it would only cost, and it's off now. /config turns it back on.");
        })
        .catch((error: unknown) => notice("error", `Couldn't keep the cache warm: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          busy.current = false;
        });
    }, Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [on, cache, state.busy]);
}
