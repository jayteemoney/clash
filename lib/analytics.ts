/**
 * Product analytics.
 *
 * MiniPay assesses a listing on DAU, MAU, retention and top countries, and none of those have a
 * source in on-chain data — /stats can only ever report what the contract saw. This is that source.
 *
 * Three constraints shaped it:
 *
 *   1. **It is anonymous, and stays that way.** The privacy policy promises "aggregate usage data —
 *      page views, country, and session counts". So no wallet address is ever sent, and no event
 *      carries one: {@link redact} strips anything address-shaped out of every property and URL on
 *      the way out, so a future `track()` call cannot quietly break that promise. PostHog's own
 *      random device id is the only identifier, which is all DAU/MAU/retention actually need.
 *   2. **It never costs the player a frame.** The client is imported dynamically and only after the
 *      first event, so it stays out of the entry bundle. Players on a slow connection are the whole
 *      audience; analytics must not be in front of the first board.
 *   3. **Unconfigured is a supported state.** With no key set every call is a no-op, exactly like
 *      the score store falling back to memory. `npm run dev` and the test suite need no account.
 *
 * Autocapture and session recording are both off. Autocapture would hoover up DOM text, and a
 * session recording inside a wallet app is not something to hold at all.
 */
import type { PostHog } from "posthog-js";

// Two spellings, for the same reason the score store reads two: the Vercel Marketplace integration
// injects NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, while PostHog's own docs and a hand-set key use
// NEXT_PUBLIC_POSTHOG_KEY. Both are written out literally because Next.js inlines NEXT_PUBLIC_*
// by static text replacement at build time — a computed lookup would resolve to nothing.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

/** Whether analytics is configured. Also the flag /stats reports. */
export const ANALYTICS_ENABLED = Boolean(KEY);

export type AnalyticsProps = Record<string, string | number | boolean | undefined>;

/**
 * Events. Kept as a closed union rather than free strings so a typo cannot silently create a
 * second, near-identical funnel step that nobody notices until the numbers are being read.
 */
export type AnalyticsEvent =
  | "round_started"
  | "round_finished"
  | "tournament_entered"
  | "deposit_prompted"
  | "duel_created"
  | "duel_accepted"
  | "duel_finished";

// Exactly 40 hex characters and no more. Without the trailing guard this also eats the first 40
// characters of a 64-character transaction hash and leaves the mangled tail behind — a hash is
// public and identifies nobody, so redacting it destroys useful data for no gain.
const ADDRESS = /0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;

/** Replaces anything address-shaped with a marker, at any depth inside a string. */
function redact<T>(value: T): T {
  if (typeof value === "string") return value.replace(ADDRESS, "[address]") as T;
  return value;
}

/**
 * Strips addresses out of every property of an event.
 *
 * Exported for the test suite: this function is the privacy policy's "aggregate usage data" promise
 * expressed as code, and it is the one part of analytics worth pinning down.
 */
export function sanitize(props?: AnalyticsProps): AnalyticsProps | undefined {
  if (!props) return undefined;
  const out: AnalyticsProps = {};
  for (const [k, v] of Object.entries(props)) out[k] = redact(v);
  return out;
}

let client: Promise<PostHog | null> | null = null;

/**
 * Resolves once the browser is not busy. Analytics is 75 KB gzipped competing for bandwidth on
 * phones that are the entire audience, so it waits until the board is dealt and the main thread is
 * free. The timeout is the floor: on a device that never goes idle it still loads, just late.
 */
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 5_000 });
    else setTimeout(resolve, 2_000);
  });
}

async function load(): Promise<PostHog | null> {
  if (!KEY || typeof window === "undefined") return null;

  try {
    await whenIdle();
    const { default: posthog } = await import("posthog-js");

    posthog.init(KEY, {
      api_host: HOST,
      // Pageviews are captured by hand: the App Router does not do a full navigation, so
      // PostHog's own listener would only ever see the first screen of a session.
      capture_pageview: false,
      capture_pageleave: true,
      // Reading the DOM is not needed to count players, and this app's DOM has balances in it.
      autocapture: false,
      disable_session_recording: true,
      // Anonymous people still get a profile — retention and DAU/MAU are computed over profiles,
      // and there is nothing personal in one when the only identifier is a random device id.
      person_profiles: "always",
      // Last line of defence for rule 1: everything outbound goes through the same redaction,
      // including the URLs PostHog collects on its own.
      sanitize_properties: (properties) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(properties)) out[k] = redact(v);
        return out;
      },
    });

    return posthog;
  } catch {
    // A blocked or failed analytics script must never take a game down with it.
    return null;
  }
}

function analytics(): Promise<PostHog | null> {
  client ??= load();
  return client;
}

/** Records an event. Safe to call anywhere, including when analytics is switched off. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!ANALYTICS_ENABLED) return;
  void analytics().then((posthog) => posthog?.capture(event, sanitize(props)));
}

/** Records a screen view. `path` only — never the query string, which carries duel ids. */
export function trackPageview(path: string): void {
  if (!ANALYTICS_ENABLED) return;
  void analytics().then((posthog) => posthog?.capture("$pageview", { $current_url: redact(path) }));
}
