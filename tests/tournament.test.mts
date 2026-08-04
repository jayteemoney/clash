import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOUR_SECONDS,
  PAYOUT_WEIGHTS,
  computePayouts,
  currentWindow,
  formatCountdown,
  gameForDuel,
  gameForWindow,
  hourStart,
  secondsRemaining,
} from "../lib/tournament";
import { GAME_IDS } from "../lib/games/types";
import { DUEL_DEADLINE_SECONDS } from "../lib/clash";

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

test("hourStart snaps to the top of the hour", () => {
  assert.equal(hourStart(1_800_003_599), 1_800_000_000);
  assert.equal(hourStart(1_800_000_000), 1_800_000_000);
  assert.equal(hourStart(1_800_003_600), 1_800_003_600);
});

test("currentWindow is exactly one hour wide", () => {
  const { start, end } = currentWindow(1_800_001_234);
  assert.equal(end - start, HOUR_SECONDS);
  assert.equal(start, 1_800_000_000);
});

test("the game rotates every hour and covers all three", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) seen.add(gameForWindow(1_800_000_000 + i * HOUR_SECONDS));
  assert.deepEqual([...seen].sort(), [...GAME_IDS].sort());
});

test("the game for an hour is stable", () => {
  const start = hourStart(1_800_001_234);
  assert.equal(gameForWindow(start), gameForWindow(start));
});

// ---------------------------------------------------------------------------
// Duel game pinning
//
// Regression: duels have an hour-long deadline that starts at acceptance, so a duel accepted
// mid-hour is still live after the hourly rotation moves on. Deriving the game from "now" meant a
// player finishing after the boundary had a valid score rejected while their stake sat in escrow.
// ---------------------------------------------------------------------------

test("a duel keeps its game for its whole deadline, across the hour boundary", () => {
  // Accepted 15 minutes before the top of the hour; the deadline runs 45 minutes past it.
  const acceptedAt = 1_800_000_000 + HOUR_SECONDS - 900;
  const pinned = gameForDuel(acceptedAt);

  for (let offset = 0; offset <= DUEL_DEADLINE_SECONDS; offset += 60) {
    assert.equal(gameForDuel(acceptedAt), pinned, `drifted ${offset}s after acceptance`);
  }

  // The hour did roll over during that window, and the rotation did move on...
  const laterHour = hourStart(acceptedAt + DUEL_DEADLINE_SECONDS);
  assert.notEqual(hourStart(acceptedAt), laterHour, "the test must actually cross a boundary");
  assert.notEqual(gameForWindow(laterHour), pinned, "the rotation must actually differ");
  // ...but the duel's game is unchanged, which is the whole point.
});

test("a duel's game matches the hour it was accepted in", () => {
  const start = 1_800_000_000;
  for (let i = 0; i < 6; i++) {
    const hour = start + i * HOUR_SECONDS;
    assert.equal(gameForDuel(hour + 30), gameForWindow(hour), `hour ${i}`);
    assert.equal(gameForDuel(hour + HOUR_SECONDS - 1), gameForWindow(hour), `hour ${i} end`);
  }
});

test("secondsRemaining never goes negative", () => {
  assert.equal(secondsRemaining(100, 500), 0);
  assert.equal(secondsRemaining(500, 100), 400);
});

test("formatCountdown pads seconds", () => {
  assert.equal(formatCountdown(0), "0:00");
  assert.equal(formatCountdown(9), "0:09");
  assert.equal(formatCountdown(75), "1:15");
  assert.equal(formatCountdown(3599), "59:59");
});

// ---------------------------------------------------------------------------
// Payouts — this decides who gets paid, so it gets the most attention.
// ---------------------------------------------------------------------------

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const D = "0x4444444444444444444444444444444444444444";

test("payouts rank by score, highest first", () => {
  const { winners, weights } = computePayouts([
    { address: B, score: 20, submittedAt: 1 },
    { address: A, score: 50, submittedAt: 2 },
    { address: C, score: 35, submittedAt: 3 },
  ]);

  assert.deepEqual(winners, [A, C, B]);
  assert.deepEqual(weights, PAYOUT_WEIGHTS.map(BigInt));
});

test("payouts are capped at the number of prize positions", () => {
  const { winners } = computePayouts([
    { address: A, score: 50, submittedAt: 1 },
    { address: B, score: 40, submittedAt: 2 },
    { address: C, score: 30, submittedAt: 3 },
    { address: D, score: 20, submittedAt: 4 },
  ]);

  assert.equal(winners.length, PAYOUT_WEIGHTS.length);
  assert.ok(!winners.includes(D as `0x${string}`));
});

test("ties are broken by who submitted first", () => {
  const { winners } = computePayouts([
    { address: A, score: 30, submittedAt: 200 },
    { address: B, score: 30, submittedAt: 100 },
  ]);

  assert.deepEqual(winners, [B, A]);
});

test("fewer players than prize positions still pays the whole pot", () => {
  const { winners, weights } = computePayouts([
    { address: A, score: 10, submittedAt: 1 },
    { address: B, score: 5, submittedAt: 2 },
  ]);

  assert.deepEqual(winners, [A, B]);
  // The contract divides pro-rata over the sum of weights, so 50/30 pays out 62.5% / 37.5% of the
  // pool rather than leaving 20% stranded in the contract.
  assert.deepEqual(weights, [50n, 30n]);
});

test("a zero score never wins a prize", () => {
  const { winners } = computePayouts([
    { address: A, score: 0, submittedAt: 1 },
    { address: B, score: 0, submittedAt: 2 },
  ]);

  assert.deepEqual(winners, []);
});

test("zero scores are excluded but real scores below them are not", () => {
  const { winners } = computePayouts([
    { address: A, score: 5, submittedAt: 1 },
    { address: B, score: 0, submittedAt: 2 },
  ]);

  assert.deepEqual(winners, [A]);
});

test("an empty tournament produces no winners", () => {
  const { winners, weights, ranked } = computePayouts([]);
  assert.deepEqual(winners, []);
  assert.deepEqual(weights, []);
  assert.deepEqual(ranked, []);
});

test("computePayouts does not mutate its input", () => {
  const entries = [
    { address: B, score: 1, submittedAt: 1 },
    { address: A, score: 2, submittedAt: 2 },
  ];
  const before = entries.map((e) => e.address);
  computePayouts(entries);
  assert.deepEqual(entries.map((e) => e.address), before);
});
