# Clash — Running It

Everything you need to get Clash running, from a laptop with nothing installed to a live app on
Celo mainnet. Written so someone who has never seen this repo can follow it top to bottom.

If you only want to **play**, skip to [Playing Clash](#playing-clash) at the end.

---

## What Clash is, in one paragraph

Every hour a tournament opens. Everyone who enters plays the **same board** — the board is derived
from the tournament id, so it is identical for every player and fixed before anyone joins. Entry is
a small stablecoin amount, held in escrow by a contract on Celo. When the hour closes the top three
scores split the pot, minus an 8% rake. Players can also challenge each other to **1v1 duels** on
the same rails. Practice is free and needs no wallet at all.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | **24 or newer** | The test suite runs TypeScript directly and relies on Node stripping the types itself. On Node 22 it will not even load. |
| **npm** | ships with Node | |
| **Git** | any recent | The contract dependencies are submodules. |
| **Foundry** | latest | Only needed to build, test or deploy the contract. Not needed to run the app. |

```bash
node --version          # must print v24.x or higher
```

Install Foundry if you need it:

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

---

## 2. Get the code

```bash
git clone --recurse-submodules https://github.com/jayteemoney/clash.git
cd clash
npm install
```

**Already cloned without `--recurse-submodules`?**

```bash
git submodule update --init --recursive
```

Without this, `forge build` cannot resolve OpenZeppelin or forge-std and every contract command
fails. The app itself will still run.

---

## 3. Run it — practice mode

```bash
npm run dev
```

Open <http://localhost:3000>.

**This works with no configuration, no wallet and no money.** All three games are fully playable.
Nothing touches the chain. This is the right first step: if practice mode works, your install is
good.

---

## 4. Run the whole money path locally

This is the one that proves the system actually works — it deploys the contract to a local chain,
enters three players, settles the pot, and runs both duel outcomes.

```bash
./scripts/e2e-local.sh
```

It needs Foundry. It takes about a minute and prints each stage. A pass looks like:

```
arena escrow  : 0 USDm  (must be 0)
treasury rake : 0.060000000000000000 USDm
winner gained : 0.920000000000000000 USDm  (1.0 pot less 8% = 0.92)
creator change : 0 USDm  (expect 0, fully refunded)
End-to-end cycle passed: tournaments and both duel outcomes.
```

The script backs up and restores your `.env.local`, so it is safe to run against a configured
checkout.

**The check that matters is `arena escrow: 0`.** Money left in the contract after settlement is the
failure mode worth caring about, and the script exits non-zero if it ever sees any.

---

## 5. Verify everything

```bash
npm run check           # typecheck + lint + MiniPay rule lint + 71 tests
npm run contracts:test  # 63 Foundry tests
npm run build           # production build
npm run check:bundle    # JS budget (needs the build first)
```

`npm run check:minipay` deserves a note: it is a linter for the **MiniPay listing rules**, and it
fails the build on things that would get the app rejected — a "Connect Wallet" button, the word
"gas" instead of "Network fee", any mention of CELO in user-facing copy, a transaction missing
`feeCurrency`, or gambling language. If it complains, it is protecting the listing. Fix the copy
rather than the linter.

---

## 6. Configure it against a real chain

Copy the template and fill it in:

```bash
cp .env.example .env.local
```

### The minimum to turn on paid tournaments

| Variable | What to put |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `11142220` for Celo Sepolia, `42220` for mainnet |
| `NEXT_PUBLIC_CLASH_ADDRESS` | The deployed `ClashArena` address |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | Block the contract was deployed in — lets `/stats` scan from the right place instead of guessing |
| `SETTLER_PRIVATE_KEY` | The operator key that opens and settles tournaments |
| `CRON_SECRET` | Any long random string; guards the settle endpoints |

Leave `NEXT_PUBLIC_CLASH_ADDRESS` empty and the app stays in practice mode. That is the intended
fallback, not a broken state.

### Everything else

| Variable | When you need it |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | Recommended in production. The default is Forno, which is rate-limited. |
| `NEXT_PUBLIC_ENTRY_PRICE` | Entry price as a decimal string. Default `0.25`. Keep stakes micro. |
| `NEXT_PUBLIC_SUPPORT_URL` | **Required for a MiniPay listing.** Must be a channel you actually monitor — the SLA is 24 hours on critical issues. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | **Required in production.** Without them scores live in a per-instance map that does not survive a restart and is not shared between serverless instances. The rate limiter uses them too. |
| `SETTLER_FEE_CURRENCY` | Optional. Pays the settler's own network fees in a stablecoin. Use the **adapter** address for USDC/USDT, never the token. |

### About the settler key

It can open and settle tournaments. **It cannot take player funds** — payouts only ever go to
addresses that actually joined, and the contract enforces that. Fund it with a little CELO for
network fees and set a low-balance alert. Full reasoning is in the README's trust model section.

---

## 7. Deploy the contract

```bash
cd contracts

export DEPLOYER_PRIVATE_KEY=0x...   # fund from faucet.celo.org/celo-sepolia for testnet
export TREASURY_ADDRESS=0x...       # where the rake goes — a Safe in production
export SETTLER_ADDRESS=0x...        # the operator address, funded separately
export CELOSCAN_API_KEY=...

# Celo Sepolia
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org --broadcast --verify

# Celo mainnet
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://forno.celo.org --broadcast --verify
```

Then put the address and deploy block into `.env.local`, and run `npm run sync:abi` if you changed
the contract.

**On Sepolia only USDm works.** The 6-decimal fee-currency adapters for USDC and USDT are not
published on the testnet, so the token table only wires USDm there. This is expected.

---

## 8. Deploy the app

```bash
vercel            # preview
vercel --prod     # production
```

Set every server variable from `.env.example` in the Vercel project settings.

**`CRON_SECRET` is the one people forget.** Without it the hourly cron gets a 401 from your own
app, nothing ever settles, and pots sit in the contract until someone notices. Set it, then confirm
in the Vercel logs that the hourly job is firing.

`vercel.json` already declares the cron. It closes the hour that just ended, opens the next one, and
sweeps any duel where a player walked away.

---

## 9. Health checks once it is live

| Check | Where | Good |
|---|---|---|
| Store is durable | `/stats` | Says **Durable**, not In-memory |
| Cron is firing | Vercel logs | An entry every hour, `closed.status` = `settled` or `nothing-to-close` |
| Settler has fees | Celoscan | Non-zero CELO balance |
| Nothing stranded | Celoscan | The arena's token balance is the sum of live escrow, and drops to 0 between hours |

---

## Troubleshooting

**`forge build` cannot find OpenZeppelin.** The submodules are not checked out. Run
`git submodule update --init --recursive`.

**Tests fail to load with an unknown file extension.** You are on Node 22 or older. Upgrade to 24.

**The lobby says practice only, but I set an address.** Restart `npm run dev` —
`NEXT_PUBLIC_*` variables are read at build time, not per request.

**A score is rejected as "not possible on this board".** The client and server disagree about the
board. Both derive it from the same seed, so this means a game module changed on one side only, or
a duel's `acceptedAt` is being read wrong. Do not raise the score ceiling to make it go away — that
is the check that stops fabricated scores.

**Nothing settles in production.** In order: is `CRON_SECRET` set in Vercel; is the cron in the
logs; does the settler key have CELO; is `SETTLER_PRIVATE_KEY` set as a server variable.

**A duel is stuck.** Duels settle the instant both players submit. If one walked away, the hourly
sweep awards the player who showed up, or refunds both if neither did — after the one-hour deadline.
The sweep tracks live duels individually, so nothing ages out of it.

---

## Playing Clash

For anyone who just wants to play.

1. **Open Clash in MiniPay.** It connects on its own — there is no button to press and nothing to
   approve. Your alias and stablecoin balance appear at the top.
2. **Try it free.** Tap **Play free**. No wallet, no payment, no entry. Every game is a 60-second
   round.
3. **Three games rotate by the hour.** Fast Math, Word Hunt, Tile Merge. The lobby shows which one
   is running and how long is left in the hour.
4. **Enter the tournament** if you want a shot at the pot. You approve the stablecoin once, then
   join. Everyone in the hour plays the *same board* — this is a test of skill, not luck, and
   nobody gets an easier grid than you.
5. **When the hour ends,** the top three scores split the pot. The payout is automatic; you do not
   claim anything.
6. **Duels** are 1v1. Both players stake the same amount, share a link, and play the same board.
   Highest score takes the pot. You have an hour from when your opponent accepts — the screen shows
   the countdown. If neither of you plays, both stakes come back in full.
7. **No balance?** The app sends you to Deposit. It will never show you an error for being empty.

Something wrong? Use the support link in the footer. Terms and Privacy are there too.
