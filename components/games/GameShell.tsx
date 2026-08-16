"use client";

import { useEffect, useRef, useState } from "react";
import { ROUND_DURATION_MS } from "@/lib/games/types";
import { Icon } from "../ui";

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
      <div className="flex items-stretch gap-2">
        <div className="plate bevel bg-panel flex flex-1 flex-col justify-center px-3 py-2">
          <h2 className="text-base leading-tight font-black tracking-tight uppercase">{title}</h2>
          <p className="text-ink-soft text-[11px] leading-tight font-bold">{tagline}</p>
        </div>
        <div className="plate bevel bg-gold flex w-21.5 shrink-0 flex-col items-center justify-center px-1 py-2">
          <span className="text-ink text-[10px] font-black tracking-wide uppercase">Score</span>
          <span className="tabular text-ink text-2xl leading-none font-black">{score}</span>
        </div>
      </div>

      {/*
        The timer. An hourglass for most of the round; in the last ten seconds it becomes a lit
        bomb and the bar turns red, so the urgency is legible without reading the number.
      */}
      <div className="plate bg-panel-sunk flex items-center gap-2 rounded-full py-1.5 pr-2 pl-2.5">
        <Icon
          name={urgent ? "bomb" : "hourglass"}
          className={`h-5 w-5 shrink-0 ${urgent ? "animate-pulse-beat" : ""}`}
        />
        <div className="border-outline h-3.5 flex-1 overflow-hidden rounded-full border-2 bg-white/70">
          <div
            className={`h-full transition-[width] duration-100 ease-linear ${urgent ? "bg-cherry" : "bg-lime"}`}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <span
          className={`tabular w-8 text-right text-lg font-black ${urgent ? "text-cherry-dark" : "text-ink"}`}
          aria-label={`${seconds} seconds left`}
        >
          {seconds}
        </span>
      </div>

      {children}
    </div>
  );
}
