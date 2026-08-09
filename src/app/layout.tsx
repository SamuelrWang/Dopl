import type { Metadata } from "next";
import { Hanken_Grotesk, Geist_Mono, Space_Grotesk, JetBrains_Mono, Newsreader, Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/shared/api/query-provider";
import { LayoutShell } from "@/shared/layout/layout-shell";
import { ToastHost } from "@/shared/ui/toast";

const geistSans = Hanken_Grotesk({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display font — used for headings and branding (openclaw aesthetic)
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Mono font — used for labels, status text, code
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Serif font (Newsreader) — used for branding / serif accents.
const playfairDisplay = Newsreader({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

// Inter — used for landing page body text
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Canonical site URL — used by metadataBase so relative image paths in
// OpenGraph/Twitter tags resolve to absolute URLs (required for link previews
// in iMessage, Slack, Twitter, etc.).
const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://usedopl.com";

const SITE_TITLE = "Dopl: Supercharge Your Agent's Capabilities";
const SITE_DESCRIPTION =
  "AI-powered knowledge base of proven agent setups, automations, and integrations. Compose and ship agent stacks faster.";

/**
 * The OpenGraph / Twitter card, pulled by every link-preview scrape (iMessage,
 * Slack, Twitter, LinkedIn, Discord) and by nothing else.
 *
 * IT WAS A 1.30MB PNG (P0-4, 2026-08-07) — a 1200×630 screenshot of the landing
 * page, which is photographic content in a format built for flat colour, at ~13×
 * the size a card of those dimensions should be. PNG could not be fixed by
 * recompression: `compressionLevel: 9` made it slightly LARGER, and palette
 * quantization to 128 colours (the only setting that reached the target size)
 * banded the sky gradient that is most of the frame. The source is fully opaque,
 * so JPEG loses nothing real: q86, 4:4:4 chroma, mozjpeg → **100,348 bytes, a
 * 92.3% reduction**, visually indistinguishable at card size and above.
 *
 * The extension change is the point of the rename, not an accident of it: JPEG is
 * the one lossy format every scraper in that list has always accepted (WebP was
 * 44KB and tempting, and is the thing to try when the tail of scrapers is known).
 */
const OG_CARD = "/img/site_thumbnail.jpg";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  icons: {
    icon: [
      { url: "/favicons/favicon.ico" },
      { url: "/favicons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/favicons/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Dopl",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: OG_CARD,
        width: 1200,
        height: 630,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_CARD],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        // The inline script below mutates body's class before hydration (strips
        // mosaic-bg / adds landing-active on / and /pricing to avoid a flash), so
        // the server/client class lists intentionally differ on first paint.
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${playfairDisplay.variable} ${inter.variable} antialiased mosaic-bg min-h-screen`}
      >
        {/* Pre-hydration: strip mosaic-bg before first paint on no-chrome
            routes so the grid pattern never flashes. Inline scripts in
            <body> are render-blocking, so this runs before the browser
            paints body's class-driven background. Must stay in sync with
            isNoChrome in layout-shell.tsx. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=location.pathname;if(p==='/'||p==='/pricing'){document.body.classList.remove('mosaic-bg');document.body.classList.add('landing-active');}}catch(e){}})();`,
          }}
        />
        <QueryProvider>
          <LayoutShell>{children}</LayoutShell>
        </QueryProvider>
        <ToastHost />
      </body>
    </html>
  );
}
