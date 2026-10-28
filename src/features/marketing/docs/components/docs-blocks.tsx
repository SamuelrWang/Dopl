import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";

import { capabilityAnchor, DOC_STATUS_LABEL, docHref, slugify, type CapabilityCard, type DocBlock, type DocParam, type ListItem } from "../content";
import { DOC_ICONS } from "./docs-icons";
import { CodeGroup, DocsConnect, PromptWindow } from "./docs-interactive";
import { RichText } from "./rich-text";
import { StatusBadge } from "./status-badge";

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

/**
 * The one capability card every device category uses: title with its capability id and tier, what it
 * does, limits, permission, the call (TypeScript and cURL), an example response, and model support.
 */
function Capability({ card: c }: { card: CapabilityCard }) {
  return (
    <section className="docs-cap" id={capabilityAnchor(c)}>
      <header className="docs-cap-head">
        <h3>{c.title}</h3>
        <code>{c.capability}</code>
        <span className="docs-cap-tier">{c.tier}</span>
      </header>
      <p>
        <RichText text={c.what} />
      </p>
      <dl className="docs-cap-facts">
        <dt>Limits</dt>
        <dd>
          <ul>
            {c.limits.map((l) => (
              <li key={l}>
                <RichText text={l} />
              </li>
            ))}
          </ul>
        </dd>
        <dt>Permission</dt>
        <dd>
          <RichText text={c.permission} />
        </dd>
      </dl>
      <p className="docs-cap-label">Call</p>
      <CodeGroup tabs={c.code} />
      <p className="docs-cap-label">Example response</p>
      <CodeGroup tabs={c.response} />
      <p className="docs-cap-label">Supported on</p>
      <ul className="docs-cap-support">
        {c.support.map((m) => (
          <li key={m.model}>
            <span className="docs-cap-model">{m.model}</span>
            <StatusBadge status={m.status} />
            {m.note && (
              <span className="docs-cap-note">
                <RichText text={m.note} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
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
    case "models":
      return (
        <div className="docs-models">
          <div className="docs-models-grid">
            {b.items.map((m) => (
              <div key={m.name} className="docs-model" data-status={m.status}>
                <div className="docs-model-top">
                  <span className="docs-model-name">{m.name}</span>
                  <span className="docs-model-status" data-status={m.status}>
                    {m.status === "coming_soon" ? "Planned" : DOC_STATUS_LABEL[m.status]}
                  </span>
                </div>
                <p className="docs-model-reach">{m.reach}</p>
              </div>
            ))}
          </div>
          {b.unsupported && b.unsupported.length > 0 && (
            <p className="docs-models-unsupported">
              <span>Not supported yet</span>
              {b.unsupported.join(" · ")}
            </p>
          )}
        </div>
      );
    case "support":
      return (
        <div className="docs-table-wrap">
          <table className="docs-table docs-support">
            <thead>
              <tr>
                <th>Capability</th>
                {b.models.map((m) => (
                  <th key={m}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.capability}>
                  <td>
                    <code>{r.capability}</code>
                  </td>
                  {r.cells.map((cell, i) => (
                    <td key={i}>
                      {cell ? <StatusBadge status={cell} /> : <span className="docs-support-none">Not supported</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "capability":
      return <Capability card={b} />;
    case "flow":
      return (
        <div className="docs-flow" role="list" aria-label={b.label}>
          {b.items.map((it, i) => (
            <div key={it.title} className="docs-flow-step" role="listitem">
              {i > 0 && <ArrowRight size={16} strokeWidth={1.8} className="docs-flow-arrow" aria-hidden />}
              <div className="docs-flow-node">
                <span className="docs-flow-title">{it.title}</span>
                <span className="docs-flow-detail">{it.detail}</span>
              </div>
            </div>
          ))}
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
