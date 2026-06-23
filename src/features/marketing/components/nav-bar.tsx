import Link from "next/link";

import { CTA_LABEL, NAV_LINKS, NAV_PILL } from "../constants";

/** Top navigation: brand left, links centered, "New" pill + CTA right. */
export function NavBar() {
  return (
    <nav className="dopl-nav">
      <Link href="/" className="dopl-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/favicons/android-chrome-512x512.png" alt="Dopl" />
        <span className="wm">Dopl</span>
      </Link>

      <div className="dopl-nav-links">
        {NAV_LINKS.map((label) => (
          <a key={label} href="#">
            {label}
          </a>
        ))}
      </div>

      <div className="dopl-nav-right">
        <span className="dopl-pill">
          <span className="dot" />
          <span className="badge">{NAV_PILL.badge}</span>
          {NAV_PILL.label}
        </span>
        <Link href="/login" className="dopl-cta dopl-cta--nav">
          {CTA_LABEL}
        </Link>
      </div>
    </nav>
  );
}
