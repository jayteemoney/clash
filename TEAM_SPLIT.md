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
| `ClashArena.sol` | Written. **63 Foundry tests pass.** `forge lint` clean. **Not deployed anywhere.** |
| Settler backend | Written. Tournaments and duels both settle. Verified end to end on Anvil. |
| Three games | Written. Deterministic boards proven by test. |
| MiniPay compliance | Written and lint-enforced. **Never verified on a real phone.** |
| `/stats` | Live, reads chain logs. **Product analytics not wired at all.** |
| Bundle | 1.32 MB raw / 430 KB gzipped, inside the 2 MB budget. |
| Deployment | **Nothing is deployed.** No testnet, no mainnet, no Vercel. |

**Verify locally before you touch anything:**

```bash
npm install
npm run check          # typecheck + lint + MiniPay rules + 56 tests
npm run contracts:test # 63 Foundry tests
./scripts/e2e-local.sh # full money path on Anvil: tournaments + both duel outcomes
```

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
| 1 | **Word Hunt score ceiling is too tight.** In e2e testing a legitimate score of 88 was rejected as impossible. `maxPlausibleScore` in `lib/games/wordhunt.ts` is `max(80, total/4)` — a guess, never validated against real play. A strong player will be told their score is impossible. | B |
| 2 | **Support URL is a placeholder.** `NEXT_PUBLIC_SUPPORT_URL` defaults to `https://t.me/clasharena`, which may not exist. MiniPay holds you to a **24-hour SLA on critical issues**, so this must be a real, monitored channel. | B |
| 3 | **No product analytics.** `/stats` covers on-chain numbers only. MiniPay assesses DAU, MAU, retention and top countries, and none of those have a source. | A |
| 4 | **Score store is in-memory without Upstash.** It does not survive a restart and is not shared between serverless instances. Production must set the Upstash variables. | A |
| 5 | **Settlement is operator-attested.** Documented in the README. Fine to launch on, but say so honestly if asked. | Both |

---

## Developer A — remaining work

### A1. Deploy to Celo Sepolia

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...      # fund with a little CELO from faucet.celo.org/celo-sepolia
export TREASURY_ADDRESS=0x...
export SETTLER_ADDRESS=0x...           # the operator key, funded separately
export CELOSCAN_API_KEY=...

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org --broadcast --verify
```

Set in `.env.local`: `NEXT_PUBLIC_CHAIN_ID=11142220`, `NEXT_PUBLIC_CLASH_ADDRESS`,
`NEXT_PUBLIC_DEPLOY_BLOCK`, `SETTLER_PRIVATE_KEY`, `CRON_SECRET`.

On Sepolia **only USDm works** — the 6-decimal fee-currency adapters are not published for the
testnet.

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
Upstash Redis via the Vercel Marketplace. Set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. Confirm `/stats` reports the store as **Durable**, not In-memory.

### A5. Deploy the app

```bash
vercel --prod
```

Set every server variable from `.env.example` in the Vercel project. `CRON_SECRET` in particular —
without it the hourly cron returns 401 to Vercel itself and nothing ever settles.

### A6. Wire product analytics
Plausible or PostHog. DAU, MAU, D1/D7/D30 retention, top countries. Link the dashboard from
`/stats`. This is a listing assessment criterion, not a nice-to-have.

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
