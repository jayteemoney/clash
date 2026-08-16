import Link from "next/link";
import { APP_NAME, SUPPORT_URL } from "@/lib/config";

/**
 * Required for MiniPay listing: Terms of Service, Privacy Policy and a reachable support channel,
 * plus clear ownership so it is obvious Clash is operated by us and not by MiniPay.
 */
export function AppFooter() {
  return (
    <footer className="text-panel/70 mt-8 border-t-[3px] border-white/15 px-4 py-6 text-xs font-semibold">
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/stats" className="underline underline-offset-2">
          Stats
        </Link>
        <Link href="/legal/terms" className="underline underline-offset-2">
          Terms of Service
        </Link>
        <Link href="/legal/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
        <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          Support
        </a>
      </nav>
      <p className="mt-3 leading-relaxed">
        {APP_NAME} is an independent skill-gaming app built on Celo. It is not operated by, or
        affiliated with, MiniPay or Opera.
      </p>
    </footer>
  );
}
