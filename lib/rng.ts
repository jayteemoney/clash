/**
 * Deterministic pseudo-random number generation.
 *
 * The fairness claim of Clash rests entirely on this file: every player in a tournament must be
 * dealt a byte-identical board, and the settler backend must be able to reproduce that same board
 * on the server to sanity-check submitted scores. So: no `Math.random`, no `Date.now`, no
 * platform-dependent maths. Everything is a pure function of the seed string.
 */

/** FNV-1a, 32-bit. Stable across engines because it only uses integer ops. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // h *= 16777619, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates on a copy. Never mutates the input. */
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32 — small, fast, and identical on every JS engine. */
export function createRng(seed: string | number): Rng {
  let state = (typeof seed === "number" ? seed : hashSeed(seed)) >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/**
 * The one place a tournament id becomes a game seed. Both the client and the settler call this,
 * so it must never change for an already-played tournament.
 */
export function tournamentSeed(tournamentId: number | bigint, gameId: string): string {
  return `clash:v1:${gameId}:${tournamentId.toString()}`;
}

/**
 * The board both sides of a duel play. Like {@link tournamentSeed}, the client deals from it and
 * the settler rebuilds from it to bound the submitted score, so the two must never drift apart —
 * which is why neither is allowed to inline the string.
 */
export function duelSeed(duelId: number | bigint, gameId: string): string {
  return `clash:v1:duel:${duelId.toString()}:${gameId}`;
}

/** Practice boards vary per attempt, and are never settled on chain. */
export function practiceSeed(gameId: string, nonce: number): string {
  return `clash:practice:${gameId}:${nonce}`;
}
