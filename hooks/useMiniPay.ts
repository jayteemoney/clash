"use client";

import { useCallback, useEffect, useState } from "react";
import { autoConnect, isMiniPay as detectMiniPay } from "@/lib/minipay";
import { getBalances, preferredStablecoin, type StablecoinBalance } from "@/lib/stablecoins";
import { resolveIdentity, type Identity } from "@/lib/identity";

export interface MiniPayState {
  address: `0x${string}` | null;
  identity: Identity | null;
  inMiniPay: boolean;
  /** True until the first connect attempt settles. */
  loading: boolean;
  balances: StablecoinBalance[];
  /** Whichever supported stablecoin the player holds the most of. */
  preferred: StablecoinBalance | null;
  /** True once balances are known and every one of them is zero. */
  needsDeposit: boolean;
  refresh: () => Promise<void>;
}

/**
 * Wallet state for the whole app. Connects itself on mount — there is no connect button, which is
 * a hard MiniPay requirement, and the app stays fully usable in practice mode when no wallet is
 * present at all.
 */
export function useMiniPay(): MiniPayState {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [inMiniPay, setInMiniPay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<StablecoinBalance[]>([]);
  const [balancesLoaded, setBalancesLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setBalances(await getBalances(address));
      setBalancesLoaded(true);
    } catch {
      // A flaky RPC read should never break the lobby; the player can still practise.
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    const load = async () => {
      try {
        const next = await getBalances(address);
        if (cancelled) return;
        setBalances(next);
        setBalancesLoaded(true);
      } catch {
        // Same as above: a failed balance read is not a broken app.
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setInMiniPay(detectMiniPay());
      const found = await autoConnect();
      if (cancelled) return;
      setAddress(found);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    address,
    identity: address ? resolveIdentity(address) : null,
    inMiniPay,
    loading,
    balances,
    preferred: preferredStablecoin(balances),
    needsDeposit: balancesLoaded && balances.length > 0 && balances.every((b) => b.raw === 0n),
    refresh,
  };
}
