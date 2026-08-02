/**
 * MiniPay integration. Every hard listing rule that can be enforced in code lives here.
 *
 *   - Detect via `window.ethereum.isMiniPay === true` and auto-connect on mount. There is no
 *     connect button anywhere in this app.
 *   - Never call `personal_sign` or `eth_signTypedData`. MiniPay does not support them, and their
 *     presence alone fails review. Entering a tournament is `approve` + a plain contract call.
 *   - Every transaction carries `feeCurrency` so the network fee is paid in a stablecoin and the
 *     player never needs CELO.
 *   - Zero balance is a deposit prompt, not an error.
 */
import { createPublicClient, createWalletClient, custom, http, type EIP1193Provider } from "viem";
import { ACTIVE_CHAIN, RPC_URL } from "./contracts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { isMiniPay?: boolean };
  }
}

/** MiniPay deeplinks. Canonical list: https://docs.minipay.xyz/technical-references/deeplinks.html */
export const DEEPLINKS = {
  /** Top-up screen. Where we send players instead of showing an "insufficient funds" error. */
  addCash: "https://link.minipay.xyz/add_cash?tokens=USDm,USDC,USDT",
  inviteFriends: "https://link.minipay.xyz/invite_friends",
  balance: "https://link.minipay.xyz/balance",
  receipt: (txHash: string) => `https://link.minipay.xyz/receipt?tx=${txHash}&celebrate`,
} as const;

export function isMiniPay(): boolean {
  return typeof window !== "undefined" && window.ethereum?.isMiniPay === true;
}

export function getProvider(): (EIP1193Provider & { isMiniPay?: boolean }) | null {
  if (typeof window === "undefined" || !window.ethereum) return null;
  return window.ethereum;
}

/** Read-only client. Safe on the server and in components that never transact. */
export function publicClient() {
  return createPublicClient({ chain: ACTIVE_CHAIN, transport: http(RPC_URL) });
}

export function walletClient() {
  const provider = getProvider();
  if (!provider) throw new Error("No wallet available.");
  return createWalletClient({ chain: ACTIVE_CHAIN, transport: custom(provider) });
}

/**
 * Auto-connect. Inside MiniPay the address is already authorised, so `eth_accounts` returns it
 * without a prompt; `eth_requestAccounts` is the fallback for a desktop browser wallet used
 * during development. Returns null when there is no wallet at all.
 */
export async function autoConnect(): Promise<`0x${string}` | null> {
  const provider = getProvider();
  if (!provider) return null;

  try {
    const existing = (await provider.request({ method: "eth_accounts" })) as `0x${string}`[];
    if (existing?.length) return existing[0];

    // Outside MiniPay only: ask once, so the app is testable in a normal browser.
    if (!isMiniPay()) {
      const requested = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
      return requested?.[0] ?? null;
    }
  } catch {
    // A refused or unavailable wallet is not an error state — the app stays in practice mode.
  }
  return null;
}

export function goDeposit() {
  if (typeof window !== "undefined") window.location.href = DEEPLINKS.addCash;
}

export function openReceipt(txHash: string) {
  if (typeof window !== "undefined") window.location.href = DEEPLINKS.receipt(txHash);
}
