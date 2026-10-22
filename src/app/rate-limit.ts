// Best-effort limit on AI checks, the only part of the tool that costs money.
// Kept in memory, so it resets when a server instance restarts and isn't
// shared between instances: it slows down misuse, it doesn't stop it. The
// real cap is the spend limit on the API key.

const WINDOW_MS = 10 * 60 * 1000;
const PER_VISITOR = 30;
const PER_INSTANCE = 300;

const visitors = new Map<string, number[]>();
let instance: number[] = [];

const recent = (times: number[], now: number) => times.filter((time) => now - time < WINDOW_MS);

/** Records one AI check. Returns false if this visitor or instance is over the limit. */
export function allowAiCheck(visitor: string, now = Date.now()): boolean {
  instance = recent(instance, now);
  const mine = recent(visitors.get(visitor) ?? [], now);
  if (mine.length >= PER_VISITOR || instance.length >= PER_INSTANCE) {
    visitors.set(visitor, mine);
    return false;
  }
  mine.push(now);
  instance.push(now);
  visitors.set(visitor, mine);
  // Keep memory bounded.
  if (visitors.size > 5000) visitors.clear();
  return true;
}

/** For tests only. */
export function resetRateLimit(): void {
  visitors.clear();
  instance = [];
}
