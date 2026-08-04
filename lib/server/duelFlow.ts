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
import { settleDuel, voidDuel } from "./settler";
import { getDuelScores } from "./store";

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
 * How many consecutive terminally-finished duels end the sweep.
 *
 * Duels finish roughly in creation order, so a run this long means everything older is done too.
 * Kept well above 1 because duels do not finish in strict order — a fast duel settling ahead of an
 * older slow one must not convince the sweep that the older one is gone.
 */
const SETTLED_RUN_TO_STOP = 25;

/**
 * Sweeps every duel that is still accepted and resolves the ones that are ready.
 *
 * Walks backwards from the newest id and stops after a run of already-finished duels, so the cost
 * stays flat as the duel history grows rather than rescanning everything every hour. `maxToScan`
 * remains a hard ceiling for the pathological case where that run never appears.
 */
export async function resolveOpenDuels(maxToScan = 200): Promise<DuelOutcome[]> {
  const next = await readNextDuelId();
  const newest = Number(next) - 1;
  if (newest < 1) return [];

  const oldest = Math.max(1, newest - maxToScan + 1);
  const outcomes: DuelOutcome[] = [];
  let finishedRun = 0;

  for (let id = newest; id >= oldest; id--) {
    try {
      const outcome = await resolveDuel(id);
      if (outcome.status === "settled" || outcome.status === "voided" || outcome.status === "waiting") {
        outcomes.push(outcome);
      }

      // Only terminally finished duels advance the run. An Open invite nobody has accepted is
      // idle but still live, so it must not count — otherwise a block of unaccepted invites would
      // hide every older accepted duel from the sweep, and those hold real stakes.
      finishedRun = outcome.status === "finished" ? finishedRun + 1 : 0;
      if (finishedRun >= SETTLED_RUN_TO_STOP) break;
    } catch (error) {
      // A read that failed tells us nothing about how far back the live duels go, so it must not
      // count towards the stop condition.
      finishedRun = 0;
      outcomes.push({
        duelId: id,
        status: "unknown",
        txHash: error instanceof Error ? error.message : undefined,
      });
    }
  }

  return outcomes;
}
