"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  ChevronDown,
  LayoutGrid,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { RESERVED_WORKSPACE_SLUGS } from "@/config";
import { UserMenu } from "./user-menu";

interface WorkspaceLike {
  id: string;
  name: string;
  slug: string;
}

type NavSection = "canvas" | "knowledge" | "skills" | "activity";

interface NavItem {
  label: string;
  icon: LucideIcon;
  section: NavSection;
}

const navItems: ReadonlyArray<NavItem> = [
  { label: "Canvas", icon: LayoutGrid, section: "canvas" },
  { label: "Knowledge", icon: BookOpen, section: "knowledge" },
  { label: "Skills", icon: Sparkles, section: "skills" },
  { label: "Activity", icon: Activity, section: "activity" },
];

/**
 * Pull the workspace slug out of a pathname like `/{wsSlug}/main` or
 * `/{wsSlug}/knowledge`. Returns null for top-level static routes
 * (`/login`, `/settings`, ...) and the legacy `/canvas` redirect, since
 * neither has a workspace context yet.
 */
function workspaceSlugFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0];
  if (RESERVED_WORKSPACE_SLUGS.has(first)) return null;
  return first;
}

function isCanvasPath(pathname: string): boolean {
  if (pathname === "/canvas" || pathname.startsWith("/canvas/")) return true;
  const segments = pathname.split("/").filter(Boolean);
  // /{wsSlug}/{canvasSlug} when the first segment is a workspace slug
  // (i.e. not reserved) and the second segment isn't one of the named
  // workspace sub-routes.
  if (segments.length < 2) return false;
  if (RESERVED_WORKSPACE_SLUGS.has(segments[0])) return false;
  return !["knowledge", "skills", "activity", "settings"].includes(segments[1]);
}

function sectionPathFor(slug: string, section: NavSection): string {
  if (section === "canvas") return `/${slug}`;
  return `/${slug}/${section}`;
}

export function Sidebar() {
  const pathname = usePathname();
  const slug = workspaceSlugFromPath(pathname);
  const { workspaces, currentWorkspace } = useWorkspaces(slug);
  const fallbackName = currentWorkspace?.name ?? "Workspace";

  return (
    <aside
      className="hidden md:flex h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] pointer-events-auto"
      style={{ backgroundColor: "oklch(0.13 0 0)" }}
    >
      <SidebarHeader
        currentSlug={currentWorkspace?.slug ?? slug ?? "default"}
        currentName={fallbackName}
        workspaces={workspaces}
      />
      <SidebarSearchRow />
      <SidebarNav
        pathname={pathname}
        workspaceSlug={currentWorkspace?.slug ?? slug}
      />
      <div className="mt-auto px-3 py-3 border-t border-white/[0.06]">
        <UserMenu dropdownDirection="up" />
      </div>
    </aside>
  );
}

function useWorkspaces(activeSlug: string | null) {
  const [workspaces, setWorkspaces] = useState<WorkspaceLike[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces")
      .then((r) => (r.ok ? r.json() : { workspaces: [] }))
      .then((body: { workspaces?: WorkspaceLike[] }) => {
        if (!cancelled) setWorkspaces(body.workspaces ?? []);
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentWorkspace = useMemo(() => {
    if (!workspaces || workspaces.length === 0) return null;
    if (activeSlug) {
      const match = workspaces.find((w) => w.slug === activeSlug);
      if (match) return match;
    }
    return workspaces[0];
  }, [workspaces, activeSlug]);

  return { workspaces: workspaces ?? [], currentWorkspace };
}

interface SidebarHeaderProps {
  currentSlug: string;
  currentName: string;
  workspaces: WorkspaceLike[];
}

function SidebarHeader({ currentSlug, currentName, workspaces }: SidebarHeaderProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2 px-3 py-3 border-b border-white/[0.06]"
    >
      <Link
        href={`/${currentSlug}`}
        aria-label="Dopl"
        className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md overflow-hidden"
      >
        <Image
          src="/favicons/favicon-32x32.png"
          alt="Dopl"
          width={20}
          height={20}
          className="rounded-sm"
        />
      </Link>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex-1 flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-white/[0.04] transition-colors text-left cursor-pointer"
      >
        <span className="text-sm font-medium text-text-primary truncate">
          {currentName}
        </span>
        <ChevronDown size={14} className="text-text-secondary/60 shrink-0" />
      </button>

      {open && (
        <div
          className="absolute left-3 right-3 top-full mt-1 rounded-md overflow-hidden bg-[oklch(0.16_0_0)] border border-white/[0.1] shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-10"
        >
          {workspaces.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-secondary">
              Loading workspaces…
            </div>
          ) : (
            <div className="py-1 max-h-72 overflow-auto">
              {workspaces.map((w) => (
                <Link
                  key={w.id}
                  href={`/${w.slug}`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block px-3 py-1.5 text-sm transition-colors cursor-pointer truncate",
                    w.slug === currentSlug
                      ? "bg-white/[0.06] text-text-primary"
                      : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary",
                  )}
                >
                  {w.name}
                </Link>
              ))}
            </div>
          )}
          <div className="border-t border-white/[0.06] py-1">
            <Link
              href={`/${currentSlug}/settings`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors cursor-pointer"
            >
              <Settings size={13} className="shrink-0" />
              Workspace settings
            </Link>
            <Link
              href="/workspaces"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors cursor-pointer"
            >
              <Plus size={13} className="shrink-0" />
              New workspace
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarSearchRow() {
  return (
    <div className="flex items-center gap-2 px-3 py-3 border-b border-white/[0.06]">
      <button
        type="button"
        className="flex-1 flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-white/[0.06] hover:bg-white/[0.04] transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <kbd className="font-mono px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] text-[10px] text-text-secondary/70">
            K
          </kbd>
          Quick Actions
        </span>
        <kbd className="font-mono text-[10px] text-text-secondary/40">⌘K</kbd>
      </button>
      <button
        type="button"
        aria-label="Search"
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-white/[0.06] hover:bg-white/[0.04] transition-colors cursor-pointer"
      >
        <Search size={13} className="text-text-secondary/60" />
        <kbd className="font-mono text-[10px] text-text-secondary/40">/</kbd>
      </button>
    </div>
  );
}

interface NavProps {
  pathname: string;
  workspaceSlug: string | null;
}

function SidebarNav({ pathname, workspaceSlug }: NavProps) {
  const segments = pathname.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1] ?? "";

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active =
          item.section === "canvas"
            ? isCanvasPath(pathname)
            : lastSegment === item.section;
        const className = cn(
          "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
          active
            ? "bg-white/[0.06] text-text-primary"
            : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary",
        );
        const inner = (
          <>
            <Icon size={15} className="shrink-0" />
            <span>{item.label}</span>
          </>
        );

        if (workspaceSlug) {
          return (
            <Link
              key={item.section}
              href={sectionPathFor(workspaceSlug, item.section)}
              className={className}
            >
              {inner}
            </Link>
          );
        }
        // No workspace yet (route doesn't carry one) — render as a
        // disabled-looking button so the layout doesn't shift.
        return (
          <button
            key={item.section}
            type="button"
            className={cn(className, "opacity-60")}
            disabled
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
