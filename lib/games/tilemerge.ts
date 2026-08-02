import { createRng } from "../rng";
import { ROUND_DURATION_MS, type GameModule, type TileMergeRound } from "./types";

export const BOARD_SIZE = 4;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/** Enough spawns that a fast player never exhausts the stream inside 60 seconds. */
const SPAWN_COUNT = 400;

export type Direction = "up" | "down" | "left" | "right";

export function buildTileMergeRound(seed: string): TileMergeRound {
  const rng = createRng(seed);

  const board = new Array<number>(CELL_COUNT).fill(0);
  // Two opening tiles, same two cells and values for every player in the tournament.
  const opening = rng.shuffle([...Array(CELL_COUNT).keys()]).slice(0, 2);
  for (const cell of opening) board[cell] = rng.next() < 0.9 ? 2 : 4;

  const spawns: TileMergeRound["spawns"] = [];
  for (let i = 0; i < SPAWN_COUNT; i++) {
    spawns.push({ slotRoll: rng.int(0, CELL_COUNT - 1), value: rng.next() < 0.9 ? 2 : 4 });
  }

  return { kind: "tilemerge", board, spawns };
}

// ---------------------------------------------------------------------------
// Move mechanics — shared by the UI and by any server-side replay check.
// ---------------------------------------------------------------------------

/** Indices to traverse for a given direction, one line at a time, near edge first. */
function lines(direction: Direction): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const line: number[] = [];
    for (let j = 0; j < BOARD_SIZE; j++) {
      switch (direction) {
        case "left":
          line.push(i * BOARD_SIZE + j);
          break;
        case "right":
          line.push(i * BOARD_SIZE + (BOARD_SIZE - 1 - j));
          break;
        case "up":
          line.push(j * BOARD_SIZE + i);
          break;
        case "down":
          line.push((BOARD_SIZE - 1 - j) * BOARD_SIZE + i);
          break;
      }
    }
    out.push(line);
  }
  return out;
}

export interface MoveResult {
  board: number[];
  /** Points earned this move — the sum of every merged tile's new value, as in 2048. */
  gained: number;
  moved: boolean;
}

export function applyMove(board: readonly number[], direction: Direction): MoveResult {
  const next = [...board];
  let gained = 0;
  let moved = false;

  for (const line of lines(direction)) {
    const values = line.map((i) => next[i]).filter((v) => v !== 0);
    const merged: number[] = [];

    for (let i = 0; i < values.length; i++) {
      if (i + 1 < values.length && values[i] === values[i + 1]) {
        const value = values[i] * 2;
        merged.push(value);
        gained += value;
        i++; // consume the partner — a tile merges at most once per move
      } else {
        merged.push(values[i]);
      }
    }

    while (merged.length < BOARD_SIZE) merged.push(0);

    line.forEach((cellIndex, position) => {
      if (next[cellIndex] !== merged[position]) moved = true;
      next[cellIndex] = merged[position];
    });
  }

  return { board: next, gained, moved };
}

/** Places the next tile from the pre-rolled stream. Returns the board unchanged if it is full. */
export function placeSpawn(board: readonly number[], spawn: { slotRoll: number; value: number }): number[] {
  const empty: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === 0) empty.push(i);
  if (empty.length === 0) return [...board];

  const next = [...board];
  next[empty[spawn.slotRoll % empty.length]] = spawn.value;
  return next;
}

export function hasMoves(board: readonly number[]): boolean {
  if (board.some((v) => v === 0)) return true;
  return (["up", "down", "left", "right"] as Direction[]).some((d) => applyMove(board, d).moved);
}

export const tileMerge: GameModule<TileMergeRound> = {
  id: "tilemerge",
  name: "Tile Merge",
  tagline: "Swipe to combine matching tiles. Every merge adds its new value to your score.",
  durationMs: ROUND_DURATION_MS,
  buildRound: buildTileMergeRound,
  // A very strong player lands somewhere around 3–4k in a minute. 20k leaves generous headroom
  // for an exceptional run while still rejecting obviously fabricated submissions.
  maxPlausibleScore: () => 20_000,
};
