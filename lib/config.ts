import { parseUnits } from "viem";
import { DEFAULT_TOKEN } from "./tokens";

/**
 * Product-level knobs. Stakes stay deliberately micro — Clash is a skill contest with a small
 * buy-in, and keeping the number small is both the right product call and what keeps the app
 * clearly inside Proof of Ship's rules.
 */

/** Tournament entry price, as a decimal string. */
export const ENTRY_PRICE = process.env.NEXT_PUBLIC_ENTRY_PRICE ?? "0.25";

export const ENTRY_AMOUNT = parseUnits(ENTRY_PRICE, DEFAULT_TOKEN.decimals);

/** Stake presets offered on the duel screen. */
export const DUEL_STAKES = ["0.25", "0.50", "1.00"] as const;

/** Rake, mirrored from the contract default purely so the UI can explain the split. */
export const RAKE_BPS = 800;

export const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL ?? "https://t.me/clasharena";

export const APP_NAME = "Clash";
export const APP_TAGLINE = "Skill tournaments, hourly.";

/** Share of the pot returned to players after the rake, as a percentage string. */
export const PLAYER_SHARE_PCT = ((10_000 - RAKE_BPS) / 100).toFixed(0);
