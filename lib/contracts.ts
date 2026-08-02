/**
 * Chain config and contract handles — the boundary between the on-chain half of the app and the
 * UI half. Everything that needs to reach the chain goes through the exports here, so an address
 * or a network only ever has to change in one place.
 *
 * Treat these exports as a published interface: the UI, the settler backend and the indexer all
 * depend on them, so a change here needs calling out in review rather than slipping through.
 */
import { celo, celoSepolia } from "viem/chains";

export { clashArenaAbi } from "./abi/clashArena";

export const CELO_MAINNET_ID = 42220 as const;
export const CELO_SEPOLIA_ID = 11142220 as const;

const configuredChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? CELO_MAINNET_ID);

/**
 * The chain this build talks to. Set NEXT_PUBLIC_CHAIN_ID=11142220 for testnet.
 *
 * Deliberately not annotated as `Chain`: the inferred Celo chain type is what carries the
 * `feeCurrency` field through viem's transaction formatters, and widening it to `Chain` would
 * make every fee-abstracted call fail to type-check.
 */
export const ACTIVE_CHAIN = configuredChainId === CELO_SEPOLIA_ID ? celoSepolia : celo;

export const IS_TESTNET = ACTIVE_CHAIN.id === CELO_SEPOLIA_ID;

/** Deployed ClashArena address. Empty string until Developer A deploys and sets the env var. */
export const CLASH_ADDRESS = (process.env.NEXT_PUBLIC_CLASH_ADDRESS ?? "") as `0x${string}` | "";

export function requireClashAddress(): `0x${string}` {
  if (!CLASH_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(CLASH_ADDRESS)) {
    throw new Error("NEXT_PUBLIC_CLASH_ADDRESS is not set to a valid address.");
  }
  return CLASH_ADDRESS as `0x${string}`;
}

/** Block the ClashArena deployment landed in — the indexer starts scanning from here. */
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "0");

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (IS_TESTNET ? "https://forno.celo-sepolia.celo-testnet.org" : "https://forno.celo.org");

export const EXPLORER_URL = IS_TESTNET ? "https://celo-sepolia.blockscout.com" : "https://celoscan.io";

export function explorerTxUrl(hash: string) {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddressUrl(address: string) {
  return `${EXPLORER_URL}/address/${address}`;
}
