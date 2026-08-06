/**
 * The full money path against a real Celo network.
 *
 *   node scripts/e2e-testnet.mjs          # tournament entry + a complete duel
 *   node scripts/e2e-testnet.mjs --settle # close and settle the tournament, once its hour is over
 *
 * The Anvil harness (scripts/e2e-local.sh) proves the logic; this proves the wiring — a real RPC
 * with replication lag, real CIP-64 fee abstraction, real block times. Those are the things a local
 * chain cannot show you, and the first run of this against Sepolia already found a bug the Anvil
 * suite could not.
 *
 * Two differences from the local harness, both forced by using a real chain:
 *
 *   - No time travel. A tournament settles when its hour actually ends, so the tournament leg is
 *     split across two invocations. Duels have no such problem: they settle the instant both
 *     players submit, which is why the duel leg runs start to finish here.
 *   - Real money, even if it is worthless. Players are derived deterministically from the deployer
 *     key, so repeat runs reuse the same wallets instead of stranding funds in fresh ones.
 *
 * Every player transaction sets `feeCurrency`, exactly as the app does, so a pass here is evidence
 * that players genuinely never need to hold CELO.
 *
 * Requires: DEPLOYER_PRIVATE_KEY funded with the entry token, and the app running on APP_URL.
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  keccak256,
  maxUint256,
  parseEventLogs,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const APP = process.env.APP_URL ?? "http://localhost:3000";
const CHAIN_ID = Number(env.NEXT_PUBLIC_CHAIN_ID);
const CHAIN = CHAIN_ID === 42220 ? celo : celoSepolia;
const RPC = env.NEXT_PUBLIC_RPC_URL || CHAIN.rpcUrls.default.http[0];
const ARENA = env.NEXT_PUBLIC_CLASH_ADDRESS;
const CRON_SECRET = env.CRON_SECRET;

// Mirrors lib/tokens.ts. Kept as a literal rather than imported because this script runs outside
// the Next.js module graph, and a mismatch here would be loud and immediate rather than subtle.
const TOKEN =
  CHAIN_ID === 42220
    ? { symbol: "USDm", address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 }
    : { symbol: "USDm", address: "0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80", decimals: 18 };
TOKEN.feeCurrency = TOKEN.address;

if (!ARENA) throw new Error("NEXT_PUBLIC_CLASH_ADDRESS is not set in .env");
if (!env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY is not set in .env");

const ARENA_ABI = JSON.parse(
  readFileSync(new URL("../lib/abi/clashArena.ts", import.meta.url), "utf8")
    .replace(/^[\s\S]*?=\s*/, "")
    .replace(/\s*as const;?\s*$/, ""),
);

const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });

// ---------------------------------------------------------------------------
// Players
//
// Derived from the deployer key so a rerun reuses the same three wallets. Fresh wallets each time
// would leave a little of the entry token stranded in every previous set.
// ---------------------------------------------------------------------------

function derive(index) {
  if (index === 0) return privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
  return privateKeyToAccount(keccak256(toHex(`${env.DEPLOYER_PRIVATE_KEY}:clash-player:${index}`)));
}

const PLAYERS = [derive(0), derive(1), derive(2)];

function wallet(account) {
  return createWalletClient({ account, chain: CHAIN, transport: http(RPC) });
}

const say = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);
const fmt = (v) => `${formatUnits(v, TOKEN.decimals)} ${TOKEN.symbol}`;

async function balance(address) {
  return pub.readContract({ address: TOKEN.address, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

/** Sends exactly the way the app does: a plain call with `feeCurrency` set, never a signature. */
async function send(account, to, data) {
  const hash = await wallet(account).sendTransaction({ account, to, data, feeCurrency: TOKEN.feeCurrency });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return receipt;
}

async function approveIfNeeded(account, amount) {
  const allowance = await pub.readContract({
    address: TOKEN.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, ARENA],
  });
  if (allowance >= amount) return null;
  return send(
    account,
    TOKEN.address,
    encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ARENA, maxUint256] }),
  );
}

async function api(path, init) {
  const response = await fetch(`${APP}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

async function fanOut() {
  say("Funding the two extra players");
  const need = 3_000_000_000_000_000_000n; // 3 units each: enough for entries and a duel stake

  for (const player of PLAYERS.slice(1)) {
    const held = await balance(player.address);
    if (held >= need) {
      console.log(`${player.address} already holds ${fmt(held)}`);
      continue;
    }
    const top = need - held;
    await send(
      PLAYERS[0],
      TOKEN.address,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [player.address, top] }),
    );
    console.log(`${player.address} funded with ${fmt(top)}`);
  }
}

async function enterTournament() {
  say("Entering the hour's tournament");
  const { body: t } = await api("/api/tournament/current");
  if (!t.playable) throw new Error(`the lobby is not playable: ${t.reason ?? "unknown"}`);
  console.log(`tournament #${t.id} · ${t.gameId} · entry ${t.entryPrice} ${t.token.symbol}`);

  const entry = BigInt(t.entryAmount);
  for (const player of PLAYERS) {
    const joined = await pub.readContract({
      address: ARENA,
      abi: ARENA_ABI,
      functionName: "hasJoined",
      args: [BigInt(t.id), player.address],
    });
    if (joined) {
      console.log(`${player.address} already in`);
      continue;
    }
    await approveIfNeeded(player, entry);
    await send(player, ARENA, encodeFunctionData({ abi: ARENA_ABI, functionName: "join", args: [BigInt(t.id)] }));
    console.log(`${player.address} joined`);
  }

  say("Submitting scores through the API");
  const scores = [60, 40, 12];
  for (const [i, player] of PLAYERS.entries()) {
    const { body } = await api("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tournamentId: t.id, address: player.address, score: scores[i], gameId: t.gameId }),
    });
    console.log(`${player.address} → ${scores[i]}: ${JSON.stringify(body)}`);
  }

  console.log(`\nescrowed: ${fmt(await balance(ARENA))}`);
  const closesIn = t.endTime - Math.floor(Date.now() / 1000);
  console.log(`the hour closes in ${Math.max(0, Math.ceil(closesIn / 60))} min — then run with --settle`);
}

async function runDuel() {
  say("A complete duel, start to finish");
  const stake = 500_000_000_000_000_000n; // 0.5
  const [creator, opponent] = PLAYERS;

  const before = { creator: await balance(creator.address), opponent: await balance(opponent.address) };

  await approveIfNeeded(creator, stake);
  const created = await send(
    creator,
    ARENA,
    encodeFunctionData({ abi: ARENA_ABI, functionName: "createDuel", args: [TOKEN.address, stake] }),
  );
  const [ev] = parseEventLogs({ abi: ARENA_ABI, eventName: "DuelCreated", logs: created.logs });
  const duelId = Number(ev.args.duelId);
  console.log(`duel #${duelId} created by ${creator.address}`);

  await approveIfNeeded(opponent, stake);
  await send(
    opponent,
    ARENA,
    encodeFunctionData({ abi: ARENA_ABI, functionName: "acceptDuel", args: [BigInt(duelId)] }),
  );
  console.log(`accepted by ${opponent.address} · escrow ${fmt(await balance(ARENA))}`);

  // The duel's game is pinned to the hour it was accepted in, not the current hour.
  const duel = await pub.readContract({ address: ARENA, abi: ARENA_ABI, functionName: "getDuel", args: [BigInt(duelId)] });
  const acceptedAt = Number(duel[5]);
  const gameId = ["fastmath", "wordhunt", "tilemerge"][Math.floor(acceptedAt / 3600) % 3];

  for (const [player, score] of [
    [creator, 30],
    [opponent, 45],
  ]) {
    const { body } = await api("/api/duel/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duelId, address: player.address, score, gameId }),
    });
    console.log(`${player.address} → ${score}: ${JSON.stringify(body).slice(0, 220)}`);
  }

  const after = { creator: await balance(creator.address), opponent: await balance(opponent.address) };
  const won = after.opponent - before.opponent;
  const lost = after.creator - before.creator;
  const expected = (stake * 2n * 92n) / 100n - stake;

  console.log(`\nwinner (45 pts): ${fmt(won)}   expected ${fmt(expected)}`);
  console.log(`loser  (30 pts): ${fmt(lost)}   expected -${fmt(stake)}`);

  const escrow = await balance(ARENA);
  if (won !== expected) throw new Error(`the duel winner received ${won}, expected ${expected}`);
  if (lost !== -stake) throw new Error(`the duel loser moved by ${lost}, expected -${stake}`);
  console.log(`arena escrow now: ${fmt(escrow)}`);
}

async function settle() {
  say("Closing and settling the tournament");
  const { body: t } = await api("/api/tournament/current");
  // The lobby always reports the *current* hour, so settle the one before it.
  const target = Number(process.env.TOURNAMENT_ID ?? t.id) - (process.env.TOURNAMENT_ID ? 0 : 1);

  const { body } = await api("/api/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CRON_SECRET}` },
    body: JSON.stringify({ tournamentId: target }),
  });
  console.log(JSON.stringify(body, null, 2));

  console.log(`\narena escrow: ${fmt(await balance(ARENA))}  (0 once every pot has been paid out)`);
  for (const p of PLAYERS) console.log(`${p.address}  ${fmt(await balance(p.address))}`);
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`chain ${CHAIN_ID} · arena ${ARENA} · token ${TOKEN.address}`);
  console.log(`app ${APP}`);

  if (process.argv.includes("--settle")) return settle();

  const funds = await balance(PLAYERS[0].address);
  console.log(`\ndeployer holds ${fmt(funds)}`);
  if (funds < 7_000_000_000_000_000_000n) {
    throw new Error(
      `not enough ${TOKEN.symbol}. Fund ${PLAYERS[0].address} with at least 7 and run again.`,
    );
  }

  await fanOut();
  await enterTournament();
  await runDuel();

  say("Tournament entries and the duel both passed. Run with --settle once the hour is over.");
}

main().catch((error) => {
  console.error(`\n\x1b[31mFAILED\x1b[0m ${error.message}`);
  process.exit(1);
});
