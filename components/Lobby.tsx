"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { AppHeader } from "./AppHeader";
import { Countdown } from "./Countdown";
import { Leaderboard } from "./Leaderboard";
import { GamePlayer } from "./games/GamePlayer";
import { Button, Card, Pill, Spinner, Stat } from "./ui";
import { useMiniPay } from "@/hooks/useMiniPay";
import { useTournament } from "@/hooks/useTournament";
import { GAME_META } from "@/lib/games";
import { practiceSeed } from "@/lib/rng";
import { joinTournament } from "@/lib/clash";
import { DEFAULT_TOKEN } from "@/lib/tokens";
import { canAfford } from "@/lib/stablecoins";
import { DEEPLINKS, goDeposit } from "@/lib/minipay";
import { PLAYER_SHARE_PCT } from "@/lib/config";
import { explorerTxUrl } from "@/lib/contracts";

type Screen =
  | { name: "lobby" }
  | { name: "playing"; mode: "practice" | "ranked"; seed: string }
  | { name: "result"; mode: "practice" | "ranked"; score: number; rank?: number; total?: number };

export function Lobby() {
  const wallet = useMiniPay();
  const { tournament, loading, refresh } = useTournament();

  const [screen, setScreen] = useState<Screen>({ name: "lobby" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [entryTx, setEntryTx] = useState<string | null>(null);
  const [practiceRound, setPracticeRound] = useState(0);
  const [entered, setEntered] = useState(false);

  const meta = tournament ? GAME_META[tournament.gameId] : null;

  const playFree = () => {
    if (!tournament) return;
    setPracticeRound((n) => n + 1);
    setScreen({ name: "playing", mode: "practice", seed: practiceSeed(tournament.gameId, practiceRound) });
  };

  const enter = async () => {
    if (!tournament?.id || !wallet.address) return;
    setNotice(null);

    const entryAmount = BigInt(tournament.entryAmount);

    // Zero balance is a deposit prompt, never an error. MiniPay listing rule.
    if (wallet.needsDeposit) {
      goDeposit();
      return;
    }
    if (!canAfford(wallet.balances, DEFAULT_TOKEN, entryAmount)) {
      goDeposit();
      return;
    }

    setBusy("Entering…");
    try {
      const steps = await joinTournament(wallet.address, BigInt(tournament.id), DEFAULT_TOKEN, entryAmount);
      setEntryTx(steps[steps.length - 1].hash);
      setEntered(true);
      await Promise.all([refresh(), wallet.refresh()]);
      setScreen({ name: "playing", mode: "ranked", seed: tournament.seed });
    } catch (error) {
      setNotice(readableError(error));
    } finally {
      setBusy(null);
    }
  };

  const finishRound = useCallback(
    async (score: number) => {
      const mode = screen.name === "playing" ? screen.mode : "practice";

      if (mode === "practice" || !tournament?.id || !wallet.address) {
        setScreen({ name: "result", mode: "practice", score });
        return;
      }

      setScreen({ name: "result", mode: "ranked", score });

      try {
        const response = await fetch("/api/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tournamentId: tournament.id,
            address: wallet.address,
            score,
            gameId: tournament.gameId,
          }),
        });
        const body = (await response.json()) as { rank?: number; total?: number; error?: string };
        if (!response.ok) {
          setNotice(body.error ?? "Your score could not be recorded.");
          return;
        }
        setScreen({ name: "result", mode: "ranked", score, rank: body.rank, total: body.total });
      } catch {
        setNotice("Your score could not be recorded. Check your connection and try again.");
      }
    },
    [screen, tournament, wallet.address],
  );

  // ---------------------------------------------------------------- playing
  if (screen.name === "playing" && tournament) {
    return (
      <main className="pb-6">
        <AppHeader wallet={wallet} />
        {screen.mode === "practice" ? (
          <div className="px-4 pb-2">
            <Pill>Free practice — no entry, no prize</Pill>
          </div>
        ) : null}
        <GamePlayer gameId={tournament.gameId} seed={screen.seed} onFinish={finishRound} />
      </main>
    );
  }

  // ----------------------------------------------------------------- result
  if (screen.name === "result") {
    return (
      <main className="flex flex-col gap-4 px-4 pb-6">
        <AppHeader wallet={wallet} />

        <Card className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">
            {screen.mode === "practice" ? "Practice score" : "Your score"}
          </span>
          <span className="tabular text-5xl font-extrabold">{screen.score}</span>
          {screen.mode === "ranked" && screen.rank ? (
            <span className="text-ink-soft text-sm font-semibold">
              Currently {ordinal(screen.rank)} of {screen.total}
            </span>
          ) : null}
          {screen.mode === "practice" ? (
            <span className="text-ink-faint text-sm">Practice rounds are never ranked and never cost anything.</span>
          ) : null}
        </Card>

        {notice ? <NoticeBox message={notice} /> : null}

        {entryTx && screen.mode === "ranked" ? (
          <a
            href={DEEPLINKS.receipt(entryTx)}
            className="border-line bg-paper-raised flex min-h-[52px] items-center justify-center rounded-2xl border text-sm font-semibold"
          >
            View entry receipt
          </a>
        ) : null}

        <div className="flex flex-col gap-2">
          {screen.mode === "practice" ? (
            <Button onClick={playFree}>Practise again</Button>
          ) : (
            <Button variant="secondary" onClick={() => setScreen({ name: "lobby" })}>
              Back to the arena
            </Button>
          )}
          {screen.mode === "practice" ? (
            <Button variant="ghost" onClick={() => setScreen({ name: "lobby" })}>
              Back to the arena
            </Button>
          ) : null}
        </div>

        <section>
          <h2 className="mb-2 text-sm font-extrabold tracking-wide uppercase">This hour</h2>
          <Leaderboard tournamentId={tournament?.id ?? null} highlightAlias={wallet.identity?.displayName} />
        </section>
      </main>
    );
  }

  // ------------------------------------------------------------------ lobby
  return (
    <main className="flex flex-col gap-4 px-4 pb-6">
      <AppHeader wallet={wallet} />

      {!wallet.loading && !wallet.inMiniPay ? <OutsideMiniPayNotice /> : null}

      {loading || !tournament || !meta ? (
        <Card className="flex justify-center py-10">
          <Spinner label="Loading this hour's tournament…" />
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-ink text-paper flex h-9 w-9 items-center justify-center rounded-xl text-sm font-extrabold">
                    {meta.emoji}
                  </span>
                  <div>
                    <h1 className="text-xl leading-tight font-extrabold">{meta.name}</h1>
                    <p className="text-ink-faint text-xs">{meta.tagline}</p>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">Closes in</div>
                <div className="text-xl">
                  <Countdown endTime={tournament.endTime} onExpire={refresh} />
                </div>
              </div>
            </div>

            <p className="border-line text-ink-soft rounded-2xl border border-dashed px-3 py-2 text-xs leading-relaxed">
              Everyone entering this hour plays the <strong>same board</strong>. No luck involved — the
              highest scores take the prize pool.
            </p>

            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="Prize pool"
                value={`${formatUnits(BigInt(tournament.pot), tournament.token.decimals)}`}
                hint={tournament.token.symbol}
              />
              <Stat label="Entry" value={tournament.entryPrice} hint={tournament.token.symbol} />
              <Stat label="Players" value={tournament.players} hint="this hour" />
            </div>
          </Card>

          {notice ? <NoticeBox message={notice} /> : null}

          <div className="flex flex-col gap-2">
            {tournament.playable && wallet.address && !entered ? (
              <Button onClick={enter} disabled={Boolean(busy)}>
                {busy ?? `Enter for ${tournament.entryPrice} ${tournament.token.symbol}`}
              </Button>
            ) : null}

            {tournament.playable && wallet.address && entered ? (
              <Button onClick={() => setScreen({ name: "playing", mode: "ranked", seed: tournament.seed })}>
                Play your round
              </Button>
            ) : null}

            <Button variant={wallet.address && tournament.playable ? "ghost" : "primary"} onClick={playFree}>
              Play free
            </Button>
          </div>

          {tournament.playable ? (
            <p className="text-ink-faint px-1 text-xs leading-relaxed">
              Entering costs {tournament.entryPrice} {tournament.token.symbol} plus a small network fee, both
              paid in your stablecoin. {PLAYER_SHARE_PCT}% of the pool goes to the top three scores; the rest
              runs the arena.
            </p>
          ) : (
            <p className="text-ink-faint px-1 text-xs leading-relaxed">
              Paid tournaments are not running right now, but free practice always works.
            </p>
          )}

          {wallet.needsDeposit ? <DepositPrompt /> : null}

          <Link
            href="/duel"
            className="border-line bg-paper-raised flex min-h-[52px] items-center justify-between rounded-2xl border px-4"
          >
            <span className="text-sm font-semibold">Challenge a friend to a duel</span>
            <span className="text-vermilion text-sm font-bold">→</span>
          </Link>

          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-extrabold tracking-wide uppercase">Live standings</h2>
              {tournament.id ? <span className="text-ink-faint text-xs">#{tournament.id}</span> : null}
            </div>
            <Leaderboard tournamentId={tournament.id} highlightAlias={wallet.identity?.displayName} />
          </section>

          {entryTx ? (
            <a
              href={explorerTxUrl(entryTx)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-faint px-1 text-xs underline underline-offset-2"
            >
              View your entry on the block explorer
            </a>
          ) : null}
        </>
      )}
    </main>
  );
}

function NoticeBox({ message }: { message: string }) {
  return (
    <div className="border-vermilion bg-vermilion-soft text-vermilion-dark animate-rise rounded-2xl border px-3 py-2 text-sm font-semibold">
      {message}
    </div>
  );
}

function DepositPrompt() {
  return (
    <div className="border-line bg-paper-raised flex flex-col gap-2 rounded-2xl border p-3">
      <p className="text-sm font-semibold">Your balance is empty.</p>
      <p className="text-ink-faint text-xs">
        Add a digital dollar balance to enter paid tournaments. Free practice keeps working either way.
      </p>
      <a
        href={DEEPLINKS.addCash}
        className="bg-vermilion active:bg-vermilion-dark flex min-h-[48px] items-center justify-center rounded-xl font-semibold text-white"
      >
        Deposit
      </a>
    </div>
  );
}

function OutsideMiniPayNotice() {
  return (
    <div className="border-line bg-paper-raised rounded-2xl border p-3">
      <p className="text-sm font-semibold">Open Clash in MiniPay to play for prizes.</p>
      <p className="text-ink-faint mt-1 text-xs">
        You can practise here in any browser. Entering a tournament needs the MiniPay app.
      </p>
    </div>
  );
}

function ordinal(n: number) {
  const suffix = ["th", "st", "nd", "rd"][((n % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][n % 100] ?? "th";
  return `${n}${suffix}`;
}

/** Turns a chain or wallet failure into something a player can act on. */
function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/user rejected|denied/i.test(message)) return "You cancelled the transaction.";
  if (/insufficient/i.test(message)) return "Not enough balance to cover the entry and network fee.";
  if (/AlreadyJoined/i.test(message)) return "You are already entered in this tournament.";
  if (/TournamentClosed/i.test(message)) return "This tournament just closed. The next one is already open.";
  return "That did not go through. Please try again.";
}
