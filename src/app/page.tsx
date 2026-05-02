"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import {
  KB_TICK_MS,
  KB_TICK_TOTAL,
  MCP_TICK_MS,
  MCP_TICK_TOTAL,
  PAGE_BG,
  TAB_DURATION_MS,
  TABS,
  type TabId,
} from "@/features/marketing/constants";
import { KnowledgeMock } from "@/features/marketing/components/knowledge-mock";
import { McpMock } from "@/features/marketing/components/mcp-mock";
import { RevealOnMount } from "@/features/marketing/components/reveal";
import { SidebarMock } from "@/features/marketing/components/sidebar-mock";
import { SkillsMock } from "@/features/marketing/components/skills-mock";
import { TeamsMock } from "@/features/marketing/components/teams-mock";

export default function Home() {
  const [tab, setTab] = useState<TabId>("mcp");
  const [scrolled, setScrolled] = useState(false);
  // 99 = animation complete (everything visible). The active tab resets
  // its tick to 0 and ticks up; inactive tabs leave it at 99.
  const [kbTick, setKbTick] = useState(99);
  const [mcpTick, setMcpTick] = useState(99);
  // 0..1 progress through the current tab's dwell time. Drives the
  // progress bar in the active tab and triggers auto-advance at 1.
  const [tabProgress, setTabProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (tab !== "knowledge") {
      setKbTick(99);
      return;
    }
    setKbTick(0);
    let t = 0;
    const id = window.setInterval(() => {
      t++;
      setKbTick(t);
      if (t >= KB_TICK_TOTAL) window.clearInterval(id);
    }, KB_TICK_MS);
    return () => window.clearInterval(id);
  }, [tab]);

  useEffect(() => {
    if (tab !== "mcp") {
      setMcpTick(99);
      return;
    }
    setMcpTick(0);
    let t = 0;
    const id = window.setInterval(() => {
      t++;
      setMcpTick(t);
      if (t >= MCP_TICK_TOTAL) window.clearInterval(id);
    }, MCP_TICK_MS);
    return () => window.clearInterval(id);
  }, [tab]);

  // Tab progress + auto-advance. Wall-clock based to avoid drift.
  // When the bar fills, batch all four resets so the new tab's first
  // paint already reflects the start state — no flash of 100% bar on
  // the new tab, no flash of stale kbTick on the sidebar mid-transition.
  useEffect(() => {
    setTabProgress(0);
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / TAB_DURATION_MS);
      setTabProgress(progress);
      if (progress >= 1) {
        window.clearInterval(id);
        const idx = TABS.findIndex((t) => t.id === tab);
        const nextId = TABS[(idx + 1) % TABS.length].id;
        setTab(nextId);
        setTabProgress(0);
        setKbTick(nextId === "knowledge" ? 0 : 99);
        setMcpTick(nextId === "mcp" ? 0 : 99);
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [tab]);

  const switchTab = (nextId: TabId) => {
    if (nextId === tab) return;
    setTab(nextId);
    setTabProgress(0);
    setKbTick(nextId === "knowledge" ? 0 : 99);
    setMcpTick(nextId === "mcp" ? 0 : 99);
  };

  return (
    <div
      className="min-h-screen text-white antialiased overflow-x-hidden"
      style={{
        backgroundColor: PAGE_BG,
        fontFamily:
          "var(--font-inter), Inter, ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <nav className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-8 py-3">
        <div
          className={cn(
            "mx-auto flex items-center justify-between rounded-full px-5 py-2.5 transition-all duration-700 ease-in-out",
            scrolled
              ? "max-w-[1200px] bg-black/40 backdrop-blur-xl border border-white/[0.08] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
              : "max-w-[1600px] bg-transparent border border-transparent",
          )}
        >
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/favicons/favicon-32x32.png"
                alt="Dopl"
                width={34}
                height={34}
                className="rounded-lg border-[3px] border-black"
              />
              <span
                className="text-white text-[22px]"
                style={{
                  fontFamily:
                    "var(--font-playfair), 'Playfair Display', Georgia, serif",
                  fontStyle: "italic",
                }}
              >
                Dopl
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-6">
              <Link
                href="/docs"
                className="text-white/60 text-[13px] hover:text-white transition-colors"
              >
                Docs
              </Link>
              <Link
                href="/community"
                className="text-white/60 text-[13px] hover:text-white transition-colors"
              >
                Community
              </Link>
              <Link
                href="/pricing"
                className="text-white/60 text-[13px] hover:text-white transition-colors"
              >
                Pricing
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-white/60 text-[13px] hover:text-white transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="bg-white/[0.08] border border-white/[0.12] text-white text-[13px] px-4 py-1.5 rounded-full hover:bg-white/[0.12] transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative px-4 pt-28 pb-20">
        <div className="max-w-[1200px] mx-auto text-center">
          <RevealOnMount delay={80} rise={16} duration={700}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/[0.12] bg-white/[0.04] mb-8">
              <span className="text-white/70 text-[12px] font-mono tracking-wide">
                Introducing Dopl
              </span>
              <ArrowRight size={12} className="text-white/50" />
            </div>
          </RevealOnMount>

          <RevealOnMount delay={180} rise={20} duration={780}>
            <h1
              className="font-semibold tracking-tight leading-[0.95] text-white mb-6"
              style={{ fontSize: "clamp(48px, 6vw, 72px)" }}
            >
              The intelligence layer
              <br />
              for your AI.
            </h1>
          </RevealOnMount>

          <RevealOnMount delay={320} rise={18} duration={780}>
            <p className="text-white/60 text-[17px] md:text-[19px] max-w-[600px] mx-auto mb-10">
              Dopl is the distribution layer for agentic teams.
            </p>
          </RevealOnMount>

          <RevealOnMount delay={440} rise={14} duration={780}>
            <div className="flex items-center justify-center gap-3 mb-20">
              <button
                type="button"
                className="bg-white text-black text-[14px] font-medium px-5 py-2.5 rounded-md hover:bg-white/90 transition-colors"
              >
                Start for free
              </button>
              <button
                type="button"
                className="bg-white/[0.08] border border-white/[0.12] text-white text-[14px] font-medium px-5 py-2.5 rounded-md hover:bg-white/[0.12] transition-colors"
              >
                Talk to us
              </button>
            </div>
          </RevealOnMount>
        </div>

        {/* Tab strip — borders span the full viewport width; the tab row
            itself stays inside the 1280px container so the cutoffs align
            with the panel edges below. */}
        <div className="border-y border-white/[0.06]">
          <div className="max-w-[1280px] mx-auto flex items-center justify-center divide-x divide-white/[0.06]">
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => switchTab(t.id)}
                  className={cn(
                    "relative flex-1 max-w-[280px] py-7 text-[14px] font-medium",
                    active
                      ? "text-white"
                      : "text-white/50 hover:text-white/70",
                  )}
                  // Active tab darkens to the panel's bg so it visually
                  // joins the panel below — like a tab stuck onto the card.
                  style={{
                    backgroundColor: active
                      ? "oklch(0.11 0 0)"
                      : "transparent",
                    transition:
                      "background-color 220ms ease-out, color 180ms ease-out",
                  }}
                >
                  {t.label}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute -bottom-px left-0 h-[2px] bg-white"
                      style={{
                        width: `${tabProgress * 100}%`,
                        transition: "width 80ms linear",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Gutter — vertical dashed lines aligned with the panel's left
            and right edges, bridging the tab strip and the panel. */}
        <div className="relative max-w-[1280px] mx-auto h-12">
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 border-l border-dashed border-white/[0.12]"
          />
          <div
            aria-hidden
            className="absolute inset-y-0 right-0 border-l border-dashed border-white/[0.12]"
          />
        </div>

        {/* Mock surface */}
        <div className="relative max-w-[1280px] mx-auto">
          <div
            className="rounded-xl border border-white/[0.08] overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.35),0_32px_80px_rgba(0,0,0,0.55)] text-left"
            style={{ height: 680, backgroundColor: "oklch(0.11 0 0)" }}
          >
            <div className="flex h-full">
              <SidebarMock active={tab} kbTick={kbTick} />
              <div className="flex-1 flex flex-col min-w-0">
                {tab === "mcp" && <McpMock mcpTick={mcpTick} />}
                {tab === "knowledge" && <KnowledgeMock kbTick={kbTick} />}
                {tab === "skills" && <SkillsMock />}
                {tab === "teams" && <TeamsMock />}
              </div>
            </div>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-40 rounded-b-xl"
            style={{
              background: `linear-gradient(to top, ${PAGE_BG} 0%, ${PAGE_BG} 30%, transparent 100%)`,
            }}
          />
        </div>
      </section>
    </div>
  );
}
