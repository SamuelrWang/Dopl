"use client";

import Image from "next/image";
import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Home,
  LayoutGrid,
  MessageSquare,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";

import type { TabId } from "../constants";

export function SidebarMock({
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
      className={cn(
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
        className={cn(
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
              className={cn(
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
