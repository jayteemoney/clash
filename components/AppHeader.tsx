"use client";

import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import { formatAmount } from "@/lib/stablecoins";
import type { MiniPayState } from "@/hooks/useMiniPay";
import { avatarHue } from "@/lib/identity";

/**
 * Header. Note what is *not* here: no connect button (MiniPay auto-connects and a button there is
 * an instant listing failure) and no raw 0x address (players are shown their alias instead).
 */
export function AppHeader({ wallet }: { wallet: MiniPayState }) {
  const { identity, preferred } = wallet;

  return (
    <header className="flex items-center justify-between px-4 pt-4 pb-2">
      <Link href="/" className="flex items-center gap-2">
        <Logo />
        <span className="text-lg font-extrabold tracking-tight">{APP_NAME}</span>
      </Link>

      {identity ? (
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-[11px] leading-tight font-semibold">{identity.displayName}</div>
            {preferred ? (
              <div className="tabular text-ink-faint text-[11px] leading-tight">
                {formatAmount(preferred.raw, preferred.token.decimals)} {preferred.token.symbol}
              </div>
            ) : null}
          </div>
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: `hsl(${avatarHue(identity.address)} 55% 42%)` }}
            aria-hidden
          >
            {identity.initials}
          </span>
        </div>
      ) : null}
    </header>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden fill="none">
      <rect width="26" height="26" rx="7" fill="#17150F" />
      <path d="M7 8.5 13 5l6 3.5v9L13 21l-6-3.5v-9Z" fill="#D23517" />
      <path d="M13 9.5 16.5 13 13 16.5 9.5 13 13 9.5Z" fill="#EAE8E1" />
    </svg>
  );
}
