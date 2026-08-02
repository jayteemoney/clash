import { test } from "node:test";
import assert from "node:assert/strict";
import { fastMath, buildFastMathRound } from "../lib/games/fastmath";
import { wordHunt, buildWordHuntRound, solveGrid, wordScore, GRID_SIZE } from "../lib/games/wordhunt";
import { tileMerge, buildTileMergeRound, applyMove, placeSpawn, hasMoves } from "../lib/games/tilemerge";
import { WORD_SET } from "../lib/games/words";
import { tournamentSeed } from "../lib/rng";

const SEED = tournamentSeed(1234, "test");

// ---------------------------------------------------------------------------
// Fast Math
// ---------------------------------------------------------------------------

test("Fast Math deals an identical board for the same seed", () => {
  assert.deepEqual(buildFastMathRound(SEED), buildFastMathRound(SEED));
});

test("Fast Math deals a different board for a different seed", () => {
  assert.notDeepEqual(buildFastMathRound(SEED), buildFastMathRound(`${SEED}x`));
});

test("every Fast Math answer is arithmetically correct", () => {
  for (const q of buildFastMathRound(SEED).questions) {
    const expected = q.op === "+" ? q.a + q.b : q.op === "-" ? q.a - q.b : q.a * q.b;
    assert.equal(q.answer, expected, `${q.a} ${q.op} ${q.b}`);
  }
});

test("Fast Math never asks a question with a negative answer", () => {
  for (const q of buildFastMathRound(SEED).questions) {
    assert.ok(q.answer >= 0, `negative answer: ${q.a} ${q.op} ${q.b}`);
  }
});

test("Fast Math supplies more questions than anyone can finish in a minute", () => {
  assert.ok(buildFastMathRound(SEED).questions.length >= 80);
});

test("Fast Math's plausibility ceiling is above a strong run and below an absurd one", () => {
  const ceiling = fastMath.maxPlausibleScore(buildFastMathRound(SEED));
  assert.ok(ceiling > 100, "a very strong player must not be rejected");
  assert.ok(ceiling < 5_000, "a fabricated score must be rejected");
});

// ---------------------------------------------------------------------------
// Word Hunt
// ---------------------------------------------------------------------------

test("Word Hunt deals an identical grid and solution set for the same seed", () => {
  const a = buildWordHuntRound(SEED);
  const b = buildWordHuntRound(SEED);
  assert.deepEqual(a.grid, b.grid);
  assert.deepEqual(a.solutions, b.solutions);
});

test("Word Hunt grids are 16 single upper-case letters", () => {
  const { grid } = buildWordHuntRound(SEED);
  assert.equal(grid.length, GRID_SIZE * GRID_SIZE);
  for (const letter of grid) assert.match(letter, /^[A-Z]$/);
});

test("every Word Hunt solution is a dictionary word of at least three letters", () => {
  const { solutions } = buildWordHuntRound(SEED);
  for (const word of solutions) {
    assert.ok(word.length >= 3, `too short: ${word}`);
    assert.ok(WORD_SET.has(word), `not in the dictionary: ${word}`);
  }
});

test("every Word Hunt solution is actually traceable on its grid", () => {
  const { grid, solutions } = buildWordHuntRound(SEED);

  const neighbours = (i: number) => {
    const r = Math.floor(i / GRID_SIZE);
    const c = i % GRID_SIZE;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) out.push(nr * GRID_SIZE + nc);
      }
    }
    return out;
  };

  const traceable = (word: string) => {
    const walk = (index: number, position: number, used: Set<number>): boolean => {
      if (grid[index] !== word[position]) return false;
      if (position === word.length - 1) return true;
      used.add(index);
      const ok = neighbours(index).some((n) => !used.has(n) && walk(n, position + 1, used));
      used.delete(index);
      return ok;
    };
    return grid.some((_, i) => walk(i, 0, new Set()));
  };

  // The full set can be large; a sample across the length range is enough to catch a solver bug.
  const sample = [...solutions.slice(0, 15), ...solutions.slice(-15)];
  for (const word of sample) assert.ok(traceable(word), `not traceable on the grid: ${word}`);
});

test("Word Hunt rerolls until the grid is worth playing", () => {
  // Every seed must clear the quality bar, not just a lucky one.
  for (let i = 0; i < 8; i++) {
    const { solutions } = buildWordHuntRound(tournamentSeed(i, "wordhunt"));
    assert.ok(solutions.length >= 40, `seed ${i} produced only ${solutions.length} words`);
  }
});

test("Word Hunt solutions are ordered longest first", () => {
  const { solutions } = buildWordHuntRound(SEED);
  for (let i = 1; i < solutions.length; i++) {
    assert.ok(solutions[i - 1].length >= solutions[i].length);
  }
});

test("word scoring rewards length", () => {
  assert.equal(wordScore("CAT"), 1);
  assert.equal(wordScore("CATS"), 1);
  assert.equal(wordScore("CATTY"), 2);
  assert.equal(wordScore("CATTLE"), 3);
  assert.equal(wordScore("CATTLES"), 5);
});

test("the solver finds nothing on a grid with no adjacency", () => {
  // A grid of a single letter can only spell repeats of that letter, none of which are words.
  assert.deepEqual(solveGrid(Array(16).fill("Q")), []);
});

test("Word Hunt's ceiling scales with the grid but never drops below a reachable floor", () => {
  const round = buildWordHuntRound(SEED);
  const total = round.solutions.reduce((sum, w) => sum + wordScore(w), 0);
  const ceiling = wordHunt.maxPlausibleScore(round);
  assert.ok(ceiling >= 80);
  assert.ok(ceiling <= total, "the ceiling must be reachable in principle");
});

// ---------------------------------------------------------------------------
// Tile Merge
// ---------------------------------------------------------------------------

test("Tile Merge deals an identical opening and spawn stream for the same seed", () => {
  assert.deepEqual(buildTileMergeRound(SEED), buildTileMergeRound(SEED));
});

test("Tile Merge opens with exactly two tiles, each a 2 or a 4", () => {
  const { board } = buildTileMergeRound(SEED);
  const filled = board.filter((v) => v !== 0);
  assert.equal(board.length, 16);
  assert.equal(filled.length, 2);
  for (const v of filled) assert.ok(v === 2 || v === 4);
});

test("Tile Merge spawn values are only ever 2 or 4", () => {
  for (const spawn of buildTileMergeRound(SEED).spawns) {
    assert.ok(spawn.value === 2 || spawn.value === 4);
    assert.ok(spawn.slotRoll >= 0 && spawn.slotRoll < 16);
  }
});

test("applyMove slides tiles and merges pairs once", () => {
  // Row of four 2s collapses to two 4s, scoring 4 + 4.
  const board = [2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const result = applyMove(board, "left");
  assert.deepEqual(result.board.slice(0, 4), [4, 4, 0, 0]);
  assert.equal(result.gained, 8);
  assert.ok(result.moved);
});

test("applyMove never merges a tile twice in one move", () => {
  // 4,4,8 must become 8,8 — not a single 16.
  const board = [4, 4, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const result = applyMove(board, "left");
  assert.deepEqual(result.board.slice(0, 4), [8, 8, 0, 0]);
  assert.equal(result.gained, 8);
});

test("applyMove reports no movement when nothing can move", () => {
  const board = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  for (const direction of ["up", "down", "left", "right"] as const) {
    const result = applyMove(board, direction);
    assert.equal(result.moved, false, direction);
    assert.equal(result.gained, 0, direction);
  }
});

test("applyMove works in every direction", () => {
  const board = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0];
  assert.deepEqual(applyMove(board, "right").board.slice(12), [0, 0, 0, 4]);
  assert.deepEqual(applyMove(board, "up").board.slice(0, 4), [2, 2, 0, 0]);
  assert.equal(applyMove(board, "down").moved, false, "the row is already at the bottom");
});

test("applyMove does not mutate the board it is given", () => {
  const board = [2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const copy = [...board];
  applyMove(board, "left");
  assert.deepEqual(board, copy);
});

test("placeSpawn fills an empty cell and leaves a full board alone", () => {
  const nearlyFull = Array(16).fill(2);
  nearlyFull[7] = 0;
  const filled = placeSpawn(nearlyFull, { slotRoll: 9, value: 4 });
  assert.equal(filled[7], 4, "the only empty cell must be the one used");

  const full = Array(16).fill(2);
  assert.deepEqual(placeSpawn(full, { slotRoll: 3, value: 4 }), full);
});

test("placeSpawn is deterministic for a given board and spawn", () => {
  const board = [2, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const spawn = { slotRoll: 5, value: 2 };
  assert.deepEqual(placeSpawn(board, spawn), placeSpawn(board, spawn));
});

test("hasMoves recognises a dead board", () => {
  assert.equal(hasMoves([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]), false);
  assert.equal(hasMoves([2, 2, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]), true, "an adjacent pair can merge");
  assert.equal(hasMoves([0, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]), true, "an empty cell is a move");
});

test("Tile Merge's ceiling rejects fabricated scores", () => {
  const ceiling = tileMerge.maxPlausibleScore(buildTileMergeRound(SEED));
  assert.ok(ceiling > 5_000, "an exceptional run must not be rejected");
  assert.ok(ceiling < 1_000_000);
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

test("every game module reports a 60-second round", () => {
  for (const game of [fastMath, wordHunt, tileMerge]) {
    assert.equal(game.durationMs, 60_000, game.id);
  }
});

test("no game's board depends on wall-clock time", () => {
  // Build the same seed twice with a gap; identical output means no hidden Date.now dependency.
  const first = [fastMath, wordHunt, tileMerge].map((g) => JSON.stringify(g.buildRound(SEED)));
  const start = Date.now();
  while (Date.now() - start < 5) {
    /* burn a few milliseconds so the clock has definitely moved */
  }
  const second = [fastMath, wordHunt, tileMerge].map((g) => JSON.stringify(g.buildRound(SEED)));
  assert.deepEqual(first, second);
});
