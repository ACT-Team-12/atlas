import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SmoothScroll } from "@/ui/motion/SmoothScroll";
import "./globals.css";

// Self-hosted (SIL Open Font License), so builds never depend on a font download.
const display = localFont({ src: "./fonts/bricolage-grotesque-latin.woff2", variable: "--font-display", weight: "700 800", display: "swap" });
const body = localFont({ src: "./fonts/figtree-latin.woff2", variable: "--font-body", weight: "500 800", display: "swap" });
const hand = localFont({ src: "./fonts/caveat-latin.woff2", variable: "--font-hand", weight: "500 700", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://atlas-team12.vercel.app"),
  applicationName: "ATLAS",
  openGraph: { type: "website", siteName: "ATLAS", url: "/" },
  twitter: { card: "summary_large_image" },
  appleWebApp: { capable: true, title: "ATLAS", statusBarStyle: "default" },
  title: "ATLAS · Your visit, turned into a plan you can finish",
  description:
    "Snap the after-visit summary. ATLAS explains every step in your language, shows the exact line it came from, and matches what gets in the way to verified Atlanta resources.",
};

export const viewport: Viewport = { themeColor: "#bfe9dc" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${hand.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('js-motion')",
          }}
        />
      </head>
      <body>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
