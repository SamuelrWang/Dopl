"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { CreateCanvasDialog } from "./create-canvas-dialog";
import type { Canvas } from "../types";

/**
 * Header pill that shows the current canvas name and lets the user
 * switch to another canvas, manage canvases, or create a new one.
 *
 * Renders only on `/canvas/*` and `/canvases/*` routes — anywhere else
 * the active-canvas concept doesn't apply, and the pill would just be a
 * cosmetic dropdown.
 */
export function CanvasSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ slug?: string }>();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [canvases, setCanvases] = useState<Canvas[] | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const showSwitcher =
    pathname.startsWith("/canvas") || pathname.startsWith("/canvases");

  // Fetch on first open. Not eagerly — keeps the header fast on every
  // page load and avoids querying when the user never opens it.
  useEffect(() => {
    if (!open || canvases !== null) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/canvases")
      .then((r) => (r.ok ? r.json() : { canvases: [] }))
      .then((body: { canvases: Canvas[] }) => {
        if (cancelled) return;
        setCanvases(body.canvases ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setCanvases([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, canvases]);

  // Click-outside close.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!showSwitcher) return null;

  // Resolve the active canvas's display name without requiring a fetch.
  const activeSlug = params?.slug ?? null;
  const activeCanvas = canvases?.find((c) => c.slug === activeSlug) ?? null;
  const label = activeCanvas?.name ?? activeSlug ?? "Canvas";

  return (
    <>
      <div className="relative shrink-0" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.12em] font-medium text-white/70 bg-white/[0.06] border border-white/[0.12] hover:bg-white/[0.10] hover:text-white/90 hover:border-white/[0.2] transition-colors duration-150 select-none max-w-[180px]"
        >
          <span className="truncate">{label}</span>
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            aria-hidden
            className="shrink-0 opacity-60"
          >
            <path
              d="M1 2.5L4 5.5L7 2.5"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 w-64 rounded-lg overflow-hidden bg-[oklch(0.16_0_0)] border border-white/[0.1] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          >
            <div className="px-3 py-2 border-b border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider text-white/40 font-medium">
                Canvases
              </p>
            </div>

            <div className="py-1 max-h-72 overflow-y-auto">
              {loading && (
                <div className="px-3 py-2 text-xs text-white/40">Loading…</div>
              )}
              {!loading && canvases && canvases.length === 0 && (
                <div className="px-3 py-2 text-xs text-white/40">
                  No canvases yet.
                </div>
              )}
              {!loading &&
                canvases?.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(`/canvas/${c.slug}`);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                      c.slug === activeSlug
                        ? "bg-white/[0.06] text-white"
                        : "text-white/70 hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                    {c.slug === activeSlug && (
                      <span className="text-[10px] uppercase tracking-wider text-white/40 shrink-0">
                        Active
                      </span>
                    )}
                  </button>
                ))}
            </div>

            <div className="border-t border-white/[0.06] py-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer flex items-center gap-2"
              >
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/30 text-[11px] leading-none">
                  +
                </span>
                New canvas
              </button>
              <Link
                href="/canvases"
                onClick={() => setOpen(false)}
                className="block px-3 py-1.5 text-sm text-white/60 hover:bg-white/[0.06] hover:text-white transition-colors"
              >
                Manage canvases
              </Link>
            </div>
          </div>
        )}
      </div>

      <CreateCanvasDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(canvas) => {
          // Invalidate the local list so the dropdown picks up the new row.
          setCanvases((prev) => (prev ? [canvas, ...prev] : prev));
        }}
      />
    </>
  );
}
