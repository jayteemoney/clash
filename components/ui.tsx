import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Shared primitives. Every interactive target is at least 44px tall — this is a thumb-first app. */

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-vermilion text-white active:bg-vermilion-dark disabled:bg-ink-faint",
  secondary: "bg-ink text-paper active:bg-ink-soft disabled:bg-ink-faint",
  ghost: "bg-transparent text-ink border border-line active:bg-paper-raised",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border-line bg-paper-raised rounded-3xl border p-4 ${className}`}>{children}</div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "hot" | "good" }) {
  const tones = {
    neutral: "bg-paper-raised text-ink-soft border-line",
    hot: "bg-vermilion-soft text-vermilion-dark border-vermilion-soft",
    good: "bg-jade/10 text-jade border-jade/20",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">{label}</span>
      <span className="tabular text-xl font-bold">{value}</span>
      {hint ? <span className="text-ink-faint text-xs">{hint}</span> : null}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="text-ink-soft inline-flex items-center gap-2 text-sm">
      <span
        className="border-ink-faint border-t-vermilion inline-block h-4 w-4 animate-spin rounded-full border-2"
        aria-hidden
      />
      {label}
    </span>
  );
}
