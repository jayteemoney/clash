import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFooter } from "@/components/AppFooter";
import { Analytics } from "@/components/Analytics";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description:
    "Skill tournaments you can play in 60 seconds. Everyone in an hourly tournament plays the same board, and the top scores split the prize pool.",
  applicationName: APP_NAME,
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: "Same board for everyone. Top scores split the pool. Play free, or enter for a quarter.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // The games use swipes and rapid taps; a pinch-zoom mid-round is never intentional.
  userScalable: false,
  themeColor: "#17150F",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="bg-paper text-ink flex min-h-full flex-col antialiased">
        <div className="app-shell flex min-h-dvh flex-col">
          <div className="flex-1">{children}</div>
          <AppFooter />
        </div>
        <Analytics />
      </body>
    </html>
  );
}
