import { NextResponse } from "next/server";
import { DEFAULT_TOKEN } from "@/lib/tokens";
import { ENTRY_AMOUNT } from "@/lib/config";
import { HOUR_SECONDS, currentWindow } from "@/lib/tournament";
import { authorizeOperator, ensureTournament, settlerConfigured, tournamentIdForStart } from "@/lib/server/settler";
import { settleOne, type SettleOutcome } from "@/lib/server/settleFlow";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The hourly tick, wired to Vercel Cron in vercel.json.
 *
 * Closes the hour that just ended and opens the one that just started, in that order — a player
 * arriving in the first seconds of a new hour should find a tournament already waiting rather than
 * an empty lobby.
 */
export async function GET(request: Request) {
  if (!authorizeOperator(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!settlerConfigured()) {
    return NextResponse.json({ error: "Settler key is not configured." }, { status: 503 });
  }

  const { start, end } = currentWindow();
  const previousStart = start - HOUR_SECONDS;

  let closed: SettleOutcome | { tournamentId: null; status: string } = {
    tournamentId: null,
    status: "nothing-to-close",
  };

  try {
    const previousId = await tournamentIdForStart(previousStart);
    if (previousId > 0n) closed = await settleOne(Number(previousId));
  } catch (error) {
    closed = {
      tournamentId: null,
      status: `close-failed: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }

  let opened;
  try {
    const result = await ensureTournament({
      startSeconds: start,
      endSeconds: end,
      entryToken: DEFAULT_TOKEN.address,
      entryAmount: ENTRY_AMOUNT,
    });
    opened = { id: Number(result.id), created: result.created, txHash: result.txHash };
  } catch (error) {
    opened = { error: error instanceof Error ? error.message : "open-failed" };
  }

  // Always 200: a non-2xx makes Vercel retry, and a retry cannot fix a reverted settle. The body
  // carries the real status for the operator dashboard and alerting.
  return NextResponse.json({ ranAt: new Date().toISOString(), closed, opened });
}
