"use client";

import { Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { GET_STARTED_URL } from "../../constants";
import { Logo } from "../../components/logo";

export interface SearchEntry {
  title: string;
  group: string;
  href: string;
}

/**
 * The docs frame: a full-height sidebar (logo + "Docs", then `nav`) and, over the content
 * column only, a top bar — Search on the left, "Main site" and "Get API key" on the right.
 * Below 1024px the sidebar slides in behind the menu button.
 *
 * The drawer remembers the path it opened on, so following a link closes it with no effect.
 */
export function DocsFrame({ nav, entries, children }: { nav: ReactNode; entries: SearchEntry[]; children: ReactNode }) {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const navOpen = openOn !== null && openOn === pathname;
  const sidebar = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpenOn(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the drawer on a press outside it — a document listener, not a scrim `onClick`
  // (INVARIANTS §15).
  useEffect(() => {
    if (!navOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (sidebar.current?.contains(target) || target.closest?.(".docs-menu-btn")) return;
      setOpenOn(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [navOpen]);

  return (
    <div className="lp docs" data-nav-open={navOpen || undefined}>
      <aside ref={sidebar} className="docs-sidebar">
        <div className="docs-sidebar-head">
          <Logo />
          <span className="docs-sidebar-label">Docs</span>
          <button
            type="button"
            className="lp-icon-btn docs-close-btn"
            aria-label="Close navigation"
            onClick={() => setOpenOn(null)}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        {nav}
      </aside>

      <div className="docs-main">
        <header className="docs-topbar">
          <div className="docs-topbar-start">
            <button
              type="button"
              className="lp-icon-btn docs-menu-btn"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setOpenOn(navOpen ? null : pathname)}
            >
              <Menu size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="lp-btn lp-btn--sm lp-btn--3d-light docs-search-btn"
              onClick={() => setSearchOpen(true)}
            >
              <span className="docs-search-label">Search</span>
              <Search size={16} aria-hidden />
            </button>
          </div>
          <div className="docs-topbar-end">
            <Link href="/" className="lp-ctl-secondary docs-main-site">
              Main site
            </Link>
            <a href={GET_STARTED_URL} className="lp-btn lp-btn--sm lp-btn--3d">
              Get API key
            </a>
          </div>
        </header>

        {children}
      </div>

      {searchOpen && <SearchDialog entries={entries} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function SearchDialog({ entries, onClose }: { entries: SearchEntry[]; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const panel = useRef<HTMLDivElement>(null);

  // Dismiss on a press outside the panel — a document listener, not an `onClick` on the
  // scrim, so the whole page never wears the hand cursor (INVARIANTS §15).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => `${e.title} ${e.group}`.toLowerCase().includes(q));
  }, [entries, query]);

  const go = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  };

  return (
    <div className="docs-search-scrim">
      <div ref={panel} className="docs-search-panel" role="dialog" aria-label="Search the docs">
        <div className="docs-search-field">
          <Search size={16} aria-hidden />
          <input
            autoFocus
            value={query}
            placeholder="Search"
            aria-label="Search the docs"
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") go(results[cursor]);
            }}
          />
        </div>
        <ul className="docs-search-results">
          {results.length === 0 && <li className="docs-search-empty">No results</li>}
          {results.map((r, i) => (
            <li key={r.href}>
              <button
                type="button"
                className="docs-search-result"
                data-active={i === cursor || undefined}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r)}
              >
                <span className="docs-search-group">{r.group}</span>
                <span>{r.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
