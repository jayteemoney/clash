"use client";

import { useCallback, useState } from "react";
import { GameShell } from "./GameShell";
import type { FastMathRound } from "@/lib/games/types";

/**
 * Fast Math. A custom keypad rather than a text input: the mobile keyboard would cover half the
 * board, and its open/close animation costs more than a second across a 60-second round.
 */
export function FastMathGame({
  round,
  onFinish,
}: {
  round: FastMathRound;
  onFinish: (score: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [entry, setEntry] = useState("");
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [feedback, setFeedback] = useState<"none" | "right" | "wrong">("none");

  const question = round.questions[index % round.questions.length];

  const finish = useCallback(() => onFinish(score), [onFinish, score]);

  const submit = (value: string) => {
    if (value === "") return;

    if (Number(value) === question.answer) {
      const nextStreak = streak + 1;
      // Every fifth consecutive answer raises the value of each subsequent one, capped at 4x so a
      // long streak rewards consistency without letting one run decide the whole tournament.
      const points = Math.min(4, 1 + Math.floor(nextStreak / 5));
      setScore((s) => s + points);
      setStreak(nextStreak);
      setFeedback("right");
    } else {
      setStreak(0);
      setFeedback("wrong");
    }

    setEntry("");
    setIndex((i) => i + 1);
    setTimeout(() => setFeedback("none"), 160);
  };

  const press = (key: string) => {
    if (key === "clear") {
      setEntry("");
      return;
    }
    if (key === "enter") {
      submit(entry);
      return;
    }
    if (entry.length >= 6) return;
    setEntry((e) => (e === "0" ? key : e + key));
  };

  const multiplier = Math.min(4, 1 + Math.floor(streak / 5));

  return (
    <GameShell
      title="Fast Math"
      tagline="Answer as many as you can. Five in a row raises your multiplier."
      score={score}
      onExpire={finish}
    >
      <div
        className={`border-line bg-paper-raised flex flex-col items-center gap-2 rounded-3xl border py-6 ${
          feedback === "wrong" ? "animate-shake" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          {streak >= 5 ? (
            <span className="bg-vermilion-soft text-vermilion-dark rounded-full px-2 py-0.5 text-[11px] font-bold">
              {multiplier}× · {streak} streak
            </span>
          ) : (
            <span className="text-ink-faint text-[11px] font-semibold">
              {streak > 0 ? `${streak} in a row` : "Answer five in a row for a multiplier"}
            </span>
          )}
        </div>

        <div className="tabular text-4xl font-extrabold" aria-live="polite">
          {question.a} {question.op} {question.b}
        </div>

        <div
          className={`tabular flex h-12 min-w-[120px] items-center justify-center rounded-2xl border-2 px-4 text-3xl font-bold ${
            feedback === "right"
              ? "border-jade text-jade"
              : feedback === "wrong"
                ? "border-vermilion text-vermilion"
                : "border-line text-ink"
          }`}
        >
          {entry || <span className="text-ink-faint">?</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <Key key={k} onPress={() => press(k)}>
            {k}
          </Key>
        ))}
        <Key onPress={() => press("clear")} tone="muted">
          ⌫
        </Key>
        <Key onPress={() => press("0")}>0</Key>
        <Key onPress={() => press("enter")} tone="accent">
          ✓
        </Key>
      </div>
    </GameShell>
  );
}

function Key({
  children,
  onPress,
  tone = "plain",
}: {
  children: React.ReactNode;
  onPress: () => void;
  tone?: "plain" | "accent" | "muted";
}) {
  const tones = {
    plain: "bg-paper-raised border-line text-ink active:bg-line",
    accent: "bg-vermilion border-vermilion text-white active:bg-vermilion-dark",
    muted: "bg-paper-raised border-line text-ink-soft active:bg-line",
  } as const;

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className={`tabular flex h-14 items-center justify-center rounded-2xl border text-2xl font-bold transition-colors ${tones[tone]}`}
    >
      {children}
    </button>
  );
}
