/**
 * Score storage for the settler backend.
 *
 * Two backends, chosen at runtime:
 *   - Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are
 *     set. Plain `fetch`, no SDK dependency.
 *   - An in-process Map otherwise, so `npm run dev` and the test suite work with no external
 *     service. It does not survive a restart and is not shared between serverless instances, so it
 *     is strictly a development fallback — {@link storeBackend} reports which one is live and the
 *     /stats page surfaces it.
 *
 * Scores are the input to a real payout, so this is the boundary Developer A hardens: everything
 * written here has already passed validation in app/api/score.
 */
import "server-only";

import type { DuelWatch } from "@/lib/duelSweep";

export type { DuelWatch };

export interface ScoreEntry {
  tournamentId: number;
  address: `0x${string}`;
  score: number;
  gameId: string;
  /** Unix ms. Ties on the leaderboard are broken by who submitted first. */
  submittedAt: number;
}

// Two spellings, because the same database arrives under different names depending on how it was
// provisioned. Upstash's own console gives you UPSTASH_REDIS_REST_*; the Vercel Marketplace
// integration injects KV_REST_API_* instead — a leftover of the retired @vercel/kv naming, and not
// what Upstash's own getting-started guide shows. Reading both means the app does not care which
// route was taken, and switching between them is an environment change rather than a code change.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

export function storeBackend(): "redis" | "memory" {
  return useRedis ? "redis" : "memory";
}

export type StoreHealth =
  /** No Redis configured. Scores live in this instance's memory and die with it. */
  | { backend: "memory"; reachable: false; detail: string }
  /** Redis configured and answering. */
  | { backend: "redis"; reachable: true; detail: string }
  /** Configured but not answering — every score write is failing right now. */
  | { backend: "redis"; reachable: false; detail: string };

/**
 * Whether the store is actually usable, as opposed to merely configured.
 *
 * {@link storeBackend} only reports which branch the code will take: it returns "redis" the moment
 * both variables are non-empty, so a typo'd URL or a revoked token still reads as durable while
 * every score write fails. That is the worst way to be wrong — the operator's dashboard says the
 * money-critical path is safe at the exact moment it is not. So the health check pays for one
 * round-trip and reports what the store did, not what it was told to do.
 */
export async function storeHealth(): Promise<StoreHealth> {
  if (!useRedis) {
    const missing = [
      REDIS_URL ? null : "UPSTASH_REDIS_REST_URL (or KV_REST_API_URL)",
      REDIS_TOKEN ? null : "UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN)",
    ].filter(Boolean);
    return {
      backend: "memory",
      reachable: false,
      detail: `${missing.join(" and ")} not set — scores are per-instance and do not survive a restart.`,
    };
  }

  try {
    const pong = await redis<string>(["PING"]);
    if (pong !== "PONG") return { backend: "redis", reachable: false, detail: `PING answered ${JSON.stringify(pong)}.` };
    return { backend: "redis", reachable: true, detail: "Redis answered PING." };
  } catch (error) {
    return {
      backend: "redis",
      reachable: false,
      detail: error instanceof Error ? error.message : "Redis did not respond.",
    };
  }
}

/**
 * One Upstash command over the REST API. Exported so everything that needs durable server state
 * (the score store here, the rate limiter in ./ratelimit) speaks to Redis through a single
 * helper rather than each rebuilding the same fetch.
 */
export async function redis<T>(command: (string | number)[]): Promise<T> {
  const response = await fetch(REDIS_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Score store unavailable (${response.status}).`);
  const body = (await response.json()) as { result: T };
  return body.result;
}

const memory = new Map<string, Map<string, ScoreEntry>>();

function key(tournamentId: number) {
  return `clash:scores:${tournamentId}`;
}

/**
 * Records a score, keeping only a player's best for the tournament.
 * Returns the entry that is now stored.
 */
export async function putScore(entry: ScoreEntry): Promise<ScoreEntry> {
  const field = entry.address.toLowerCase();

  if (useRedis) {
    const existingRaw = await redis<string | null>(["HGET", key(entry.tournamentId), field]);
    const existing = existingRaw ? (JSON.parse(existingRaw) as ScoreEntry) : null;
    if (existing && existing.score >= entry.score) return existing;

    await redis(["HSET", key(entry.tournamentId), field, JSON.stringify(entry)]);
    // Scores are only needed until settlement; a week of retention is plenty for disputes.
    await redis(["EXPIRE", key(entry.tournamentId), 60 * 60 * 24 * 7]);
    return entry;
  }

  let bucket = memory.get(key(entry.tournamentId));
  if (!bucket) {
    bucket = new Map();
    memory.set(key(entry.tournamentId), bucket);
  }
  const existing = bucket.get(field);
  if (existing && existing.score >= entry.score) return existing;
  bucket.set(field, entry);
  return entry;
}

export async function getScores(tournamentId: number): Promise<ScoreEntry[]> {
  if (useRedis) {
    const flat = await redis<string[]>(["HGETALL", key(tournamentId)]);
    const entries: ScoreEntry[] = [];
    for (let i = 1; i < (flat?.length ?? 0); i += 2) {
      try {
        entries.push(JSON.parse(flat[i]) as ScoreEntry);
      } catch {
        // Skip anything unparseable rather than failing the whole leaderboard.
      }
    }
    return entries;
  }

  return [...(memory.get(key(tournamentId))?.values() ?? [])];
}

// ---------------------------------------------------------------------------
// Duel scores
//
// Kept separate from tournament scores: a duel is keyed by duel id rather than tournament id, and
// only ever holds two entries, so mixing them into the same namespace would only invite mistakes.
// ---------------------------------------------------------------------------

export interface DuelScoreEntry {
  duelId: number;
  address: `0x${string}`;
  score: number;
  gameId: string;
  submittedAt: number;
}

function duelKey(duelId: number) {
  return `clash:duel:${duelId}`;
}

const duelMemory = new Map<string, Map<string, DuelScoreEntry>>();

/** Records a duel score. First submission stands — a duel is one round, not a best-of. */
export async function putDuelScore(entry: DuelScoreEntry): Promise<DuelScoreEntry> {
  const field = entry.address.toLowerCase();

  if (useRedis) {
    const existingRaw = await redis<string | null>(["HGET", duelKey(entry.duelId), field]);
    if (existingRaw) return JSON.parse(existingRaw) as DuelScoreEntry;

    await redis(["HSET", duelKey(entry.duelId), field, JSON.stringify(entry)]);
    await redis(["EXPIRE", duelKey(entry.duelId), 60 * 60 * 24 * 7]);
    return entry;
  }

  let bucket = duelMemory.get(duelKey(entry.duelId));
  if (!bucket) {
    bucket = new Map();
    duelMemory.set(duelKey(entry.duelId), bucket);
  }
  const existing = bucket.get(field);
  if (existing) return existing;
  bucket.set(field, entry);
  return entry;
}

export async function getDuelScores(duelId: number): Promise<DuelScoreEntry[]> {
  if (useRedis) {
    const flat = await redis<string[]>(["HGETALL", duelKey(duelId)]);
    const entries: DuelScoreEntry[] = [];
    for (let i = 1; i < (flat?.length ?? 0); i += 2) {
      try {
        entries.push(JSON.parse(flat[i]) as DuelScoreEntry);
      } catch {
        // Skip anything unparseable rather than failing the whole duel.
      }
    }
    return entries;
  }

  return [...(duelMemory.get(duelKey(duelId))?.values() ?? [])];
}

// ---------------------------------------------------------------------------
// The duel watchlist
//
// The settler has to be able to find every duel that still holds money, however long ago it was
// created. Scanning a fixed window back from the newest id cannot promise that: once the history
// grows past the window, an older duel still holding two stakes drops out of it silently and
// forever.
//
// So the sweep keeps its own record instead. It ingests new ids as they appear, drops each duel
// once the chain says it is terminally finished, and carries the rest forward. The work per sweep
// is then proportional to how many duels are actually live — normally a handful — rather than to
// how long the app has been running, and nothing can age out of it.
// ---------------------------------------------------------------------------

const DUEL_WATCH_KEY = "clash:duelwatch";

let watchMemory: DuelWatch | null = null;

/** The stored watchlist, or null if the settler has never swept on this backend. */
export async function getDuelWatch(): Promise<DuelWatch | null> {
  if (useRedis) {
    const raw = await redis<string | null>(["GET", DUEL_WATCH_KEY]);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DuelWatch;
    } catch {
      // Unreadable means the sweep falls back to a cold start, which is recoverable. Pretending
      // it parsed would not be.
      return null;
    }
  }
  return watchMemory;
}

export async function setDuelWatch(watch: DuelWatch): Promise<void> {
  if (useRedis) {
    // Deliberately no TTL. Every other key here expires because it is only needed until a payout
    // lands; this one is the record of which payouts have *not* happened yet.
    await redis(["SET", DUEL_WATCH_KEY, JSON.stringify(watch)]);
    return;
  }
  watchMemory = watch;
}

/** Marks a tournament settled so a retried cron run cannot double-submit. */
export async function markSettled(tournamentId: number, txHash: string): Promise<void> {
  if (useRedis) {
    await redis(["SET", `clash:settled:${tournamentId}`, txHash, "EX", 60 * 60 * 24 * 30]);
    return;
  }
  settledMemory.set(tournamentId, txHash);
}

export async function getSettledTx(tournamentId: number): Promise<string | null> {
  if (useRedis) return redis<string | null>(["GET", `clash:settled:${tournamentId}`]);
  return settledMemory.get(tournamentId) ?? null;
}

const settledMemory = new Map<number, string>();
