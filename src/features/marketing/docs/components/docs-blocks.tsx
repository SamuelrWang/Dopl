import { Info } from "lucide-react";
import Link from "next/link";

import { docHref, slugify, type DocBlock, type DocParam, type ListItem } from "../content";
import { DOC_ICONS } from "./docs-icons";
import { CodeGroup, DocsConnect, PromptWindow } from "./docs-interactive";
import { RichText } from "./rich-text";

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
  const { text, blocks } = typeof item === "string" ? { text: item, blocks: undefined } : item;
  return (
    <li>
      <RichText text={text} />
      {blocks && <DocBlocks blocks={blocks} />}
    </li>
  );
}

/** One field: monospace name, then "required" and the type; the description beneath. */
function Param({ p }: { p: DocParam }) {
  return (
    <div className="docs-param">
      <div className="docs-param-head">
        <code className="docs-param-name">{p.name}</code>
        <span className="docs-param-meta">
          {p.required && <span>required</span>}
          {p.location && <span>{p.location}</span>}
          <span>{p.type}</span>
        </span>
      </div>
      <p className="docs-param-desc">
        <RichText text={p.description} />
      </p>
    </div>
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
        <div className="docs-callout">
          <Info size={18} strokeWidth={1.8} className="docs-callout-icon" aria-hidden />
          <p>
            <RichText text={b.text} />
          </p>
        </div>
      );
    case "list": {
      const items = b.items.map((it, i) => <Item key={i} item={it} />);
      return b.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "cards":
      return (
        <div className="docs-cards">
          {b.items.map((c) => {
            const Icon = DOC_ICONS[c.icon];
            return (
              <Link key={c.title} href={docHref(c.href)} className="lp-mp-card docs-card">
                <Icon size={22} strokeWidth={1.6} aria-hidden />
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
            <section key={s.title} className="docs-step">
              <h3>
                {i + 1}. {s.title}
              </h3>
              <DocBlocks blocks={s.blocks} />
            </section>
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
        <h2 className="docs-endpoint" id={slugify(b.path)}>
          <code>
            {b.method} {b.path}
          </code>
        </h2>
      );
    case "params":
      return (
        <section className="docs-params">
          <h3 id={slugify(b.title)} className="docs-params-title">
            {b.title}
          </h3>
          {b.params.map((p) => (
            <Param key={p.name} p={p} />
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
    case "endpoints":
      return (
        <div className="docs-table-wrap">
          <table className="docs-table docs-table-endpoints">
            <thead>
              <tr>
                <th>{b.label}</th>
                <th aria-hidden />
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.path}>
                  <td>
                    <Link href={docHref(r.href)}>
                      <code>
                        {r.method} {r.path}
                      </code>
                    </Link>
                  </td>
                  <td>{r.description}</td>
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
            <section key={e.title} id={slugify(e.date)} className="docs-changelog-entry">
              <p className="docs-changelog-date">{e.date}</p>
              <h3>{e.title}</h3>
              <p>
                <RichText text={e.description} />
              </p>
            </section>
          ))}
        </div>
      );
  }
}
