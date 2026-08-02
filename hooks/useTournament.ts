"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameId } from "@/lib/games/types";

export interface CurrentTournament {
  id: number | null;
  gameId: GameId;
  seed: string;
  startTime: number;
  endTime: number;
  entryPrice: string;
  entryAmount: string;
  token: { symbol: string; address: `0x${string}`; decimals: number };
  pot: string;
  players: number;
  scoresIn?: number;
  settled?: boolean;
  /** False when the contract or settler is not configured — the app runs practice-only. */
  playable: boolean;
  reason?: string;
}

/**
 * Plain fetch with no React involvement, so the polling effect and the caller-facing `refresh`
 * share one implementation without either owning the other's state updates.
 */
async function fetchCurrent(): Promise<CurrentTournament | null> {
  try {
    const response = await fetch("/api/tournament/current", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as CurrentTournament;
  } catch {
    return null;
  }
}

export function useTournament() {
  const [tournament, setTournament] = useState<CurrentTournament | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await fetchCurrent();
    // A failed poll keeps whatever we last had; the lobby degrades to practice rather than
    // flashing an error screen at someone mid-session.
    if (next) setTournament(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const next = await fetchCurrent();
      if (cancelled) return;
      if (next) setTournament(next);
      setLoading(false);
    };

    void load();
    // The hour rolls over on its own and the pot moves as people enter. Half a minute feels live
    // without hammering the RPC behind the route.
    const timer = setInterval(load, 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { tournament, loading, refresh };
}
