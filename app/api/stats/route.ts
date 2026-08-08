import { NextResponse } from "next/server";
import { getStats } from "@/lib/server/indexer";
import { storeHealth } from "@/lib/server/store";

export const revalidate = 60;

/**
 * Machine-readable feed behind /stats. Also handy for a Dune or Grafana pull.
 *
 * `scoreStoreHealthy` is the field worth alerting on: `scoreStore: "redis"` only says Redis is
 * configured, while `false` here means score writes are failing right now.
 */
export async function GET() {
  const stats = await getStats();
  const store = await storeHealth();
  return NextResponse.json({
    ...stats,
    scoreStore: store.backend,
    scoreStoreHealthy: store.reachable,
    scoreStoreDetail: store.detail,
  });
}
