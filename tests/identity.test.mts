import { test } from "node:test";
import assert from "node:assert/strict";
import { aliasFor, resolveIdentity, avatarHue } from "../lib/identity";

/**
 * MiniPay forbids showing a raw `0x…` address as the primary identifier, so every player is
 * rendered as a generated alias. These tests hold that line: an alias must be stable for an
 * address, distinct between addresses, and must never leak the address it came from.
 */

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const D = "0x4444444444444444444444444444444444444444";

test("aliases are stable for an address and case-insensitive", () => {
  assert.equal(aliasFor(A), aliasFor(A));
  assert.equal(aliasFor(A), aliasFor(A.toUpperCase()));
});

test("aliases differ between addresses", () => {
  const aliases = new Set([A, B, C, D].map(aliasFor));
  assert.equal(aliases.size, 4);
});

test("an alias never leaks the address", () => {
  const alias = aliasFor(A);
  assert.ok(!alias.startsWith("0x"));
  assert.match(alias, /^[A-Za-z]+\d{2}$/);
});

test("resolveIdentity produces two initials and keeps the address for explorer links only", () => {
  const identity = resolveIdentity(A);
  assert.equal(identity.address, A);
  assert.equal(identity.initials.length, 2);
  assert.match(identity.initials, /^[A-Z]{2}$/);
});

test("avatar hues stay on the colour wheel", () => {
  for (const address of [A, B, C, D]) {
    const hue = avatarHue(address);
    assert.ok(hue >= 0 && hue < 360);
  }
});
