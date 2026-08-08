# Clash — Team Split & Runbook

**Status: code complete.** Everything below is written, tested and on `main`. What remains is
deployment and real-world verification — the things that need funded keys, a real phone, and live
accounts.

- **Developer A — jayteemoney.** Chain, money, settlement, deployment, operations.
- **Developer B.** Player experience, MiniPay compliance, games, device verification.

> **Regulatory guardrail — both of you.** Lead with the identical-seed **tournament** framing and
> the **free-practice** default. Keep stakes micro. Never describe this as betting, gambling,
> wagering or odds. `npm run check:minipay` fails the build on that language, and it should stay
> that way.

---

## Where the project actually is

| | State |
|---|---|
| `ClashArena.sol` | **Live and verified on Celo Sepolia:** [`0xD2557f8f…70D98`](https://sepolia.celoscan.io/address/0xd2557f8ff808349f355a79d81e693a2528570d98), block 32741375. 63 Foundry tests pass, `forge lint` clean. **Not on mainnet.** |
| Settler backend | Written. **Tournament payouts, duel payouts and abandoned-duel refunds all executed on Sepolia with real transactions.** |
| Three games | Written. Deterministic boards proven by test. |
| MiniPay compliance | Written and lint-enforced. **Never verified on a real phone.** |
| `/stats` | Live, reads chain logs. Product analytics instrumented (PostHog, anonymous) but **dark until a key is set**. |
| Bundle | 1.32 MB raw / 430 KB gzipped, inside the 2 MB budget. |
| Deployment | Testnet contract live. Vercel project `dev-jaytees-projects/clash` exists and is linked to the repo, with the score store configured — but **it has never been deployed**. **No mainnet.** |

**Verify locally before you touch anything:**

```bash
git submodule update --init --recursive   # the contracts' Foundry deps
npm install
npm run check          # typecheck + lint + MiniPay rules + 71 tests
npm run contracts:test # 63 Foundry tests
./scripts/e2e-local.sh # full money path on Anvil: tournaments + both duel outcomes
```

**Node 24 or newer.** The suite runs `.mts` files directly and needs Node's own type stripping.

Step-by-step setup, configuration and deployment instructions live in [USER_GUIDE.md](USER_GUIDE.md).

---

## The seams between the two halves

Four files are shared surface. **Changing any of them needs a note in the PR and a ping to the
other developer** — they are where the two halves can silently drift apart.

| File | Owner | Why it matters |
|---|---|---|
| `lib/contracts.ts` | A | Addresses, chain, ABI. Everything chain-facing reads it. |
| `lib/clash.ts` | A | Every on-chain read and write. B's lobby and duel screens call it directly. |
| `lib/games/types.ts` | B | `buildRound` must stay **pure** — A's settler re-runs it to bound scores. |
| `lib/rng.ts` | B | `tournamentSeed` and `duelSeed`. If client and server disagree, every honest score is rejected. |
| `app/api/*` | A | The REST surface B's screens consume. |

---

## Known issues to fix before launch

| # | Issue | Owner |
|---|---|---|
| 1 | ~~**Word Hunt score ceiling is too tight.**~~ **Fixed.** The old `max(80, total/4)` was a flat 80 on 293 of 300 measured boards, which is why a legitimate 88 was rejected. Now derived from the board: the best 30 words × 1.2, floored at 100. Pinned by tests over 100 boards. | B |
| 2 | **Support URL is a placeholder.** `NEXT_PUBLIC_SUPPORT_URL` defaults to `https://t.me/clasharena`, which may not exist. MiniPay holds you to a **24-hour SLA on critical issues**, so this must be a real, monitored channel. | B |
| 3 | **No product analytics.** ~~`/stats` covers on-chain numbers only.~~ **Instrumented, not provisioned.** PostHog is wired end to end — seven funnel events, anonymous only, address redaction pinned by 8 tests, dynamically imported and idle-deferred so it stays off the first-paint path. It stays dark until `NEXT_PUBLIC_POSTHOG_KEY` is set; `/stats` now reports **Collecting** or **Not configured**. See A6. | A |
| 4 | ~~**Score store is in-memory without Upstash.**~~ **Fixed.** Upstash Redis is provisioned and both variables are on the Vercel project in all three environments; the rate limiter now shares it. The gate it was measured against was also wrong: `/stats` said **Durable** whenever the two variables were merely non-empty, so a typo'd URL or a revoked token read as durable while every score write failed. `/stats` now does a `PING` round-trip and reports **Configured but unreachable** when set but not answering, `/api/stats` exposes `scoreStoreHealthy` to alert on, and `npm run check:store` proves it with a write, read-back, TTL and delete. Both branches verified against a live and a deliberately broken endpoint. | A |
| 5 | **Settlement is operator-attested.** Documented in the README. Fine to launch on, but say so honestly if asked. | Both |
| 6 | ~~**Duels broke across the hour boundary.**~~ **Fixed.** A duel's game is now pinned to the hour it was accepted in (`gameForDuel`) rather than the current hour, so a duel accepted at 12:45 still plays its own game at 13:05 instead of having a valid score rejected. | A |
| 7 | ~~**Contracts did not build from a clean clone.**~~ **Fixed.** `forge-std` and `openzeppelin-contracts` are now git submodules pinned to release tags; `contracts/lib/` is no longer gitignored. | A |
| 8 | **Multi-token entry is not implemented.** `preferredStablecoin` picks the player's richest stablecoin and the header displays it, but every payment path hardcodes `DEFAULT_TOKEN` (USDm). A player holding only USDC is sent to Deposit. See "Before mainnet" below. | A |
| 9 | ~~**The duel sweep could strand stakes.**~~ **Fixed.** It scanned a fixed 200-id window back from the newest duel, so once the history grew past that, an older accepted duel still holding two stakes dropped out of range silently and permanently. The sweep now keeps a persisted watchlist: ids are ingested as they appear and removed only when the chain reports the duel terminally finished. Work per sweep is proportional to *live* duels, not total history. Pure logic in `lib/duelSweep.ts`, 11 tests. | A |
| 10 | ~~**CI pinned Node 22.**~~ **Fixed.** `npm test` runs `.mts` directly and relies on Node's own type stripping, which is only on by default from 23.6 — the suite could not even load. Now Node 24, with `engines` in `package.json` to say so. | A |
| 11 | **CI has never actually run.** Every job on the workflow B added aborted at start: *"your account is locked due to a billing issue."* The merge gate is currently decorative. | A |
| 12 | ~~**No duel deadline shown.**~~ **Fixed.** Players had an hour from acceptance and nothing on screen said so. The duel screen now shows a live countdown. | A |
| 13 | ~~**`e2e-local.sh` destroyed `.env.local`.**~~ **Fixed.** It overwrote the file with Anvil settings and left it there, so the next `npm run dev` pointed at a chain that no longer existed. It now backs up and restores. | A |
| 14 | ~~**The lobby could serve tournament 0.**~~ **Fixed.** `ensureTournament` re-read the id after creating it, and Forno load-balances, so the read could hit a node that had not seen the block — it returned `id: 0, playable: true` on the very first live request. Players would have been dealt the board for tournament 0 while their entries went to tournament 1. The id now comes from the `TournamentCreated` log of the receipt. | A |
| 15 | ~~**Sepolia's 6-decimal adapters were marked unpublished.**~~ **Fixed.** Both are registered in Sepolia's `FeeCurrencyDirectory`: USDC adapter `0xbf1441Ea…71c7`, USDT adapter `0xe19447B1…Cf92a`. The table wired only USDm and set USDC's `feeCurrency` to a different token entirely. The MiniPay lint only validated the mainnet pair, so it never noticed — it now checks all four, matched by token address. | A |
| 17 | **Use a dedicated RPC in production — Forno's read-after-write lag is real, not theoretical.** Forno load-balances across nodes, so a read issued right after a confirmed write can land on one that has not seen the block. On the first testnet run this produced, in order: a lobby serving `id: 0`, a legitimate duel score rejected as "not in play", and an `eth_getLogs` that failed with "block is out of range". Each is now handled in code, but every one of them is a symptom. Set `NEXT_PUBLIC_RPC_URL` to a dedicated endpoint before mainnet. | A |
| 16 | **Two different stablecoins are called USDm on Sepolia.** Legacy `cUSD` at `0xEF4d…bC80` (what the table uses, mirroring mainnet where USDm *is* cUSD) and a newer StableTokenV3 literally symboled `USDm` at `0xdE9e4C…b00b`. Neither is obtainable, so it does not block testing, but the choice should be deliberate before anyone relies on testnet USDm. | A |

---

## The launch sequence

The order matters. Each step is gated on the one before it, and the gates are real — skipping one
means finding out about a problem with real money on the line instead of testnet money.

| # | Step | Owner | Gate to clear before moving on |
|---|---|---|---|
| **0** | Unlock the GitHub account so CI can run | A | A green run on `main` |
| ~~**1**~~ | ~~Deploy to Celo Sepolia~~ **Done.** [`0xD2557f8f…70D98`](https://sepolia.celoscan.io/address/0xd2557f8ff808349f355a79d81e693a2528570d98), verified, deploy block 32741375 | A | ✅ |
| ~~**2**~~ | ~~One full cycle on testnet~~ **Done.** See below | A | ✅ |
| ~~**3**~~ | ~~Provision Upstash~~ **Done.** Upstash for Redis `clash-scores` via the Vercel Marketplace, us-east-1, connected to `dev-jaytees-projects/clash` across production, preview and development | A | ✅ `/stats` reports **Durable** |
| **4** | Preview deploy, device-test in MiniPay | B | All 9 checks in B3 pass on a real phone |
| **5** | Real support channel | B | A monitored link in `NEXT_PUBLIC_SUPPORT_URL` |
| **6** | Deploy to mainnet + verify on Celoscan | A | Verified source on Celoscan, treasury set to the Safe |
| **7** | `vercel --prod`, all env vars, confirm cron fires | A | An hourly settle in the logs |
| **8** | Re-run the full device test against production | B | Passing on preview is not passing on production |
| **9** | Product analytics — **instrumented**, needs a PostHog key | A | DAU/MAU/retention reporting |
| **10** | Screenshots + PageSpeed | B | 3+ at 360×640 under 500 KB each; 90+ mobile |
| **11** | talent.app project page and Proof of Ship submission | A | Submitted |

**Step 4 is next — and it is B's, on a real Android phone.** Nothing on A's side moves until it
passes, because mainnet (step 6) is gated on it. Step 0 can happen in parallel; it blocks nothing
but the merge gate.

### What step 2 actually proved, on Celo Sepolia

Run with `node scripts/e2e-testnet.mjs`, entry token USDC. Every figure below was read from chain
events or from balances pinned to the transaction's own block, never from a live balance read.

| | Result |
|---|---|
| Tournament #2, 3 players | pot `0.75`, rake `0.06` (8%) |
| Payouts 50/30/20 | `0.345` · `0.207` · `0.138` — sums to `0.69` |
| Duel #4, both played | winner paid `0.92`, rake `0.08`, escrow released exactly `1.00` |
| Duel #2, abandoned | swept after its deadline, **both stakes refunded in full**, no rake taken |
| Re-running the sweep | reported `already-settled` — no double payout |
| **Arena escrow at the end** | **`0`** |

And the thing Anvil could never show: **every player transaction was a type `0x7b` CIP-64
transaction, fees paid in USDC, from accounts holding zero CELO.** That is the MiniPay premise,
now demonstrated rather than assumed.

**Do not skip this step for mainnet-adjacent changes.** It found four defects that the 71 unit
tests, 63 contract tests and the full Anvil harness all passed — see known issues 14 and 17.

---

## Developer A — remaining work

### A1. Deploy to Celo Sepolia

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...      # fund with a little CELO from faucet.celo.org/celo-sepolia
export TREASURY_ADDRESS=0x...
export SETTLER_ADDRESS=0x...           # the operator key, funded separately
export ETHERSCAN_API_KEY=...        # from etherscan.io, works for Celo via API V2

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org --broadcast --verify
```

Set in `.env.local`: `NEXT_PUBLIC_CHAIN_ID=11142220`, `NEXT_PUBLIC_CLASH_ADDRESS`,
`NEXT_PUBLIC_DEPLOY_BLOCK`, `SETTLER_PRIVATE_KEY`, `CRON_SECRET`.

On Sepolia set **`NEXT_PUBLIC_ENTRY_TOKEN=USDC`**. All three stablecoins are wired and both
6-decimal adapters are registered there, but USDC is the only one obtainable —
<https://faucet.circle.com> lists Celo Sepolia. USDm cannot be faucetted or swapped for on that
network at all.

### A2. One full cycle on testnet
Create → join → score → settle against the live testnet contract, driven from B's UI. This is the
integration checkpoint; do not proceed to mainnet until it passes.

### A3. Deploy to Celo mainnet and verify

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url https://forno.celo.org --broadcast --verify
```

Then: treasury set to the project **Safe**, contract **verified on Celoscan**, `npm run sync:abi`,
and `NEXT_PUBLIC_DEPLOY_BLOCK` recorded so `/stats` scans from the right block. The manual verify
command is in the README if `--verify` does not run.

### A4. Provision the score store

**Done.** Upstash for Redis via the Vercel Marketplace, so it bills through Vercel.

```bash
vercel integration accept-terms upstash        # once per team, interactive, human confirmation
vercel integration add upstash/upstash-kv --name clash-scores
```

Two traps, both of which cost time:

**The terms acceptance cannot be done by the CLI non-interactively, and the browser page does not
work.** Opening the `verification_uri` the CLI prints leaves `vercel integration installations`
reporting none, however many times you retry. `vercel integration accept-terms <name>` — which
requires CLI **58+**, an interactive terminal, and a typed confirmation — is what actually
registers it. This is not a version bug; it is a deliberate gate on accepting legal terms.

**The integration does not inject the variable names Upstash's own guide tells you to use.**
`vercel integration guide upstash/upstash-kv` shows `Redis.fromEnv()`, which reads
`UPSTASH_REDIS_REST_URL` / `_TOKEN`. What actually lands on the project is `KV_REST_API_URL` /
`KV_REST_API_TOKEN` — leftover naming from the retired `@vercel/kv`. `lib/server/store.ts` and
`scripts/check-store.mjs` therefore read either spelling, so provisioning by hand and provisioning
through the marketplace are an environment difference rather than a code change.

`vercel integration add` also overwrites `.env.local` on the way through. It preserves local-only
keys, which means a hand-set `UPSTASH_REDIS_REST_URL` silently keeps winning over the marketplace
database until it is removed.

Region is **us-east-1**, matching Vercel's default `iad1`; a mismatch puts a transatlantic
round-trip on every score write during settlement.

`npm run check:store` is the real gate. `/stats` reporting *Durable* on the strength of two
non-empty variables was worth nothing — a typo'd URL or a revoked token read as durable while every
score write failed, which is the worst way to be wrong about a money-critical path. The page now
does a round-trip and reports **Configured but unreachable** when the store is set but not
answering; the script does a full write, read-back, TTL and delete.

### A5. Deploy the app

```bash
vercel --prod
```

Set every server variable from `.env.example` in the Vercel project. `CRON_SECRET` in particular —
without it the hourly settle returns 401 to the scheduler and nothing ever settles.

**The hourly settle does not run on Vercel Cron.** Hobby accounts are capped at one cron run per
day, and Vercel refuses the deployment outright rather than degrading the schedule — `0 * * * *` in
`vercel.json` failed every deploy, production included. A daily settle was never an option either:
players would wait up to 24 hours for an hourly tournament's payout.

So `vercel.json` carries no crons, and Upstash QStash (`clash-settle`, provisioned through the
marketplace) calls the endpoint instead. Create the schedule once the production URL exists:

```bash
curl -X POST https://qstash.upstash.io/v2/schedules/https://YOUR-DOMAIN/api/cron/settle \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: 0 * * * *" \
  -H "Upstash-Forward-Authorization: Bearer $CRON_SECRET"
```

`QSTASH_TOKEN` is already on the project. Confirm the first firing in the QStash dashboard and in
the Vercel function logs before treating step 7 as done.

### A6. Wire product analytics

**Instrumented. Not yet provisioned** — it needs a PostHog project key, and until one is set every
call is a no-op and `/stats` reports **Not configured**.

PostHog, not Plausible: D1/D7/D30 is a cohort retention question, and Plausible does aggregate
traffic rather than cohorts. It is also the only product analytics tool in Vercel's marketplace —
Statsig, the other result, is flags and A/B tests.

To finish:

1. Create a project at <https://posthog.com> (or `vercel integration add posthog`, which needs the
   same terms acceptance as Upstash — see A4).
2. Set `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, and `NEXT_PUBLIC_ANALYTICS_URL` (the
   shareable dashboard link that `/stats` surfaces) on the Vercel project.
3. Build the three insights MiniPay assesses: DAU/MAU from unique users, retention from the
   retention insight on `round_started`, and top countries from PostHog's own GeoIP.

**What is collected, and what deliberately is not.** `lib/analytics.ts` sends anonymous events
only: a random device id, never a wallet address. The privacy policy already promises "aggregate
usage data — page views, country, and session counts", so `sanitize` strips anything address-shaped
out of every property and URL on the way out, and it is pinned by tests. Autocapture and session
recording are both off — a session recording inside a wallet app is not something to hold at all.

Events: `round_started`, `round_finished`, `tournament_entered`, `deposit_prompted`, `duel_created`,
`duel_accepted`, `duel_finished`. Enough for the funnel from open → practice → entry → duel.

The client is 75 KB gzipped, dynamically imported and deferred to `requestIdleCallback`, so it is
off the first-paint path. Bundle is 507 KB gzipped against a 700 KB budget.

**Touches four of B's files** — `app/layout.tsx`, `components/Analytics.tsx` (new),
`components/Lobby.tsx`, `components/DuelScreen.tsx`. Every change is a one-line `track()` call at an
existing branch, plus the mount in the layout. Ping B per the merge protocol.

### A7. Operational readiness
- Fund the settler key with CELO for network fees, and set a low-balance alert.
- Confirm the hourly cron is firing and settling in the Vercel logs.
- Collect a **sample Celoscan transaction hash for every user-facing method**: `join`,
  `createDuel`, `acceptDuel`, `cancelDuel`, `settle`, `settleDuel`, `voidDuel`.

### A8. Submit
Register on talent.app, create the project page (repo + mainnet address + live URL + sample settle
tx), submit to Proof of Ship, post progress in the PoS Telegram.

---

## Developer B — remaining work

**Read this whole section before starting. Your code is already written and merged — your job is
to own it, fix two known defects, and verify it on real hardware.**

### B0. Get set up

```bash
git clone https://github.com/jayteemoney/clash.git
cd clash
npm install
npm run check          # must pass before you change anything
npm run dev            # http://localhost:3000 — practice mode works with no config
```

Read these first, in this order: `lib/minipay.ts`, `lib/games/types.ts`, `components/Lobby.tsx`,
`components/games/GameShell.tsx`. They carry the rules the rest of the UI depends on.

### B1. Fix the Word Hunt score ceiling — do this first

`lib/games/wordhunt.ts` → `maxPlausibleScore` currently returns `max(80, ceil(total / 4))`. It is
too tight: a legitimate score of 88 was rejected during testing.

1. Play twenty real 60-second rounds across different seeds. Record your scores.
2. Set the floor above the best score a strong player reaches, with headroom — being generous
   costs nothing, because the contract already stops anyone who never entered from being paid.
3. Add a test in `tests/games.test.mts` pinning the new floor.

Do the same sanity check for Fast Math (`360`) and Tile Merge (`20_000`) while you are there.

### B2. Make the support channel real

Create the Telegram group (or WhatsApp / email / portal), then set `NEXT_PUBLIC_SUPPORT_URL` in
Vercel and `.env.example`. **You are committing to a 24-hour fix window on critical issues** — if
MiniPay cannot reach you, they disable the listing. Consider an AI first-responder on the channel
to triage by severity; the Celopedia skill documents that pattern.

### B3. Device testing — the one thing nobody has done

Emulators do not work. You need a real Android phone with MiniPay installed.

```bash
npm run dev
npx ngrok http 3000
```

Open the HTTPS ngrok URL inside MiniPay and verify, in order:

1. The app connects with **no prompt and no button**. If a connect button ever appears, that is an
   instant listing failure.
2. Your alias and stablecoin balance show in the header. **No raw `0x…` anywhere.**
3. **Play free** works start to finish, with no wallet involved.
4. All three games are playable with a thumb: the Fast Math keypad, Word Hunt tapping, Tile Merge
   swiping. The 60-second timer must not reset or drift.
5. **Enter a tournament.** Approve then join. The fee is charged in stablecoin — **CELO must never
   appear**, in any screen or any error.
6. Empty your balance and confirm you are sent to **Deposit**, never shown an error.
7. **Run a duel with a second phone**: create, share the link, accept, both play. Confirm the
   winner is paid and the receipt deeplink opens.
8. Everything is usable at **360×640** with no horizontal scrolling.
9. Read every string on screen. **Network fee**, **Deposit**, **Withdraw**, **Stablecoin** — never
   gas, onramp, offramp, crypto, bet or odds.

Report anything broken to A immediately if it touches money.

### B4. Capture the submission assets

- **At least 3 screenshots** at 360×640, PNG or JPG, **each under 500 KB**. Show the lobby, a game
  mid-round, and a result or leaderboard.
- **PageSpeed Insights** on the production URL at https://pagespeed.web.dev. Target 90+ on mobile.
  If it falls short, run `npm run build && npm run check:bundle` and look at the largest chunks
  first.

### B5. Deployments you own

You do not deploy contracts — that is A. Your deployment responsibilities are:

- **ngrok** for device testing (above).
- **Vercel preview deploys.** Every PR you open gets a preview URL. Test your changes there on a
  real phone before asking for review — localhost behaves differently inside MiniPay.
  ```bash
  vercel                # preview
  ```
- **Never run `vercel --prod`.** Production promotion is A's, so that env vars and the settler key
  stay under one owner.
- After A ships to production, re-run the whole of **B3** against the live URL. Passing on preview
  is not passing on production.

### B6. Optional, if there is time

Phone-number identity via ODIS → FederatedAttestations, replacing generated aliases.
`resolveIdentity` in `lib/identity.ts` is the seam. Needs an ODIS quota. Nice to have; aliases
already satisfy the rule.

---

## Ownership map

| Area | Owner |
|---|---|
| `contracts/**` | A |
| `app/api/**`, `app/stats/**` | A |
| `lib/contracts.ts`, `lib/tokens.ts`, `lib/clash.ts`, `lib/tournament.ts`, `lib/server/**` | A |
| `app/page.tsx`, `app/layout.tsx`, `app/duel/**`, `app/legal/**` | B |
| `components/**`, `hooks/**` | B |
| `lib/games/**`, `lib/rng.ts`, `lib/minipay.ts`, `lib/stablecoins.ts`, `lib/identity.ts` | B |
| `scripts/check-minipay-rules.mjs`, `scripts/check-bundle-size.mjs` | B |
| `.env.example`, `README.md` | Both |

---

## Merge protocol

- Branch per task: `a/<task>`, `b/<task>`.
- `npm run check` **and** `npm run contracts:test` must pass before merge.
- Anything touching a seam file (the four above) gets reviewed by the other developer.
- Anything touching settlement, payouts or escrow gets reviewed by the other developer, no
  exceptions — that code moves real money.

---

## Proof of Ship checklist

| # | Item | Owner | Done |
|---|---|---|---|
| 1 | `ClashArena` deployed + verified on Celoscan (mainnet) | A | ☐ |
| 2 | Public repo with real commit history | Both | ☑ |
| 3 | Live URL, working end to end on a real phone | A + B | ☐ |
| 4 | Auto-connect · no Connect button · no CELO · correct `feeCurrency` | B | ☐ verify |
| 5 | Free practice + micro stakes · no gambling framing | B | ☑ code, ☐ verify |
| 6 | `/stats` live + sample settle tx | A | ☐ |
| 7 | Sample tx hash for every user-facing method | A | ☐ |
| 8 | 3+ screenshots at 360×640, under 500 KB each | B | ☐ |
| 9 | PageSpeed score captured | B | ☐ |
| 10 | Terms + Privacy + support link reachable in-app | B | ☑ code, ☐ real support channel |
| 11 | Product analytics reporting DAU/MAU/retention | A | ☐ |
| 12 | Registered on talent.app + submitted | A | ☐ |
