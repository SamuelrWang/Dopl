"use client";

import { useState } from "react";
import Link from "next/link";
import { DOWNLOAD_LABEL, DOWNLOAD_URL, MENU_LABEL, NAV_LINKS } from "../constants";
import { ArrowUpRight, MenuIcon, SearchIcon } from "./icons";
import { Logo } from "./logo";
import { PricingModal } from "./pricing-modal";

/** Top bar: brand left · links + Download centered · search + Menu right.
 * "Pricing" opens the popup (href stays /pricing for middle-click/no-JS).
 *
 * The dark button here was Login; it is the same button with the same classes,
 * pointed at the download (../constants.ts). Below 900px `.lp-nav-center` is
 * display:none, so this button is desktop-only — unchanged from the Login era,
 * and the hero's CTA is the one a phone sees. */
export function SiteNav() {
  const [pricingOpen, setPricingOpen] = useState(false);

  return (
    <header className="lp-nav">
      <div className="lp-nav-left">
        <Logo />
      </div>

      <div className="lp-nav-center">
        <nav className="lp-links">
          {NAV_LINKS.map((label) =>
            label === "Pricing" ? (
              <Link
                key={label}
                href="/pricing"
                onClick={(e) => {
                  e.preventDefault();
                  setPricingOpen(true);
                }}
              >
                {label}
              </Link>
            ) : (
              <a key={label} href="#">
                {label}
              </a>
            )
          )}
        </nav>
        <span className="lp-divider" aria-hidden />
        <a href={DOWNLOAD_URL} download className="lp-btn lp-btn--sm lp-btn--3d">
          {DOWNLOAD_LABEL}
          <ArrowUpRight size={13} />
        </a>
      </div>

      <div className="lp-nav-right">
        <button type="button" className="lp-icon-btn" aria-label="Search">
          <SearchIcon size={17} />
        </button>
        <button type="button" className="lp-menu-btn">
          {MENU_LABEL}
          <MenuIcon size={16} />
        </button>
      </div>

      {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} />}
    </header>
  );
}
