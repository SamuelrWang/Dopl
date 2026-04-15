"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DocsSidebar, DOC_SECTIONS } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";
import { SECTIONS } from "./docs-content";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState(DOC_SECTIONS[0].id);
  const [activeHeading, setActiveHeading] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  const section = SECTIONS[activeSection];
  const SectionComponent = section?.component;
  const sectionToc = section?.toc ?? [];

  // Scroll-spy within the active section
  useEffect(() => {
    if (sectionToc.length === 0) return;
    setActiveHeading(sectionToc[0].id);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveHeading(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );

    // Small delay so the DOM has rendered the new section
    const timer = setTimeout(() => {
      for (const item of sectionToc) {
        const el = document.getElementById(item.id);
        if (el) observer.observe(el);
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [activeSection, sectionToc]);

  const handleSectionChange = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    // Scroll content to top when switching sections
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, []);

  const handleHeadingClick = useCallback((headingId: string) => {
    const el = document.getElementById(headingId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      setActiveHeading(headingId);
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
        <DocsSidebar
          activeSection={activeSection}
          activeHeading={activeHeading}
          onSectionChange={handleSectionChange}
          onHeadingClick={handleHeadingClick}
        />

        {/* Main content */}
        <main
          ref={contentRef}
          className="flex-1 overflow-y-auto px-12 py-8 scrollbar-discreet"
        >
          {SectionComponent && <SectionComponent />}
          <div className="h-32" />
        </main>

        {/* Right TOC */}
        <DocsToc items={sectionToc} activeId={activeHeading} />
      </div>
    </div>
  );
}
