"use client";

import { useCallback, useState } from "react";
import { GameShell } from "./GameShell";
import { Pill } from "../ui";
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
        className={`plate bevel bg-panel flex flex-col items-center gap-2 py-5 ${
          feedback === "wrong" ? "animate-shake" : ""
        }`}
      >
        {streak >= 5 ? (
          <Pill tone="gold">
            {multiplier}× · {streak} streak
          </Pill>
        ) : (
          <span className="text-ink-soft text-[11px] font-black uppercase">
            {streak > 0 ? `${streak} in a row` : "Five in a row for a multiplier"}
          </span>
        )}

        <div className="tabular text-5xl font-black" aria-live="polite">
          {question.a} {question.op} {question.b}
        </div>

        <div
          className={`plate tabular flex h-14 min-w-30 items-center justify-center px-4 text-3xl font-black ${
            feedback === "right"
              ? "bg-lime text-white"
              : feedback === "wrong"
                ? "bg-cherry text-white"
                : "bg-panel-sunk text-ink"
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
    plain: "bg-panel-raised text-ink",
    accent: "bg-lime text-white",
    muted: "bg-panel-sunk text-ink-soft",
  } as const;

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className={`plate bevel pressable no-select tabular flex h-15 items-center justify-center text-2xl font-black ${tones[tone]}`}
    >
      {children}
    </button>
  );
}
