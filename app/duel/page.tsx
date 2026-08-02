import { Suspense } from "react";
import { DuelScreen } from "@/components/DuelScreen";
import { Spinner } from "@/components/ui";

export const metadata = {
  title: "Clash — Duels",
  description: "Challenge a friend to a 60-second skill duel. Same board, winner takes the pot.",
};

/** `?duel=<id>` is the invite link a challenger shares. */
export default async function DuelPage({
  searchParams,
}: {
  searchParams: Promise<{ duel?: string }>;
}) {
  const { duel } = await searchParams;
  const parsed = Number(duel);
  const initialDuelId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner label="Loading duel…" />
        </div>
      }
    >
      <DuelScreen initialDuelId={initialDuelId} />
    </Suspense>
  );
}
