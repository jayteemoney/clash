import { NextResponse } from "next/server";
import { GAME_IDS, type GameId } from "@/lib/games/types";
import { loadGame } from "@/lib/games";
import { tournamentSeed } from "@/lib/rng";
import { currentWindow, gameForWindow } from "@/lib/tournament";
import { chainNow, readHasJoined, readTournament } from "@/lib/clash";
import { CLASH_ADDRESS } from "@/lib/contracts";
import { aliasFor } from "@/lib/identity";
import { getScores, putScore } from "@/lib/server/store";
import { clientKey, rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

interface Body {
  tournamentId?: unknown;
  address?: unknown;
  score?: unknown;
  gameId?: unknown;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Records a tournament score.
 *
 * This endpoint decides who gets paid, so it assumes the client is hostile and re-derives
 * everything it can server-side:
 *   - the tournament must be the live one, still open, and unsettled;
 *   - the address must actually have joined on chain;
 *   - the game must be the one this hour is running;
 *   - the score must not exceed what the *specific board* for this seed makes reachable, computed
 *     here from the same pure `buildRound` the client used.
 *
 * What it cannot do is prove the player earned the score honestly — that is the operator-attested
 * limitation documented in the README, and the reason commit-reveal is the next step.
 */
export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "score"), 20, 60_000);
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

  const tournamentId = Number(body.tournamentId);
  const address = typeof body.address === "string" ? (body.address as `0x${string}`) : null;
  const score = Number(body.score);
  const gameId = body.gameId as GameId;

  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return NextResponse.json({ error: "Unknown tournament." }, { status: 400 });
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
  if (!CLASH_ADDRESS) {
    return NextResponse.json({ error: "Tournaments are not available right now." }, { status: 503 });
  }

  // The hour must match the game — a score for a game this hour is not running is not a score.
  const { start } = currentWindow();
  if (gameForWindow(start) !== gameId) {
    return NextResponse.json({ error: "That game is not running right now." }, { status: 400 });
  }

  let onChain;
  try {
    onChain = await readTournament(BigInt(tournamentId));
  } catch {
    return NextResponse.json({ error: "Could not reach the tournament." }, { status: 503 });
  }

  if (onChain.entryToken === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ error: "Unknown tournament." }, { status: 404 });
  }
  if (onChain.settled) {
    return NextResponse.json({ error: "That tournament has already paid out." }, { status: 409 });
  }
  // Chain time, not server time — the same clock `join` was gated on, so a player is never turned
  // away from a tournament the contract still considers open.
  if ((await chainNow()) >= onChain.endTime) {
    return NextResponse.json({ error: "That tournament has closed." }, { status: 409 });
  }

  const joined = await readHasJoined(BigInt(tournamentId), address);
  if (!joined) {
    return NextResponse.json({ error: "Enter the tournament before submitting a score." }, { status: 403 });
  }

  // Rebuild the exact board this player was dealt and check the score is reachable on it.
  const game = await loadGame(gameId);
  const round = game.buildRound(tournamentSeed(tournamentId, gameId));
  const ceiling = game.maxPlausibleScore(round);
  if (score > ceiling) {
    return NextResponse.json({ error: "That score is not possible on this board." }, { status: 422 });
  }

  const stored = await putScore({
    tournamentId,
    address,
    score,
    gameId,
    submittedAt: Date.now(),
  });

  const all = await getScores(tournamentId);
  const ranked = all.sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt);
  const rank = ranked.findIndex((e) => e.address.toLowerCase() === address.toLowerCase()) + 1;

  return NextResponse.json({
    accepted: true,
    /** The best score we hold for this player — a worse replay does not overwrite a better run. */
    score: stored.score,
    rank,
    total: ranked.length,
    leaderboard: ranked.slice(0, 10).map((e) => ({ alias: aliasFor(e.address), score: e.score })),
  });
}
