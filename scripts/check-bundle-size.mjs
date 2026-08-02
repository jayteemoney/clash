#!/usr/bin/env node
/**
 * Enforces the JS bundle budget. MiniPay reviews performance, and the app targets phones on
 * variable networks — a regression here is a listing risk, not a nice-to-have.
 *
 *   npm run build && node scripts/check-bundle-size.mjs
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = join(root, ".next/static");

const BUDGET_RAW_MB = 2;
const BUDGET_GZIP_KB = 700;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(staticDir);
} catch {
  console.error("No build output found. Run `npm run build` first.");
  process.exit(1);
}

let raw = 0;
let gzip = 0;
const sized = files.map((file) => {
  const bytes = readFileSync(file);
  const g = gzipSync(bytes).length;
  raw += bytes.length;
  gzip += g;
  return { file: relative(root, file), raw: bytes.length, gzip: g };
});

const rawMb = raw / 1024 / 1024;
const gzipKb = gzip / 1024;

console.log(`JS shipped: ${rawMb.toFixed(2)} MB raw · ${gzipKb.toFixed(0)} KB gzipped across ${files.length} chunks`);
console.log("\nLargest chunks:");
for (const entry of sized.sort((a, b) => b.raw - a.raw).slice(0, 5)) {
  console.log(`  ${(entry.raw / 1024).toFixed(0).padStart(5)} KB raw  ${(entry.gzip / 1024).toFixed(0).padStart(4)} KB gz  ${entry.file}`);
}

const failures = [];
if (rawMb > BUDGET_RAW_MB) failures.push(`raw ${rawMb.toFixed(2)} MB exceeds the ${BUDGET_RAW_MB} MB budget`);
if (gzipKb > BUDGET_GZIP_KB) failures.push(`gzipped ${gzipKb.toFixed(0)} KB exceeds the ${BUDGET_GZIP_KB} KB budget`);

if (failures.length) {
  console.error(`\nBundle budget exceeded:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

console.log("\nBundle budget: within limits.");
