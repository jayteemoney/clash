import test from "node:test";
import assert from "node:assert/strict";

import { COLD_START_SCAN, nextWatch, planSweep, type DuelWatch } from "../lib/duelSweep";

// ---------------------------------------------------------------------------
// The settler's hourly duel sweep.
//
// Every accepted duel holds two real stakes, and the sweep is the only thing that frees them when
// a player walks away. The property under test throughout is that a duel the chain has not
// declared finished cannot be forgotten — not by age, not by volume, not by a failed read.
// ---------------------------------------------------------------------------

test("a cold start looks back over recent history", () => {
  const { scanning } = planSweep(50, null, 200);
  assert.deepEqual(scanning, Array.from({ length: 50 }, (_, i) => i + 1));
});

test("a cold start does not try to walk the whole chain", () => {
  const { scanning, deferred } = planSweep(10_000, null, 1_000);
  assert.equal(scanning.length + deferred.length, COLD_START_SCAN);
  assert.equal(scanning[0], 10_000 - COLD_START_SCAN + 1);
});

test("a warm sweep reads carried-over duels and new ones, and nothing else", () => {
  // 3 and 7 are still live from last time; 11 and 12 were created since.
  const watch: DuelWatch = { ids: [3, 7], highWater: 10 };
  const { scanning } = planSweep(12, watch, 200);
  assert.deepEqual(scanning, [3, 7, 11, 12]);
});

test("the oldest duels are read first", () => {
  const watch: DuelWatch = { ids: [2, 40], highWater: 100 };
  const { scanning } = planSweep(103, watch, 200);
  assert.deepEqual(scanning, [2, 40, 101, 102, 103]);
});

test("work beyond the budget is deferred, never dropped", () => {
  const watch: DuelWatch = { ids: [1, 2, 3, 4, 5], highWater: 5 };
  const { scanning, deferred } = planSweep(8, watch, 3);

  assert.deepEqual(scanning, [1, 2, 3]);
  assert.deepEqual(deferred, [4, 5, 6, 7, 8]);

  // Suppose the three that were read all turned out to be finished. The deferred five must still
  // be on the list for next hour, because nobody has looked at them yet.
  const carried = nextWatch(8, deferred, []);
  assert.deepEqual(carried.ids, [4, 5, 6, 7, 8]);
});

test("a duel stays on the list until the chain says it is finished", () => {
  // Duel 4 is live. Run twenty sweeps with a hundred new duels each, all of which finish at once.
  let watch: DuelWatch = { ids: [4], highWater: 4 };
  let newest = 4;

  for (let round = 0; round < 20; round++) {
    newest += 100;
    const { scanning, deferred } = planSweep(newest, watch, 200);
    assert.ok(scanning.includes(4), `sweep ${round} stopped looking at duel 4`);
    // Only duel 4 comes back live; everything else finished.
    watch = nextWatch(newest, deferred, [4]);
  }

  assert.deepEqual(watch.ids, [4]);
  assert.equal(watch.highWater, newest);
});

test("a duel that finishes is not carried forever", () => {
  const watch = nextWatch(10, [], []);
  assert.deepEqual(watch.ids, []);
  assert.equal(watch.highWater, 10);

  // ...and the ids it already ingested are not re-read on the next sweep.
  assert.deepEqual(planSweep(10, watch, 200).scanning, []);
});

test("an unaccepted invite does not hide older live duels", () => {
  // The old windowed sweep walked back from the newest id, so a block of open invites could push
  // an older accepted duel out of range. Ids are tracked individually now, so it cannot.
  const invites = Array.from({ length: 300 }, (_, i) => i + 2);
  const watch: DuelWatch = { ids: [1, ...invites], highWater: 301 };

  const { scanning } = planSweep(301, watch, 200);
  assert.equal(scanning[0], 1, "the oldest live duel must be read first, not last");
});

test("a duel is never scheduled twice in one sweep", () => {
  // A watchlist id above highWater would otherwise be added by both the carry-over and the
  // new-id range, and settling the same duel twice in one run is not a harmless mistake.
  const watch: DuelWatch = { ids: [5, 6], highWater: 4 };
  const { scanning } = planSweep(8, watch, 200);
  assert.deepEqual(scanning, [5, 6, 7, 8]);
});

test("ids beyond the newest duel are discarded", () => {
  // Pointing a deployment at a fresh contract leaves a watchlist referring to duels that do not
  // exist on it. Reading them would only produce noise.
  const watch: DuelWatch = { ids: [900, 901], highWater: 901 };
  assert.deepEqual(planSweep(3, watch, 200).scanning, []);
});

test("nextWatch merges deferred and live without duplicating", () => {
  const watch = nextWatch(20, [7, 8], [8, 9]);
  assert.deepEqual(watch.ids, [7, 8, 9]);
});
