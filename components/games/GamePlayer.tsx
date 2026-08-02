"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { loadGame, type GameId, type Round } from "@/lib/games";
import { Spinner } from "@/components/ui";

/**
 * Loads a game's code and builds its board, then hands off to the right screen.
 *
 * Everything here is lazy. Word Hunt in particular drags a 340 KB dictionary behind it, and none
 * of the three games belong in the entry bundle when most sessions only ever play one of them.
 */

const loading = () => (
  <div className="flex items-center justify-center py-16">
    <Spinner label="Dealing your board…" />
  </div>
);

const FastMathGame = dynamic(() => import("./FastMathGame").then((m) => m.FastMathGame), { loading });
const WordHuntGame = dynamic(() => import("./WordHuntGame").then((m) => m.WordHuntGame), { loading });
const TileMergeGame = dynamic(() => import("./TileMergeGame").then((m) => m.TileMergeGame), { loading });

export function GamePlayer({
  gameId,
  seed,
  onFinish,
}: {
  gameId: GameId;
  seed: string;
  onFinish: (score: number) => void;
}) {
  // The built round is tagged with the seed it came from. A seed change therefore invalidates it
  // during render — no clearing setState in the effect body, and no chance of one frame showing a
  // previous round's board.
  const [built, setBuilt] = useState<{ seed: string; round: Round | null; error: string | null }>({
    seed,
    round: null,
    error: null,
  });
  const current = built.seed === seed ? built : { seed, round: null, error: null };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const game = await loadGame(gameId);
        // Building a Word Hunt board solves the whole grid, so yield a frame first and let the
        // loading state actually paint before the main thread is blocked.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const round = game.buildRound(seed);
        if (!cancelled) setBuilt({ seed, round, error: null });
      } catch {
        if (!cancelled) setBuilt({ seed, round: null, error: "This game could not be loaded. Please try again." });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId, seed]);

  if (current.error) {
    return <p className="text-vermilion-dark px-4 py-10 text-center text-sm font-semibold">{current.error}</p>;
  }

  const round = current.round;
  if (!round) return loading();

  if (round.kind === "fastmath") return <FastMathGame round={round} onFinish={onFinish} />;
  if (round.kind === "wordhunt") return <WordHuntGame round={round} onFinish={onFinish} />;
  return <TileMergeGame round={round} onFinish={onFinish} />;
}
