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

export interface ScoreEntry {
  tournamentId: number;
  address: `0x${string}`;
  score: number;
  gameId: string;
  /** Unix ms. Ties on the leaderboard are broken by who submitted first. */
  submittedAt: number;
}

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

export function storeBackend(): "redis" | "memory" {
  return useRedis ? "redis" : "memory";
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
