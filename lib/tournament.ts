/**
 * Hourly tournament scheduling. Shared by the client (to show the countdown) and the settler
 * backend (to decide what to create and what to close), so every derivation here is pure and
 * timestamp-driven — no server state involved.
 */
import { GAME_IDS, type GameId } from "./games/types";

export const HOUR_SECONDS = 3600;

/** Unix seconds at the top of the hour containing `nowSeconds`. */
export function hourStart(nowSeconds: number): number {
  return Math.floor(nowSeconds / HOUR_SECONDS) * HOUR_SECONDS;
}

export function currentWindow(nowSeconds = Math.floor(Date.now() / 1000)) {
  const start = hourStart(nowSeconds);
  return { start, end: start + HOUR_SECONDS };
}

/**
 * Which game an hour runs. Rotating on the hour bucket rather than the tournament id means the
 * schedule is predictable to players and stays stable even if an hour is skipped.
 */
export function gameForWindow(startSeconds: number): GameId {
  const hourIndex = Math.floor(startSeconds / HOUR_SECONDS);
  return GAME_IDS[hourIndex % GAME_IDS.length];
}

/** Prize split for the top finishers, as weights passed to `settle`. */
export const PAYOUT_WEIGHTS = [50, 30, 20];

/**
 * Ranks scores and produces the winners/weights arrays for the contract.
 *
 * Fewer players than payout slots simply means fewer winners — the weights still sum to whatever
 * is present, and the contract divides pro-rata over that sum, so the pot is always fully paid out.
 * Ties are broken by earliest submission, which rewards the player who got there first.
 */
export function computePayouts<T extends { address: string; score: number; submittedAt: number }>(
  entries: T[],
): { winners: `0x${string}`[]; weights: bigint[]; ranked: T[] } {
  const ranked = [...entries].sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt);
  const top = ranked.slice(0, PAYOUT_WEIGHTS.length).filter((e) => e.score > 0);

  return {
    winners: top.map((e) => e.address as `0x${string}`),
    weights: top.map((_, i) => BigInt(PAYOUT_WEIGHTS[i])),
    ranked,
  };
}

export function secondsRemaining(endSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)) {
  return Math.max(0, endSeconds - nowSeconds);
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
