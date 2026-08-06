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

// Mirrors lib/tokens.ts, including the rule that a 6-decimal token's fee currency is its adapter
// and never the token itself. Kept as a literal rather than imported because this script runs
// outside the Next.js module graph; a drift here fails loudly on the first transaction.
const TABLE = {
  42220: {
    USDm: { address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18, feeCurrency: "0x765DE816845861e75A25fCA122bb6898B8B1282a" },
    USDC: { address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6, feeCurrency: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" },
    USDT: { address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6, feeCurrency: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72" },
  },
  11142220: {
    USDm: { address: "0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80", decimals: 18, feeCurrency: "0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80" },
    USDC: { address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E", decimals: 6, feeCurrency: "0xbf1441Ea57f43f35f713431001f35742c88071c7" },
    USDT: { address: "0xd077A400968890Eacc75cdc901F0356c943e4fDb", decimals: 6, feeCurrency: "0xe19447B12cb0d0220B2a501D8382be2f61CcF92a" },
  },
};

const SYMBOL = env.NEXT_PUBLIC_ENTRY_TOKEN || "USDm";
const TOKEN = { symbol: SYMBOL, ...(TABLE[CHAIN_ID]?.[SYMBOL] ?? {}) };
if (!TOKEN.address) throw new Error(`no ${SYMBOL} configured for chain ${CHAIN_ID}`);

/** Amounts scale with the token's decimals, so the same run works for 18- and 6-decimal entries. */
const unit = (whole) => BigInt(whole) * 10n ** BigInt(TOKEN.decimals);

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

/**
 * Sends the way the app does — a plain call with `feeCurrency` set, never a signature — but with
 * the gas and fee fields worked out here rather than left to viem.
 *
 * That is not a style choice. viem's automatic path calls `eth_estimateGas` with a `maxFeePerGas`,
 * and the Celo node's balance check on that path ignores `feeCurrency`: it looks at the native
 * balance, sees zero, and fails with "gas required exceeds allowance (0)" before anything is
 * broadcast. The transaction itself is fine — sending one with an explicit gas limit produces a
 * type 0x7b CIP-64 transaction that succeeds from an account holding no CELO at all.
 *
 * So: estimate without a fee attached (that path does not balance-check), then price the gas in the
 * fee currency, which is exactly what a wallet does on the player's behalf.
 */
async function send(account, to, data) {
  const [estimate, gasPrice] = await Promise.all([
    pub.request({ method: "eth_estimateGas", params: [{ from: account.address, to, data }] }),
    pub.request({ method: "eth_gasPrice", params: [TOKEN.feeCurrency] }),
  ]);

  // Paying in a fee currency costs more gas than the bare call: the node also debits the token.
  // Double the estimate rather than guess at the exact overhead.
  const gas = (BigInt(estimate) * 2n) + 60_000n;

  const hash = await wallet(account).sendTransaction({
    account,
    to,
    data,
    feeCurrency: TOKEN.feeCurrency,
    gas,
    maxFeePerGas: BigInt(gasPrice) * 2n,
    maxPriorityFeePerGas: BigInt(gasPrice) / 10n,
  });

  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return receipt;
}

/**
 * Waits until the RPC actually reports the state a confirmed transaction produced.
 *
 * A receipt only proves one node saw the block. Forno is a load balancer, so the very next read can
 * land on a node that has not caught up and answer with the pre-transaction state. Every failure
 * this script has hit on Sepolia has been a variant of that.
 */
async function waitForState(label, read, want, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await want(await read())) return;
    } catch {
      // A read that throws is treated the same as a read that is behind: try again.
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`the chain never reported: ${label}`);
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
  const need = unit(3); // enough for an entry and a duel stake

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
  const stake = unit(1) / 2n; // 0.5
  const [creator, opponent] = PLAYERS;

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
  const accepted = await send(
    opponent,
    ARENA,
    encodeFunctionData({ abi: ARENA_ABI, functionName: "acceptDuel", args: [BigInt(duelId)] }),
  );
  // The app's own score route reads this status, so wait for the RPC to agree that the duel is
  // accepted before submitting. Skipping this is how the previous run got "This duel is not in
  // play" for a duel that had demonstrably been accepted two seconds earlier.
  await waitForState(
    `duel ${duelId} is accepted`,
    () => pub.readContract({ address: ARENA, abi: ARENA_ABI, functionName: "getDuel", args: [BigInt(duelId)] }),
    (d) => Number(d[4]) === 2,
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

  // Assert on the settlement event, not on balance deltas.
  //
  // Balances are the wrong instrument here for two reasons. Network fees come out of the very token
  // being measured, so a delta is the payout minus an unknowable amount of gas; and a balance read
  // issued straight after settlement can land on an RPC node that has not seen the block, which is
  // how an earlier version of this script reported the winner *losing* money on a duel that had in
  // fact paid out correctly. The event carries the exact figures and cannot be stale.
  // `fromBlock` is pulled back a little: querying from the acceptance block can outrun a node that
  // is behind it, which fails outright with "block is out of range" rather than returning nothing.
  const from = accepted.blockNumber > 50n ? accepted.blockNumber - 50n : 0n;
  let settled = [];
  await waitForState(
    `duel ${duelId} settled`,
    () =>
      pub.getContractEvents({
        address: ARENA,
        abi: ARENA_ABI,
        eventName: "DuelSettled",
        args: { duelId: BigInt(duelId) },
        fromBlock: from,
        toBlock: "latest",
      }),
    (events) => {
      settled = events;
      return events.length > 0;
    },
  );

  const { winner, amount, rake } = settled[0].args;
  const pot = stake * 2n;
  const expectedRake = (pot * 800n) / 10_000n;

  console.log(`\nwinner:  ${winner}`);
  console.log(`payout:  ${fmt(amount)}   expected ${fmt(pot - expectedRake)}`);
  console.log(`rake:    ${fmt(rake)}   expected ${fmt(expectedRake)}`);

  if (winner.toLowerCase() !== opponent.address.toLowerCase()) {
    throw new Error(`the higher score did not win: paid ${winner}`);
  }
  if (amount !== pot - expectedRake) throw new Error(`payout was ${amount}, expected ${pot - expectedRake}`);
  if (rake !== expectedRake) throw new Error(`rake was ${rake}, expected ${expectedRake}`);
  if (amount + rake !== pot) throw new Error(`payout and rake do not add up to the pot`);

  // Then prove the money actually left the contract, by reading the arena's balance either side of
  // the settlement block. Comparing against a fixed number would be wrong — the arena legitimately
  // also holds the open tournament's pot and any other duel still in play — and reading "now" is
  // subject to the same replication lag as everything else. Pinning both reads to a block makes the
  // difference exact.
  const at = settled[0].blockNumber;
  const [held, wasHeld] = await Promise.all([
    pub.readContract({ address: TOKEN.address, abi: erc20Abi, functionName: "balanceOf", args: [ARENA], blockNumber: at }),
    pub.readContract({ address: TOKEN.address, abi: erc20Abi, functionName: "balanceOf", args: [ARENA], blockNumber: at - 1n }),
  ]);

  console.log(`\narena escrow: ${fmt(wasHeld)} → ${fmt(held)}  (released ${fmt(wasHeld - held)}, the duel pot)`);
  if (wasHeld - held !== pot) {
    throw new Error(`settling released ${wasHeld - held}, expected the whole ${pot} pot`);
  }
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
  if (funds < unit(7)) {
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
