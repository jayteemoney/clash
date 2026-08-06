import "server-only";

import {
  DUEL_DEADLINE_SECONDS,
  DUEL_STATUS_ACCEPTED,
  chainNow,
  isDuelFinished,
  readDuel,
  readNextDuelId,
  type DuelOnChain,
} from "@/lib/clash";
import { nextWatch, planSweep } from "@/lib/duelSweep";
import { settleDuel, voidDuel } from "./settler";
import { getDuelScores, getDuelWatch, setDuelWatch } from "./store";

/**
 * Resolving duels.
 *
 * Every accepted duel holds two real stakes, so every accepted duel must have a way out. There are
 * exactly three, and between them they cover the whole state space:
 *
 *   - both played        → the higher score wins, immediately, no waiting for the deadline
 *   - one played         → after the deadline, the player who showed up wins
 *   - neither played     → after the deadline, both stakes are refunded via voidDuel
 *
 * The third case is why the contract needs `voidDuel` at all: `settleDuel` has to name a winner,
 * so on its own it cannot resolve a duel nobody completed.
 */

export interface DuelOutcome {
  duelId: number;
  /**
   * `finished` is reserved for duels that are Settled or Cancelled — terminally done, nothing can
   * happen to them again. `not-accepted` means the duel is still Open: this sweep cannot act on it
   * (nobody has staked against it yet) but it is not finished either, and treating the two alike
   * would let a block of unaccepted invites hide older live duels from the sweep.
   */
  status: "settled" | "voided" | "waiting" | "finished" | "not-accepted" | "unknown";
  winner?: `0x${string}`;
  txHash?: string;
  scores?: { address: string; score: number }[];
  /** Why the duel could not be resolved. Only ever set alongside `unknown`. */
  error?: string;
}

/** Whether the chain still considers this duel capable of holding money. */
function stillLive(status: DuelOutcome["status"]): boolean {
  // `unknown` counts as live on purpose: a read or a settle that failed tells us nothing about
  // where the money is, and dropping a duel on that basis would strand it permanently.
  return status === "waiting" || status === "not-accepted" || status === "unknown";
}

/** Higher score wins; a tie goes to whoever submitted first. */
function pickWinner(
  duel: DuelOnChain,
  scores: { address: `0x${string}`; score: number; submittedAt: number }[],
): `0x${string}` | null {
  const eligible = scores.filter(
    (s) =>
      s.address.toLowerCase() === duel.creator.toLowerCase() ||
      s.address.toLowerCase() === duel.opponent.toLowerCase(),
  );
  if (eligible.length === 0) return null;

  const ranked = [...eligible].sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt);
  return ranked[0].address;
}

export async function resolveDuel(duelId: number): Promise<DuelOutcome> {
  let duel: DuelOnChain;
  try {
    duel = await readDuel(BigInt(duelId));
  } catch {
    return { duelId, status: "unknown" };
  }

  if (duel.status !== DUEL_STATUS_ACCEPTED) {
    return { duelId, status: isDuelFinished(duel.status) ? "finished" : "not-accepted" };
  }

  const scores = await getDuelScores(duelId);
  const bothPlayed = scores.length >= 2;
  const expired = (await chainNow()) >= duel.acceptedAt + DUEL_DEADLINE_SECONDS;

  // Still inside the window and someone has yet to play — leave it alone.
  if (!bothPlayed && !expired) {
    return { duelId, status: "waiting", scores: scores.map((s) => ({ address: s.address, score: s.score })) };
  }

  const winner = pickWinner(duel, scores);

  if (!winner) {
    // Deadline passed with no valid score from either side. Refund both.
    const txHash = await voidDuel(BigInt(duelId));
    return { duelId, status: "voided", txHash };
  }

  const txHash = await settleDuel(BigInt(duelId), winner);
  return {
    duelId,
    status: "settled",
    winner,
    txHash,
    scores: scores.map((s) => ({ address: s.address, score: s.score })),
  };
}

/**
 * Resolves every duel that is ready, and keeps track of the ones that are not.
 *
 * Duels normally settle inline the moment both players submit (see app/api/duel/score). This sweep
 * is the safety net for the ones where somebody walked away, so the only thing it must never do is
 * lose sight of a duel that still holds stakes.
 *
 * It therefore works from a persisted watchlist rather than a window over recent ids: new duels are
 * ingested as they appear, finished ones are dropped, and everything else is carried to the next
 * run. `maxToScan` bounds the reads per sweep, oldest first — a duel past the cap is deferred to
 * the next hour, never forgotten.
 */
export async function resolveOpenDuels(maxToScan = 200): Promise<DuelOutcome[]> {
  const next = await readNextDuelId();
  const newest = Number(next) - 1;
  if (newest < 1) return [];

  const { scanning, deferred } = planSweep(newest, await getDuelWatch(), maxToScan);

  const outcomes: DuelOutcome[] = [];
  const live: number[] = [];

  for (const id of scanning) {
    let outcome: DuelOutcome;
    try {
      outcome = await resolveDuel(id);
    } catch (error) {
      // resolveDuel handles its own read failures; reaching here means settleDuel or voidDuel
      // reverted. Keep the duel on the watchlist and try again next hour.
      outcome = { duelId: id, status: "unknown", error: error instanceof Error ? error.message : "settle-failed" };
    }

    if (stillLive(outcome.status)) live.push(id);
    if (outcome.status !== "finished" && outcome.status !== "not-accepted") outcomes.push(outcome);
  }

  await setDuelWatch(nextWatch(newest, deferred, live));

  return outcomes;
}
