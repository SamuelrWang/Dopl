"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Header } from "./header";
import { FlushGrid } from "@/components/design";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const isDocs = pathname.startsWith("/docs");
  // Community detail pages use their own full-screen layout
  const isCommunityDetail = pathname.startsWith("/community/") && !pathname.endsWith("/posts");

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
        <main className="container mx-auto px-4 py-8 pointer-events-auto">{children}</main>
      </div>
    </>
  );
}
