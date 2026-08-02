import { NextResponse } from "next/server";
import { authorizeOperator, settlerConfigured } from "@/lib/server/settler";
import { settleOne } from "@/lib/server/settleFlow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Manual settlement for a single tournament. Operator-only; the cron route is the usual path. */
export async function POST(request: Request) {
  if (!authorizeOperator(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!settlerConfigured()) {
    return NextResponse.json({ error: "Settler key is not configured." }, { status: 503 });
  }

  let tournamentId: number;
  try {
    const body = (await request.json()) as { tournamentId?: unknown };
    tournamentId = Number(body.tournamentId);
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return NextResponse.json({ error: "Unknown tournament." }, { status: 400 });
  }

  try {
    return NextResponse.json(await settleOne(tournamentId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settlement failed." },
      { status: 500 },
    );
  }
}
