"use client";

import { useEffect, useRef, useState } from "react";
import { ROUND_DURATION_MS } from "@/lib/games/types";

/**
 * Owns the 60-second clock and the score readout so the individual games do not each reimplement
 * them. The clock is driven off a wall-clock deadline rather than an accumulating interval, so a
 * backgrounded tab or a dropped frame cannot hand anyone extra seconds.
 */
export function GameShell({
  title,
  tagline,
  score,
  onExpire,
  children,
  durationMs = ROUND_DURATION_MS,
}: {
  title: string;
  tagline: string;
  score: number;
  onExpire: () => void;
  children: React.ReactNode;
  durationMs?: number;
}) {
  const [remaining, setRemaining] = useState(durationMs);
  const expired = useRef(false);

  // `onExpire` closes over the score, so its identity changes on every point scored. Holding it in
  // a ref keeps it out of the timer effect's dependencies — otherwise the effect would re-run and
  // recompute the deadline each time, silently handing the player a fresh 60 seconds per point.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    const deadline = Date.now() + durationMs;

    const timer = setInterval(() => {
      const left = Math.max(0, deadline - Date.now());
      setRemaining(left);
      if (left === 0 && !expired.current) {
        expired.current = true;
        onExpireRef.current();
      }
    }, 100);

    return () => clearInterval(timer);
  }, [durationMs]);

  const seconds = Math.ceil(remaining / 1000);
  const fraction = remaining / durationMs;
  const urgent = seconds <= 10;

  return (
    <div className="no-select flex flex-col gap-3 px-4 pb-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg leading-tight font-extrabold">{title}</h2>
          <p className="text-ink-faint text-xs">{tagline}</p>
        </div>
        <div className="text-right">
          <div className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">Score</div>
          <div className="tabular text-2xl leading-none font-extrabold">{score}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="bg-line h-2 flex-1 overflow-hidden rounded-full">
          <div
            className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
              urgent ? "bg-vermilion" : "bg-ink"
            }`}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <span
          className={`tabular w-9 text-right text-lg font-bold ${urgent ? "text-vermilion" : "text-ink-soft"}`}
          aria-label={`${seconds} seconds left`}
        >
          {seconds}
        </span>
      </div>

      {children}
    </div>
  );
}
