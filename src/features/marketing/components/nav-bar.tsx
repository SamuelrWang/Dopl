import Link from "next/link";

import { NAV_LINKS, HERO } from "../constants";

/** Floating cream pill nav — brand wordmark, links, primary CTA. */
export function NavBar() {
  return (
    <nav className="nav">
      <div className="nav-pill">
        <Link href="/" className="brand">
          <span className="logo">
            <i></i>
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span className="name">Dopl</span>
        </Link>
        <div className="nav-links">
          {NAV_LINKS.map((link) => (
            <a key={link.label} href="#">
              {link.label}
              {link.caret && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
            </a>
          ))}
        </div>
        <span className="nav-divider"></span>
        <Link className="btn-dl" href="/login">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
          {HERO.cta}
        </Link>
      </div>
    </nav>
  );
}
