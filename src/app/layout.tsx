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

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const playfairDisplay = Newsreader({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// metadataBase: relative OpenGraph/Twitter image paths must resolve absolute or link previews
// (iMessage, Slack, Twitter) break.
const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://usedopl.com";

const SITE_TITLE = "Dopl: Supercharge Your Agent's Capabilities";
const SITE_DESCRIPTION =
  "AI-powered knowledge base of proven agent setups, automations, and integrations. Compose and ship agent stacks faster.";

/**
 * OpenGraph / Twitter card — read only by link-preview scrapers.
 * ⚠ Must stay JPEG, not PNG: the frame is photographic (a landing screenshot), so PNG cost 1.30MB
 * and could not be recompressed — `compressionLevel: 9` grew it, and 128-colour quantization
 * banded the sky gradient. Fully opaque source ⇒ JPEG loses nothing: q86, 4:4:4, mozjpeg →
 * 100,348 bytes. JPEG is also the one lossy format every scraper accepts (WebP is 44KB and
 * tempting once the scraper tail is known).
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
        // ⚠ The inline script below mutates body's class before hydration (strips mosaic-bg /
        // adds landing-active on / and /pricing), so server/client class lists differ on first paint.
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
