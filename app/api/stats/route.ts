import { NextResponse } from "next/server";
import { getStats } from "@/lib/server/indexer";
import { storeBackend } from "@/lib/server/store";

export const revalidate = 60;

/** Machine-readable feed behind /stats. Also handy for a Dune or Grafana pull. */
export async function GET() {
  const stats = await getStats();
  return NextResponse.json({ ...stats, scoreStore: storeBackend() });
}
