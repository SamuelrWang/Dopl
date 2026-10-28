import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { DOCS_HOME_COPY, HOME_CARDS, HOME_CORE, HOME_DEVICES, docHref, getDocPage, statusOf } from "../content";
import { DOC_ICONS } from "./docs-icons";
import { CodeGroup } from "./docs-interactive";
import { DocsShell } from "./docs-page";

function SectionHead({ title, href, more }: { title: string; href: string; more: string }) {
  return (
    <div className="docs-home-head">
      <h2>{title}</h2>
      <Link href={href} className="docs-home-more">
        {more}
        <ArrowRight size={14} strokeWidth={2} aria-hidden />
      </Link>
    </div>
  );
}

/**
 * The docs home: a hero (promise, two actions, a code sample), "Start here" cards, the device
 * categories as tiles, then a pick of Core pages. Descriptions come from the pages.
 */
export function DocsHome() {
  return (
    <DocsShell>
      <main className="docs-wrap docs-home">
        <section className="docs-intro">
          <div className="docs-intro-text">
            <p className="docs-intro-eyebrow">{DOCS_HOME_COPY.eyebrow}</p>
            <h1>{DOCS_HOME_COPY.title}</h1>
            <p className="docs-intro-sub">{DOCS_HOME_COPY.subtitle}</p>
            <div className="docs-intro-actions">
              <Link href={docHref("quickstart")} className="lp-btn lp-btn--sm lp-btn--3d">
                Start the quickstart
              </Link>
              <Link href={docHref("api-reference")} className="lp-btn lp-btn--sm lp-btn--3d-light">
                API reference
              </Link>
            </div>
          </div>
          <div className="docs-intro-code">
            <CodeGroup tabs={[{ label: "TypeScript", code: DOCS_HOME_COPY.sample }]} />
          </div>
        </section>

        <section className="docs-home-section">
          <div className="docs-home-head">
            <h2>Start here</h2>
          </div>
          <div className="docs-home-cards">
            {HOME_CARDS.map((c) => {
              const Icon = DOC_ICONS[c.icon];
              return (
                <Link key={c.slug} href={docHref(c.slug)} className="docs-home-card">
                  <span className="docs-home-icon" aria-hidden>
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <span className="docs-home-card-title">
                    {c.title}
                    <ArrowRight className="docs-home-arrow" size={14} strokeWidth={2} aria-hidden />
                  </span>
                  <span className="docs-home-desc">{getDocPage(c.slug)?.description}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="docs-home-section">
          <SectionHead title="Devices" href={docHref("devices")} more="All categories" />
          <div className="docs-home-tiles">
            {HOME_DEVICES.map((d) => {
              const Icon = DOC_ICONS[d.icon];
              const soon = statusOf(d.slug) === "coming_soon";
              return (
                <Link key={d.slug} href={docHref(d.slug)} className="docs-home-tile" data-soon={soon || undefined}>
                  <span className="docs-home-tile-top">
                    <span className="docs-home-icon" aria-hidden>
                      <Icon size={16} strokeWidth={1.75} />
                    </span>
                    {soon && <span className="docs-nav-tag">Soon</span>}
                  </span>
                  <span className="docs-home-tile-title">{d.title}</span>
                  <span className="docs-home-desc">{getDocPage(d.slug)?.description}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="docs-home-section">
          <SectionHead title="Core concepts" href={docHref("overview")} more="Overview" />
          <div className="docs-home-picks">
            {HOME_CORE.map((c) => {
              const page = getDocPage(c.slug);
              const Icon = DOC_ICONS[c.icon];
              return (
                <Link key={c.slug} href={docHref(c.slug)} className="docs-home-pick">
                  <span className="docs-home-icon" aria-hidden>
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <span className="docs-home-pick-text">
                    <span className="docs-home-pick-title">{page?.title}</span>
                    <span className="docs-home-desc">{page?.description}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    </DocsShell>
  );
}
