"use client";

import { useState } from "react";
import Link from "next/link";
import { LOGIN_LABEL, MENU_LABEL, NAV_LINKS } from "../constants";
import { ArrowUpRight, MenuIcon, SearchIcon } from "./icons";
import { Logo } from "./logo";
import { PricingModal } from "./pricing-modal";

/** Top bar: brand left · links + Login centered · search + Menu right.
 * "Pricing" opens the popup (href stays /pricing for middle-click/no-JS). */
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
        <Link href="/login" className="lp-btn lp-btn--sm lp-btn--3d">
          {LOGIN_LABEL}
          <ArrowUpRight size={13} />
        </Link>
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
