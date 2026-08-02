/**
 * Frozen interface #2 (see TEAM_SPLIT.md) — the game plug-in contract.
 *
 * Owner: Developer B. Consumer: Developer A (the settler re-simulates against it).
 *
 * `buildRound` MUST be pure and deterministic. It runs in the browser to deal the player's board
 * and again on the server to validate the score that comes back. If it ever depends on time,
 * randomness, locale or the DOM, the fairness guarantee is gone and score validation breaks.
 */

export type GameId = "fastmath" | "wordhunt" | "tilemerge";

export const GAME_IDS: GameId[] = ["fastmath", "wordhunt", "tilemerge"];

/** Every round is 60 seconds. */
export const ROUND_DURATION_MS = 60_000;

/** Discriminated payloads, one per game. */
export interface FastMathRound {
  kind: "fastmath";
  questions: { a: number; b: number; op: "+" | "-" | "×"; answer: number }[];
}

export interface WordHuntRound {
  kind: "wordhunt";
  /** 4×4 letter grid, row-major. */
  grid: string[];
  /** Every word findable on this grid, upper-case, sorted longest-first. */
  solutions: string[];
}

export interface TileMergeRound {
  kind: "tilemerge";
  /** Starting 4×4 board, row-major. 0 is an empty cell. */
  board: number[];
  /**
   * Pre-rolled spawn stream. `slotRoll` is taken modulo the number of empty cells at spawn time,
   * so which cell gets used still depends on the player's own moves — but the stream itself is
   * identical for everyone, which is the part that has to be fair.
   */
  spawns: { slotRoll: number; value: number }[];
}

export type Round = FastMathRound | WordHuntRound | TileMergeRound;

export interface GameModule<R extends Round = Round> {
  id: GameId;
  /** Player-facing name. */
  name: string;
  /** One line explaining how to score, shown above the board. */
  tagline: string;
  durationMs: number;
  /** Pure. Same seed ⇒ same round, on every device and on the server. */
  buildRound(seed: string): R;
  /**
   * Ceiling a human could conceivably reach on this exact board in 60 seconds. The settler rejects
   * any submitted score above it, which is the cheapest defence against a tampered client.
   */
  maxPlausibleScore(round: R): number;
}
