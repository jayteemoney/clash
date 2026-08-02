import { NextResponse } from "next/server";
import { GAME_IDS, type GameId } from "@/lib/games/types";
import { loadGame } from "@/lib/games";
import { duelSeed } from "@/lib/rng";
import { currentWindow, gameForWindow } from "@/lib/tournament";
import { DUEL_DEADLINE_SECONDS, DUEL_STATUS_ACCEPTED, chainNow, readDuel } from "@/lib/clash";
import { CLASH_ADDRESS } from "@/lib/contracts";
import { aliasFor } from "@/lib/identity";
import { getDuelScores, putDuelScore } from "@/lib/server/store";
import { clientKey, rateLimit } from "@/lib/server/ratelimit";
import { resolveDuel } from "@/lib/server/duelFlow";
import { settlerConfigured } from "@/lib/server/settler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

interface Body {
  duelId?: unknown;
  address?: unknown;
  score?: unknown;
  gameId?: unknown;
}

/**
 * Records a duel score, and resolves the duel the moment both players have submitted.
 *
 * Settling inline rather than waiting for the hourly cron matters here: a duel is between two
 * people who are usually playing within minutes of each other, and making the winner wait up to an
 * hour for a payout they can already see they earned would feel broken. The cron is the safety net
 * for duels where the second player never shows.
 *
 * Validation mirrors the tournament score route — the duel must be live, the submitter must be one
 * of the two duelists, and the score must be reachable on the board this duel actually deals.
 */
export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "duel-score"), 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many submissions. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const duelId = Number(body.duelId);
  const address = typeof body.address === "string" ? (body.address as `0x${string}`) : null;
  const score = Number(body.score);
  const gameId = body.gameId as GameId;

  if (!Number.isInteger(duelId) || duelId <= 0) {
    return NextResponse.json({ error: "Unknown duel." }, { status: 400 });
  }
  if (!address || !ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid player." }, { status: 400 });
  }
  if (!Number.isFinite(score) || !Number.isInteger(score) || score < 0) {
    return NextResponse.json({ error: "Invalid score." }, { status: 400 });
  }
  if (!GAME_IDS.includes(gameId)) {
    return NextResponse.json({ error: "Unknown game." }, { status: 400 });
  }
  if (!CLASH_ADDRESS || !settlerConfigured()) {
    return NextResponse.json({ error: "Duels are not available right now." }, { status: 503 });
  }
  if (gameForWindow(currentWindow().start) !== gameId) {
    return NextResponse.json({ error: "That game is not running right now." }, { status: 400 });
  }

  let duel;
  try {
    duel = await readDuel(BigInt(duelId));
  } catch {
    return NextResponse.json({ error: "Could not reach the duel." }, { status: 503 });
  }

  if (duel.status !== DUEL_STATUS_ACCEPTED) {
    return NextResponse.json({ error: "This duel is not in play." }, { status: 409 });
  }

  const isDuelist =
    address.toLowerCase() === duel.creator.toLowerCase() || address.toLowerCase() === duel.opponent.toLowerCase();
  if (!isDuelist) {
    return NextResponse.json({ error: "You are not in this duel." }, { status: 403 });
  }

  if ((await chainNow()) >= duel.acceptedAt + DUEL_DEADLINE_SECONDS) {
    return NextResponse.json({ error: "This duel has run out of time." }, { status: 409 });
  }

  // Rebuild the exact board this duel deals and check the score is reachable on it.
  const game = await loadGame(gameId);
  const round = game.buildRound(duelSeed(duelId, gameId));
  if (score > game.maxPlausibleScore(round)) {
    return NextResponse.json({ error: "That score is not possible on this board." }, { status: 422 });
  }

  const stored = await putDuelScore({ duelId, address, score, gameId, submittedAt: Date.now() });
  const scores = await getDuelScores(duelId);

  // Both in? Resolve now rather than making the winner wait for the hourly sweep.
  let outcome = null;
  if (scores.length >= 2) {
    try {
      outcome = await resolveDuel(duelId);
    } catch {
      // The cron will pick it up. Never fail the player's submission over a settlement hiccup —
      // their score is already recorded, which is the part that must not be lost.
      outcome = null;
    }
  }

  return NextResponse.json({
    accepted: true,
    score: stored.score,
    submitted: scores.length,
    opponentPlayed: scores.length >= 2,
    outcome,
    scores: scores.map((s) => ({ alias: aliasFor(s.address), score: s.score })),
  });
}
