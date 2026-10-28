import "@/features/marketing/closing.css";

import Link from "next/link";

import { FOOTER_COLUMNS, FOOTER_COPY, type FooterLink } from "./closing-content";
import { Logo } from "./logo";

/** Landing footer: brand column + link columns, copyright row.
 *  ⚠ Every link is a real route (src/app) or an on-page anchor; see
 *  closing-content.ts › FOOTER_COLUMNS. */
function FooterAnchor({ link }: { link: FooterLink }) {
  const body = (
    <>
      {link.label}
      {link.tag && <span className="lp-foot-tag">{link.tag}</span>}
    </>
  );
  // Hash anchors and route handlers are plain anchors; pages use next/link.
  if (link.plain || link.href.includes("#")) {
    return (
      <a href={link.href} className="lp-foot-link">
        {body}
      </a>
    );
  }
  return (
    <Link href={link.href} className="lp-foot-link">
      {body}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-foot-inner">
        <div className="lp-foot-brand">
          <Logo />
          <p className="lp-foot-tagline">{FOOTER_COPY.tagline}</p>
        </div>

        <nav className="lp-foot-cols" aria-label="Footer">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title} className="lp-foot-col">
              <h3 className="lp-foot-title">{col.title}</h3>
              <ul className="lp-foot-list">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <FooterAnchor link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="lp-foot-bottom">
        <p className="lp-foot-copy">{FOOTER_COPY.copyright}</p>
      </div>
    </footer>
  );
}
