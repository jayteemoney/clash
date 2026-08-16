"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits, parseUnits } from "viem";
import { AppHeader } from "./AppHeader";
import { Countdown } from "./Countdown";
import { Leaderboard } from "./Leaderboard";
import { GamePlayer } from "./games/GamePlayer";
import { Button, Card, Pill, Spinner, Stat } from "./ui";
import { useMiniPay } from "@/hooks/useMiniPay";
import {
  DUEL_DEADLINE_SECONDS,
  DUEL_STATUS_ACCEPTED,
  acceptDuel,
  cancelDuel,
  createDuel,
  readDuel,
  type DuelOnChain,
} from "@/lib/clash";
import { DEFAULT_TOKEN } from "@/lib/tokens";
import { canAfford } from "@/lib/stablecoins";
import { DEEPLINKS, goDeposit } from "@/lib/minipay";
import { DUEL_STAKES, PLAYER_SHARE_PCT } from "@/lib/config";
import { CLASH_ADDRESS, explorerTxUrl } from "@/lib/contracts";
import { GAME_META } from "@/lib/games";
import { duelSeed } from "@/lib/rng";
import { currentWindow, gameForDuel, gameForWindow } from "@/lib/tournament";
import { aliasFor } from "@/lib/identity";
import { track } from "@/lib/analytics";

/**
 * 1v1 duels. Both sides stake the same amount, both play the board seeded from the duel id, and
 * the winner takes the pot less the same rake the tournaments charge.
 *
 * The invite is just a link carrying `?duel=<id>`. Sharing goes through MiniPay's invite deeplink,
 * which is the highest-intent surface a player has for pulling a friend in.
 */
export function DuelScreen({ initialDuelId }: { initialDuelId: number | null }) {
  const wallet = useMiniPay();

  const [duelId, setDuelId] = useState<number | null>(initialDuelId);
  const [duel, setDuel] = useState<DuelOnChain | null>(null);
  const [stake, setStake] = useState<string>(DUEL_STAKES[0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [result, setResult] = useState<DuelResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A duel plays the game of the hour it was accepted in, and keeps it for the duel's whole life.
  // Reading the current hour instead would let the rotation change the game out from under a duel
  // that is still in play — the two sides could be dealt different boards, and a score submitted
  // after the boundary would be rejected as the wrong game. Until someone accepts, there is no
  // accepted hour yet, so a duel being created previews the current hour's game.
  const gameId = duel?.status === DUEL_STATUS_ACCEPTED ? gameForDuel(duel.acceptedAt) : gameForWindow(currentWindow().start);
  const meta = GAME_META[gameId];

  const load = useCallback(async () => {
    if (!duelId || !CLASH_ADDRESS) return;
    try {
      setDuel(await readDuel(BigInt(duelId)));
    } catch {
      setNotice("That duel could not be found.");
    }
  }, [duelId]);

  useEffect(() => {
    if (!duelId || !CLASH_ADDRESS) return;
    let cancelled = false;

    const read = async () => {
      try {
        const found = await readDuel(BigInt(duelId));
        if (!cancelled) setDuel(found);
      } catch {
        if (!cancelled) setNotice("That duel could not be found.");
      }
    };

    void read();
    return () => {
      cancelled = true;
    };
  }, [duelId]);

  const create = async () => {
    if (!wallet.address) return;
    setNotice(null);

    const amount = parseUnits(stake, DEFAULT_TOKEN.decimals);
    if (wallet.needsDeposit || !canAfford(wallet.balances, DEFAULT_TOKEN, amount)) {
      track("deposit_prompted", { reason: "duel_create" });
      goDeposit();
      return;
    }

    setBusy("Creating…");
    try {
      const { steps, duelId: created } = await createDuel(wallet.address, DEFAULT_TOKEN, amount);
      setLastTx(steps[steps.length - 1].hash);
      await wallet.refresh();

      if (created !== null) {
        track("duel_created", { stake });
        setDuelId(Number(created));
        setNotice(null);
      } else {
        setNotice("Duel created, but the invite link could not be read. Refresh and check your duels.");
      }
    } catch (error) {
      setNotice(readableError(error));
    } finally {
      setBusy(null);
    }
  };

  const accept = async () => {
    if (!wallet.address || !duel || !duelId) return;
    setNotice(null);

    if (wallet.needsDeposit || !canAfford(wallet.balances, DEFAULT_TOKEN, duel.stake)) {
      track("deposit_prompted", { reason: "duel_accept" });
      goDeposit();
      return;
    }

    setBusy("Accepting…");
    try {
      const steps = await acceptDuel(wallet.address, BigInt(duelId), DEFAULT_TOKEN, duel.stake);
      setLastTx(steps[steps.length - 1].hash);
      track("duel_accepted", { stake: formatUnits(duel.stake, DEFAULT_TOKEN.decimals) });
      await Promise.all([load(), wallet.refresh()]);
    } catch (error) {
      setNotice(readableError(error));
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async () => {
    if (!wallet.address || !duelId) return;
    setBusy("Withdrawing…");
    try {
      const step = await cancelDuel(wallet.address, BigInt(duelId), DEFAULT_TOKEN);
      setLastTx(step.hash);
      await Promise.all([load(), wallet.refresh()]);
    } catch (error) {
      setNotice(readableError(error));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Sends the round's score to the settler. The duel resolves the moment the second player's score
   * lands, so the response can already carry the outcome.
   */
  const submitScore = async (value: number) => {
    setScore(value);
    setPlaying(false);
    track("round_finished", { game: gameId, mode: "duel", score: value });

    if (!duelId || !wallet.address) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/duel/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duelId, address: wallet.address, score: value, gameId }),
      });
      const body = (await response.json()) as DuelResult & { error?: string };

      if (!response.ok) {
        setNotice(body.error ?? "Your score could not be recorded.");
        return;
      }

      // Status only. `outcome.winner` is an address; the redaction in lib/analytics would catch it,
      // but the guard is not a licence to send one.
      if (body.outcome) track("duel_finished", { status: body.outcome.status });

      setResult(body);
      await Promise.all([load(), wallet.refresh()]);
    } catch {
      setNotice("Your score could not be sent. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (playing) {
    return (
      <main className="pb-6">
        <AppHeader wallet={wallet} />
        <GamePlayer gameId={gameId} seed={duelSeed(duelId ?? 0, gameId)} onFinish={submitScore} />
      </main>
    );
  }

  const shareUrl =
    typeof window !== "undefined" && duelId ? `${window.location.origin}/duel?duel=${duelId}` : "";

  return (
    <main className="flex flex-col gap-4 px-4 pb-6">
      <AppHeader wallet={wallet} />

      <div className="flex items-center justify-between">
        <h1 className="titled text-gold text-2xl">Duels</h1>
        <Link href="/" className="text-panel text-sm font-black uppercase underline underline-offset-2">
          Back to the arena
        </Link>
      </div>

      <Card className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="plate bevel-sm bg-grape flex h-10 w-10 items-center justify-center rounded-xl text-base">
            {meta.emoji}
          </span>
          <div>
            <p className="text-sm font-bold">
              {duel?.status === DUEL_STATUS_ACCEPTED ? "This duel" : "Right now"}: {meta.name}
            </p>
            <p className="text-ink-faint text-xs">Both players get the same board. Highest score wins the pot.</p>
          </div>
        </div>
        <p className="text-ink-faint text-xs">
          Winner takes {PLAYER_SHARE_PCT}% of the combined stake. The rest runs the arena.
        </p>
      </Card>

      {notice ? (
        <div className="plate bevel-sm bg-cherry px-3 py-2 text-sm font-black text-white">
          {notice}
        </div>
      ) : null}

      {score !== null ? (
        <Card className="flex flex-col items-center gap-1 py-6 text-center">
          <span className="text-ink-soft text-[11px] font-black tracking-wide uppercase">Your duel score</span>
          <span className="tabular text-5xl font-black">{score}</span>
          {submitting ? (
            <Spinner label="Sending your score…" />
          ) : (
            <DuelResultLine result={result} you={wallet.address} />
          )}
        </Card>
      ) : null}

      {duelId && duel ? (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="titled text-panel text-base">Duel #{duelId}</h2>
            <Pill tone={duel.status === 2 ? "good" : duel.status === 1 ? "hot" : "neutral"}>
              {["Not found", "Waiting for an opponent", "In play", "Paid out", "Withdrawn"][duel.status]}
            </Pill>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Stake each"
              value={formatUnits(duel.stake, DEFAULT_TOKEN.decimals)}
              hint={DEFAULT_TOKEN.symbol}
            />
            <Stat
              label="Pot"
              value={formatUnits(duel.stake * 2n, DEFAULT_TOKEN.decimals)}
              hint={DEFAULT_TOKEN.symbol}
            />
          </div>

          <div className="text-ink-soft flex flex-col gap-1 text-xs">
            <span>
              Challenger: <strong>{aliasFor(duel.creator)}</strong>
            </span>
            {duel.status >= 2 ? (
              <span>
                Opponent: <strong>{aliasFor(duel.opponent)}</strong>
              </span>
            ) : null}
          </div>

          {duel.status === 1 && wallet.address?.toLowerCase() !== duel.creator.toLowerCase() ? (
            <Button onClick={accept} disabled={Boolean(busy)}>
              {busy ?? `Accept for ${formatUnits(duel.stake, DEFAULT_TOKEN.decimals)} ${DEFAULT_TOKEN.symbol}`}
            </Button>
          ) : null}

          {duel.status === 1 && wallet.address?.toLowerCase() === duel.creator.toLowerCase() ? (
            <>
              <ShareRow url={shareUrl} />
              <Button variant="ghost" onClick={withdraw} disabled={Boolean(busy)}>
                {busy ?? "Withdraw and get your stake back"}
              </Button>
            </>
          ) : null}

          {duel.status === 2 ? (
            <>
              {/* Players are on a clock from the moment the duel is accepted, and nothing used to
                  say so. Miss it and the stake is refunded rather than lost, but finding that out
                  by surprise is not the experience. */}
              <div className="plate bg-panel-sunk flex items-center justify-between px-3 py-2">
                <span className="text-ink-soft text-xs font-black uppercase">Time left to play your round</span>
                <Countdown endTime={duel.acceptedAt + DUEL_DEADLINE_SECONDS} onExpire={load} />
              </div>
              <Button
                onClick={() => {
                  track("round_started", { game: gameId, mode: "duel" });
                  setPlaying(true);
                }}
                disabled={score !== null}
              >
                {score !== null ? "Round played" : "Play your round"}
              </Button>
            </>
          ) : null}
        </Card>
      ) : null}

      {!duelId ? (
        <Card className="flex flex-col gap-3">
          <h2 className="titled text-panel text-base">Start a duel</h2>

          <div className="grid grid-cols-3 gap-2">
            {DUEL_STAKES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStake(option)}
                className={`plate no-select tabular min-h-13 text-base font-black ${
                  stake === option ? "bevel-press bg-cherry text-white" : "bevel pressable bg-panel-raised text-ink"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          {wallet.address ? (
            <Button onClick={create} disabled={Boolean(busy)}>
              {busy ?? `Stake ${stake} ${DEFAULT_TOKEN.symbol}`}
            </Button>
          ) : (
            <p className="text-ink-faint text-xs">Open Clash in MiniPay to create a duel.</p>
          )}

          <p className="text-panel/80 text-xs leading-relaxed font-semibold">
            Your stake is held until the duel is settled. If nobody accepts, withdraw it and it comes
            straight back.
          </p>
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDuelId(null);
            setDuel(null);
            setScore(null);
          }}
          className="text-panel/80 text-xs font-bold underline underline-offset-2"
        >
          Start a different duel
        </button>
      )}

      {lastTx ? (
        <a
          href={explorerTxUrl(lastTx)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-panel/80 text-xs font-bold underline underline-offset-2"
        >
          View the last transaction on the block explorer
        </a>
      ) : null}

      {duelId ? (
        <section>
          <h2 className="titled text-panel mb-2 text-base">This hour&rsquo;s arena</h2>
          <Leaderboard tournamentId={null} />
        </section>
      ) : null}

      {wallet.loading ? <Spinner label="Checking your wallet…" /> : null}
    </main>
  );
}

interface DuelResult {
  submitted: number;
  opponentPlayed: boolean;
  outcome: { status: string; winner?: string; txHash?: string } | null;
  scores: { alias: string; score: number }[];
}

/**
 * What the player is told after a round. The wording tracks the actual state rather than promising
 * a payout that may not have happened yet: a duel only resolves once both scores are in, or once
 * the deadline passes and the hourly sweep picks it up.
 */
function DuelResultLine({ result, you }: { result: DuelResult | null; you: `0x${string}` | null }) {
  if (!result) {
    return <span className="text-ink-faint text-xs">Score recorded.</span>;
  }

  if (!result.opponentPlayed) {
    return (
      <span className="text-ink-faint text-xs">
        Waiting for your opponent. They have an hour from accepting; if they never play, the pot is
        yours automatically.
      </span>
    );
  }

  const outcome = result.outcome;

  if (outcome?.status === "settled") {
    const won = you && outcome.winner?.toLowerCase() === you.toLowerCase();
    return (
      <div className="flex flex-col items-center gap-1">
        <span className={`text-sm font-black ${won ? "text-lime-dark" : "text-ink-soft"}`}>
          {won ? "You won the duel." : "Your opponent took this one."}
        </span>
        {outcome.txHash ? (
          <a href={DEEPLINKS.receipt(outcome.txHash)} className="text-cherry-dark text-xs font-black underline">
            View the payout receipt
          </a>
        ) : null}
      </div>
    );
  }

  if (outcome?.status === "voided") {
    return <span className="text-ink-faint text-xs">Nobody completed this duel. Both stakes were returned.</span>;
  }

  return (
    <span className="text-ink-faint text-xs">
      Both scores are in. The payout settles in a moment — check back shortly.
    </span>
  );
}

function ShareRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="plate bg-panel-sunk flex items-center gap-2 rounded-xl px-3 py-2">
        <span className="text-ink-soft flex-1 truncate text-xs font-semibold">{url}</span>
        <button type="button" onClick={copy} className="text-cherry-dark text-xs font-black uppercase">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <a
        href={DEEPLINKS.inviteFriends}
        className="plate bevel pressable bg-panel flex min-h-12 items-center justify-center text-sm font-black uppercase"
      >
        Invite a friend
      </a>
    </div>
  );
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/user rejected|denied/i.test(message)) return "You cancelled the transaction.";
  if (/insufficient/i.test(message)) return "Not enough balance to cover the stake and network fee.";
  if (/CannotDuelSelf/i.test(message)) return "You cannot accept your own duel.";
  if (/DuelNotOpen/i.test(message)) return "Someone already took this duel.";
  return "That did not go through. Please try again.";
}
