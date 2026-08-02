import { createRng } from "../rng";
import { ROUND_DURATION_MS, type FastMathRound, type GameModule } from "./types";

const QUESTION_COUNT = 80; // Far more than anyone finishes in 60s, so nobody runs out of board.

/**
 * Fast-Math — an arithmetic sprint. Difficulty ramps with the question index so the first few are
 * warm-ups and the tail separates the strong players.
 */
export function buildFastMathRound(seed: string): FastMathRound {
  const rng = createRng(seed);
  const questions: FastMathRound["questions"] = [];

  for (let i = 0; i < QUESTION_COUNT; i++) {
    // Ramp: two-digit by question ~20, harder multiplication after that.
    const tier = Math.min(3, Math.floor(i / 20));
    const op = pickOp(rng.next(), tier);

    let a: number;
    let b: number;

    if (op === "×") {
      a = rng.int(2, 6 + tier * 3);
      b = rng.int(2, 6 + tier * 2);
    } else {
      const ceiling = [20, 60, 150, 400][tier];
      a = rng.int(2, ceiling);
      b = rng.int(2, ceiling);
      if (op === "-" && b > a) [a, b] = [b, a]; // keep answers non-negative
    }

    questions.push({ a, b, op, answer: op === "+" ? a + b : op === "-" ? a - b : a * b });
  }

  return { kind: "fastmath", questions };
}

function pickOp(roll: number, tier: number): "+" | "-" | "×" {
  if (tier === 0) return roll < 0.6 ? "+" : "-";
  if (tier === 1) return roll < 0.4 ? "+" : roll < 0.75 ? "-" : "×";
  return roll < 0.3 ? "+" : roll < 0.55 ? "-" : "×";
}

export const fastMath: GameModule<FastMathRound> = {
  id: "fastmath",
  name: "Fast Math",
  tagline: "Answer as many as you can in 60 seconds. One point each, streaks pay a bonus.",
  durationMs: ROUND_DURATION_MS,
  buildRound: buildFastMathRound,
  // ~1.5 answers/second is already world-class; the streak bonus can double a score, so allow 4×
  // the base rate before calling a submission implausible.
  maxPlausibleScore: () => 360,
};
