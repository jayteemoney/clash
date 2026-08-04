import { createRng, type Rng } from "../rng";
import { ROUND_DURATION_MS, type GameModule, type WordHuntRound } from "./types";
import { MIN_WORD_LENGTH, WORD_SET } from "./words";

export const GRID_SIZE = 4;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

/** Standard English Boggle dice. Using real dice keeps boards playable instead of vowel-starved. */
const DICE = [
  "AAEEGN",
  "ABBJOO",
  "ACHOPS",
  "AFFKPS",
  "AOOTTW",
  "CIMOTU",
  "DEILRX",
  "DELRVY",
  "DISTTY",
  "EEGHNW",
  "EEINSU",
  "EHRTVW",
  "EIOSST",
  "ELRTTY",
  "HIMNQU",
  "HLNNRZ",
] as const;

/**
 * Inputs to the plausibility ceiling. Kept together and named so the numbers can be re-derived
 * rather than re-guessed — see {@link wordHunt.maxPlausibleScore} for how they were measured.
 */
/** More words than anyone taps in 60 seconds; the ceiling scales with this slice of the board. */
const CEILING_WORD_COUNT = 30;
/** Multiplier on top, so an exceptional run is never called impossible. */
const CEILING_HEADROOM = 1.2;
/**
 * Absolute floor. A sparse grid can be worth under 50 points in total, so on those boards the
 * floor sits above a full clear and stops constraining — unavoidable, given the floor also has to
 * clear the legitimate 88 that the old ceiling rejected. Nothing is lost: an unconstrained sparse
 * board is still only ever ranked against other players on that same board.
 */
const CEILING_FLOOR = 100;

/** Points per word length — longer finds are worth disproportionately more. */
export function wordScore(word: string): number {
  const n = word.length;
  if (n <= 4) return 1;
  if (n === 5) return 2;
  if (n === 6) return 3;
  return 5;
}

/**
 * Neighbour indices for every cell, precomputed once. Boggle adjacency includes diagonals.
 */
const NEIGHBOURS: number[][] = (() => {
  const out: number[][] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const row = Math.floor(i / GRID_SIZE);
    const col = i % GRID_SIZE;
    const cell: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
        cell.push(r * GRID_SIZE + c);
      }
    }
    out.push(cell);
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Trie — built lazily, once, and shared by every round. Without prefix pruning a
// depth-16 search over 49k words is unusably slow.
// ---------------------------------------------------------------------------

interface TrieNode {
  children: Map<string, TrieNode>;
  word: boolean;
}

let trieRoot: TrieNode | null = null;

function getTrie(): TrieNode {
  if (trieRoot) return trieRoot;
  const root: TrieNode = { children: new Map(), word: false };
  for (const word of WORD_SET) {
    let node = root;
    for (const ch of word) {
      let next = node.children.get(ch);
      if (!next) {
        next = { children: new Map(), word: false };
        node.children.set(ch, next);
      }
      node = next;
    }
    node.word = true;
  }
  trieRoot = root;
  return root;
}

/** Every dictionary word reachable on this grid under Boggle adjacency rules. */
export function solveGrid(grid: string[]): string[] {
  const root = getTrie();
  const found = new Set<string>();
  const visited = new Array<boolean>(CELL_COUNT).fill(false);

  const walk = (index: number, node: TrieNode, prefix: string) => {
    const letter = grid[index];
    const next = node.children.get(letter);
    if (!next) return;

    const word = prefix + letter;
    visited[index] = true;

    if (next.word && word.length >= MIN_WORD_LENGTH) found.add(word);
    for (const n of NEIGHBOURS[index]) {
      if (!visited[n]) walk(n, next, word);
    }

    visited[index] = false;
  };

  for (let i = 0; i < CELL_COUNT; i++) walk(i, root, "");

  // Longest first so the results screen leads with the impressive finds.
  return [...found].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function rollGrid(rng: Rng): string[] {
  const order = rng.shuffle(DICE);
  return order.map((die) => die[rng.int(0, die.length - 1)]);
}

/**
 * A board with too few words is a bad 60 seconds for everyone, so reroll until the grid clears a
 * quality bar. The retry loop is seeded, so it is still perfectly deterministic.
 */
export function buildWordHuntRound(seed: string): WordHuntRound {
  const MIN_SOLUTIONS = 40;

  let grid: string[] = [];
  let solutions: string[] = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    const rng = createRng(`${seed}#${attempt}`);
    grid = rollGrid(rng);
    solutions = solveGrid(grid);
    if (solutions.length >= MIN_SOLUTIONS) break;
  }

  return { kind: "wordhunt", grid, solutions };
}

export const wordHunt: GameModule<WordHuntRound> = {
  id: "wordhunt",
  name: "Word Hunt",
  tagline: "Link touching letters to spell words. Longer words are worth far more.",
  durationMs: ROUND_DURATION_MS,
  buildRound: buildWordHuntRound,
  /**
   * The theoretical maximum is every word on the board, which nobody types in 60 seconds — so the
   * ceiling has to sit above real play but below a full board clear.
   *
   * Derived from the board rather than guessed. Measured over 300 seeded grids, the value of the
   * best 30 words — more than anyone taps in 60 seconds — reaches 124 on the richest boards, while
   * a quarter of the board's total value is below 80 on 293 of those 300 grids. The previous
   * `max(80, total/4)` was therefore a flat 80 in practice, and rejected a legitimate 88 in
   * testing (see TEAM_SPLIT.md → known issues).
   *
   * So: take the value of the best {@link CEILING_WORD_COUNT} words on this specific grid, which
   * scales with how rich the board is, and apply {@link CEILING_HEADROOM} on top. Being generous
   * costs little — the contract already refuses to pay anyone who never entered, and a score is
   * only ever compared against other players on the same board.
   */
  maxPlausibleScore: (round) => {
    const best = round.solutions
      .map(wordScore)
      .sort((a, b) => b - a)
      .slice(0, CEILING_WORD_COUNT)
      .reduce((sum, v) => sum + v, 0);

    return Math.max(CEILING_FLOOR, Math.ceil(best * CEILING_HEADROOM));
  },
};
