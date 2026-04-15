"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DocsSidebar, DOC_SECTIONS } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";
import { DocsContent, TOC_ENTRIES } from "./docs-content";

// Flatten all item ids from sidebar sections for scroll-spy
const ALL_IDS = DOC_SECTIONS.flatMap((s) => s.items.map((i) => i.id));

export default function DocsPage() {
  const [activeId, setActiveId] = useState(ALL_IDS[0] || "");
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll-spy: observe which section heading is in view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the first visible heading (top-most on screen)
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );

    // Observe all headings that match sidebar/TOC ids
    const allIds = new Set([
      ...ALL_IDS,
      ...TOC_ENTRIES.map((t) => t.id),
    ]);
    for (const id of allIds) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  const handleNavigate = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      setActiveId(id);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[oklch(0.06_0_0)]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 h-14 flex items-center px-6 bg-[oklch(0.06_0_0)]/90 backdrop-blur-md border-b border-white/[0.06]">
        <Link
          href="/"
          className="flex items-center gap-2 text-white/90 hover:text-white transition-colors"
        >
          <span className="font-semibold text-[15px] tracking-tight">Dopl</span>
          <span className="text-white/30 text-[13px]">Docs</span>
        </Link>

        <div className="ml-auto flex items-center gap-4">
          <Link
            href="/community"
            className="text-white/45 text-[13px] hover:text-white/70 transition-colors"
          >
            Community
          </Link>
          <Link
            href="/pricing"
            className="text-white/45 text-[13px] hover:text-white/70 transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="text-[13px] px-3 py-1.5 rounded bg-white/[0.08] text-white/80 hover:bg-white/[0.12] transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Three-column layout */}
      <div className="flex h-[calc(100vh-56px)]">
        {/* Left sidebar */}
        <DocsSidebar activeId={activeId} onNavigate={handleNavigate} />

        {/* Main content */}
        <main
          ref={contentRef}
          className="flex-1 overflow-y-auto px-12 py-8 scrollbar-discreet"
        >
          {/* Hero */}
          <div className="mb-10">
            <p className="font-mono text-[11px] uppercase tracking-widest text-white/30 mb-2">
              Documentation
            </p>
            <h1 className="text-[32px] font-bold text-white/95 leading-tight mb-3">
              Dopl Documentation
            </h1>
            <p className="text-[16px] text-white/50 leading-relaxed max-w-[560px]">
              Everything you need to use Dopl. From canvas basics to MCP server
              setup, cluster workflows, and the Chrome extension.
            </p>
          </div>

          <DocsContent />

          {/* Footer spacer */}
          <div className="h-32" />
        </main>

        {/* Right TOC */}
        <DocsToc items={TOC_ENTRIES} activeId={activeId} />
      </div>
    </div>
  );
}
