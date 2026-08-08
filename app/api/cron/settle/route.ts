import { NextResponse } from "next/server";
import { DEFAULT_TOKEN } from "@/lib/tokens";
import { ENTRY_AMOUNT } from "@/lib/config";
import { HOUR_SECONDS, currentWindow } from "@/lib/tournament";
import { authorizeOperator, ensureTournament, settlerConfigured, tournamentIdForStart } from "@/lib/server/settler";
import { settleOne, type SettleOutcome } from "@/lib/server/settleFlow";
import { resolveOpenDuels } from "@/lib/server/duelFlow";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The hourly tick, driven by an Upstash QStash schedule.
 *
 * Not Vercel Cron: Hobby accounts are capped at one cron run per day, and a daily settle would
 * leave players waiting up to 24 hours for a payout that the product promises within the hour.
 * Vercel rejects the deployment outright rather than degrading, so `vercel.json` carries no crons
 * and QStash calls this endpoint instead, forwarding `Authorization: Bearer $CRON_SECRET`.
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

  // Duels normally settle the instant both players submit, so this sweep exists for the ones where
  // somebody walked away: past the deadline it awards the player who showed up, or refunds both if
  // neither did. Without it an accepted duel could hold two stakes indefinitely.
  let duels;
  try {
    duels = await resolveOpenDuels();
  } catch (error) {
    duels = { error: error instanceof Error ? error.message : "duel-sweep-failed" };
  }

  // Always 200: a non-2xx makes Vercel retry, and a retry cannot fix a reverted settle. The body
  // carries the real status for the operator dashboard and alerting.
  return NextResponse.json({ ranAt: new Date().toISOString(), closed, opened, duels });
}
