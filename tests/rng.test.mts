import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng, hashSeed, practiceSeed, tournamentSeed } from "../lib/rng";

/**
 * Determinism is the product. If two players in the same tournament can be dealt different boards,
 * the "skill, not chance" claim is false and settlement is indefensible — so these are the tests
 * that matter most in the repository.
 */

test("the same seed produces the same stream", () => {
  const a = createRng("clash");
  const b = createRng("clash");
  for (let i = 0; i < 500; i++) assert.equal(a.next(), b.next());
});

test("different seeds produce different streams", () => {
  const a = createRng("clash-1");
  const b = createRng("clash-2");
  const differing = Array.from({ length: 50 }, () => a.next() !== b.next()).filter(Boolean);
  assert.ok(differing.length > 45, "streams should diverge almost immediately");
});

test("values stay inside [0, 1)", () => {
  const rng = createRng("bounds");
  for (let i = 0; i < 10_000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test("int() is inclusive at both ends and never escapes the range", () => {
  const rng = createRng("ints");
  const seen = new Set<number>();
  for (let i = 0; i < 5_000; i++) {
    const v = rng.int(3, 7);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 3 && v <= 7, `out of range: ${v}`);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6, 7]);
});

test("shuffle is deterministic and does not mutate its input", () => {
  const source = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
  const a = createRng("shuffle").shuffle(source);
  const b = createRng("shuffle").shuffle(source);

  assert.deepEqual(a, b);
  assert.deepEqual([...source], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...a].sort((x, y) => x - y), [...source]);
});

test("hashSeed is stable and returns an unsigned 32-bit integer", () => {
  assert.equal(hashSeed("clash"), hashSeed("clash"));
  assert.notEqual(hashSeed("clash"), hashSeed("clasi"));
  for (const input of ["", "a", "a much longer seed string with spaces", "0x1234"]) {
    const h = hashSeed(input);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  }
});

test("tournamentSeed is stable across number and bigint ids", () => {
  assert.equal(tournamentSeed(42, "fastmath"), tournamentSeed(42n, "fastmath"));
  assert.notEqual(tournamentSeed(42, "fastmath"), tournamentSeed(42, "wordhunt"));
  assert.notEqual(tournamentSeed(42, "fastmath"), tournamentSeed(43, "fastmath"));
});

test("practice seeds never collide with tournament seeds", () => {
  assert.notEqual(practiceSeed("fastmath", 1), tournamentSeed(1, "fastmath"));
});
