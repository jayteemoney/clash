import { NextResponse } from "next/server";
import { aliasFor } from "@/lib/identity";
import { getScores, getSettledTx } from "@/lib/server/store";
import { PAYOUT_WEIGHTS } from "@/lib/tournament";

export const dynamic = "force-dynamic";

/** Live standings for a tournament. Read-only, no wallet, safe to poll from the game screen. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const tournamentId = Number(id);

  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return NextResponse.json({ error: "Unknown tournament." }, { status: 400 });
  }

  const scores = await getScores(tournamentId);
  const ranked = scores.sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt);
  const settleTx = await getSettledTx(tournamentId);

  return NextResponse.json({
    tournamentId,
    total: ranked.length,
    settleTx,
    entries: ranked.slice(0, 25).map((entry, index) => ({
      rank: index + 1,
      alias: aliasFor(entry.address),
      address: entry.address,
      score: entry.score,
      /** Percentage of the prize pool this position is currently in line for. */
      shareWeight: PAYOUT_WEIGHTS[index] ?? 0,
    })),
  });
}
