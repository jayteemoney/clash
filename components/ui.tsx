import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Shared primitives, in the casual arcade style: thick outlines, chunky radii and a hard bottom
 * bevel so every control reads as a physical object that travels when pressed.
 *
 * Every interactive target is at least 44px tall — this is a thumb-first app.
 */

type Variant = "primary" | "secondary" | "ghost" | "go" | "gold";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-cherry text-white active:bg-cherry-dark",
  secondary: "bg-sky text-white active:bg-sky-dark",
  ghost: "bg-panel text-ink active:bg-panel-sunk",
  go: "bg-lime text-white active:bg-lime-dark",
  gold: "bg-gold text-ink active:bg-gold-dark",
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
      className={`plate bevel pressable no-select flex min-h-[54px] w-full items-center justify-center gap-2 px-5 text-base font-black tracking-tight uppercase disabled:translate-y-[4px] disabled:cursor-not-allowed disabled:bg-ink-faint disabled:shadow-[0_1px_0_0_var(--color-outline)] ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`plate bevel bg-panel text-ink p-4 ${className}`}>{children}</div>;
}

/**
 * Menu header in the shape of a fabric canopy — the awning from the asset pack. The scalloped
 * lower edge is an SVG so it stays crisp at any width, and the whole thing is one element the
 * screens can drop above a section.
 */
export function Banner({ children, tone = "cherry" }: { children: ReactNode; tone?: "cherry" | "sky" | "grape" }) {
  const tones = {
    cherry: { fill: "var(--color-cherry)", stripe: "var(--color-cherry-dark)" },
    sky: { fill: "var(--color-sky)", stripe: "var(--color-sky-dark)" },
    grape: { fill: "var(--color-grape)", stripe: "#7a3fd1" },
  } as const;
  const { fill, stripe } = tones[tone];

  return (
    <div className="relative">
      <div
        className="plate bevel relative z-10 flex min-h-[52px] items-center justify-center px-6 text-center"
        style={{ backgroundColor: fill }}
      >
        {/* Awning stripes, drawn as a repeating gradient rather than an image. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[1.05rem] opacity-30"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, ${stripe} 0 14px, transparent 14px 28px)`,
          }}
        />
        <span className="titled relative text-lg text-white">{children}</span>
      </div>
      {/* Scalloped hem, hanging below the canopy. */}
      <svg
        className="relative z-0 -mt-1 w-full"
        height="14"
        viewBox="0 0 120 14"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M0 0h120v3c-10 0-10 8-20 8S90 3 80 3 70 11 60 11 50 3 40 3 30 11 20 11 10 3 0 3Z"
          fill={fill}
          stroke="var(--color-outline)"
          strokeWidth="2.5"
        />
      </svg>
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "hot" | "good" | "gold";
}) {
  const tones = {
    neutral: "bg-panel text-ink",
    hot: "bg-cherry text-white",
    good: "bg-lime text-white",
    gold: "bg-gold text-ink",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-[2.5px] border-outline px-3 py-1 text-xs font-black uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A square cell from the pack — sunken, outlined, used for the numbers that matter. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="plate bg-panel-sunk flex flex-col items-center gap-0.5 rounded-2xl px-1 py-2 text-center">
      <span className="text-ink-soft text-[10px] font-black tracking-wide uppercase">{label}</span>
      <span className="tabular text-xl leading-none font-black">{value}</span>
      {hint ? <span className="text-ink-faint text-[10px] font-bold">{hint}</span> : null}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="text-ink inline-flex items-center gap-2 text-sm font-black uppercase">
      <span
        className="border-outline border-t-cherry inline-block h-5 w-5 animate-spin rounded-full border-[3px]"
        aria-hidden
      />
      {label}
    </span>
  );
}

/** Rating stars from the pack. Used to show payout rank at a glance. */
export function Stars({ count, of = 3 }: { count: number; of?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${count} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <Star key={i} filled={i < count} />
      ))}
    </span>
  );
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5Z"
        fill={filled ? "var(--color-gold)" : "transparent"}
        stroke="var(--color-outline)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Icons from the pack, drawn inline. Only the ones the app actually uses — an hourglass for the
 * clock, a bomb for the last ten seconds, a trophy for standings, a check and a cross for answers.
 */
export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="var(--color-outline)"
      strokeWidth="2.5"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}

export type IconName = "hourglass" | "bomb" | "trophy" | "check" | "cross" | "swords" | "coin";

const PATHS: Record<IconName, ReactNode> = {
  hourglass: (
    <>
      <path d="M6 2h12M6 22h12" />
      <path d="M8 2v4l4 6 4-6V2M8 22v-4l4-6 4 6v4" fill="var(--color-gold)" />
    </>
  ),
  bomb: (
    <>
      <circle cx="11" cy="15" r="6.5" fill="var(--color-ink)" />
      <path d="M16 9l2-2M18 7c1-2 3-2 3-4" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" fill="var(--color-gold)" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
      <path d="M10 20h4M12 14v6" />
    </>
  ),
  check: <path d="M4 13l5 5L20 6" stroke="var(--color-lime)" strokeWidth="3.5" />,
  cross: <path d="M6 6l12 12M18 6L6 18" stroke="var(--color-cherry)" strokeWidth="3.5" />,
  swords: (
    <>
      <path d="M3 3l9 9M21 3l-9 9" />
      <path d="M12 12l4 9M12 12l-4 9" fill="var(--color-sky)" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" fill="var(--color-gold)" />
      <path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" />
    </>
  ),
};
