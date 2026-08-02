import Link from "next/link";
import { APP_NAME, PLAYER_SHARE_PCT, SUPPORT_URL } from "@/lib/config";

export const metadata = {
  title: "Clash — Terms of Service",
  description: "The terms that apply to using the Clash skill-tournament app.",
};

export default function TermsPage() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-4 pb-6 text-sm leading-relaxed">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-extrabold">Terms of Service</h1>
        <Link href="/" className="text-ink-faint text-sm underline underline-offset-2">
          Back
        </Link>
      </div>

      <p className="text-ink-faint text-xs">Last updated 1 August 2026.</p>

      <Section title="What Clash is">
        <p>
          {APP_NAME} is a skill-based tournament app. In each hourly tournament every entrant is
          dealt an identical game board, generated from the tournament&rsquo;s on-chain identifier.
          Placement is determined solely by how well you play that board. There is no element of
          chance in scoring, and no wagering on an uncertain outcome.
        </p>
      </Section>

      <Section title="Entering">
        <p>
          A free practice mode is always available and never requires a wallet or a payment. Entering
          a ranked tournament costs a fixed entry amount in a supported stablecoin, plus the network
          fee. Entries are final once confirmed on chain.
        </p>
      </Section>

      <Section title="Prizes">
        <p>
          {PLAYER_SHARE_PCT}% of each tournament&rsquo;s prize pool is distributed to the top-scoring
          entrants according to the published split. The remainder is retained to operate the arena.
          Duels follow the same split between the two players.
        </p>
      </Section>

      <Section title="How results are decided">
        <p>
          Games run on your device and your score is submitted to our settlement service, which ranks
          entrants and instructs the smart contract to pay out. The contract restricts settlement so
          that only entrants can be paid, never more than the pool, and never to the operator. We
          validate submitted scores against the board you were dealt and reject scores that board
          cannot produce. We are working towards fully verifiable, on-chain scoring; until then,
          ranking is operator-attested and this limitation is stated plainly in our public repository.
        </p>
      </Section>

      <Section title="Fair play">
        <p>
          Automated play, modified clients, and multiple accounts operated by one person are not
          permitted. We may withhold a payout, void a result, or refuse service where we identify
          such activity.
        </p>
      </Section>

      <Section title="Eligibility">
        <p>
          You must be of legal age in your jurisdiction and permitted to use a skill-gaming service
          there. You are responsible for any tax arising from prizes you receive.
        </p>
      </Section>

      <Section title="No warranty">
        <p>
          Clash is provided as-is. Blockchain transactions are irreversible, and we cannot recover
          funds sent in error or lost through a compromised device or wallet.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions or problems:{" "}
          <a href={SUPPORT_URL} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">
            reach our support channel
          </a>
          . We aim to resolve critical issues within 24 hours.
        </p>
      </Section>

      <p className="text-ink-faint text-xs">
        {APP_NAME} is operated independently and is not affiliated with MiniPay or Opera.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 font-extrabold">{title}</h2>
      <div className="text-ink-soft">{children}</div>
    </section>
  );
}
