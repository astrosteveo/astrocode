import type { ModelChoice } from "../events";

/** `claude-opus-5-5` reads as `Opus 5.5`. */
export function modelLabel(model: string) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(model);
  if (!match) return model.charAt(0).toUpperCase() + model.slice(1);
  const [, family = "", major = "", minor] = match;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
}

/** Whether one of Claude Code's model choices is the model running, which it may name by id or by alias. */
export function isCurrentModel(current: string | undefined, choice: ModelChoice) {
  return current !== undefined && (current === choice.value || modelLabel(current) === choice.name);
}

export function currentModel(state: { model?: string; models: ModelChoice[] }) {
  return state.models.find((model) => isCurrentModel(state.model, model));
}

/** Whether thinking can be turned off on the model running. Unknown models are given the benefit of the doubt. */
export function canStopThinking(state: { model?: string; models: ModelChoice[] }) {
  return currentModel(state)?.thinkingOff ?? true;
}

export function duration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** How long something took, to a tenth of a second under ten seconds: `0.4s`, `6.2s`, `1m 12s`. */
export function took(ms: number) {
  return ms < 10_000 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : duration(ms);
}

/** Whether a time is long enough to be worth saying: under a tenth of a second it would read `0.0s`. */
export const timed = (ms: number | undefined): ms is number => ms !== undefined && ms >= 100;

/** 1234 reads as 1.2k. */
export function compact(count: number) {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** How long ago, briefly: 5m ago, 3h ago, Mon. */
export function ago(ms: number, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** When a usage window resets: a time today, or a weekday and time. `seconds` is a Unix time. */
export function resetTime(seconds: number, now = Date.now()) {
  const at = new Date(seconds * 1000);
  const sameDay = at.toDateString() === new Date(now).toDateString();
  return at.toLocaleString(undefined, sameDay ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric" });
}
