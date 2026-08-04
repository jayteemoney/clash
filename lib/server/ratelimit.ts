import "server-only";

import { redis, storeBackend } from "./store";

/**
 * Fixed-window rate limiting for the score endpoints.
 *
 * Two backends, chosen the same way {@link storeBackend} chooses one:
 *   - Upstash Redis when it is configured. `INCR` + `EXPIRE` is atomic on the server, so the limit
 *     holds across every serverless instance — which is the only way it means anything on Vercel,
 *     where each lambda would otherwise enforce its own private quota.
 *   - An in-process Map otherwise, so `npm run dev` and the tests need no external service.
 *
 * This is defence in depth, not the main event: the real protection against a fabricated score is
 * the `maxPlausibleScore` ceiling and the contract's "must have joined" check. The limiter exists
 * to stop one client hammering the endpoint.
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

/**
 * In-process fixed window. Used directly when Redis is not configured, and as the fallback when a
 * Redis call fails — a limiter that is down must not take the whole endpoint down with it.
 */
function rateLimitInProcess(identifier: string, limit: number, windowMs: number): RateLimitResult {
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

/**
 * Records a hit and reports whether it is allowed.
 *
 * Async because the durable path is a network round trip. Callers must await it — the previous
 * synchronous version could only ever be per-instance.
 */
export async function rateLimit(identifier: string, limit = 20, windowMs = 60_000): Promise<RateLimitResult> {
  if (storeBackend() !== "redis") {
    return rateLimitInProcess(identifier, limit, windowMs);
  }

  const seconds = Math.ceil(windowMs / 1000);
  // Bucket the key by window so it expires naturally and a new window starts from zero, rather
  // than depending on EXPIRE landing before the next INCR.
  const key = `clash:rl:${identifier}:${Math.floor(Date.now() / windowMs)}`;

  try {
    const count = await redis<number>(["INCR", key]);
    // Only the first hit needs to arm the TTL; setting it every time would slide the window.
    if (count === 1) await redis(["EXPIRE", key, seconds]);

    if (count > limit) {
      const ttl = await redis<number>(["TTL", key]);
      return { allowed: false, remaining: 0, retryAfterSeconds: ttl > 0 ? ttl : seconds };
    }
    return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
  } catch {
    // Redis unreachable. Fall back to the local window rather than rejecting honest players —
    // failing open here is right, because the score ceiling is what actually guards the pot.
    return rateLimitInProcess(identifier, limit, windowMs);
  }
}

/** Best-effort client key: the forwarded IP, falling back to a constant. */
export function clientKey(request: Request, suffix = ""): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip");
  return `${forwarded || real || "unknown"}:${suffix}`;
}
