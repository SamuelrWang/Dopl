import {
  Bell,
  Glasses,
  KeyRound,
  Laptop,
  Link2,
  MessageCircleQuestion,
  Monitor,
  MonitorSmartphone,
  MousePointer2,
  Route,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { docHref, slugify, type DocBlock, type DocIcon, type DocLogo, type ListItem } from "../content";
import { CodeGroup, DocsTabs } from "./docs-interactive";
import { RichText } from "./rich-text";

const ICONS: Record<DocIcon, LucideIcon> = {
  show: Monitor,
  ask: MessageCircleQuestion,
  notify: Bell,
  connect: Link2,
  route: Route,
  glasses: Glasses,
  phone: Smartphone,
  notch: Laptop,
  desktop: MonitorSmartphone,
};

/** One agent-bank hue per card / step, spaced round the wheel so neighbours never match. */
const HUES = [11, 7, 1, 14, 4, 9, 16, 5];
export function hue(i: number): string {
  return `var(--agent-color-${String(HUES[i % HUES.length]).padStart(2, "0")})`;
}

/** Brand marks that ship in `public/img/onboarding/`; the rest are generic glyphs. */
const LOGO_SRC: Partial<Record<DocLogo, string>> = {
  claude: "/img/onboarding/claude-logo.svg",
  chatgpt: "/img/onboarding/chatgpt-logo.svg",
  codex: "/img/onboarding/chatgpt-logo.svg",
};
const LOGO_ICON: Partial<Record<DocLogo, LucideIcon>> = { cursor: MousePointer2, key: KeyRound };

function Logo({ logo }: { logo: DocLogo }) {
  const src = LOGO_SRC[logo];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={16} height={16} className="docs-accordion-logo" />;
  }
  const Icon = LOGO_ICON[logo] ?? KeyRound;
  return <Icon size={16} className="docs-accordion-logo" aria-hidden />;
}

export function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </>
  );
}

function Item({ item }: { item: string | ListItem }) {
  if (typeof item === "string") {
    return (
      <li>
        <RichText text={item} />
      </li>
    );
  }
  return (
    <li>
      <RichText text={item.text} />
      {item.blocks && <DocBlocks blocks={item.blocks} />}
    </li>
  );
}

function Block({ block: b }: { block: DocBlock }) {
  switch (b.type) {
    case "p":
      return (
        <p>
          <RichText text={b.text} />
        </p>
      );
    case "h2":
      return <h2 id={slugify(b.text)}>{b.text}</h2>;
    case "h3":
      return <h3 id={slugify(b.text)}>{b.text}</h3>;
    case "quote":
      return (
        <blockquote className="docs-bubble">
          <RichText text={b.text} />
        </blockquote>
      );
    case "list": {
      const items = b.items.map((it, i) => <Item key={i} item={it} />);
      return b.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "cards":
      return (
        <div className="docs-cards">
          {b.items.map((c, i) => {
            const Icon = ICONS[c.icon];
            return (
              <Link key={c.title} href={docHref(c.href)} className="docs-card bento card-lift">
                <span className="docs-card-icon" style={{ background: hue(i) }}>
                  <Icon size={15} aria-hidden />
                </span>
                <span className="docs-card-title">{c.title}</span>
                <span className="docs-card-desc">
                  <RichText text={c.description} />
                </span>
              </Link>
            );
          })}
        </div>
      );
    case "steps":
      return (
        <div className="docs-steps">
          {b.items.map((s, i) => (
            <div key={s.title} className="docs-step">
              <div className="docs-step-line" aria-hidden />
              <div className="docs-step-number" style={{ borderColor: hue(i) }}>
                {i + 1}
              </div>
              <p className="docs-step-title">{s.title}</p>
              <div className="docs-step-content">
                <DocBlocks blocks={s.blocks} />
              </div>
            </div>
          ))}
        </div>
      );
    case "tabs":
      return (
        <DocsTabs
          labels={b.tabs.map((t) => t.label)}
          panels={b.tabs.map((t) => (
            <DocBlocks key={t.label} blocks={t.blocks} />
          ))}
        />
      );
    case "accordions":
      return (
        <div className="docs-accordions bento">
          {b.items.map((a) => (
            <details key={a.title} className="docs-accordion">
              <summary>
                <svg className="docs-accordion-caret" viewBox="0 0 18 18" width={12} height={12} aria-hidden>
                  <path
                    d="M14 4H4c-.64 0-1.23.35-1.53.9-.31.56-.29 1.25.05 1.79l5.03 7.92c.32.51.87.81 1.47.81s1.15-.3 1.48-.81l5.02-7.92c.34-.54.36-1.23.05-1.79A1.75 1.75 0 0 0 14 4Z"
                    fill="currentColor"
                  />
                </svg>
                {a.logo && <Logo logo={a.logo} />}
                <span>{a.title}</span>
              </summary>
              <div className="docs-accordion-body">
                <DocBlocks blocks={a.blocks} />
              </div>
            </details>
          ))}
        </div>
      );
    case "code":
      return <CodeGroup tabs={b.tabs} />;
    case "hero":
      return (
        <div className="docs-hero">
          <div className="docs-hero-card bento">
            <span className="docs-hero-label">{b.label}</span>
            {b.lines.map((line, i) => (
              <span key={line} className={i === 0 ? "docs-hero-line-strong" : "docs-hero-line"}>
                {line}
              </span>
            ))}
          </div>
        </div>
      );
    case "endpoint":
      return (
        <div className="docs-endpoint bento">
          <span className="docs-method" data-method={b.method}>
            {b.method}
          </span>
          <code>{b.path}</code>
        </div>
      );
    case "params":
      return (
        <section className="docs-params">
          <h2 id={slugify(b.title)}>{b.title}</h2>
          {b.params.map((p) => (
            <div key={p.name} className="docs-param">
              <div className="docs-param-head">
                <code className="docs-param-name">{p.name}</code>
                <span className="docs-chip">{p.type}</span>
                {p.location && <span className="docs-chip">{p.location}</span>}
                {p.required && <span className="docs-chip docs-chip-required">required</span>}
              </div>
              <p>
                <RichText text={p.description} />
              </p>
            </div>
          ))}
        </section>
      );
    case "table":
      return (
        <div className="docs-table-wrap bento">
          <table className="docs-table">
            <thead>
              <tr>
                {b.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <RichText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "changelog":
      return (
        <div className="docs-changelog">
          {b.entries.map((e) => (
            <article key={e.title} id={slugify(e.date.split(" ")[0])} className="docs-changelog-entry">
              <span className="docs-changelog-date">{e.date}</span>
              <div>
                <h2>{e.title}</h2>
                <p className="docs-changelog-desc">
                  <RichText text={e.description} />
                </p>
                <div className="docs-changelog-media" aria-hidden />
              </div>
            </article>
          ))}
        </div>
      );
  }
}
