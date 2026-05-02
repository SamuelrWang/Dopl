"use client";

import { useEffect, useRef } from "react";
import {
  Bold,
  FileText,
  Folder,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Plus,
  Quote,
  Redo2,
  Search,
  Strikethrough,
  Table,
  Underline,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";

import { KB_ENTRIES, KB_GATE } from "../constants";
import { PageTopBar } from "./page-top-bar";
import { Reveal, TypewriterText } from "./reveal";

export function KnowledgeMock({ kbTick }: { kbTick: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the editor pane to keep the most-recently-revealed block in
  // view. Pads with pb-32 so the latest block lands above the bottom fade.
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
                      className={cn(
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
      className={cn(
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
