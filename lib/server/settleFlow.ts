import "server-only";

import { chainNow, readPlayers, readTournament } from "@/lib/clash";
import { computePayouts } from "@/lib/tournament";
import { settleTournament } from "./settler";
import { getScores, getSettledTx, markSettled } from "./store";

export interface SettleOutcome {
  tournamentId: number;
  status: "settled" | "already-settled" | "not-closed" | "unknown" | "empty" | "refunded";
  txHash?: string;
  winners?: { address: string; score: number; weight: number }[];
  pot?: string;
}

/**
 * Ranks a closed tournament and pays it out.
 *
 * Idempotent by design, because Vercel Cron can and does fire a job twice: the local settled
 * marker short-circuits the common case, and the contract's `AlreadySettled` revert is the
 * backstop for the case where the marker was lost.
 */
export async function settleOne(tournamentId: number): Promise<SettleOutcome> {
  const known = await getSettledTx(tournamentId);
  if (known) return { tournamentId, status: "already-settled", txHash: known };

  const onChain = await readTournament(BigInt(tournamentId));

  if (onChain.entryToken === "0x0000000000000000000000000000000000000000") {
    return { tournamentId, status: "unknown" };
  }
  if (onChain.settled) {
    return { tournamentId, status: "already-settled" };
  }
  if ((await chainNow()) < onChain.endTime) {
    return { tournamentId, status: "not-closed" };
  }

  const scores = await getScores(tournamentId);
  const { winners, weights, ranked } = computePayouts(
    scores.map((s) => ({ address: s.address, score: s.score, submittedAt: s.submittedAt })),
  );

  // An hour nobody entered — or entered but never submitted a score — still has to be closed, or
  // the scheduler retries it forever. The contract treats an empty pot as a no-op close.
  if (onChain.totalPot === 0n) {
    const txHash = await settleTournament(BigInt(tournamentId), [], []);
    await markSettled(tournamentId, txHash);
    return { tournamentId, status: "empty", txHash, pot: "0" };
  }

  if (winners.length === 0) {
    // Entries were paid but no score arrived — everyone timed out, or the score store was lost.
    // The entrants come from the contract rather than the score store precisely because the store
    // may be what failed; otherwise a lost store would strand the pot in the contract forever.
    // Equal weights make the contract's pro-rata split an even refund, less the rake.
    const players = await readPlayers(BigInt(tournamentId));
    if (players.length === 0) {
      // A non-zero pot with no players on chain should be impossible. Leave it unsettled and
      // surface it rather than guessing at a distribution.
      return { tournamentId, status: "unknown", pot: onChain.totalPot.toString() };
    }

    const txHash = await settleTournament(
      BigInt(tournamentId),
      [...players],
      players.map(() => 1n),
    );
    await markSettled(tournamentId, txHash);
    return { tournamentId, status: "refunded", txHash, pot: onChain.totalPot.toString(), winners: [] };
  }

  const txHash = await settleTournament(BigInt(tournamentId), winners, weights);
  await markSettled(tournamentId, txHash);

  return {
    tournamentId,
    status: "settled",
    txHash,
    pot: onChain.totalPot.toString(),
    winners: winners.map((address, i) => ({
      address,
      score: ranked[i]?.score ?? 0,
      weight: Number(weights[i]),
    })),
  };
}
