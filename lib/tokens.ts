/**
 * The stablecoin table.
 *
 * MiniPay hard rules encoded here:
 *   - USDm / USDC / USDT only. CELO is never listed, never displayed, never selectable.
 *   - `feeCurrency` is what the network fee is charged in. For 18-decimal USDm the token IS the
 *     fee currency. For 6-decimal USDC and USDT it MUST be the adapter contract — passing the
 *     token address in `feeCurrency` makes the transaction fail outright.
 */
import { CELO_SEPOLIA_ID, ACTIVE_CHAIN } from "./contracts";

export type TokenSymbol = "USDm" | "USDC" | "USDT";

export interface TokenInfo {
  symbol: TokenSymbol;
  /** ERC-20 contract — use for balanceOf, approve, transferFrom. */
  address: `0x${string}`;
  decimals: number;
  /** Pass this in the `feeCurrency` transaction field. NOT always equal to `address`. */
  feeCurrency: `0x${string}`;
  /** Shown to users instead of the ticker where a friendlier label reads better. */
  label: string;
}

const MAINNET_TOKENS: Record<TokenSymbol, TokenInfo> = {
  USDm: {
    symbol: "USDm",
    address: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    decimals: 18,
    // 18-decimal Mento stablecoin: token address doubles as the fee currency.
    feeCurrency: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    label: "USDm",
  },
  USDC: {
    symbol: "USDC",
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
    // Adapter, NOT the token. Using the token address here breaks the transaction.
    feeCurrency: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
    label: "USDC",
  },
  USDT: {
    symbol: "USDT",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    decimals: 6,
    // Adapter, NOT the token.
    feeCurrency: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
    label: "USDT",
  },
};

/**
 * Celo Sepolia. Only USDm is wired up: the 6-decimal fee-currency adapters are not published for
 * the testnet, and shipping a guessed adapter address would produce failing transactions that look
 * like app bugs. Testnet is for the create → join → settle smoke test, which USDm covers.
 */
const SEPOLIA_TOKENS: Record<TokenSymbol, TokenInfo> = {
  USDm: {
    symbol: "USDm",
    address: "0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80",
    decimals: 18,
    feeCurrency: "0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80",
    label: "USDm",
  },
  USDC: {
    symbol: "USDC",
    address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
    decimals: 6,
    // No published adapter on Sepolia — see note above. Excluded from SUPPORTED_TOKENS.
    feeCurrency: "0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80",
    label: "USDC",
  },
  USDT: {
    symbol: "USDT",
    address: "0xd077A400968890Eacc75cdc901F0356c943e4fDb",
    decimals: 6,
    feeCurrency: "0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80",
    label: "USDT",
  },
};

const IS_SEPOLIA = ACTIVE_CHAIN.id === CELO_SEPOLIA_ID;

export const TOKENS: Record<TokenSymbol, TokenInfo> = IS_SEPOLIA ? SEPOLIA_TOKENS : MAINNET_TOKENS;

/** Symbols the app will actually transact in, in balance-check order. */
export const SUPPORTED_SYMBOLS: TokenSymbol[] = IS_SEPOLIA ? ["USDm"] : ["USDm", "USDC", "USDT"];

export const SUPPORTED_TOKENS: TokenInfo[] = SUPPORTED_SYMBOLS.map((s) => TOKENS[s]);

/** Entry and stakes default to USDm. */
export const DEFAULT_TOKEN: TokenInfo = TOKENS.USDm;

export function tokenByAddress(address: string): TokenInfo | undefined {
  const lower = address.toLowerCase();
  return SUPPORTED_TOKENS.find((t) => t.address.toLowerCase() === lower);
}

export function tokenBySymbol(symbol: string): TokenInfo | undefined {
  return SUPPORTED_TOKENS.find((t) => t.symbol === symbol);
}
