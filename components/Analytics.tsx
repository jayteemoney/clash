"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackPageview } from "@/lib/analytics";

/**
 * Records a screen view on every route change.
 *
 * The App Router never does a full page load after the first one, so PostHog's built-in pageview
 * listener would report a single screen per session and make every funnel look like a wall. This
 * watches the pathname instead.
 *
 * `usePathname` deliberately, not `useSearchParams`: the duel screen carries a duel id in the query
 * string, and there is no reason for it to leave the device. Reading search params here would also
 * opt the whole tree into client-side rendering.
 *
 * Renders nothing, and does nothing at all when analytics is unconfigured.
 */
export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    trackPageview(pathname);
  }, [pathname]);

  return null;
}
