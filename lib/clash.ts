/**
 * Every on-chain write the player makes. Two rules hold throughout:
 *
 *   1. `feeCurrency` is always set, so the network fee comes out of a stablecoin and the player
 *      never needs to hold CELO.
 *   2. No signature is ever requested. Entering is an ERC-20 approve followed by a plain call.
 */
import { encodeFunctionData, erc20Abi, maxUint256, parseEventLogs } from "viem";
import { clashArenaAbi, requireClashAddress } from "./contracts";
import { publicClient, walletClient } from "./minipay";
import type { TokenInfo } from "./tokens";

export interface TxStep {
  label: string;
  hash: `0x${string}`;
}

async function send(params: {
  account: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  token: TokenInfo;
}): Promise<`0x${string}`> {
  const wallet = walletClient();
  return wallet.sendTransaction({
    account: params.account,
    to: params.to,
    data: params.data,
    // The 6-decimal tokens need their adapter here, never the token address. `TokenInfo.feeCurrency`
    // already encodes that distinction — see lib/tokens.ts.
    feeCurrency: params.token.feeCurrency,
  });
}

async function waitFor(hash: `0x${string}`) {
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The transaction did not go through. Please try again.");
  return receipt;
}

/** Current allowance the arena holds for this player's token. */
export async function getAllowance(user: `0x${string}`, token: TokenInfo): Promise<bigint> {
  return publicClient().readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [user, requireClashAddress()],
  });
}

/**
 * Approve the arena to pull entry fees.
 *
 * Approving an unlimited amount means a returning player pays one network fee per entry instead of
 * two. The arena can only ever move funds through `join`, `createDuel` and `acceptDuel`, each of
 * which pulls a fixed, player-initiated amount — it has no path to drain an allowance.
 */
export async function approveIfNeeded(
  user: `0x${string}`,
  token: TokenInfo,
  amount: bigint,
): Promise<TxStep | null> {
  const allowance = await getAllowance(user, token);
  if (allowance >= amount) return null;

  const hash = await send({
    account: user,
    to: token.address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [requireClashAddress(), maxUint256] }),
    token,
  });
  await waitFor(hash);
  return { label: "Approved", hash };
}

export async function joinTournament(
  user: `0x${string}`,
  tournamentId: bigint,
  token: TokenInfo,
  entryAmount: bigint,
): Promise<TxStep[]> {
  const steps: TxStep[] = [];

  const approval = await approveIfNeeded(user, token, entryAmount);
  if (approval) steps.push(approval);

  const hash = await send({
    account: user,
    to: requireClashAddress(),
    data: encodeFunctionData({ abi: clashArenaAbi, functionName: "join", args: [tournamentId] }),
    token,
  });
  await waitFor(hash);
  steps.push({ label: "Entered", hash });

  return steps;
}

/**
 * Creates a duel and reads its id back out of the receipt.
 *
 * The id has to come from the `DuelCreated` log rather than the return value — a transaction's
 * return data is not available to the sender — and the player needs it immediately to share the
 * invite link.
 */
export async function createDuel(
  user: `0x${string}`,
  token: TokenInfo,
  stake: bigint,
): Promise<{ steps: TxStep[]; duelId: bigint | null }> {
  const steps: TxStep[] = [];

  const approval = await approveIfNeeded(user, token, stake);
  if (approval) steps.push(approval);

  const hash = await send({
    account: user,
    to: requireClashAddress(),
    data: encodeFunctionData({ abi: clashArenaAbi, functionName: "createDuel", args: [token.address, stake] }),
    token,
  });
  const receipt = await waitFor(hash);
  steps.push({ label: "Duel created", hash });

  const events = parseEventLogs({ abi: clashArenaAbi, eventName: "DuelCreated", logs: receipt.logs });
  const duelId = events[0]?.args?.duelId ?? null;

  return { steps, duelId };
}

export async function acceptDuel(
  user: `0x${string}`,
  duelId: bigint,
  token: TokenInfo,
  stake: bigint,
): Promise<TxStep[]> {
  const steps: TxStep[] = [];

  const approval = await approveIfNeeded(user, token, stake);
  if (approval) steps.push(approval);

  const hash = await send({
    account: user,
    to: requireClashAddress(),
    data: encodeFunctionData({ abi: clashArenaAbi, functionName: "acceptDuel", args: [duelId] }),
    token,
  });
  await waitFor(hash);
  steps.push({ label: "Duel accepted", hash });

  return steps;
}

export async function cancelDuel(user: `0x${string}`, duelId: bigint, token: TokenInfo): Promise<TxStep> {
  const hash = await send({
    account: user,
    to: requireClashAddress(),
    data: encodeFunctionData({ abi: clashArenaAbi, functionName: "cancelDuel", args: [duelId] }),
    token,
  });
  await waitFor(hash);
  return { label: "Duel withdrawn", hash };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The chain's current timestamp.
 *
 * `join` and `settle` are gated on `block.timestamp`, so anything that predicts whether they will
 * succeed has to ask the chain rather than the server. A server clock even slightly ahead would
 * otherwise turn players away from a tournament the contract still considers open, and one behind
 * would send doomed settle transactions.
 */
export async function chainNow(): Promise<number> {
  const block = await publicClient().getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}

export interface TournamentOnChain {
  entryToken: `0x${string}`;
  entryAmount: bigint;
  startTime: number;
  endTime: number;
  totalPot: bigint;
  settled: boolean;
  playerCount: number;
}

export async function readTournament(tournamentId: bigint): Promise<TournamentOnChain> {
  const [entryToken, entryAmount, startTime, endTime, totalPot, settled, numPlayers] =
    await publicClient().readContract({
      address: requireClashAddress(),
      abi: clashArenaAbi,
      functionName: "getTournament",
      args: [tournamentId],
    });

  return {
    entryToken,
    entryAmount,
    startTime: Number(startTime),
    endTime: Number(endTime),
    totalPot,
    settled,
    playerCount: Number(numPlayers),
  };
}

/** Everyone who paid into a tournament, straight from the contract. */
export async function readPlayers(tournamentId: bigint): Promise<readonly `0x${string}`[]> {
  return publicClient().readContract({
    address: requireClashAddress(),
    abi: clashArenaAbi,
    functionName: "getPlayers",
    args: [tournamentId],
  });
}

export async function readHasJoined(tournamentId: bigint, user: `0x${string}`): Promise<boolean> {
  return publicClient().readContract({
    address: requireClashAddress(),
    abi: clashArenaAbi,
    functionName: "hasJoined",
    args: [tournamentId, user],
  });
}

export interface DuelOnChain {
  creator: `0x${string}`;
  opponent: `0x${string}`;
  entryToken: `0x${string}`;
  stake: bigint;
  /** 0 None · 1 Open · 2 Accepted · 3 Settled · 4 Cancelled */
  status: number;
}

export async function readDuel(duelId: bigint): Promise<DuelOnChain> {
  const [creator, opponent, entryToken, stake, status] = await publicClient().readContract({
    address: requireClashAddress(),
    abi: clashArenaAbi,
    functionName: "getDuel",
    args: [duelId],
  });
  return { creator, opponent, entryToken, stake, status: Number(status) };
}

export const DUEL_STATUS = ["None", "Open", "Accepted", "Settled", "Cancelled"] as const;
