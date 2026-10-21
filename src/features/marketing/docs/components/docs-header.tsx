"use client";

import { Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Logo } from "../../components/logo";
import { ASK_INPUT_ID } from "./docs-interactive";

export interface SearchEntry {
  title: string;
  group: string;
  href: string;
}

export interface HeaderTab {
  label: string;
  href: string;
  active: boolean;
}

function focusAsk() {
  document.getElementById(ASK_INPUT_ID)?.focus();
}

/**
 * Two rows: brand · Search ⌘K · Ask Assistant ⌘I · Main site, then the section tabs with
 * the active one underlined. Search filters page titles; it is not full-text yet.
 */
export function DocsHeader({ tabs, entries }: { tabs: HeaderTab[]; entries: SearchEntry[] }) {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (key === "i") {
        e.preventDefault();
        focusAsk();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="docs-header">
      <div className="docs-header-top">
        <div className="docs-header-brand">
          <Logo />
        </div>
        <div className="docs-header-center">
          <button type="button" className="docs-search-btn seg-pill" onClick={() => setSearchOpen(true)}>
            <Search size={16} aria-hidden />
            <span className="docs-search-label">Search...</span>
            <kbd>⌘K</kbd>
          </button>
          <button type="button" className="docs-assistant-btn auth-btn-3d" onClick={focusAsk}>
            <Sparkles size={14} aria-hidden />
            <span>Ask Assistant</span>
            <kbd>⌘I</kbd>
          </button>
        </div>
        <div className="docs-header-end">
          <Link href="/" className="docs-main-site">
            Main site
          </Link>
        </div>
      </div>
      <nav className="docs-header-tabs" aria-label="Sections">
        <div className="seg-track">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={t.active ? "docs-header-tab raised-tab" : "docs-header-tab"}
              aria-current={t.active ? "page" : undefined}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
      {searchOpen && <SearchDialog entries={entries} onClose={() => setSearchOpen(false)} />}
    </header>
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
      <div ref={panel} className="docs-search-panel bento" role="dialog" aria-label="Search the docs">
        <div className="docs-search-field">
          <Search size={16} aria-hidden />
          <input
            autoFocus
            value={query}
            placeholder="Search..."
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
