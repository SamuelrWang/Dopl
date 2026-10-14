import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { QueryProvider } from "@/shared/api/query-provider";
import { LayoutShell } from "@/shared/layout/layout-shell";
import { ToastHost } from "@/shared/ui/toast";

/*
 * Self-hosted, never fetched at build time. These were `next/font/google`, and Turbopack 16.2.x
 * fails the build whenever Google answers a family's CSS with a `fonts.gstatic.com/l/font?kit=…&skey=…`
 * URL: the `&` survives into the internal font-file request and splits its one-entry query
 * ("next/font/google queries have exactly one entry"). Google's answer varies by request, so the
 * build failed intermittently on Vercel and never locally. Files + licenses: `./fonts/README.md`.
 *
 * Each family is Google's LATIN subset of its variable font — the one file Google served for every
 * weight below — declared once per weight/style exactly as Google's CSS declared it, so the
 * `--font-*` names, weights, styles, `display: swap` and the metric-adjusted fallback face
 * (Arial; Times New Roman for the serif) are what `next/font/google` emitted.
 */
// next/font/local options must be literals (the compiler reads them statically) — no helper.
const geistSans = localFont({
  variable: "--font-geist-sans",
  src: [
    { path: "./fonts/hanken-grotesk-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/hanken-grotesk-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/hanken-grotesk-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/hanken-grotesk-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
});

const geistMono = localFont({
  variable: "--font-geist-mono",
  src: [
    { path: "./fonts/geist-mono-latin.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
});

const spaceGrotesk = localFont({
  variable: "--font-display",
  src: [
    { path: "./fonts/space-grotesk-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/space-grotesk-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/space-grotesk-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/space-grotesk-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
});

const jetbrainsMono = localFont({
  variable: "--font-mono",
  src: [
    { path: "./fonts/jetbrains-mono-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-latin.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
});

const playfairDisplay = localFont({
  variable: "--font-playfair",
  src: [
    { path: "./fonts/newsreader-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/newsreader-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/newsreader-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/newsreader-italic-latin.woff2", weight: "400", style: "italic" },
    { path: "./fonts/newsreader-italic-latin.woff2", weight: "500", style: "italic" },
    { path: "./fonts/newsreader-italic-latin.woff2", weight: "600", style: "italic" },
  ],
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

const inter = localFont({
  variable: "--font-inter",
  src: [
    { path: "./fonts/inter-latin.woff2", weight: "300", style: "normal" },
    { path: "./fonts/inter-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/inter-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/inter-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
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
  // Home-screen install (iOS "Add to Home Screen", Android install): opens standalone, no browser chrome.
  manifest: "/favicons/site.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Dopl",
    statusBarStyle: "default",
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

/**
 * THE VIEWPORT, AND IT EXISTS FOR ONE LINE OF IT (Samuel, 2026-09-04).
 *
 * `width`/`initialScale` are Next's own defaults restated only because declaring the export
 * replaces them — nothing about the desktop or marketing render changes.
 *
 * ⚠ `interactiveWidget: "resizes-content"` IS THE ASK: when the soft keyboard opens it must
 * SHRINK THE LAYOUT VIEWPORT and push the page up by exactly its own height, rather than
 * overlaying the page (the `resizes-visual` default) and leaving the browser to scroll the
 * content up on its own. The app shell is `position: fixed; inset: 0`
 * (`app-shell.module.css › .root`), so a shrinking layout viewport is what re-lays the shell
 * above the keyboard — the composer rides up with it and the panelling stays whole.
 * ⚠ NOTHING COMPENSATES IN JS, deliberately. No `visualViewport` listener, no keyboard-height
 * padding, no scroll offset: any of those add movement ON TOP of the browser's own and that
 * doubled shift is what tore the layout. The declaration is the whole mechanism.
 * ⚠ NO `maximumScale` / `userScalable: false` here. Focus-zoom is killed at the FIELD, by
 * giving it a ≥16px font size on coarse pointers (`channels/components/composer-input.tsx`); killing
 * it here would take pinch-zoom away from every reader on every page.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
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
            isNoChrome in layout-shell.tsx.

            🔒 ⚠ **IF YOU ARE HERE BECAUSE OF *"Encountered a script tag while
            rendering React component. Scripts inside React components are never
            executed when rendering on the client"*, THAT WARNING IS A SYMPTOM
            AND THIS TAG IS NOT THE DEFECT (measured 2026-09-17).** It is the
            ONLY `<script>` in `src/` (`grep -rn "<script" src/`), and this is a
            SERVER component — its tag is part of the initial HTML and runs
            there. The warning appears when React RE-RENDERS the document on the
            client, which is what a RECOVERABLE hydration failure anywhere in the
            tree makes it do (*"this tree will be regenerated on the client"*).
            **Find the hydration mismatch; this stops logging when that is
            fixed.** The 2026-09-17 instance was the landing hero's scripted
            scene, fixed at `hero-banner.tsx`'s `ssr: false` boundary.

            🚫 **AND DO NOT "FIX" IT WITH `next/script strategy="beforeInteractive"`.**
            Next hoists that strategy into `<head>`, where `document.body` is
            still null — the body writes below would no-op inside their own
            `try`, silently, and the mosaic flash this exists to prevent would
            come back with every gate still green. Targeting
            `document.documentElement` instead would work, but `globals.css ›
            body.landing-active` and `layout-shell.tsx`'s four `document.body`
            writes all key off BODY, so that is a four-file ruling and not a
            drive-by. */}
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
