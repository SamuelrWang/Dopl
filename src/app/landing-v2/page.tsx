"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bold,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  Heading1,
  Heading2,
  Heading3,
  Home,
  Italic,
  LayoutGrid,
  Link2,
  List,
  ListOrdered,
  MessageSquare,
  Plus,
  Quote,
  Redo2,
  Search,
  Settings,
  Sparkles,
  Strikethrough,
  Table,
  Underline,
  Undo2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const TABS = [
  { id: "mcp", label: "MCP" },
  { id: "knowledge", label: "Knowledge Base" },
  { id: "skills", label: "Skills" },
  { id: "teams", label: "Teams" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function cx(...args: Array<string | false | undefined | null>) {
  return args.filter(Boolean).join(" ");
}

/** Page bg — charcoal. Clearly lighter than the panel (0.11) so the
 *  panel reads as a darker, framed surface elevated against the page. */
const PAGE_BG = "oklch(0.16 0 0)";

/** Per-tab dwell time. The progress bar fills over this duration; when
 *  it reaches 100% the tab auto-advances to the next one. */
const TAB_DURATION_MS = 8000;

/** Knowledge anim — total ~7.8s at 120ms × 65. */
const KB_TICK_MS = 120;
const KB_TICK_TOTAL = 65;

/** MCP anim — total ~7.7s at 120ms × 64. The terminal window flies in
 *  at tick 4, cycles begin at tick 8, four cycles of 14 ticks each. */
const MCP_TICK_MS = 120;
const MCP_TICK_TOTAL = 64;
const MCP_FLY_IN_TICK = 4;
const MCP_CYCLE_START_TICK = 8;
const MCP_CYCLE_LENGTH = 14;
const MCP_TYPE_CHARS_PER_TICK = 6;

const MCP_CLIENT_CYCLES = [
  {
    name: "Claude Code",
    badge: "CC",
    cmd: "claude mcp add dopl https://mcp.dopl.ai/u/sam-wang",
    response: "✓ Connected. 12 tools registered.",
  },
  {
    name: "Codex CLI",
    badge: "CX",
    cmd: "codex mcp register dopl https://mcp.dopl.ai/u/sam-wang",
    response: "✓ Registered. Run codex login dopl to authenticate.",
  },
  {
    name: "Claude Desktop",
    badge: "CD",
    cmd: "claude_desktop add dopl https://mcp.dopl.ai/u/sam-wang",
    response: "✓ Server added. Restart Claude Desktop to use.",
  },
  {
    name: "Cursor",
    badge: "CR",
    cmd: "cursor mcp connect dopl https://mcp.dopl.ai/u/sam-wang",
    response: "✓ Connected. Reload Cursor to refresh tools.",
  },
] as const;

export default function LandingV2() {
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

  // Knowledge tab animation
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

  // MCP tab animation
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
  // When the bar fills, batch all four resets (tab, progress, both anim
  // ticks) so the new tab's first paint already reflects the start state
  // — no flash of 100% bar on the new tab, no flash of stale kbTick on
  // the sidebar mid-transition.
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

  /** Manual tab switch — same batched-reset shape as auto-advance so the
   *  first frame on the new tab already shows the correct start state. */
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
      {/* Top nav (cloned from existing landing) */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-8 py-3">
        <div
          className={cx(
            "mx-auto flex items-center justify-between rounded-full px-5 py-2.5 transition-all duration-700 ease-in-out",
            scrolled
              ? "max-w-[1200px] bg-black/40 backdrop-blur-xl border border-white/[0.08] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
              : "max-w-[1600px] bg-transparent border border-transparent",
          )}
        >
          <div className="flex items-center gap-8">
            <Link href="/landing-v2" className="flex items-center gap-2">
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
          {/* Hero text — staggered fade-up entrance */}
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
            with the panel edges below. Padding bumped to py-7 for height. */}
        <div className="border-y border-white/[0.06]">
          <div className="max-w-[1280px] mx-auto flex items-center justify-center divide-x divide-white/[0.06]">
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => switchTab(t.id)}
                  className={cx(
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

        {/* Mock surface — layered shadow + bottom fade-out */}
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
          {/* Fade-out at the bottom of the panel into the page bg */}
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

/* ─────────────────────────  Sidebar (shared)  ───────────────────────── */

function SidebarMock({
  active,
  kbTick,
}: {
  active: TabId;
  kbTick: number;
}) {
  // Knowledge animation gates: section drops down at tick 4, the
  // "Networking emails" KB gets selected at tick 11.
  const knowledgeExpanded = active === "knowledge" && kbTick >= 4;
  const networkingActive = active === "knowledge" && kbTick >= 11;
  return (
    <aside
      className="hidden md:flex w-64 shrink-0 flex-col border-r border-white/[0.06]"
      style={{ backgroundColor: "oklch(0.13 0 0)" }}
    >
      {/* Header — workspace */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-white/[0.06]">
        <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md overflow-hidden">
          <Image
            src="/favicons/favicon-32x32.png"
            alt="Dopl"
            width={20}
            height={20}
            className="rounded-sm"
          />
        </div>
        <button
          type="button"
          className="relative flex-1 flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-white/[0.04] transition-colors text-left"
        >
          <span className="text-[13px] font-medium text-white truncate">
            Sam&apos;s workspace
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <ChevronDown size={13} className="text-white/40" />
          </span>
        </button>
      </div>

      {/* Search row */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-white/[0.06]">
        <button
          type="button"
          className="flex-1 flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-white/[0.06] hover:bg-white/[0.04]"
        >
          <span className="flex items-center gap-1.5 text-[11px] text-white/60">
            <kbd className="font-mono px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] text-[10px] text-white/50">
              K
            </kbd>
            Quick Actions
          </span>
          <kbd className="font-mono text-[10px] text-white/30">⌘K</kbd>
        </button>
        <button
          type="button"
          aria-label="Search"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-white/[0.06] hover:bg-white/[0.04]"
        >
          <Search size={13} className="text-white/40" />
          <kbd className="font-mono text-[10px] text-white/30">/</kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 px-2 py-2">
        <NavRow icon={Home} label="Overview" />
        <NavRow icon={LayoutGrid} label="Canvas" />
        <NavRow icon={MessageSquare} label="Chat" />
        <NavSection
          icon={BookOpen}
          label="Knowledge"
          active={active === "knowledge"}
          expanded={knowledgeExpanded}
          items={[
            { name: "Networking emails", active: networkingActive },
            { name: "Competitor intel" },
            { name: "Product specs" },
            { name: "Customer feedback" },
          ]}
        />
        <NavSection
          icon={Sparkles}
          label="Skills"
          active={active === "skills"}
          expanded={active === "skills"}
          items={[
            { name: "Cold outreach email writer", active: true },
            { name: "Polymarket trading bot" },
            { name: "Code review assistant" },
            { name: "GitHub repo analyzer" },
            { name: "Linear ticket triager" },
          ]}
        />
        <NavRow icon={Activity} label="Activity" />
        <NavRow icon={Users} label="Members" active={active === "teams"} />
        <NavRow icon={Settings} label="Settings" active={active === "mcp"} />
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/[0.06] flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-[11px] font-semibold text-white">
          SW
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-white/80 truncate">Sam Wang</div>
          <div className="text-[10px] text-white/40 truncate">
            srwang@usc.edu
          </div>
        </div>
        <ChevronDown size={13} className="text-white/40 shrink-0" />
      </div>
    </aside>
  );
}

function NavRow({
  icon: Icon,
  label,
  active,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(
        "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors text-left",
        active
          ? "bg-white/[0.06] text-white"
          : "text-white/70 hover:bg-white/[0.04] hover:text-white",
      )}
    >
      <Icon size={15} className="shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function NavSection({
  icon: Icon,
  label,
  active,
  expanded,
  items,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  expanded: boolean;
  items: { name: string; active?: boolean }[];
}) {
  return (
    <>
      <button
        type="button"
        className={cx(
          "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors text-left",
          active
            ? "bg-white/[0.06] text-white"
            : "text-white/70 hover:bg-white/[0.04] hover:text-white",
        )}
      >
        <Icon size={15} className="shrink-0" />
        <span className="flex-1">{label}</span>
        {expanded ? (
          <ChevronDown size={13} className="text-white/40 shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-white/40 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-white/[0.06] pl-2">
          {items.map((it) => (
            <button
              key={it.name}
              type="button"
              className={cx(
                "block px-2 py-1 rounded-md text-[11px] transition-colors text-left truncate",
                it.active
                  ? "bg-white/[0.06] text-white"
                  : "text-white/60 hover:bg-white/[0.04] hover:text-white",
              )}
            >
              {it.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ─────────────────────────  Tab 1: MCP  ───────────────────────── */

function McpMock({ mcpTick }: { mcpTick: number }) {
  // Resolve the cycling terminal state from the global tick.
  // Phases: hidden (0..3) → fly-in (4..7) → cycles (8+).
  const showTerminal = mcpTick >= MCP_FLY_IN_TICK;
  const inCycles = mcpTick >= MCP_CYCLE_START_TICK;
  const elapsedInCycles = inCycles ? mcpTick - MCP_CYCLE_START_TICK : 0;
  const cycleIdx = inCycles
    ? Math.floor(elapsedInCycles / MCP_CYCLE_LENGTH) %
      MCP_CLIENT_CYCLES.length
    : 0;
  const inCycleTick = inCycles ? elapsedInCycles % MCP_CYCLE_LENGTH : 0;
  const activeClient = MCP_CLIENT_CYCLES[cycleIdx];
  // Within each 14-tick cycle: ticks 0..9 = typing, 10..13 = response shown.
  const typeWindow = MCP_CYCLE_LENGTH - 4;
  const charsTyped = inCycles
    ? Math.min(activeClient.cmd.length, inCycleTick * MCP_TYPE_CHARS_PER_TICK)
    : 0;
  const isTyping =
    inCycles && inCycleTick < typeWindow && charsTyped < activeClient.cmd.length;
  const showResponse =
    inCycles && (inCycleTick >= typeWindow || charsTyped >= activeClient.cmd.length);

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "oklch(0.11 0 0)" }}
    >
      <PageTopBar
        title="MCP Server"
        right={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] text-white/70 hover:text-white border border-white/[0.08] px-2.5 py-1 rounded-md"
          >
            <Copy size={12} /> Copy URL
          </button>
        }
      />
      <div className="flex-1 flex min-h-0">
        {/* Left: endpoint + connected clients (static info) */}
        <div className="flex-1 overflow-y-auto px-8 py-6 min-w-0">
          <div className="space-y-5 max-w-xl">
            {/* Server endpoint */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">
                Server endpoint
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 font-mono text-[13px] text-white/90 px-3 py-2 rounded-md bg-black/40 border border-white/[0.06] truncate">
                  mcp.dopl.ai/u/sam-wang
                </div>
                <button
                  type="button"
                  className="p-2 rounded-md border border-white/[0.08] text-white/60 hover:text-white shrink-0"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>

            {/* Connected clients */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <div className="px-5 pt-4 pb-3 border-b border-white/[0.06]">
                <div className="text-[13px] font-medium text-white">
                  Connected clients
                </div>
                <div className="text-[11px] text-white/40 mt-0.5">
                  Detected agents on this device
                </div>
              </div>
              <div className="divide-y divide-white/[0.04]">
                <ClientRow
                  name="Claude Code"
                  path="~/.claude.json"
                  status="connected"
                />
                <ClientRow
                  name="Claude Desktop"
                  path="~/Library/.../claude_desktop_config.json"
                  status="connected"
                />
                <ClientRow
                  name="Cursor"
                  path="not detected"
                  status="disconnected"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: floating terminal window. Flies in once at MCP_FLY_IN_TICK,
            then its inner content swaps per cycle (re-keyed on cycleIdx so
            each new client starts typing fresh). */}
        <div className="w-[440px] shrink-0 px-6 py-6 flex items-start">
          {showTerminal && (
            <RevealOnMount from="right">
              <div className="w-full rounded-xl overflow-hidden border border-white/[0.10] shadow-[0_12px_40px_rgba(0,0,0,0.6)] bg-black/80 backdrop-blur-sm">
                {/* Title bar */}
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.08] bg-black/60">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                  <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                  <div
                    key={`title-${cycleIdx}`}
                    className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-white/60 font-mono"
                    style={{
                      animation: "fadeIn 220ms ease-out",
                    }}
                  >
                    <span className="w-4 h-4 rounded bg-white/[0.08] border border-white/[0.12] flex items-center justify-center text-[8px] font-semibold text-white/80">
                      {activeClient.badge}
                    </span>
                    {activeClient.name}
                  </div>
                </div>
                {/* Body */}
                <div
                  key={`body-${cycleIdx}`}
                  className="px-4 py-3 font-mono text-[12px] min-h-[180px] flex flex-col gap-2"
                  style={{
                    animation: "fadeIn 220ms ease-out",
                  }}
                >
                  <div className="text-white/30 text-[10px] uppercase tracking-wider">
                    Connecting to MCP server
                  </div>
                  <div className="text-white/90 break-all leading-relaxed">
                    <span className="text-white/40">$ </span>
                    {charsTyped > 0 ? (
                      <ColorizedCmd cmd={activeClient.cmd.slice(0, charsTyped)} />
                    ) : null}
                    {isTyping && (
                      <span className="inline-block w-[6px] h-[12px] bg-white/70 align-middle ml-0.5 animate-pulse" />
                    )}
                  </div>
                  {showResponse && (
                    <div
                      className="text-emerald-400 flex items-center gap-1.5"
                      style={{ animation: "fadeIn 280ms ease-out" }}
                    >
                      <Check size={11} className="shrink-0" />
                      <span>{activeClient.response}</span>
                    </div>
                  )}
                </div>
              </div>
            </RevealOnMount>
          )}
        </div>
      </div>
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}

/** Lightweight syntax-coloring of the cycling MCP commands so the user can
 *  see the binary, the URL, and the rest at a glance. Pure presentational. */
function ColorizedCmd({ cmd }: { cmd: string }) {
  // Split on the URL if it appears.
  const urlIdx = cmd.indexOf("https://");
  if (urlIdx === -1) {
    // First word = binary (emerald), rest white.
    const spaceIdx = cmd.indexOf(" ");
    if (spaceIdx === -1) {
      return <span className="text-emerald-400">{cmd}</span>;
    }
    return (
      <>
        <span className="text-emerald-400">{cmd.slice(0, spaceIdx)}</span>
        <span className="text-white/85">{cmd.slice(spaceIdx)}</span>
      </>
    );
  }
  const before = cmd.slice(0, urlIdx);
  const url = cmd.slice(urlIdx);
  const spaceIdx = before.indexOf(" ");
  return (
    <>
      <span className="text-emerald-400">
        {spaceIdx === -1 ? before : before.slice(0, spaceIdx)}
      </span>
      <span className="text-white/85">
        {spaceIdx === -1 ? "" : before.slice(spaceIdx)}
      </span>
      <span className="text-cyan-300 break-all">{url}</span>
    </>
  );
}

function ClientRow({
  name,
  path,
  status,
}: {
  name: string;
  path: string;
  status: "connected" | "disconnected";
}) {
  return (
    <div className="px-5 py-3 flex items-center gap-4">
      <div className="w-8 h-8 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[10px] font-mono text-white/60 shrink-0">
        {name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-white">{name}</div>
        <div className="text-[11px] text-white/40 font-mono truncate">
          {path}
        </div>
      </div>
      {status === "connected" ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{" "}
            Connected
          </span>
          <button
            type="button"
            className="text-[11px] text-white/60 hover:text-white px-2 py-1"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-white/40 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-white/30" /> Not
            connected
          </span>
          <button
            type="button"
            className="text-[11px] text-black bg-white px-3 py-1 rounded-md font-medium"
          >
            Connect
          </button>
        </>
      )}
    </div>
  );
}

/* ─────────────────  Tab 2: Knowledge Base  ───────────────── */

const KB_ENTRIES: { title: string; active?: boolean }[] = [
  { title: "Mistakes Samuel pushes back on" },
  { title: "Personal context — building blocks", active: true },
  { title: "Playbook — Catch-up with existing contact" },
  { title: "Playbook — Cold or warm intro" },
  { title: "Playbook — Listing to contract conversion" },
  { title: "Playbook — Reply to delayed sender" },
  { title: "README — How to use this KB" },
  { title: "Subject lines" },
  { title: "Voice and style rules" },
  { title: "Workflow when drafting an email" },
];

/** Tick gates for the Knowledge animation. Edit these numbers to retime. */
const KB_GATE = {
  entriesStart: 13, // first entry appears; subsequent entries +1 tick each
  entrySelected: 24, // "Personal context — building blocks" highlights
  title: 26,
  toolbar: 28,
  h2: 30,
  intro: 32, // typewriter paragraph starts here
  // (typewriter ~10 ticks; downstream blocks resume after it)
  h3Position: 44,
  positionBullet1: 45,
  positionBullet2: 46,
  positionBullet3: 47,
  positionBullet4: 48,
  h3Tooling: 50,
  toolingBullet: 51,
  quote: 53,
  h3Recent: 55,
  recentBullet1: 56,
  recentBullet2: 57,
  recentBullet3: 58,
  h3Tracked: 60,
  trackedIntro: 61,
  table: 63,
};

function KnowledgeMock({ kbTick }: { kbTick: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the editor pane to keep the most-recently-revealed block in
  // view as the animation progresses. Pads with pb-32 so the latest block
  // lands above the bottom fade-out overlay.
  useEffect(() => {
    if (kbTick < KB_GATE.title) return;
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [kbTick]);

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "oklch(0.11 0 0)" }}
    >
      <PageTopBar
        title="Networking emails"
        right={
          <>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] w-[280px]">
              <Search size={12} className="text-white/40" />
              <span className="text-[12px] text-white/30">Search content</span>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[12px] text-black bg-white px-3 py-1.5 rounded-md font-medium"
            >
              <Plus size={12} /> Add entry
            </button>
            <button
              type="button"
              className="text-white/60 hover:text-white px-1.5 text-[14px]"
              aria-label="More"
            >
              ⋯
            </button>
          </>
        }
      />
      <div className="flex-1 flex min-h-0">
        {/* Entries list (flat) — items fade in one by one starting at
            KB_GATE.entriesStart */}
        <aside
          className="w-72 shrink-0 border-r border-white/[0.06] flex flex-col"
          style={{ backgroundColor: "oklch(0.135 0 0)" }}
        >
          <div className="flex-1 overflow-y-auto px-2 py-3">
            <div className="flex flex-col gap-0.5">
              {KB_ENTRIES.map((e, i) => {
                const at = KB_GATE.entriesStart + i;
                const isActive =
                  e.title === "Personal context — building blocks" &&
                  kbTick >= KB_GATE.entrySelected;
                return (
                  <Reveal key={e.title} at={at} kbTick={kbTick}>
                    <button
                      type="button"
                      className={cx(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-left truncate transition-colors",
                        isActive
                          ? "bg-white/[0.06] text-white"
                          : "text-white/70 hover:bg-white/[0.04] hover:text-white",
                      )}
                    >
                      <FileText size={12} className="shrink-0 text-white/40" />
                      <span className="truncate">{e.title}</span>
                    </button>
                  </Reveal>
                );
              })}
            </div>
          </div>
          <div className="border-t border-white/[0.06] px-3 py-2.5 flex items-center gap-4 text-[12px]">
            <button
              type="button"
              className="flex items-center gap-1.5 text-white/70 hover:text-white"
            >
              <Plus size={12} /> New entry
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 text-white/70 hover:text-white"
            >
              <Folder size={12} /> New folder
            </button>
          </div>
        </aside>

        {/* Editor — content blocks reveal in sequence */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <Reveal at={KB_GATE.title} kbTick={kbTick}>
            <div className="px-12 pt-7 pb-3">
              <h1 className="text-white text-[26px] font-semibold tracking-tight leading-tight">
                Personal context — building blocks
              </h1>
            </div>
          </Reveal>

          <Reveal at={KB_GATE.toolbar} kbTick={kbTick}>
            <div className="px-12 py-1.5 border-b border-white/[0.06]">
              <div className="flex items-center gap-0.5">
                <ToolbarBtn icon={Heading1} />
                <ToolbarBtn icon={Heading2} />
                <ToolbarBtn icon={Heading3} />
                <ToolbarDivider />
                <ToolbarBtn icon={Bold} />
                <ToolbarBtn icon={Italic} />
                <ToolbarBtn icon={Underline} />
                <ToolbarBtn icon={Strikethrough} />
                <ToolbarDivider />
                <ToolbarBtn icon={List} active />
                <ToolbarBtn icon={ListOrdered} />
                <ToolbarBtn icon={Quote} />
                <ToolbarBtn icon={Table} />
                <ToolbarBtn icon={Link2} />
                <ToolbarDivider />
                <ToolbarBtn icon={Undo2} />
                <ToolbarBtn icon={Redo2} />
              </div>
            </div>
          </Reveal>

          <article className="px-12 pt-6 pb-32 max-w-3xl">
            <Reveal at={KB_GATE.h2} kbTick={kbTick}>
              <h2 className="text-white text-[19px] font-semibold mb-2.5">
                Personal context — Samuel&apos;s building blocks
              </h2>
            </Reveal>

            <Reveal at={KB_GATE.intro} kbTick={kbTick}>
              <p className="text-white/70 text-[14px] leading-relaxed mb-5 min-h-[44px]">
                <TypewriterText
                  text="Reusable bio elements. Pick what's relevant for the recipient; don't dump all of them."
                  startTick={KB_GATE.intro}
                  currentTick={kbTick}
                  speed={5}
                />
              </p>
            </Reveal>

            <Reveal at={KB_GATE.h3Position} kbTick={kbTick}>
              <h3 className="text-white text-[15px] font-semibold mb-2">
                Current position
              </h3>
            </Reveal>
            <ul className="space-y-2 mb-5 pl-1">
              <Reveal at={KB_GATE.positionBullet1} kbTick={kbTick}>
                <Bullet>
                  Left{" "}
                  <strong className="text-white">USC for SF in January</strong>{" "}
                  to be a{" "}
                  <strong className="text-white">
                    Founder in Residence at Entrepreneurs First
                  </strong>
                  .
                </Bullet>
              </Reveal>
              <Reveal at={KB_GATE.positionBullet2} kbTick={kbTick}>
                <Bullet>
                  Doing{" "}
                  <strong className="text-white">
                    forward-deployed AI work
                  </strong>{" "}
                  with a handful of companies — building agents and workflows
                  for executives and teams.
                </Bullet>
              </Reveal>
              <Reveal at={KB_GATE.positionBullet3} kbTick={kbTick}>
                <Bullet>
                  Goal: building{" "}
                  <strong className="text-white">
                    the first forward-deployed operational intelligence firm
                  </strong>
                  .
                </Bullet>
              </Reveal>
              <Reveal at={KB_GATE.positionBullet4} kbTick={kbTick}>
                <Bullet>
                  Has a <strong className="text-white">cofounder</strong>.
                </Bullet>
              </Reveal>
            </ul>

            <Reveal at={KB_GATE.h3Tooling} kbTick={kbTick}>
              <h3 className="text-white text-[15px] font-semibold mb-2">
                Tooling
              </h3>
            </Reveal>
            <ul className="space-y-2 mb-5 pl-1">
              <Reveal at={KB_GATE.toolingBullet} kbTick={kbTick}>
                <Bullet>
                  <strong className="text-white">
                    Power user of OpenClaw, Claude Code, and Cowork.
                  </strong>{" "}
                  These are his daily drivers. Mention by name when relevant.
                  Order Samuel uses:{" "}
                  <code className="font-mono text-[12px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/80">
                    OpenClaw, Claude Code, and Cowork
                  </code>
                  .
                </Bullet>
              </Reveal>
            </ul>

            <Reveal at={KB_GATE.quote} kbTick={kbTick}>
              <blockquote className="border-l-2 border-white/20 pl-4 my-5 text-white/60 italic text-[14px] leading-relaxed">
                &ldquo;If Samuel doesn&apos;t already follow you on Twitter or
                LinkedIn, you&apos;re probably not relevant enough to email
                yet.&rdquo;
              </blockquote>
            </Reveal>

            <Reveal at={KB_GATE.h3Recent} kbTick={kbTick}>
              <h3 className="text-white text-[15px] font-semibold mb-2">
                Recent work (use as portfolio bullets)
              </h3>
            </Reveal>
            <ul className="space-y-2 mb-5 pl-1">
              <Reveal at={KB_GATE.recentBullet1} kbTick={kbTick}>
                <Bullet>
                  Recently scaled a product giving agents{" "}
                  <strong className="text-white">knowledge stores</strong> to
                  specialize them (generalists → specialists).
                </Bullet>
              </Reveal>
              <Reveal at={KB_GATE.recentBullet2} kbTick={kbTick}>
                <Bullet>
                  Spent time in <strong className="text-white">Chicago</strong>{" "}
                  building an{" "}
                  <strong className="text-white">
                    agentic OS for a healthcare brokerage
                  </strong>
                  .
                </Bullet>
              </Reveal>
              <Reveal at={KB_GATE.recentBullet3} kbTick={kbTick}>
                <Bullet>
                  Has shipped{" "}
                  <strong className="text-white">
                    4+ AI products to &gt;10k total users
                  </strong>
                  .
                </Bullet>
              </Reveal>
            </ul>

            <Reveal at={KB_GATE.h3Tracked} kbTick={kbTick}>
              <h3 className="text-white text-[15px] font-semibold mb-2">
                Tracked products
              </h3>
            </Reveal>
            <Reveal at={KB_GATE.trackedIntro} kbTick={kbTick}>
              <p className="text-white/70 text-[14px] leading-relaxed mb-3">
                Reference these when the conversation calls for proof points.
              </p>
            </Reveal>
            <Reveal at={KB_GATE.table} kbTick={kbTick}>
              <div className="rounded-lg border border-white/[0.08] overflow-hidden mb-2">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-white/[0.02] border-b border-white/[0.06]">
                      <th className="text-left font-medium text-white/70 px-3 py-2">
                        Product
                      </th>
                      <th className="text-left font-medium text-white/70 px-3 py-2">
                        Users
                      </th>
                      <th className="text-left font-medium text-white/70 px-3 py-2">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    <tr>
                      <td className="px-3 py-2 text-white/80">
                        Setup Intelligence Engine
                      </td>
                      <td className="px-3 py-2 text-white/60">8.2k</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                          <span className="w-1 h-1 rounded-full bg-emerald-400" />{" "}
                          Live
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-white/80">
                        Healthcare brokerage agent
                      </td>
                      <td className="px-3 py-2 text-white/60">1.4k</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                          <span className="w-1 h-1 rounded-full bg-emerald-400" />{" "}
                          Live
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-white/80">
                        Forward-deployed AI ops
                      </td>
                      <td className="px-3 py-2 text-white/60">—</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                          <span className="w-1 h-1 rounded-full bg-amber-400" />{" "}
                          In progress
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Reveal>
          </article>
        </div>
      </div>
    </div>
  );
}

/* ─────  Animation primitives used by the Knowledge mock  ───── */

/** Renders nothing until `kbTick >= at`, then mounts its child with a
 *  short fade + slight rise. Resetting `kbTick` to a value below `at`
 *  unmounts the child so the animation replays on next entry. */
function Reveal({
  at,
  kbTick,
  children,
}: {
  at: number;
  kbTick: number;
  children: React.ReactNode;
}) {
  if (kbTick < at) return null;
  return <RevealOnMount key={at}>{children}</RevealOnMount>;
}

function RevealOnMount({
  children,
  from = "down",
  delay = 0,
  rise = 6,
  duration,
}: {
  children: React.ReactNode;
  /** Direction the element animates in from. "down" = slight rise from
   *  below; "right" = fly-in from off-screen right with a small zoom. */
  from?: "down" | "right";
  /** Delay (ms) before the entrance animation begins. */
  delay?: number;
  /** Pixels of upward translate for "down" entrances. Use larger values
   *  (e.g. 18) for hero text that should travel further. */
  rise?: number;
  /** Override transition duration in ms. Defaults to 280 (down) / 420 (right). */
  duration?: number;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), Math.max(0, delay));
    return () => window.clearTimeout(id);
  }, [delay]);
  const initial =
    from === "right"
      ? "translateX(48px) scale(0.96)"
      : `translateY(${rise}px)`;
  const ms = duration ?? (from === "right" ? 420 : 280);
  return (
    <div
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translate(0,0) scale(1)" : initial,
        transition:
          from === "right"
            ? `opacity ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1), transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
            : `opacity ${ms}ms ease-out, transform ${ms}ms ease-out`,
      }}
    >
      {children}
    </div>
  );
}

/** Char-by-char text reveal driven by the global tick. Renders a blinking
 *  caret while typing. `speed` is chars per tick (1 tick = 80ms). */
function TypewriterText({
  text,
  startTick,
  currentTick,
  speed = 5,
}: {
  text: string;
  startTick: number;
  currentTick: number;
  speed?: number;
}) {
  const elapsed = Math.max(0, currentTick - startTick);
  const charsToShow = Math.min(text.length, elapsed * speed);
  const isTyping = charsToShow < text.length;
  return (
    <>
      {text.slice(0, charsToShow)}
      {isTyping && (
        <span className="inline-block w-[2px] h-[14px] bg-white/70 align-middle ml-0.5 animate-pulse" />
      )}
    </>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-white/70 text-[14px] leading-relaxed">
      <span className="mt-2 w-1 h-1 rounded-full bg-white/40 shrink-0" />
      <span className="flex-1">{children}</span>
    </li>
  );
}

function ToolbarBtn({
  icon: Icon,
  active,
}: {
  icon: LucideIcon;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(
        "p-1.5 rounded transition-colors",
        active
          ? "bg-white/[0.08] text-white"
          : "text-white/55 hover:bg-white/[0.04] hover:text-white",
      )}
    >
      <Icon size={14} />
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 w-px h-4 bg-white/[0.08]" />;
}

/* ─────────────────────────  Tab 3: Skills  ───────────────────────── */

interface SkillEntry {
  name: string;
  desc: string;
  invocations: number;
  connectors: string[];
  expanded?: boolean;
  whenUse?: string;
  whenNot?: string;
  connectorBadges?: { name: string; connected: boolean }[];
}

const SKILLS: SkillEntry[] = [
  {
    name: "Cold outreach email writer",
    desc: "Composes personalized outbound emails from a target&apos;s LinkedIn + company signals. Writes in the user&apos;s voice.",
    invocations: 1342,
    connectors: ["linkedin", "gmail"],
    expanded: true,
    whenUse:
      "When you need a first-touch sales email tailored to a specific prospect, with research baked in.",
    whenNot:
      "When the recipient has already replied — switch to the reply-handler skill instead.",
    connectorBadges: [
      { name: "LinkedIn", connected: true },
      { name: "Gmail", connected: true },
      { name: "Slack", connected: false },
    ],
  },
  {
    name: "Polymarket trading bot",
    desc: "Auto-buys 'No' on standalone yes/no markets with positive expected value, holds to resolution.",
    invocations: 87,
    connectors: ["polymarket"],
  },
  {
    name: "Code review assistant",
    desc: "Reviews diffs for security, type safety, and adherence to repo conventions. Posts inline comments.",
    invocations: 524,
    connectors: ["github"],
  },
  {
    name: "GitHub repo analyzer",
    desc: "Crawls a repo, extracts setup instructions, and surfaces hidden configuration knobs.",
    invocations: 211,
    connectors: ["github"],
  },
  {
    name: "Linear ticket triager",
    desc: "Reads new Linear tickets, assigns severity + owner based on past triage decisions.",
    invocations: 96,
    connectors: ["linear"],
  },
];

function SkillsMock() {
  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "oklch(0.11 0 0)" }}
    >
      <PageTopBar
        title="Skills"
        right={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] text-white/40 px-2.5 py-1 rounded-md border border-white/[0.06] cursor-not-allowed"
          >
            <Plus size={12} /> New skill
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-5xl mx-auto rounded-xl border border-white/[0.08] divide-y divide-white/[0.04] bg-white/[0.01]">
          {SKILLS.map((s) => (
            <SkillRow key={s.name} skill={s} initialOpen={!!s.expanded} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SkillRow({
  skill,
  initialOpen,
}: {
  skill: SkillEntry;
  initialOpen: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 px-5 py-3.5 hover:bg-white/[0.02] text-left"
      >
        <ChevronRight
          size={14}
          className={cx(
            "mt-1 text-white/40 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-white">
              {skill.name}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1 h-1 rounded-full bg-emerald-400" /> active
            </span>
          </div>
          <p
            className="text-[12px] text-white/50 mt-0.5 line-clamp-1"
            dangerouslySetInnerHTML={{ __html: skill.desc }}
          />
        </div>
        <div className="flex items-center gap-3 shrink-0 mt-0.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-white/60 font-mono">
            <Sparkles size={11} className="text-amber-400/70" />{" "}
            {skill.invocations.toLocaleString()}
          </span>
          <div className="flex -space-x-1">
            {skill.connectors.map((c) => (
              <ConnectorIcon key={c} name={c} />
            ))}
          </div>
        </div>
      </button>
      {open && skill.whenUse && (
        <div className="px-5 pb-5 pt-1 grid grid-cols-1 md:grid-cols-2 gap-5 bg-white/[0.01]">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
              When to use
            </div>
            <p className="text-[12px] text-white/70 leading-relaxed">
              {skill.whenUse}
            </p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
              When NOT to use
            </div>
            <p className="text-[12px] text-white/70 leading-relaxed">
              {skill.whenNot}
            </p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
              Connectors
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(skill.connectorBadges ?? []).map((b) =>
                b.connected ? (
                  <span
                    key={b.name}
                    className="inline-flex items-center gap-1 text-[11px] text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20"
                  >
                    {b.name} <Check size={10} />
                  </span>
                ) : (
                  <span
                    key={b.name}
                    className="inline-flex items-center gap-1 text-[11px] text-white/50 px-2 py-0.5 rounded-full bg-white/[0.02] border border-white/[0.06]"
                  >
                    {b.name}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="flex items-end justify-end">
            <button
              type="button"
              className="bg-white text-black text-[12px] font-medium px-3 py-1.5 rounded-md"
            >
              Open
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectorIcon({ name }: { name: string }) {
  const map: Record<string, { bg: string; ch: string; fg?: string }> = {
    linkedin: { bg: "bg-[#0A66C2]", ch: "in" },
    gmail: { bg: "bg-[#EA4335]", ch: "M" },
    polymarket: { bg: "bg-[#1652F0]", ch: "P" },
    github: { bg: "bg-[#0d1117]", ch: "G" },
    linear: { bg: "bg-[#5E6AD2]", ch: "L" },
    slack: { bg: "bg-[#4A154B]", ch: "S" },
    notion: { bg: "bg-white", ch: "N", fg: "text-black" },
  };
  const m = map[name] ?? { bg: "bg-white/[0.1]", ch: "?" };
  return (
    <div
      className={cx(
        "w-5 h-5 rounded-full ring-2 ring-[oklch(0.11_0_0)] flex items-center justify-center text-[8px] font-semibold",
        m.bg,
        m.fg ?? "text-white",
      )}
    >
      {m.ch}
    </div>
  );
}

/* ─────────────────────────  Tab 4: Teams  ───────────────────────── */

function TeamsMock() {
  const teams = [
    { name: "Engineering", count: 8, color: "bg-cyan-500/80" },
    { name: "Marketing", count: 4, color: "bg-fuchsia-500/80" },
    { name: "Founders", count: 2, color: "bg-amber-500/80" },
  ];
  const resources: {
    kind: "kb" | "skill";
    name: string;
    access: boolean[];
  }[] = [
    { kind: "kb", name: "AI agents", access: [true, true, true] },
    { kind: "kb", name: "Marketing playbooks", access: [false, true, true] },
    { kind: "kb", name: "Internal docs", access: [true, true, true] },
    {
      kind: "skill",
      name: "Cold outreach email writer",
      access: [false, true, true],
    },
    {
      kind: "skill",
      name: "Polymarket trading bot",
      access: [false, false, true],
    },
    {
      kind: "skill",
      name: "Code review assistant",
      access: [true, false, true],
    },
  ];

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "oklch(0.11 0 0)" }}
    >
      <PageTopBar
        title="Teams"
        right={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] text-black bg-white px-2.5 py-1 rounded-md font-medium"
          >
            <Plus size={12} /> New team
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Teams cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {teams.map((t) => (
              <div
                key={t.name}
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className={cx(
                      "w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-semibold text-white",
                      t.color,
                    )}
                  >
                    {t.name[0]}
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-white">
                      {t.name}
                    </div>
                    <div className="text-[11px] text-white/40">
                      {t.count} members
                    </div>
                  </div>
                </div>
                <div className="flex -space-x-1.5">
                  {Array.from({ length: Math.min(t.count, 4) }).map((_, i) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded-full ring-2 ring-[oklch(0.11_0_0)] bg-gradient-to-br from-white/30 to-white/10"
                    />
                  ))}
                  {t.count > 4 && (
                    <div className="w-6 h-6 rounded-full ring-2 ring-[oklch(0.11_0_0)] bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[9px] text-white/60">
                      +{t.count - 4}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Access matrix */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-white">
                  Access matrix
                </div>
                <div className="text-[11px] text-white/40 mt-0.5">
                  Scope knowledge bases and skills to teams
                </div>
              </div>
              <button
                type="button"
                className="text-[11px] text-white/60 hover:text-white px-2 py-1 border border-white/[0.06] rounded-md"
              >
                Edit
              </button>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.01]">
                  <th className="text-left font-normal text-[10px] uppercase tracking-wider text-white/40 px-5 py-2">
                    Resource
                  </th>
                  {teams.map((t) => (
                    <th
                      key={t.name}
                      className="text-left font-normal text-[10px] uppercase tracking-wider text-white/40 px-3 py-2"
                    >
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {resources.map((r) => (
                  <tr key={r.name}>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        {r.kind === "kb" ? (
                          <BookOpen size={13} className="text-white/40" />
                        ) : (
                          <Sparkles size={13} className="text-amber-400/70" />
                        )}
                        <span className="text-white/80">{r.name}</span>
                      </div>
                    </td>
                    {r.access.map((g, i) => (
                      <td key={i} className="px-3 py-2.5">
                        {g ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                            <Check size={11} />
                          </span>
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  Shared bits  ───────────────────────── */

function PageTopBar({
  title,
  center,
  right,
}: {
  title: string;
  center?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.06] shrink-0">
      <div className="text-[13px] font-medium text-white shrink-0">{title}</div>
      {center}
      <div className="flex-1" />
      <div className="flex items-center gap-2 shrink-0">{right}</div>
    </div>
  );
}
