import "server-only";

/**
 * Fixed-window rate limiting for the score endpoint.
 *
 * In-process, so it is per-instance rather than global. That is a deliberate MVP trade-off: the
 * real defence against a fabricated score is the `maxPlausibleScore` ceiling and the
 * "must have joined" check in the contract, not this. The limiter exists to keep a single client
 * from hammering the endpoint.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(identifier: string, limit = 20, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(identifier);

  if (!existing || now >= existing.resetAt) {
    windows.set(identifier, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }

  // Opportunistic cleanup so the map cannot grow without bound in a long-lived instance.
  if (windows.size > 5_000) {
    for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k);
  }

  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Best-effort client key: the forwarded IP, falling back to a constant. */
export function clientKey(request: Request, suffix = ""): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip");
  return `${forwarded || real || "unknown"}:${suffix}`;
}
