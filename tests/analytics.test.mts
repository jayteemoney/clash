import { strict as assert } from "node:assert";
import { test } from "node:test";

import { sanitize } from "../lib/analytics";

/**
 * The privacy policy promises "aggregate usage data — page views, country, and session counts".
 * Analytics keeps that promise by never sending a wallet address, and `sanitize` is the guard that
 * holds even if a future `track()` call is careless. These tests pin the guard.
 */

test("an address on its own is redacted", () => {
  const out = sanitize({ who: "0x1234567890abcdefABCDEF1234567890abcdefAB" });
  assert.equal(out?.who, "[address]");
});

test("an address embedded in a longer string is redacted", () => {
  const out = sanitize({ url: "https://clash.app/duel?from=0x1234567890abcdefABCDEF1234567890abcdefAB&id=7" });
  assert.equal(out?.url, "https://clash.app/duel?from=[address]&id=7");
});

test("every address in a string is redacted, not just the first", () => {
  const a = "0x1111111111111111111111111111111111111111";
  const b = "0x2222222222222222222222222222222222222222";
  const out = sanitize({ pair: `${a} vs ${b}` });
  assert.equal(out?.pair, "[address] vs [address]");
});

test("addresses are redacted whatever the case", () => {
  const out = sanitize({ who: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12" });
  assert.equal(out?.who, "[address]");
});

test("non-address values pass through untouched", () => {
  const out = sanitize({ game: "wordhunt", score: 88, mode: "ranked", first: true });
  assert.deepEqual(out, { game: "wordhunt", score: 88, mode: "ranked", first: true });
});

test("a transaction hash is not mistaken for an address", () => {
  // 64 hex characters, not 40. Hashes are public and carry no identity on their own.
  const hash = `0x${"a".repeat(64)}`;
  const out = sanitize({ tx: hash });
  assert.equal(out?.tx, hash);
});

test("undefined properties survive as undefined", () => {
  const out = sanitize({ game: undefined });
  assert.equal(out?.game, undefined);
});

test("no properties means nothing to sanitize", () => {
  assert.equal(sanitize(undefined), undefined);
});
