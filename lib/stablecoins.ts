/**
 * Balance reads and preferred-stablecoin selection.
 *
 * MiniPay requires apps to adapt to whichever supported stablecoin the player actually holds the
 * most of, and to send them to the deposit screen rather than an error when they hold none.
 */
import { erc20Abi, formatUnits } from "viem";
import { publicClient } from "./minipay";
import { SUPPORTED_TOKENS, type TokenInfo } from "./tokens";

export interface StablecoinBalance {
  token: TokenInfo;
  raw: bigint;
  /** Human-readable amount, normalised across the 6- and 18-decimal tokens. */
  amount: number;
}

export async function getBalances(user: `0x${string}`): Promise<StablecoinBalance[]> {
  const client = publicClient();

  const results = await client.multicall({
    contracts: SUPPORTED_TOKENS.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [user] as const,
    })),
    allowFailure: true,
  });

  return SUPPORTED_TOKENS.map((token, i) => {
    const result = results[i];
    const raw = result.status === "success" ? (result.result as bigint) : 0n;
    return { token, raw, amount: Number(formatUnits(raw, token.decimals)) };
  });
}

/** The stablecoin the player holds the most of, or null when every balance is zero. */
export function preferredStablecoin(balances: StablecoinBalance[]): StablecoinBalance | null {
  const funded = balances.filter((b) => b.raw > 0n);
  if (funded.length === 0) return null;
  return funded.reduce((best, b) => (b.amount > best.amount ? b : best));
}

export function balanceOf(balances: StablecoinBalance[], token: TokenInfo): StablecoinBalance | undefined {
  return balances.find((b) => b.token.address === token.address);
}

export function canAfford(balances: StablecoinBalance[], token: TokenInfo, amount: bigint): boolean {
  const entry = balanceOf(balances, token);
  return !!entry && entry.raw >= amount;
}

/** Two decimal places is how money reads; a digital dollar should not show 18 of them. */
export function formatAmount(raw: bigint, decimals: number): string {
  const value = Number(formatUnits(raw, decimals));
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
