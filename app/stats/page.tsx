import Link from "next/link";
import { getStats } from "@/lib/server/indexer";
import { storeBackend } from "@/lib/server/store";
import { explorerAddressUrl } from "@/lib/contracts";
import { APP_NAME } from "@/lib/config";

export const metadata = {
  title: "Clash — Stats",
  description: "Live on-chain activity for the Clash arena: entries, prize pools, fees and players.",
};

// Recomputed at most once a minute; the indexer caches on top of this.
export const revalidate = 60;

/**
 * Public stats. No wallet, no connection prompt — a reviewer or a player can open this cold.
 *
 * Everything here is read straight from chain logs rather than a private database, so the numbers
 * are independently checkable against the explorer link at the bottom.
 */
export default async function StatsPage() {
  const stats = await getStats();

  return (
    <main className="flex flex-col gap-4 px-4 pt-4 pb-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-extrabold">{APP_NAME} stats</h1>
        <Link href="/" className="text-ink-faint text-sm underline underline-offset-2">
          Back to the arena
        </Link>
      </div>

      {!stats.available ? (
        <div className="border-line bg-paper-raised rounded-2xl border p-4">
          <p className="text-sm font-semibold">Live numbers are not available yet.</p>
          <p className="text-ink-faint mt-1 text-xs">{stats.reason}</p>
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-2">
        <Tile label="Entries" value={stats.entries.toLocaleString()} hint="lifetime" />
        <Tile label="Unique players" value={stats.uniquePlayers.toLocaleString()} hint="distinct wallets" />
        <Tile label="Tournaments paid out" value={stats.tournamentsSettled.toLocaleString()} />
        <Tile label="Duels played" value={`${stats.duelsSettled} / ${stats.duelsCreated}`} hint="settled / created" />
      </section>

      <Panel title="Prize pool volume">
        <TokenRows rows={stats.potVolume} empty="No entries recorded yet." />
      </Panel>

      <Panel title="Paid out to players">
        <TokenRows rows={stats.paidToPlayers} empty="No payouts yet." />
      </Panel>

      <Panel title="Arena fees collected">
        <TokenRows rows={stats.rakeCollected} empty="No fees collected yet." />
      </Panel>

      <Panel title="Reliability">
        <dl className="flex flex-col gap-2 text-sm">
          <Row
            label="Failed transaction rate"
            value={
              stats.failedTxRate === null
                ? "Unavailable"
                : `${(stats.failedTxRate * 100).toFixed(2)}% of ${stats.txTotal?.toLocaleString()} transactions`
            }
          />
          <Row label="Network" value={stats.network} />
          <Row label="Score store" value={storeBackend() === "redis" ? "Durable" : "In-memory (development)"} />
          <Row label="Scanned to block" value={stats.scannedToBlock} />
        </dl>
      </Panel>

      {stats.entriesPerDay.length > 0 ? (
        <Panel title="Entries per day">
          <EntriesChart data={stats.entriesPerDay} />
        </Panel>
      ) : null}

      <div className="text-ink-faint flex flex-col gap-1 text-xs">
        <span>Updated {new Date(stats.generatedAt).toUTCString()}</span>
        {stats.contract ? (
          <a
            href={explorerAddressUrl(stats.contract)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Verify these numbers on the block explorer
          </a>
        ) : null}
        <span>
          Player counts, retention and top countries are tracked separately in the product analytics
          dashboard linked from the submission.
        </span>
      </div>
    </main>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-line bg-paper-raised rounded-2xl border p-3">
      <div className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">{label}</div>
      <div className="tabular mt-0.5 text-2xl font-extrabold">{value}</div>
      {hint ? <div className="text-ink-faint text-xs">{hint}</div> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-line bg-paper-raised rounded-2xl border p-4">
      <h2 className="mb-2 text-sm font-extrabold tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  );
}

function TokenRows({ rows, empty }: { rows: { symbol: string; amount: number }[]; empty: string }) {
  if (rows.length === 0) return <p className="text-ink-faint text-sm">{empty}</p>;

  return (
    <dl className="flex flex-col gap-2 text-sm">
      {rows.map((row) => (
        <Row
          key={row.symbol}
          label={row.symbol}
          value={row.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        />
      ))}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="tabular font-bold">{value}</dd>
    </div>
  );
}

/** A plain CSS bar chart — no charting library, so nothing is added to the bundle for one graph. */
function EntriesChart({ data }: { data: { date: string; entries: number }[] }) {
  const peak = Math.max(...data.map((d) => d.entries), 1);

  return (
    <div className="flex h-24 items-end gap-1" role="img" aria-label="Daily entries over the last 30 days">
      {data.map((day) => (
        <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={`${day.date}: ${day.entries}`}>
          <div
            className="bg-vermilion w-full rounded-t-sm"
            style={{ height: `${Math.max(4, (day.entries / peak) * 80)}px` }}
          />
        </div>
      ))}
    </div>
  );
}
