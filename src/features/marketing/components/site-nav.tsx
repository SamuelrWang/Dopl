"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DOWNLOAD_URL,
  GET_STARTED_LABEL,
  GET_STARTED_URL,
  MENU_LABEL,
  NAV_LINKS,
} from "../constants";
import { ArrowUpRight, MenuIcon, SearchIcon } from "./icons";
import { Logo } from "./logo";

/** Card stays mounted this long after close so `lpMenuOut` can run.
 *  ⚠ Keep in sync with marketing.css. */
const MENU_EXIT_MS = 140;

/** Read at event time, not subscribed: only gates whether a close waits for an
 *  animation. */
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type MenuState = "closed" | "open" | "closing";

/** Top bar: brand left · links + Get Started centered · search + Menu right.
 *
 * ⚠ SEARCH AND MENU ARE MUTUALLY EXCLUSIVE — opening either closes the other.
 * Both collapse on Escape (focus returns to their button) and on outside
 * mousedown.
 *
 * Below 900px marketing.css sets `.lp-nav-center` display:none, so the dark CTA
 * and search are desktop-only; a phone gets the hero CTA and the Menu. */
export function SiteNav() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuState, setMenuState] = useState<MenuState>("closed");

  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchToggleRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mirror of `menuState` for event handlers, which must not re-subscribe on
   * every state change. */
  const menuStateRef = useRef<MenuState>("closed");
  /** Row to focus once the card mounts — set only by ArrowDown/ArrowUp on the
   * closed button; a mouse open leaves focus on the button. Ref not state: the
   * card's arrival consumes it and it must not trigger its own render. */
  const menuAutoFocus = useRef<"first" | "last" | null>(null);

  useEffect(() => {
    menuStateRef.current = menuState;
  }, [menuState]);

  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    []
  );

  const closeMenu = useCallback((returnFocus = false) => {
    if (menuStateRef.current !== "open") return;
    if (exitTimer.current) clearTimeout(exitTimer.current);
    if (prefersReducedMotion()) {
      setMenuState("closed");
    } else {
      setMenuState("closing");
      exitTimer.current = setTimeout(() => setMenuState("closed"), MENU_EXIT_MS);
    }
    menuStateRef.current = "closed";
    menuAutoFocus.current = null;
    if (returnFocus) menuBtnRef.current?.focus();
  }, []);

  const collapseSearch = useCallback((returnFocus = false) => {
    setSearchOpen(false);
    setQuery("");
    if (returnFocus) searchToggleRef.current?.focus();
  }, []);

  const openMenu = useCallback((autoFocus: "first" | "last" | null = null) => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setMenuState("open");
    menuStateRef.current = "open";
    menuAutoFocus.current = autoFocus;
    setSearchOpen(false);
    setQuery("");
  }, []);

  const openSearch = useCallback(() => {
    closeMenu();
    setSearchOpen(true);
  }, [closeMenu]);

  /* Focus on grow-start, not animation-end — waiting eats first keystrokes. */
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const want = menuAutoFocus.current;
    if (menuState !== "open" || !want) return;
    menuAutoFocus.current = null;
    const items = cardRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items?.length) return;
    (want === "first" ? items[0] : items[items.length - 1])?.focus();
  }, [menuState]);

  /* Outside mousedown closes whichever surface is open. */
  useEffect(() => {
    if (!searchOpen && menuState === "closed") return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchOpen && searchRef.current && !searchRef.current.contains(target)) {
        collapseSearch();
      }
      if (menuStateRef.current === "open" && menuRef.current && !menuRef.current.contains(target)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [searchOpen, menuState, collapseSearch, closeMenu]);

  /* Escape closes and hands focus back to the control that opened it. */
  useEffect(() => {
    if (!searchOpen && menuState === "closed") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuStateRef.current === "open") closeMenu(true);
      if (searchOpen) collapseSearch(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, menuState, collapseSearch, closeMenu]);

  const moveMenuFocus = (direction: 1 | -1) => {
    const items = Array.from(
      cardRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = current === -1 ? (direction === 1 ? 0 : items.length - 1) : current + direction;
    items[(next + items.length) % items.length]?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    if (menuStateRef.current !== "open") {
      openMenu(direction === 1 ? "first" : "last");
      return;
    }
    moveMenuFocus(direction);
  };

  /* Tab past the last row closes. Row-to-row keeps relatedTarget inside the
     wrapper, so this fires only on a real exit. */
  const onMenuBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && menuRef.current?.contains(next)) return;
    closeMenu();
  };

  const menuOpen = menuState === "open";

  return (
    <header className="lp-nav">
      <div className="lp-nav-left">
        <Logo />
      </div>

      <div className="lp-nav-center">
        <nav className="lp-links">
          {NAV_LINKS.map((label) =>
            label === "Pricing" ? (
              <Link key={label} href="/pricing">
                {label}
              </Link>
            ) : (
              // Placeholder until the page exists. preventDefault is
              // load-bearing: a naked `#` navigation rewrites the URL to `/#`
              // and jump-scrolls to top, tearing the scroll-scrubbed sections
              // mid-animation.
              <a key={label} href="#" onClick={(e) => e.preventDefault()}>
                {label}
              </a>
            )
          )}
        </nav>
        <span className="lp-divider" aria-hidden />
        <a href={GET_STARTED_URL} className="lp-btn lp-btn--sm lp-btn--3d">
          {GET_STARTED_LABEL}
          <ArrowUpRight size={13} />
        </a>
      </div>

      <div className="lp-nav-right">
        {/* Slot stays one button wide; the shell inside grows leftward over
            its neighbours. */}
        <div className="lp-nav-search" data-open={searchOpen} ref={searchRef}>
          <div className="lp-icon-btn lp-nav-search-shell">
            <button
              type="button"
              ref={searchToggleRef}
              className="lp-nav-search-toggle"
              aria-label={searchOpen ? "Close search" : "Search"}
              aria-expanded={searchOpen}
              aria-controls="lp-nav-search-field"
              /* ⚠ Suppress focus shift while open, else the input's blur closes
                 the pill a beat before this click reopens it. */
              onMouseDown={(event) => {
                if (searchOpen) event.preventDefault();
              }}
              onClick={() => (searchOpen ? collapseSearch(true) : openSearch())}
            >
              <SearchIcon size={17} />
            </button>
            <input
              id="lp-nav-search-field"
              ref={inputRef}
              className="lp-nav-search-input"
              type="text"
              autoComplete="off"
              placeholder="Search"
              aria-label="Search"
              tabIndex={searchOpen ? 0 : -1}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                // TODO: no search surface exists yet — inert on purpose.
                event.preventDefault();
              }}
              onBlur={() => {
                if (query.trim() === "") collapseSearch();
              }}
            />
          </div>
        </div>

        <div
          className="lp-nav-menu"
          data-open={menuOpen}
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
          onBlur={onMenuBlur}
        >
          <button
            type="button"
            ref={menuBtnRef}
            className="lp-menu-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => (menuOpen ? closeMenu() : openMenu())}
          >
            {MENU_LABEL}
            <MenuIcon size={16} />
          </button>

          {menuState !== "closed" && (
            /* ⚠ A CLOSING CARD LEAVES THE A11Y TREE AS WELL AS THE HIT-TEST
               (2026-08-30). The CSS half is `pointer-events: none` on
               `[data-state="closing"]`; this is the half a pointer rule cannot
               do — for 140ms the card is still mounted, and a keyboard or
               screen-reader user would otherwise reach a menu that is
               dismissing. `shared/ui/popover-menu.tsx` set the precedent: it
               drops `role` and sets `inert` on exactly this transition, with
               the same sentence. */
            <div
              className="lp-nav-menu-card"
              data-state={menuState}
              ref={cardRef}
              role={menuState === "closing" ? undefined : "menu"}
              inert={menuState === "closing"}
              aria-label={MENU_LABEL}
            >
              {/* TODO: no destination for Product yet — non-navigating.
                  preventDefault keeps `#` from rewriting the URL to `/#`. */}
              <a
                role="menuitem"
                className="lp-nav-menu-item"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  closeMenu();
                }}
              >
                Product
              </a>
              {/* TODO: no destination for Services yet — non-navigating. */}
              <a
                role="menuitem"
                className="lp-nav-menu-item"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  closeMenu();
                }}
              >
                Services
              </a>
              <Link
                role="menuitem"
                className="lp-nav-menu-item"
                href="/pricing"
                onClick={() => closeMenu()}
              >
                Pricing
              </Link>
              {/* ⚠ Plain anchor, not next/link: /download is a route handler
                  redirecting to the dmg, not a page. */}
              <a
                role="menuitem"
                className="lp-nav-menu-item"
                href={DOWNLOAD_URL}
                onClick={() => closeMenu()}
              >
                Download
              </a>
              <div className="lp-nav-menu-divider" role="separator" />
              <a
                role="menuitem"
                className="lp-btn lp-btn--3d lp-nav-menu-cta"
                href={GET_STARTED_URL}
                onClick={() => closeMenu()}
              >
                {GET_STARTED_LABEL}
                <ArrowUpRight size={12} />
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
