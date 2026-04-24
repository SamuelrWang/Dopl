"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Header } from "./header";
import { FlushGrid } from "@/shared/design";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const isDocs = pathname.startsWith("/docs");
  // Community detail pages use their own full-screen layout
  const isCommunityDetail = pathname.startsWith("/community/") && !pathname.endsWith("/posts");
  // /browse needs more horizontal room + breathing space below the
  // fixed top nav so the smart-chat rail + grid don't run up against
  // the bars. Wider max-width than the default `container` class.
  // Matches /browse, /browse/entries, /browse/clusters.
  const isBrowse = pathname === "/browse" || pathname.startsWith("/browse/");

  // Toggle mosaic-bg on body: remove for landing, ensure present elsewhere
  useEffect(() => {
    if (isLanding || isCommunityDetail || isDocs) {
      document.body.classList.remove("mosaic-bg");
      document.body.classList.add("landing-active");
      document.body.style.backgroundColor = "#000";
    } else {
      document.body.classList.add("mosaic-bg");
      document.body.classList.remove("landing-active");
      document.body.style.backgroundColor = "";
    }
    return () => {
      document.body.classList.remove("landing-active");
      document.body.classList.add("mosaic-bg");
      document.body.style.backgroundColor = "";
    };
  }, [isLanding, isDocs]);

  if (isLanding || isCommunityDetail || isDocs) {
    return <>{children}</>;
  }

  return (
    <>
      <FlushGrid />
      <div className="relative z-[2] pointer-events-none">
        <Header />
        <main
          className={
            // /browse goes full-viewport-width: chat rail flushes to
            // the left edge, grid fills the rest. No mx-auto + no
            // max-width so wide monitors don't get empty side gutters.
            isBrowse
              ? "w-full pl-3 pr-3 pt-12 pb-6 pointer-events-auto"
              : "container mx-auto px-4 py-8 pointer-events-auto"
          }
        >
          {children}
        </main>
      </div>
    </>
  );
}
