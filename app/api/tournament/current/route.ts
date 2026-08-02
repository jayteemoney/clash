import { NextResponse } from "next/server";
import { CLASH_ADDRESS } from "@/lib/contracts";
import { DEFAULT_TOKEN } from "@/lib/tokens";
import { ENTRY_AMOUNT, ENTRY_PRICE } from "@/lib/config";
import { currentWindow, gameForWindow } from "@/lib/tournament";
import { tournamentSeed } from "@/lib/rng";
import { readTournament } from "@/lib/clash";
import { ensureTournament, settlerConfigured } from "@/lib/server/settler";
import { getScores } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * The lobby's single source of truth for "what is running right now".
 *
 * Opens the hour's tournament on chain if the cron has not already done so, so a cold start or a
 * missed cron tick still gives players something to enter. Everything degrades to practice mode
 * rather than erroring: a lobby that cannot reach the chain should still let people play.
 */
export async function GET() {
  const { start, end } = currentWindow();
  const gameId = gameForWindow(start);
  const seed = tournamentSeed(start, gameId);

  const base = {
    gameId,
    seed,
    startTime: start,
    endTime: end,
    entryPrice: ENTRY_PRICE,
    entryAmount: ENTRY_AMOUNT.toString(),
    token: { symbol: DEFAULT_TOKEN.symbol, address: DEFAULT_TOKEN.address, decimals: DEFAULT_TOKEN.decimals },
  };

  if (!CLASH_ADDRESS || !settlerConfigured()) {
    return NextResponse.json({
      ...base,
      id: null,
      pot: "0",
      players: 0,
      playable: false,
      reason: "practice-only",
    });
  }

  try {
    const { id } = await ensureTournament({
      startSeconds: start,
      endSeconds: end,
      entryToken: DEFAULT_TOKEN.address,
      entryAmount: ENTRY_AMOUNT,
    });

    const onChain = await readTournament(id);
    const submitted = await getScores(Number(id));

    return NextResponse.json({
      ...base,
      id: Number(id),
      // The seed follows the tournament id once one exists, so re-opening the same hour after a
      // chain hiccup can never deal a different board than the players who already entered saw.
      seed: tournamentSeed(id, gameId),
      pot: onChain.totalPot.toString(),
      players: onChain.playerCount,
      scoresIn: submitted.length,
      settled: onChain.settled,
      playable: true,
    });
  } catch (error) {
    return NextResponse.json({
      ...base,
      id: null,
      pot: "0",
      players: 0,
      playable: false,
      reason: error instanceof Error ? error.message : "unavailable",
    });
  }
}
