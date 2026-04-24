"use client";

/**
 * Shared layout for /browse/entries and /browse/clusters.
 *
 * - Fixed-height flex container anchored below the top nav
 * - Tabs render as Next.js <Link>s so the active tab lives in the URL
 *   (back/forward buttons work, links to either tab are first-class)
 * - SmartChatPanel is the persistent left rail across tab switches,
 *   so a typed-but-unsent chat input doesn't get wiped on navigation
 * - Right side is the tab's content, scrolls independently
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SmartChatPanel } from "@/features/entries/components/smart-chat-panel";
import { EntryPreviewProvider } from "@/features/entries/components/entry-preview-context";
import { EntryPreviewPanel } from "@/features/entries/components/entry-preview-panel";

export default function BrowseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isEntries =
    pathname === "/browse" || pathname.startsWith("/browse/entries");
  const isClusters = pathname.startsWith("/browse/clusters");
  const isSaved = pathname.startsWith("/browse/saved");

  return (
    <EntryPreviewProvider>
      <div className="flex flex-col h-[calc(100vh-100px)]">
        <div className="flex items-center gap-1 mb-4 shrink-0">
          <TabLink href="/browse/entries" active={isEntries}>
            Entries
          </TabLink>
          <TabLink href="/browse/clusters" active={isClusters}>
            Clusters
          </TabLink>
          <TabLink href="/browse/saved" active={isSaved}>
            Saved
          </TabLink>
        </div>

        <div className="flex gap-4 flex-1 min-h-0">
          <aside className="w-[320px] shrink-0 hidden md:block h-full">
            <SmartChatPanel />
          </aside>

          <div className="flex-1 min-w-0 overflow-y-auto pr-1">{children}</div>
        </div>
      </div>
      <EntryPreviewPanel />
    </EntryPreviewProvider>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`h-8 px-4 flex items-center font-mono text-[11px] uppercase tracking-wider rounded-[3px] border transition-colors ${
        active
          ? "bg-white/[0.08] border-white/[0.18] text-white/90"
          : "bg-transparent border-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
      }`}
    >
      {children}
    </Link>
  );
}
