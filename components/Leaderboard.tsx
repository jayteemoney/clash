"use client";

import { useEffect, useState } from "react";
import { PAYOUT_WEIGHTS } from "@/lib/tournament";
import { avatarHue } from "@/lib/identity";

export interface LeaderboardEntry {
  rank: number;
  alias: string;
  address: string;
  score: number;
  shareWeight: number;
}

/** Live standings. Polls while the tournament is open, then freezes once it closes. */
export function Leaderboard({
  tournamentId,
  highlightAlias,
  live = true,
}: {
  tournamentId: number | null;
  highlightAlias?: string;
  live?: boolean;
}) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [fetched, setFetched] = useState(false);

  // With no tournament there is nothing to wait for, so derive the loaded flag rather than setting
  // it from inside the effect.
  const loaded = !tournamentId || fetched;

  useEffect(() => {
    if (!tournamentId) return;

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/leaderboard/${tournamentId}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { entries: LeaderboardEntry[] };
        if (!cancelled) setEntries(body.entries ?? []);
      } catch {
        // Leave the last good standings on screen rather than blanking the board.
      } finally {
        if (!cancelled) setFetched(true);
      }
    };

    void load();
    if (!live) return;

    const timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tournamentId, live]);

  if (!loaded) {
    return <p className="text-ink-faint px-1 py-4 text-sm">Loading standings…</p>;
  }

  if (entries.length === 0) {
    return (
      <p className="text-ink-faint px-1 py-4 text-sm">
        No scores yet this hour. Play a round and you are on the board.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-1.5">
      {entries.map((entry) => {
        const isYou = highlightAlias && entry.alias === highlightAlias;
        const paying = entry.rank <= PAYOUT_WEIGHTS.length;
        return (
          <li
            key={entry.address}
            className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${
              isYou ? "border-vermilion bg-vermilion-soft" : "border-line bg-paper-raised"
            }`}
          >
            <span className={`tabular w-6 text-sm font-extrabold ${paying ? "text-vermilion" : "text-ink-faint"}`}>
              {entry.rank}
            </span>
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ backgroundColor: `hsl(${avatarHue(entry.address)} 55% 42%)` }}
              aria-hidden
            >
              {entry.alias.slice(0, 2).toUpperCase()}
            </span>
            <span className="flex-1 truncate text-sm font-semibold">
              {entry.alias}
              {isYou ? <span className="text-vermilion-dark ml-1 text-xs font-bold">you</span> : null}
            </span>
            {paying ? (
              <span className="text-ink-faint text-[11px] font-semibold">{entry.shareWeight}%</span>
            ) : null}
            <span className="tabular text-sm font-extrabold">{entry.score}</span>
          </li>
        );
      })}
    </ol>
  );
}
