/**
 * Which duels the settler's hourly sweep looks at, and what it remembers afterwards.
 *
 * Split out from lib/server/duelFlow because this is the part that decides whether a duel holding
 * real stakes can ever be forgotten, and that deserves tests. Everything here is pure: no chain,
 * no store, no `server-only`, so the suite can exercise it directly.
 *
 * The rule the whole design exists to guarantee: **a duel leaves the watchlist only when the chain
 * has said it is terminally finished.** Not when it is old, not when the list is long, not when a
 * read failed. Anything else eventually strands somebody's money.
 */

export interface DuelWatch {
  /** Duel ids the chain has not yet reported as Settled or Cancelled. */
  ids: number[];
  /** Highest duel id already folded into {@link ids}. Anything above it is new since last sweep. */
  highWater: number;
}

/**
 * How far back a cold start looks when there is no watchlist yet.
 *
 * Only reached on the first sweep of a deployment, or after the store is wiped. Anything older than
 * this and still unfinished has to be an unaccepted invite, which no sweep can act on anyway —
 * only its creator can withdraw it.
 */
export const COLD_START_SCAN = 500;

/**
 * Picks the duels to read this run.
 *
 * Carried-over live duels and newly created ones go into one pool, oldest first, because the oldest
 * have been holding stakes the longest. `maxToScan` bounds the chain reads; whatever does not fit
 * is deferred rather than dropped, and {@link nextWatch} keeps it for next time.
 */
export function planSweep(
  newest: number,
  watch: DuelWatch | null,
  maxToScan: number,
): { scanning: number[]; deferred: number[] } {
  if (newest < 1) return { scanning: [], deferred: [] };

  const firstNew = watch ? watch.highWater + 1 : Math.max(1, newest - COLD_START_SCAN + 1);

  // A set, because a carried-over id and a "new" id can overlap if highWater ever moves backwards
  // — reading the same duel twice in one sweep would be harmless but settling it twice would not.
  const candidates = new Set<number>();
  for (const id of watch?.ids ?? []) {
    if (id >= 1 && id <= newest) candidates.add(id);
  }
  for (let id = firstNew; id <= newest; id++) candidates.add(id);

  const ordered = [...candidates].sort((a, b) => a - b);
  return { scanning: ordered.slice(0, maxToScan), deferred: ordered.slice(maxToScan) };
}

/**
 * The watchlist to persist once the sweep has classified everything it managed to read.
 *
 * `highWater` moves to `newest` even when duels were deferred: those ids are already carried in
 * `ids`, so nothing needs re-ingesting, and leaving the mark behind would make every later sweep
 * re-walk the same range.
 */
export function nextWatch(newest: number, deferred: number[], stillLive: number[]): DuelWatch {
  const ids = [...new Set([...deferred, ...stillLive])].sort((a, b) => a - b);
  return { ids, highWater: newest };
}
