"use client";

import { useEffect, useReducer, useRef } from "react";
import { formatCountdown, secondsRemaining } from "@/lib/tournament";

/**
 * Time left in the hour.
 *
 * The remaining time is computed during render from the deadline rather than held in state, so it
 * cannot drift and cannot go stale when `endTime` changes; the interval exists only to force a
 * repaint once a second.
 */
export function Countdown({ endTime, onExpire }: { endTime: number; onExpire?: () => void }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const fired = useRef(false);

  useEffect(() => {
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const left = secondsRemaining(endTime);

  // Reset the latch when a new hour opens, so the next rollover fires too.
  useEffect(() => {
    fired.current = false;
  }, [endTime]);

  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [left, onExpire]);

  const urgent = left <= 120;

  return (
    <span className={`tabular font-extrabold ${urgent ? "text-vermilion" : "text-ink"}`}>
      {formatCountdown(left)}
    </span>
  );
}
