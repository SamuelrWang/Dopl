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
        url: "/img/site_thumbnail.png",
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
    images: ["/img/site_thumbnail.png"],
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
