#!/usr/bin/env node
/**
 * The automated gate over both halves of the build (see TEAM_SPLIT.md → Shared).
 *
 * MiniPay's listing review checks a handful of things that are cheap to break by accident and
 * expensive to discover at review time. This script fails the build on the ones a grep can catch.
 *
 *   node scripts/check-minipay-rules.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components", "hooks", "lib"];
const SCAN_EXTS = [".ts", ".tsx", ".css"];

/** Files where a banned term is legitimate: the token table names CELO's fee-currency adapters. */
const EXEMPT = new Set(["lib/tokens.ts", "lib/contracts.ts"]);

/**
 * Generated data, not copy. The Word Hunt dictionary is 49,643 English words and inevitably
 * contains "gas" and "bet" — scanning it for user-facing wording is meaningless.
 */
const SKIP = new Set(["lib/games/words.ts", "lib/abi/clashArena.ts"]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (SCAN_EXTS.some((ext) => name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap((dir) => {
  try {
    return walk(join(root, dir));
  } catch {
    return [];
  }
});

const findings = [];

function report(file, line, rule, detail) {
  findings.push({ file, line, rule, detail });
}

/** Strips line comments and block comments so guidance in prose is not flagged as code. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

for (const absolute of files) {
  const rel = relative(root, absolute);
  if (SKIP.has(rel)) continue;

  const raw = readFileSync(absolute, "utf8");
  const code = stripComments(raw);
  const lines = code.split("\n");

  lines.forEach((line, i) => {
    const n = i + 1;

    // 1. No message signing. MiniPay does not support these and their presence fails review.
    if (/personal_sign|eth_signTypedData|signTypedData|signMessage/.test(line)) {
      report(rel, n, "no-message-signing", line.trim());
    }

    // 2. No "Connect Wallet" affordance.
    if (/connect\s*wallet/i.test(line)) {
      report(rel, n, "no-connect-button", line.trim());
    }

    // 3. Crypto jargon in user-facing copy. Only flags string literals, not identifiers, so
    //    `feeCurrency` and `gasEstimate` stay legal while "gas fee" in a label does not.
    const strings = line.match(/["'`]([^"'`]{2,})["'`]/g) ?? [];
    for (const literal of strings) {
      const text = literal.slice(1, -1);
      if (/\bgas\b|\bgas fee\b/i.test(text)) report(rel, n, "copy-gas", `use "network fee": ${text}`);
      if (/\bon-?ramp\b/i.test(text)) report(rel, n, "copy-onramp", `use "Deposit": ${text}`);
      if (/\boff-?ramp\b/i.test(text)) report(rel, n, "copy-offramp", `use "Withdraw": ${text}`);
      if (/\bcrypto\b/i.test(text)) report(rel, n, "copy-crypto", `use "stablecoin": ${text}`);
      // Gambling framing is a Proof of Ship rule, not a MiniPay one, but it is equally fatal.
      if (/\b(bet|betting|gambl\w*|wager|casino|jackpot|odds)\b/i.test(text)) {
        report(rel, n, "no-gambling-framing", text);
      }
    }

    // 4. CELO must never be surfaced as a user-facing token.
    if (!EXEMPT.has(rel)) {
      for (const literal of strings) {
        if (/\bCELO\b/.test(literal.slice(1, -1))) {
          report(rel, n, "no-celo-in-ui", literal.slice(1, -1));
        }
      }
    }
  });

  // 5. Every transaction must carry a fee currency.
  const sends = (code.match(/sendTransaction\s*\(/g) ?? []).length;
  const writes = (code.match(/writeContract\s*\(/g) ?? []).length;
  const fees = (code.match(/feeCurrency/g) ?? []).length;
  if (sends + writes > 0 && fees === 0) {
    report(rel, 0, "missing-fee-currency", `${sends + writes} transaction call(s) with no feeCurrency`);
  }
}

// 6. The USDC/USDT fee currency must be the adapter, not the token.
const tokensSource = readFileSync(join(root, "lib/tokens.ts"), "utf8");
const MAINNET_ADAPTERS = {
  USDC: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
  USDT: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
};
const MAINNET_TOKENS = {
  USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
  USDT: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
};

for (const symbol of ["USDC", "USDT"]) {
  const block = tokensSource.match(new RegExp(`${symbol}:\\s*\\{[\\s\\S]*?\\}`, "m"))?.[0] ?? "";
  const feeLine = block.match(/feeCurrency:\s*"(0x[0-9a-fA-F]{40})"/)?.[1];
  if (!feeLine) continue;

  if (feeLine.toLowerCase() === MAINNET_TOKENS[symbol].toLowerCase()) {
    report("lib/tokens.ts", 0, "fee-currency-must-be-adapter", `${symbol} feeCurrency is the token address`);
  }
  if (
    tokensSource.includes(MAINNET_TOKENS[symbol]) &&
    !tokensSource.includes(MAINNET_ADAPTERS[symbol]) &&
    !tokensSource.includes("SEPOLIA_TOKENS")
  ) {
    report("lib/tokens.ts", 0, "fee-currency-adapter-missing", `${symbol} adapter address not present`);
  }
}

if (findings.length === 0) {
  console.log("MiniPay rules: all checks passed.");
  process.exit(0);
}

console.error(`MiniPay rules: ${findings.length} issue(s) found.\n`);
for (const f of findings) {
  console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}  [${f.rule}]  ${f.detail}`);
}
console.error("\nSee TEAM_SPLIT.md → Shared / joint sign-off.");
process.exit(1);
