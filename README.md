# Clash

**Skill tournaments, hourly.** A MiniPay Mini App on Celo where players enter a micro-stake
tournament, everyone is dealt the **same deterministic board**, and the top scores split the prize
pool less an 8% rake.

Every entrant in a given hour plays an identical board generated from the tournament's on-chain id.
Placement is a function of how well you play it — there is no element of chance in scoring, and
free practice always works with no wallet and no payment.

Three 60-second games rotate hourly: **Fast Math**, **Word Hunt**, and **Tile Merge**. Players can
also challenge each other to 1v1 **duels** on the same rails.

---

## Quickstart

```bash
git clone --recurse-submodules <repo>   # the contracts' Foundry deps are submodules
npm install                       # Node 24 or newer
cp .env.example .env.local        # practice mode works with no configuration at all
npm run dev                       # http://localhost:3000
```

Full setup, configuration and deployment walkthrough: **[USER_GUIDE.md](USER_GUIDE.md)**.

Already cloned without `--recurse-submodules`? `git submodule update --init --recursive`. Without
it `forge build` cannot resolve OpenZeppelin or forge-std.

With no contract address configured the app runs **practice-only**: all three games are fully
playable, nothing touches the chain. Add `NEXT_PUBLIC_CLASH_ADDRESS` and `SETTLER_PRIVATE_KEY` to
turn on paid tournaments.

To see the whole money path work without spending anything:

```bash
./scripts/e2e-local.sh
```

That spins up Anvil, deploys the contract, opens a tournament, enters three players, submits scores
through the real API, closes the window and settles — then asserts the pot is fully distributed.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Determinism, scheduling, payout, sweep and identity tests (71) |
| `npm run check` | Typecheck + lint + MiniPay rule lint + tests |
| `npm run check:bundle` | Enforce the JS bundle budget (needs a build first) |
| `npm run contracts:test` | Foundry test suite (63) |
| `npm run sync:abi` | Regenerate `lib/abi/clashArena.ts` from the Foundry artifacts |
| `npm run wordlist` | Regenerate the Word Hunt dictionary |
| `./scripts/e2e-local.sh` | Full create → join → score → settle cycle on Anvil |

`npm run check` and `npm run contracts:test` both have to pass before anything merges.

---

## Layout

```
app/                     Next.js App Router
  page.tsx               Lobby
  duel/                  1v1 duels (?duel=<id> is the invite link)
  stats/                 Public on-chain stats, no wallet required
  legal/                 Terms of Service, Privacy Policy
  api/
    tournament/current   Opens and reports the hour's tournament
    score                Validated score submission
    leaderboard/[id]     Live standings
    settle               Operator-only manual settlement
    cron/settle          Hourly tick (Vercel Cron)
    stats                Machine-readable feed behind /stats

lib/
  contracts.ts           Chain config, ABI, addresses
  tokens.ts              USDm / USDC / USDT + fee adapters
  minipay.ts             Detection, auto-connect, deeplinks
  stablecoins.ts         Balances, preferred-token selection
  identity.ts            Aliases (never a raw 0x address)
  clash.ts               Every on-chain read and write
  rng.ts                 Deterministic PRNG — the fairness guarantee
  tournament.ts          Hourly scheduling and payout ranking
  games/                 Game modules behind one plug-in interface
  server/                Settler, score store, indexer

contracts/               Foundry project — ClashArena.sol
tests/                   Node test-runner suite over the pure logic
scripts/                 ABI sync, wordlist build, rule lint, bundle budget, e2e
```

The codebase is split along the `lib/` boundary: the chain, money and settlement on one side, the
player experience on the other. They meet at three interfaces — `lib/contracts.ts` for addresses
and chain config, `lib/games/types.ts` for the game plug-in contract, and the `app/api/*` routes.
Changes to any of those three need calling out in review.

---

## MiniPay compliance

These are hard listing gates, not preferences. `npm run check:minipay` fails the build on the ones
a static check can catch.

| Rule | Where it is enforced |
|---|---|
| Auto-connect, **no Connect Wallet button** | `lib/minipay.ts` → `autoConnect`, no such button exists anywhere |
| **No `personal_sign` / `eth_signTypedData`** | Entering is ERC-20 `approve` + a plain call; the rule lint greps for both |
| **USDm / USDC / USDT only, never CELO** | `lib/tokens.ts`; the rule lint flags "CELO" in any user-facing string |
| **`feeCurrency` on every transaction** | `lib/clash.ts` → `send()`; the lint fails a file that transacts without it |
| **USDC/USDT `feeCurrency` must be the adapter** | `lib/tokens.ts`, asserted by the rule lint against the known adapter addresses |
| Zero balance → **Deposit deeplink**, never an error | `lib/minipay.ts` → `goDeposit`, wired into the lobby and duel flows |
| Adapt to the highest-balance stablecoin | `lib/stablecoins.ts` → `preferredStablecoin`. **Detection and display only** — entry and stakes are USDm today, see below |
| Copy: **Network fee · Deposit · Withdraw · Stablecoin** | Enforced by the rule lint over string literals |
| **No raw `0x…` as the primary identifier** | `lib/identity.ts` — every player is shown a stable alias |
| Functional at **360×640** | Phone-width app shell, 44px minimum tap targets |
| SVG assets only, bundle budget | `public/icon.svg`, `npm run check:bundle` |
| Support link + Terms + Privacy in-app | `components/AppFooter.tsx`, `app/legal/**` |

No web fonts are loaded and nothing is fetched from a third-party CDN — the analytics client is
bundled from npm rather than injected as a remote `<script>`, and it is dynamically imported and
deferred to browser idle so it never competes with the first board. The external-origin manifest
MiniPay asks for is therefore just the RPC endpoint and your analytics host.

Analytics is anonymous by construction: a random device id, never a wallet address, with
`lib/analytics.ts` stripping anything address-shaped out of every property and URL on the way out.
That guard is pinned by tests, because it is the privacy policy written as code.

### Single-token entry — the one compliance gap

`preferredStablecoin` detects whichever supported stablecoin the player holds the most of, and the
header displays it. **Entry and duel stakes are still denominated in USDm**, because
`createTournament` fixes one `entryToken` for the whole tournament. A player holding only USDC is
therefore sent to the Deposit screen rather than being able to pay in what they hold.

Duels are the cheaper half to fix — `createDuel` already takes a token per duel, so the creator's
preferred stablecoin can be passed straight through. Tournaments need a real decision: either one
tournament per token per hour, or a swap step before `join`. Do not claim full multi-token support
in a listing submission until one of those ships.

---

## The trust model — read this before shipping

Games run on the player's device. The settler backend ranks the scores it receives and calls
`settle()`. **Settlement is therefore operator-attested in this version**, and that is stated
plainly here rather than buried.

What the contract enforces regardless of the operator:

- Only addresses that actually **joined** the tournament can be paid.
- Never more than the pot; the pot is always **fully distributed**, with rounding dust going to the
  top-weighted winner rather than accumulating in the contract.
- The rake can never exceed **10%**, and only the owner can change it.
- The settler **cannot withdraw escrow to itself** — there is no such function.
- `ReentrancyGuard` on `join`, `settle`, `settleDuel`, `createDuel`, `acceptDuel`, `cancelDuel`, and
  `SafeERC20` for every transfer.

What the contract does *not* prevent: a dishonest operator ranking players incorrectly.

What the backend does to make a fabricated score expensive:

- The submitting address must have joined on chain.
- The game must be the one that hour is running.
- The score is checked against a **ceiling recomputed server-side from the player's actual board**,
  using the same pure `buildRound(seed)` the client ran.
- Submissions are rate limited, and a worse replay never overwrites a better run.

**Path to trustless scoring.** The intended next step is commit-reveal: the client commits to a hash
of its input sequence during the round and reveals it at the end, with the server replaying the
inputs against the deterministic board to derive the score rather than accepting it. `buildRound`
is already pure and seed-driven precisely so that replay is possible; `lib/games/types.ts` is the
interface that makes it a drop-in change.

---

## Contracts

`contracts/src/ClashArena.sol`, Solidity `^0.8.24`, OpenZeppelin `Ownable` / `ReentrancyGuard` /
`SafeERC20`.

```bash
cd contracts
forge test          # 63 tests
forge lint          # clean
```

Coverage includes the join happy path, double-join and closed-window reverts, settle distribution
and rake maths, rounding dust, the empty-tournament no-op, every access-control path, a reentrant
token, 6-decimal tokens, the full duel lifecycle, and fuzz tests asserting the pot is always
conserved and the rake never exceeds its cap.

### Deploy to Celo Sepolia

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...
export TREASURY_ADDRESS=0x...
export SETTLER_ADDRESS=0x...
export ETHERSCAN_API_KEY=...        # from etherscan.io, works for Celo via API V2

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org \
  --broadcast --verify
```

Then run one full cycle against testnet before going anywhere near mainnet:

```bash
CLASH_ADDRESS=0x... ENTRY_TOKEN=0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80 \
ENTRY_AMOUNT=250000000000000000 SETTLER_PRIVATE_KEY=0x... \
forge script script/OpenTournament.s.sol:OpenTournament \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org --broadcast
```

Set `NEXT_PUBLIC_CHAIN_ID=11142220` and **`NEXT_PUBLIC_ENTRY_TOKEN=USDC`** in the app.

All three stablecoins work on Sepolia — both 6-decimal fee-currency adapters are registered there,
contrary to what this file used to say. But only **USDC** can actually be obtained:
<https://faucet.circle.com> lists Celo Sepolia. USDm is not mintable, the Mento v1 exchange on
Sepolia has an empty stable bucket and there is no v2 broker, so there is no route to it at all.

### Deploy to Celo mainnet

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url https://forno.celo.org --broadcast --verify
```

If verification does not run automatically:

```bash
# Etherscan API V2 — one host for every chain, selected by chain id. Celo's own V1 endpoints
# (api.celoscan.io, api-sepolia.celoscan.io) are deprecated and reject requests. Use 11142220
# for Celo Sepolia.
forge verify-contract <ADDRESS> src/ClashArena.sol:ClashArena \
  --chain-id 42220 \
  --verifier etherscan \
  --verifier-url https://api.etherscan.io/v2/api \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" \
      "$TREASURY_ADDRESS" "$SETTLER_ADDRESS" "$OWNER_ADDRESS") \
  --watch
```

Set the treasury to the project Safe, point `NEXT_PUBLIC_CLASH_ADDRESS` at the deployment, record
`NEXT_PUBLIC_DEPLOY_BLOCK` so `/stats` scans from the right place, and run `npm run sync:abi`.

---

## Testing on a real phone

MiniPay needs HTTPS and a real device — emulators do not work.

```bash
npm run dev
npx ngrok http 3000
```

Open the HTTPS URL on an Android phone inside MiniPay and check, in order:

1. The app connects with **no connect prompt and no button**.
2. Your alias and stablecoin balance appear in the header.
3. **Play free** works end to end.
4. **Enter** costs the entry amount plus a network fee, both in stablecoin — no CELO anywhere.
5. The payout receipt deeplink opens MiniPay's receipt screen.
6. Everything is usable at 360×640 with no horizontal scrolling.

---

## Deploying the app

```bash
vercel --prod
```

Set every server variable from `.env.example` in the Vercel project. `vercel.json` registers the
hourly cron on `/api/cron/settle`; it authenticates with `CRON_SECRET`, so set that or the route
returns 401 to everyone including Vercel.

Set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` in production. Without them the score
store falls back to an in-process map that does not survive a restart and is not shared between
serverless instances — `/stats` reports which backend is live. If the store is lost mid-hour, the
settler falls back to reading entrants from the contract and refunding them, so funds are never
stranded, but nobody wins.

Provision it through the Vercel Marketplace, which bills through Vercel and connects the database to
the project in one step:

```bash
vercel integration accept-terms upstash      # once per team; interactive, and CLI 58+ only
vercel integration add upstash/upstash-kv --name clash-scores
npm run check:store                          # writes, reads back, checks the TTL, deletes
```

The marketplace injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` rather than the `UPSTASH_REDIS_REST_*`
names Upstash's own guide shows. The app reads either spelling, so provisioning by hand from
<https://console.upstash.com> works identically — see `TEAM_SPLIT.md` A4 for the traps.

`npm run check:store` is the check worth trusting. `/stats` saying *Durable* used to mean only that
two variables were non-empty, so a typo'd URL read as durable while every score write failed; the
page now pays for a round-trip and says **Configured but unreachable** when the store is set but
not answering.

---

## Proof of Ship checklist

- [ ] `ClashArena` deployed and **verified on Celoscan** (mainnet)
- [ ] Public GitHub repo with real commit history
- [ ] Live URL on Vercel, working end-to-end on a real phone in MiniPay
- [ ] Auto-connect · no Connect button · no CELO · correct `feeCurrency` adapters
- [ ] Free-practice mode + micro-stake tournaments, **no gambling framing**
- [ ] `/stats` live, sample settle transaction hash collected
- [ ] Sample transaction hash for **every** user-facing method (`join`, `createDuel`, `acceptDuel`,
      `cancelDuel`, `settle`, `settleDuel`)
- [ ] At least 3 screenshots at 360×640, each under 500 KB
- [ ] PageSpeed Insights score captured for the production URL
- [ ] Terms, Privacy and a support link reachable in-app
- [ ] Registered on talent.app and submitted to Proof of Ship

**Regulatory framing.** Lead with the identical-seed tournament story and the free-practice default.
Keep stakes micro. Clash is a skill contest, not a wager on an uncertain event — the rule lint fails
the build on betting or gambling language anywhere in the UI, and it should stay that way.

---

## Licence

MIT.
