import Link from "next/link";
import { APP_NAME, SUPPORT_URL } from "@/lib/config";

export const metadata = {
  title: "Clash — Privacy Policy",
  description: "What Clash collects, what it does not, and how to reach us.",
};

export default function PrivacyPage() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-4 pb-6 text-sm leading-relaxed">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-extrabold">Privacy Policy</h1>
        <Link href="/" className="text-ink-faint text-sm underline underline-offset-2">
          Back
        </Link>
      </div>

      <p className="text-ink-faint text-xs">Last updated 1 August 2026.</p>

      <Section title="What we collect">
        <ul className="list-disc pl-5">
          <li>
            <strong>Your wallet address</strong>, provided by MiniPay when you open the app. We need
            it to record entries and pay out prizes.
          </li>
          <li>
            <strong>Your scores</strong> and the tournament they belong to, so we can rank entrants
            and settle prizes.
          </li>
          <li>
            <strong>Aggregate usage data</strong> — page views, country, and session counts — through
            privacy-focused product analytics.
          </li>
        </ul>
      </Section>

      <Section title="What we do not collect">
        <p>
          We do not ask for your name, email address, phone number, or any document. We never request
          your recovery phrase or private key, and no part of {APP_NAME} will ever ask you to sign a
          message to log in.
        </p>
      </Section>

      <Section title="What is public">
        <p>
          Entries, prize payouts, and fees are recorded on the Celo blockchain and are publicly
          visible by design. Leaderboards display a generated alias derived from your wallet address
          rather than the address itself.
        </p>
      </Section>

      <Section title="Retention">
        <p>
          Scores are kept for a short period after a tournament settles so that results can be
          reviewed if a player disputes them, then discarded. On-chain records are permanent and
          outside our control.
        </p>
      </Section>

      <Section title="Sharing">
        <p>
          We do not sell personal data. We share only what is necessary with our hosting and
          analytics providers to run the service.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For any privacy question or a request to delete the data we hold:{" "}
          <a href={SUPPORT_URL} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">
            contact support
          </a>
          .
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
