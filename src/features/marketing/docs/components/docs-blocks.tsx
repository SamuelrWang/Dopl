import {
  Activity,
  ArrowRight,
  Bell,
  Check,
  Code,
  FlaskConical,
  Glasses,
  KeyRound,
  Laptop,
  Layers,
  Link2,
  MessageCircleQuestion,
  Monitor,
  MonitorSmartphone,
  Route,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { docHref, slugify, type DocBlock, type DocIcon, type ListItem } from "../content";
import { CodeGroup, DocsConnect, PromptWindow } from "./docs-interactive";
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
  key: KeyRound,
  shield: ShieldCheck,
  layers: Layers,
  activity: Activity,
  code: Code,
  test: FlaskConical,
};

export function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </>
  );
}

function Item({ item, check }: { item: string | ListItem; check: boolean }) {
  const { text, blocks } = typeof item === "string" ? { text: item, blocks: undefined } : item;
  if (check) {
    return (
      <li className="lp-ctl-item docs-check-item">
        <Check size={15} strokeWidth={2} className="lp-ctl-check" aria-hidden />
        <span>
          <RichText text={text} />
        </span>
      </li>
    );
  }
  return (
    <li>
      <RichText text={text} />
      {blocks && <DocBlocks blocks={blocks} />}
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
        <blockquote>
          <RichText text={b.text} />
        </blockquote>
      );
    case "list": {
      const items = b.items.map((it, i) => <Item key={i} item={it} check={!b.ordered} />);
      return b.ordered ? <ol>{items}</ol> : <ul className="lp-ctl-list docs-check-list">{items}</ul>;
    }
    case "cards":
      return (
        <div className="docs-cards">
          {b.items.map((c) => {
            const Icon = ICONS[c.icon];
            return (
              <Link key={c.title} href={docHref(c.href)} className="lp-mp-card docs-card">
                <Icon size={16} className="docs-card-icon" aria-hidden />
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
              <div className="docs-step-number">{i + 1}</div>
              <p className="docs-step-title">{s.title}</p>
              <div className="docs-step-content">
                <DocBlocks blocks={s.blocks} />
              </div>
            </div>
          ))}
        </div>
      );
    case "prompt":
      return (
        <PromptWindow text={b.text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")}>
          <RichText text={b.text} />
        </PromptWindow>
      );
    case "connect":
      return <DocsConnect />;
    case "code":
      return <CodeGroup tabs={b.tabs} />;
    case "hero":
      return (
        <div className="docs-hero">
          <div className="docs-hero-card">
            <div className="lp-mp-chrome" aria-hidden>
              <span />
              <span />
              <span />
            </div>
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
        <div className="docs-endpoint">
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
        <div className="docs-table-wrap">
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
    case "flow":
      return (
        <figure className="docs-flow" aria-label={b.label}>
          {b.items.map((it, i) => (
            <div key={it.title} className="docs-flow-step">
              {i > 0 && <ArrowRight size={16} className="docs-flow-arrow" aria-hidden />}
              <div className="docs-flow-node">
                <span className="docs-flow-title">{it.title}</span>
                <span className="docs-flow-detail">{it.detail}</span>
              </div>
            </div>
          ))}
        </figure>
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
