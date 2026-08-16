"use client";

import { useCallback, useMemo, useState } from "react";
import { GameShell } from "./GameShell";
import { Icon } from "../ui";
import type { WordHuntRound } from "@/lib/games/types";
import { GRID_SIZE, wordScore } from "@/lib/games/wordhunt";

/**
 * Word Hunt. Tap-to-build rather than drag-to-trace: a drag across a 4×4 grid on a small screen
 * misfires constantly, and tapping is both more accurate and easier to undo.
 */
export function WordHuntGame({
  round,
  onFinish,
}: {
  round: WordHuntRound;
  onFinish: (score: number) => void;
}) {
  const [path, setPath] = useState<number[]>([]);
  const [found, setFound] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [flash, setFlash] = useState<{ text: string; good: boolean } | null>(null);

  const solutions = useMemo(() => new Set(round.solutions), [round.solutions]);
  const word = path.map((i) => round.grid[i]).join("");

  const finish = useCallback(() => onFinish(score), [onFinish, score]);

  const adjacent = (a: number, b: number) => {
    const ra = Math.floor(a / GRID_SIZE);
    const ca = a % GRID_SIZE;
    const rb = Math.floor(b / GRID_SIZE);
    const cb = b % GRID_SIZE;
    return Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1 && a !== b;
  };

  const tap = (index: number) => {
    if (path.length === 0) {
      setPath([index]);
      return;
    }
    // Tapping the tile you just used backs one step off the path.
    if (path[path.length - 1] === index) {
      setPath((p) => p.slice(0, -1));
      return;
    }
    if (path.includes(index)) return;
    if (!adjacent(path[path.length - 1], index)) return;
    setPath((p) => [...p, index]);
  };

  const show = (text: string, good: boolean) => {
    setFlash({ text, good });
    setTimeout(() => setFlash(null), 700);
  };

  const submit = () => {
    if (word.length < 3) {
      show("Too short", false);
      setPath([]);
      return;
    }
    if (found.includes(word)) {
      show("Already found", false);
      setPath([]);
      return;
    }
    if (!solutions.has(word)) {
      show("Not a word here", false);
      setPath([]);
      return;
    }

    const points = wordScore(word);
    setScore((s) => s + points);
    setFound((f) => [word, ...f]);
    show(`${word} +${points}`, true);
    setPath([]);
  };

  return (
    <GameShell
      title="Word Hunt"
      tagline="Tap touching letters. Three letters minimum, longer pays more."
      score={score}
      onExpire={finish}
    >
      <div className="flex h-8 items-center justify-center">
        {flash ? (
          <span
            className={`plate animate-pop rounded-full px-3 py-1 text-sm font-black text-white ${
              flash.good ? "bg-lime" : "bg-cherry"
            }`}
          >
            {flash.text}
          </span>
        ) : (
          <span className="tabular text-panel text-2xl font-black tracking-[0.2em]">{word || " "}</span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {round.grid.map((letter, index) => {
          const position = path.indexOf(index);
          const selected = position !== -1;
          const isLast = position === path.length - 1;
          return (
            <button
              key={index}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                tap(index);
              }}
              className={`plate no-select relative flex aspect-square items-center justify-center text-2xl font-black ${
                isLast
                  ? "bevel-press bg-cherry text-white"
                  : selected
                    ? "bevel-press bg-gold text-ink"
                    : "bevel pressable bg-panel-raised text-ink"
              }`}
            >
              {letter}
              {selected ? (
                <span className="absolute top-1 right-1.5 text-[10px] font-black opacity-80">{position + 1}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            setPath([]);
          }}
          className="plate bevel pressable no-select bg-panel text-ink-soft flex min-h-13 items-center justify-center gap-2 font-black uppercase"
        >
          <Icon name="cross" className="h-5 w-5" />
          Clear
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            submit();
          }}
          className="plate bevel pressable no-select bg-lime flex min-h-13 items-center justify-center gap-2 font-black text-white uppercase"
        >
          <Icon name="check" className="h-5 w-5" />
          Submit
        </button>
      </div>

      <div className="min-h-11">
        <div className="text-panel mb-1 text-[11px] font-black tracking-wide uppercase">
          Found {found.length}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {found.slice(0, 18).map((w) => (
            <span key={w} className="border-outline bg-panel-raised rounded-full border-2 px-2 py-0.5 text-xs font-black">
              {w}
            </span>
          ))}
        </div>
      </div>
    </GameShell>
  );
}
