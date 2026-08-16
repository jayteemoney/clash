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
    <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
      <Link href="/" className="flex items-center gap-2">
        <Logo />
        <span className="titled text-2xl text-gold">{APP_NAME}</span>
      </Link>

      {identity ? (
        <div className="plate bevel-sm bg-panel flex items-center gap-2 rounded-full py-1 pr-1 pl-3">
          <div className="text-right leading-tight">
            <div className="text-[11px] font-black">{identity.displayName}</div>
            {preferred ? (
              <div className="tabular text-ink-soft text-[11px] font-bold">
                {formatAmount(preferred.raw, preferred.token.decimals)} {preferred.token.symbol}
              </div>
            ) : null}
          </div>
          <span
            className="border-outline flex h-9 w-9 items-center justify-center rounded-full border-[2.5px] text-xs font-black text-white"
            style={{ backgroundColor: `hsl(${avatarHue(identity.address)} 70% 50%)` }}
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
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden fill="none">
      <rect x="1.5" y="1.5" width="31" height="31" rx="9" fill="var(--color-cherry)" stroke="var(--color-outline)" strokeWidth="3" />
      <path
        d="M17 7.5 25 12v10l-8 4.5L9 22V12l8-4.5Z"
        fill="var(--color-gold)"
        stroke="var(--color-outline)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M17 13l4 4-4 4-4-4 4-4Z" fill="var(--color-panel)" stroke="var(--color-outline)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
