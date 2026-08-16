"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GameShell } from "./GameShell";
import type { TileMergeRound } from "@/lib/games/types";
import { applyMove, hasMoves, placeSpawn, type Direction } from "@/lib/games/tilemerge";

const TILE_STYLES: Record<number, string> = {
  0: "bg-panel-sunk/50 border-transparent",
  2: "plate bg-panel-raised text-ink",
  4: "plate bg-panel-sunk text-ink",
  8: "plate bg-sky text-white",
  16: "plate bg-sky-dark text-white",
  32: "plate bg-grape text-white",
  64: "plate bg-cherry text-white",
  128: "plate bg-cherry-dark text-white",
  256: "plate bg-gold text-ink",
  512: "plate bg-gold-dark text-white",
  1024: "plate bg-lime text-white",
  2048: "plate bg-lime-dark text-white",
};

function tileStyle(value: number) {
  return TILE_STYLES[value] ?? "plate bg-ink text-panel";
}

function fontSize(value: number) {
  if (value >= 1024) return "text-lg";
  if (value >= 128) return "text-xl";
  return "text-2xl";
}

/** Tile Merge. Swipe on touch, arrow keys on a desktop browser for development. */
interface GameState {
  board: number[];
  score: number;
  /** How far through the pre-rolled spawn stream we are. */
  cursor: number;
  stuck: boolean;
}

export function TileMergeGame({
  round,
  onFinish,
}: {
  round: TileMergeRound;
  onFinish: (score: number) => void;
}) {
  // Board, score and spawn cursor advance together on every move, so they live in one state object
  // and one pure updater. Splitting them would mean nesting setState calls inside an updater, which
  // React is free to run twice.
  const [state, setState] = useState<GameState>({ board: round.board, score: 0, cursor: 0, stuck: false });
  const { board, score, stuck } = state;

  const finish = useCallback(() => onFinish(score), [onFinish, score]);

  const move = useCallback(
    (direction: Direction) => {
      setState((current) => {
        const result = applyMove(current.board, direction);
        if (!result.moved) return current;

        const spawn = round.spawns[current.cursor % round.spawns.length];
        const board = placeSpawn(result.board, spawn);

        return {
          board,
          score: current.score + result.gained,
          cursor: current.cursor + 1,
          stuck: !hasMoves(board),
        };
      });
    },
    [round.spawns],
  );

  // Arrow keys keep the game playable in a desktop browser during development and review.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = map[e.key];
      if (!direction) return;
      e.preventDefault();
      move(direction);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    touchStart.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // 24px of travel filters out taps and thumb jitter without feeling sluggish.
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;

    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  };

  /**
   * Reset the board but keep the score. The board is the tournament's board, so a reset deals the
   * same opening again — that is the point, and it is identical for everyone who gets stuck.
   */
  const restart = () => {
    setState((current) => ({ board: round.board, score: current.score, cursor: 0, stuck: false }));
  };

  return (
    <GameShell
      title="Tile Merge"
      tagline="Swipe to combine matching tiles. Each merge adds its value."
      score={score}
      onExpire={finish}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="plate bevel bg-panel grid touch-none grid-cols-4 gap-2 p-2"
      >
        {board.map((value, index) => (
          <div
            key={index}
            className={`flex aspect-square items-center justify-center rounded-xl font-black transition-colors ${tileStyle(
              value,
            )} ${fontSize(value)} ${value ? "animate-pop" : ""}`}
          >
            {value || ""}
          </div>
        ))}
      </div>

      {stuck ? (
        <div className="plate bevel bg-cherry flex items-center justify-between gap-3 p-3">
          <span className="text-sm font-black text-white uppercase">No moves left</span>
          <button
            type="button"
            onClick={restart}
            className="plate bevel-sm pressable no-select bg-gold text-ink min-h-11 px-4 text-sm font-black uppercase"
          >
            Reset board
          </button>
        </div>
      ) : (
        <p className="text-panel text-center text-xs font-black uppercase">Swipe anywhere on the board</p>
      )}
    </GameShell>
  );
}
