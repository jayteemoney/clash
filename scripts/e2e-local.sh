#!/usr/bin/env bash
#
# Full create → join → score → settle cycle against a local Anvil chain.
#
#   ./scripts/e2e-local.sh
#
# Proves the whole Developer A half wires together — contract, settler key, score validation,
# ranking and payout — without spending testnet funds or waiting an hour for a real window.
#
# What it does:
#   1. Starts Anvil with Celo's chain id.
#   2. Deploys MockERC20 and lifts its runtime code onto the canonical USDm address, so the app's
#      real token table works unmodified against the local chain.
#   3. Deploys ClashArena and writes .env.local.
#   4. Starts the dev server, which opens the hour's tournament on chain.
#   5. Funds three players, enters them, submits scores through the real API.
#   6. Warps past the close, settles, and checks the money landed where it should.
#
# Requires: foundry (anvil, cast, forge), node, npm, curl.

set -euo pipefail

cd "$(dirname "$0")/.."

RPC=http://127.0.0.1:8545
USDM=0x765DE816845861e75A25fCA122bb6898B8B1282a
CRON_SECRET=local-e2e-secret
APP=http://localhost:3000

# Anvil's deterministic accounts.
K0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # deployer / owner / settler
A0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
TREASURY=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
P1=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; KP1=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
P2=0x90F79bf6EB2c4f870365E785982E1f101E93b906; KP2=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
P3=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65; KP3=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a

ANVIL_PID=""
DEV_PID=""

cleanup() {
  [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null || true
  [ -n "$ANVIL_PID" ] && kill "$ANVIL_PID" 2>/dev/null || true
}
trap cleanup EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
wei_to_eth() { cast to-unit "$1" ether; }
balance() { cast call "$USDM" 'balanceOf(address)(uint256)' "$1" --rpc-url "$RPC" | awk '{print $1}'; }

say "1/7  Starting Anvil on chain 42220"
anvil --chain-id 42220 --port 8545 --silent >/tmp/clash-anvil.log 2>&1 &
ANVIL_PID=$!
sleep 4
cast chain-id --rpc-url "$RPC" >/dev/null

say "2/7  Installing a mock USDm at the canonical address"
MOCK=$(cd contracts && forge create test/mocks/MockERC20.sol:MockERC20 \
  --rpc-url "$RPC" --private-key "$K0" --broadcast \
  --constructor-args "Celo Dollar" "USDm" 18 2>&1 | awk '/Deployed to:/ {print $3}')
cast rpc anvil_setCode "$USDM" "$(cast code "$MOCK" --rpc-url "$RPC")" --rpc-url "$RPC" >/dev/null
echo "USDm decimals: $(cast call "$USDM" 'decimals()(uint8)' --rpc-url "$RPC")"

say "3/7  Deploying ClashArena"
ARENA=$(cd contracts && forge create src/ClashArena.sol:ClashArena \
  --rpc-url "$RPC" --private-key "$K0" --broadcast \
  --constructor-args "$TREASURY" "$A0" "$A0" 2>&1 | awk '/Deployed to:/ {print $3}')
echo "ClashArena: $ARENA  rake: $(cast call "$ARENA" 'rakeBps()(uint256)' --rpc-url "$RPC") bps"

cat > .env.local <<EOF
NEXT_PUBLIC_CHAIN_ID=42220
NEXT_PUBLIC_CLASH_ADDRESS=$ARENA
NEXT_PUBLIC_RPC_URL=$RPC
NEXT_PUBLIC_ENTRY_PRICE=0.25
SETTLER_PRIVATE_KEY=$K0
CRON_SECRET=$CRON_SECRET
EOF

say "4/7  Starting the app (it opens this hour's tournament on chain)"
npm run dev >/tmp/clash-dev.log 2>&1 &
DEV_PID=$!
for _ in $(seq 1 30); do
  curl -sf "$APP/api/tournament/current" >/dev/null 2>&1 && break
  sleep 1
done
TOURNAMENT=$(curl -s "$APP/api/tournament/current")
echo "$TOURNAMENT"
ID=$(printf '%s' "$TOURNAMENT" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
GAME=$(printf '%s' "$TOURNAMENT" | sed -n 's/.*"gameId":"\([a-z]*\)".*/\1/p')
[ -n "$ID" ] || { echo "The tournament did not open — check /tmp/clash-dev.log"; exit 1; }

say "5/7  Funding and entering three players"
for pair in "$P1:$KP1" "$P2:$KP2" "$P3:$KP3"; do
  addr=${pair%%:*}; key=${pair##*:}
  cast send "$USDM" "mint(address,uint256)" "$addr" 10000000000000000000 --rpc-url "$RPC" --private-key "$K0" >/dev/null
  cast send "$USDM" "approve(address,uint256)" "$ARENA" 10000000000000000000 --rpc-url "$RPC" --private-key "$key" >/dev/null
  cast send "$ARENA" "join(uint256)" "$ID" --rpc-url "$RPC" --private-key "$key" >/dev/null
  echo "entered $addr"
done
echo "escrowed: $(wei_to_eth "$(balance "$ARENA")") USDm"

say "6/7  Submitting scores through the API"
post_score() {
  curl -s -X POST "$APP/api/score" -H 'Content-Type: application/json' \
    -d "{\"tournamentId\":$ID,\"address\":\"$1\",\"score\":$2,\"gameId\":\"$GAME\"}"
  echo
}
post_score "$P2" 60
post_score "$P1" 40
post_score "$P3" 12

echo "-- a wallet that never entered is refused --"
post_score 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc 50
echo "-- an impossible score is refused --"
post_score "$P1" 999999

say "7/7  Closing the window and settling"
cast rpc evm_increaseTime 4000 --rpc-url "$RPC" >/dev/null
cast rpc evm_mine --rpc-url "$RPC" >/dev/null
curl -s -X POST "$APP/api/settle" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $CRON_SECRET" -d "{\"tournamentId\":$ID}"
echo

say "Result"
printf 'arena escrow  : %s USDm  (must be 0)\n' "$(wei_to_eth "$(balance "$ARENA")")"
printf 'treasury rake : %s USDm  (8%% of 0.75 = 0.06)\n' "$(wei_to_eth "$(balance "$TREASURY")")"
printf '1st  60 pts   : %s USDm\n' "$(wei_to_eth "$(balance "$P2")")"
printf '2nd  40 pts   : %s USDm\n' "$(wei_to_eth "$(balance "$P1")")"
printf '3rd  12 pts   : %s USDm\n' "$(wei_to_eth "$(balance "$P3")")"

if [ "$(balance "$ARENA")" != "0" ]; then
  echo "FAIL: the arena still holds funds after settlement."
  exit 1
fi

say "End-to-end cycle passed."
