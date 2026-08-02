import "server-only";

import { parseAbiItem, type Log } from "viem";
import { publicClient } from "@/lib/minipay";
import { CLASH_ADDRESS, DEPLOY_BLOCK, EXPLORER_URL, IS_TESTNET } from "@/lib/contracts";
import { SUPPORTED_TOKENS, tokenByAddress } from "@/lib/tokens";
import { formatUnits } from "viem";

/**
 * A direct-from-chain indexer for the /stats page.
 *
 * Celo's public RPC rejects `eth_getLogs` over ranges wider than ~50k blocks, and at a one-second
 * block time that is only about fourteen hours of history per request — so every scan here is
 * chunked. Results are cached in-process for a minute; the page is read-only and a minute-stale
 * number is fine, whereas re-scanning the chain on every page view is not.
 */

const CHUNK = 45_000n;
const CACHE_TTL_MS = 60_000;

const EVENTS = {
  joined: parseAbiItem("event PlayerJoined(uint256 indexed tournamentId, address indexed player, uint256 amount)"),
  fee: parseAbiItem("event FeeCollected(address indexed entryToken, uint256 rake)"),
  settled: parseAbiItem(
    "event TournamentSettled(uint256 indexed tournamentId, uint256 totalPot, uint256 rake, uint256 winnerCount)",
  ),
  payout: parseAbiItem("event Payout(uint256 indexed tournamentId, address indexed winner, uint256 amount)"),
  duelCreated: parseAbiItem(
    "event DuelCreated(uint256 indexed duelId, address indexed creator, address indexed entryToken, uint256 stake)",
  ),
  duelSettled: parseAbiItem(
    "event DuelSettled(uint256 indexed duelId, address indexed winner, uint256 amount, uint256 rake)",
  ),
} as const;

async function getLogsChunked<E extends { type: "event" }>(event: E, fromBlock: bigint, toBlock: bigint) {
  const client = publicClient();
  const all: Log[] = [];

  for (let from = fromBlock; from <= toBlock; from += CHUNK + 1n) {
    const to = from + CHUNK > toBlock ? toBlock : from + CHUNK;
    const logs = await client.getLogs({
      address: CLASH_ADDRESS as `0x${string}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viem's event generic is narrowed by the caller
      event: event as any,
      fromBlock: from,
      toBlock: to,
    });
    all.push(...logs);
  }

  return all;
}

export interface TokenTotal {
  symbol: string;
  /** Base units. */
  raw: string;
  /** Human-readable, decimals already applied. */
  amount: number;
}

export interface StatsSnapshot {
  generatedAt: string;
  network: string;
  contract: string | null;
  explorer: string;
  available: boolean;
  reason?: string;

  entries: number;
  uniquePlayers: number;
  tournamentsSettled: number;
  duelsCreated: number;
  duelsSettled: number;

  potVolume: TokenTotal[];
  rakeCollected: TokenTotal[];
  paidToPlayers: TokenTotal[];

  /** Share of transactions to the contract that reverted, or null when unavailable. */
  failedTxRate: number | null;
  txTotal: number | null;

  entriesPerDay: { date: string; entries: number }[];
  scannedToBlock: string;
}

let cached: { at: number; value: StatsSnapshot } | null = null;

export async function getStats(): Promise<StatsSnapshot> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const value = await buildStats();
  cached = { at: Date.now(), value };
  return value;
}

function emptySnapshot(reason: string): StatsSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    network: IS_TESTNET ? "Celo Sepolia" : "Celo",
    contract: CLASH_ADDRESS || null,
    explorer: EXPLORER_URL,
    available: false,
    reason,
    entries: 0,
    uniquePlayers: 0,
    tournamentsSettled: 0,
    duelsCreated: 0,
    duelsSettled: 0,
    potVolume: [],
    rakeCollected: [],
    paidToPlayers: [],
    failedTxRate: null,
    txTotal: null,
    entriesPerDay: [],
    scannedToBlock: "0",
  };
}

function totalsToList(totals: Map<string, bigint>): TokenTotal[] {
  return SUPPORTED_TOKENS.map((token) => {
    const raw = totals.get(token.address.toLowerCase()) ?? 0n;
    return { symbol: token.symbol, raw: raw.toString(), amount: Number(formatUnits(raw, token.decimals)) };
  }).filter((t) => t.raw !== "0");
}

async function buildStats(): Promise<StatsSnapshot> {
  if (!CLASH_ADDRESS) return emptySnapshot("Contract address is not configured yet.");

  const client = publicClient();

  let head: bigint;
  try {
    head = await client.getBlockNumber();
  } catch {
    return emptySnapshot("Could not reach the network.");
  }

  // Without a recorded deploy block, scanning from genesis would be thousands of requests. Fall
  // back to roughly the last week (1s blocks) so the page still shows something useful.
  const from = DEPLOY_BLOCK > 0n ? DEPLOY_BLOCK : head > 604_800n ? head - 604_800n : 0n;

  let joined: Log[];
  let fees: Log[];
  let settled: Log[];
  let payouts: Log[];
  let duelsCreated: Log[];
  let duelsSettled: Log[];

  try {
    [joined, fees, settled, payouts, duelsCreated, duelsSettled] = await Promise.all([
      getLogsChunked(EVENTS.joined, from, head),
      getLogsChunked(EVENTS.fee, from, head),
      getLogsChunked(EVENTS.settled, from, head),
      getLogsChunked(EVENTS.payout, from, head),
      getLogsChunked(EVENTS.duelCreated, from, head),
      getLogsChunked(EVENTS.duelSettled, from, head),
    ]);
  } catch (error) {
    return emptySnapshot(error instanceof Error ? error.message : "Log query failed.");
  }

  const players = new Set<string>();
  const potByToken = new Map<string, bigint>();
  const rakeByToken = new Map<string, bigint>();
  const paidByToken = new Map<string, bigint>();
  const perDay = new Map<string, number>();

  // Entries. `amount` is the entry price in the tournament's token; resolving the token needs the
  // tournament, so entries are attributed to the default token unless a Payout tells us otherwise.
  const blockTimestamps = await resolveBlockTimestamps(joined.map((l) => l.blockNumber!));

  for (const log of joined) {
    const args = (log as unknown as { args: { player: `0x${string}`; amount: bigint } }).args;
    players.add(args.player.toLowerCase());

    const timestamp = blockTimestamps.get(log.blockNumber!);
    if (timestamp) {
      const day = new Date(Number(timestamp) * 1000).toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
  }

  for (const log of settled) {
    const args = (log as unknown as { args: { totalPot: bigint } }).args;
    // Pot volume is denominated per token via the fee events, which do carry the token.
    void args;
  }

  for (const log of fees) {
    const args = (log as unknown as { args: { entryToken: `0x${string}`; rake: bigint } }).args;
    const key = args.entryToken.toLowerCase();
    rakeByToken.set(key, (rakeByToken.get(key) ?? 0n) + args.rake);
  }

  for (const log of payouts) {
    const args = (log as unknown as { args: { amount: bigint } }).args;
    // Payout does not carry the token; attribute to the default entry token, which is what every
    // tournament currently uses. Revisit if multi-token tournaments ship.
    const key = SUPPORTED_TOKENS[0].address.toLowerCase();
    paidByToken.set(key, (paidByToken.get(key) ?? 0n) + args.amount);
  }

  // Pot volume = what players put in = payouts + rake.
  for (const token of SUPPORTED_TOKENS) {
    const key = token.address.toLowerCase();
    const total = (paidByToken.get(key) ?? 0n) + (rakeByToken.get(key) ?? 0n);
    if (total > 0n) potByToken.set(key, total);
  }

  const duelStakes = duelsCreated.reduce((sum, log) => {
    const args = (log as unknown as { args: { entryToken: `0x${string}`; stake: bigint } }).args;
    const token = tokenByAddress(args.entryToken);
    return token ? sum + args.stake : sum;
  }, 0n);
  if (duelStakes > 0n) {
    const key = SUPPORTED_TOKENS[0].address.toLowerCase();
    potByToken.set(key, (potByToken.get(key) ?? 0n) + duelStakes);
  }

  const { failedTxRate, txTotal } = await getFailedTxRate();

  return {
    generatedAt: new Date().toISOString(),
    network: IS_TESTNET ? "Celo Sepolia" : "Celo",
    contract: CLASH_ADDRESS,
    explorer: EXPLORER_URL,
    available: true,
    entries: joined.length,
    uniquePlayers: players.size,
    tournamentsSettled: settled.length,
    duelsCreated: duelsCreated.length,
    duelsSettled: duelsSettled.length,
    potVolume: totalsToList(potByToken),
    rakeCollected: totalsToList(rakeByToken),
    paidToPlayers: totalsToList(paidByToken),
    failedTxRate,
    txTotal,
    entriesPerDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([date, entries]) => ({
      date,
      entries,
    })),
    scannedToBlock: head.toString(),
  };
}

/** Block timestamps for the day buckets, fetched once per distinct block. */
async function resolveBlockTimestamps(blockNumbers: (bigint | null)[]): Promise<Map<bigint, bigint>> {
  const client = publicClient();
  const distinct = [...new Set(blockNumbers.filter((b): b is bigint => b !== null))];
  const out = new Map<bigint, bigint>();

  // Cap the fan-out: a busy contract would otherwise issue thousands of block reads per page view.
  const limited = distinct.slice(-500);

  await Promise.all(
    limited.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        out.set(blockNumber, block.timestamp);
      } catch {
        // A missing timestamp just drops that entry from the daily chart.
      }
    }),
  );

  return out;
}

/**
 * Failed-transaction rate.
 *
 * Reverted transactions emit no logs, so this cannot come from `eth_getLogs`. Blockscout's REST
 * API exposes an `isError` flag per transaction, which is the cheapest honest source. Returns null
 * rather than a fabricated zero when the API is unavailable.
 */
async function getFailedTxRate(): Promise<{ failedTxRate: number | null; txTotal: number | null }> {
  const base = IS_TESTNET ? "https://celo-sepolia.blockscout.com" : "https://celo.blockscout.com";

  try {
    const url = `${base}/api?module=account&action=txlist&address=${CLASH_ADDRESS}&sort=desc&page=1&offset=1000`;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { failedTxRate: null, txTotal: null };

    const body = (await response.json()) as { status: string; result?: { isError?: string }[] };
    if (body.status !== "1" || !Array.isArray(body.result) || body.result.length === 0) {
      return { failedTxRate: null, txTotal: null };
    }

    const failed = body.result.filter((tx) => tx.isError === "1").length;
    return { failedTxRate: failed / body.result.length, txTotal: body.result.length };
  } catch {
    return { failedTxRate: null, txTotal: null };
  }
}
