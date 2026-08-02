import "server-only";

import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ACTIVE_CHAIN, RPC_URL, clashArenaAbi, requireClashAddress } from "@/lib/contracts";
import { publicClient } from "@/lib/minipay";

/**
 * The operator side of settlement.
 *
 * This key can open tournaments and call `settle` / `settleDuel`. What it cannot do is take the
 * money: the contract only lets it pay addresses that actually joined, never more than the pot,
 * and never to itself. See the trust note in the README.
 */

export function settlerConfigured(): boolean {
  return Boolean(process.env.SETTLER_PRIVATE_KEY);
}

function settlerAccount() {
  const key = process.env.SETTLER_PRIVATE_KEY;
  if (!key) throw new Error("SETTLER_PRIVATE_KEY is not configured.");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

function settlerWallet() {
  return createWalletClient({ account: settlerAccount(), chain: ACTIVE_CHAIN, transport: http(RPC_URL) });
}

export function settlerAddress(): `0x${string}` {
  return settlerAccount().address;
}

/**
 * The backend pays its own network fees in CELO by default — it is a funded server key, not a
 * player, so fee abstraction buys nothing. Set SETTLER_FEE_CURRENCY to a fee-currency address to
 * pay in a stablecoin instead (use the adapter for the 6-decimal tokens).
 */
function feeCurrency(): `0x${string}` | undefined {
  const configured = process.env.SETTLER_FEE_CURRENCY;
  return configured ? (configured as `0x${string}`) : undefined;
}

async function writeAndWait(functionName: string, args: readonly unknown[]): Promise<`0x${string}`> {
  const wallet = settlerWallet();
  const hash = await wallet.writeContract({
    address: requireClashAddress(),
    abi: clashArenaAbi,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- name/args are validated by callers
    functionName: functionName as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
    feeCurrency: feeCurrency(),
  });

  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash}).`);
  return hash;
}

/** Reads the id already registered for an hour, or 0 when that hour has no tournament yet. */
export async function tournamentIdForStart(startSeconds: number): Promise<bigint> {
  return publicClient().readContract({
    address: requireClashAddress(),
    abi: clashArenaAbi,
    functionName: "tournamentIdForStart",
    args: [BigInt(startSeconds)],
  });
}

/**
 * Opens the tournament for an hour, or returns the existing id.
 *
 * The check-then-create is racy across concurrent cron invocations, which is exactly why the
 * contract also refuses a duplicate start time — a loser of the race reverts with
 * `TournamentExists`, and we re-read rather than propagating the failure.
 */
export async function ensureTournament(params: {
  startSeconds: number;
  endSeconds: number;
  entryToken: `0x${string}`;
  entryAmount: bigint;
}): Promise<{ id: bigint; created: boolean; txHash?: `0x${string}` }> {
  const existing = await tournamentIdForStart(params.startSeconds);
  if (existing > 0n) return { id: existing, created: false };

  try {
    const txHash = await writeAndWait("createTournament", [
      BigInt(params.startSeconds),
      BigInt(params.endSeconds),
      params.entryToken,
      params.entryAmount,
    ]);
    return { id: await tournamentIdForStart(params.startSeconds), created: true, txHash };
  } catch (error) {
    const id = await tournamentIdForStart(params.startSeconds);
    if (id > 0n) return { id, created: false };
    throw error;
  }
}

export async function settleTournament(
  tournamentId: bigint,
  winners: `0x${string}`[],
  weights: bigint[],
): Promise<`0x${string}`> {
  return writeAndWait("settle", [tournamentId, winners, weights]);
}

export async function settleDuel(duelId: bigint, winner: `0x${string}`): Promise<`0x${string}`> {
  return writeAndWait("settleDuel", [duelId, winner]);
}

/** Refunds both sides of an accepted duel neither player completed. */
export async function voidDuel(duelId: bigint): Promise<`0x${string}`> {
  return writeAndWait("voidDuel", [duelId]);
}

/** Shared secret guard for the operator-only routes. Vercel Cron sends it as a bearer token. */
export function authorizeOperator(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}
