"use client";

/** A documentation site: its frame, sidebar tree, long text, code and reference rows. See README.md. */
import { ArrowRight, Check, ChevronRight, Copy, Info } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import b from "./base.module.css";
import c from "./catalog.module.css";
import { cx, ICON, ICON_SM } from "./components";
import d from "./data.module.css";
import s from "./docs.module.css";
import k from "./keys.module.css";
import o from "./surfaces.module.css";
import { Text } from "./ui-page";

/* Frame */
/** Holds the sidebar. Below 1024px it is a drawer. */
export const DocNavSlot = ({ open, slotRef, children }: { open: boolean; slotRef?: React.Ref<HTMLDivElement>; children: ReactNode }) => (
  <div ref={slotRef} className={cx(s.navSlot, open && s.navOpen)}>
    {children}
  </div>
);
export const DocMain = ({ children }: { children: ReactNode }) => <div className={s.main}>{children}</div>;
/** Only below 1024px: the way into the drawer. */
export const DocMobileBar = ({ children }: { children: ReactNode }) => <div className={s.mobileBar}>{children}</div>;
export const DocFootActions = ({ children }: { children: ReactNode }) => <div className={s.footActions}>{children}</div>;

export function DocBrand({ href, label, mark, children }: { href: string; label: string; mark: ReactNode; children: ReactNode }) {
  return (
    <span className={b.between}>
      <Link href={href} className={s.brand} aria-label={label}>
        {mark}
        <Text kind="h3">{label}</Text>
      </Link>
      {children}
    </span>
  );
}

/* Sidebar tree */
export function NavFolder({ icon, label, tag, open, onToggle, children }: { icon: ReactNode; label: string; tag?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div>
      <button type="button" className={cx(o.navItem, s.folderRow)} aria-expanded={open} onClick={onToggle}>
        {icon}
        <span className={b.clip}>{label}</span>
        {tag && <span className={s.navTag}>{tag}</span>}
        <ChevronRight {...ICON_SM} aria-hidden="true" className={cx(s.chevron, open && s.chevronOpen)} />
      </button>
      {open && <div className={s.children}>{children}</div>}
    </div>
  );
}
export const NavSubhead = ({ children }: { children: ReactNode }) => <span className={s.subhead}>{children}</span>;

export function NavAnchors({ items }: { items: { id: string; text: string }[] }) {
  return (
    <ul className={s.anchors}>
      {items.map((a) => (
        <li key={a.id}>
          <a className={s.anchor} href={`#${a.id}`}>
            {a.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/* Page */
export const DocColumn = ({ wide, children }: { /** Holds cards or code beside text, not text alone. */ wide?: boolean; children: ReactNode }) => <div className={cx(s.column, wide && s.columnWide)}>{children}</div>;

export function DocHead({ group, title, badge, action, children }: { group?: string; title: string; badge?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <header className={s.head}>
      {group && <Text kind="smallMuted">{group}</Text>}
      <div className={s.headTitle}>
        <h1 className={s.h1}>
          {title}
          {badge}
        </h1>
        {action}
      </div>
      {children && <Text kind="muted" as="p">{children}</Text>}
    </header>
  );
}

/** Text, with the code that goes with it held in view beside it. */
export function DocSplit({ left, right, label }: { left: ReactNode; right: ReactNode; label: string }) {
  return (
    <div className={s.split}>
      {left}
      <aside className={s.sticky} aria-label={label}>
        {right}
      </aside>
    </div>
  );
}

/** A docs home's lead: the promise and what to press, beside a sample. */
export function DocIntro({ eyebrow, title, sub, actions, side }: { eyebrow: string; title: string; sub: string; actions: ReactNode; side: ReactNode }) {
  return (
    <section className={s.intro}>
      <div className={s.introText}>
        <Text kind="smallMuted">{eyebrow}</Text>
        <h1 className={s.h1}>{title}</h1>
        <Text kind="muted" as="p">{sub}</Text>
        <div className={s.introActions}>{actions}</div>
      </div>
      {side}
    </section>
  );
}

export const DocFoot = ({ children }: { children: ReactNode }) => <footer className={s.foot}>{children}</footer>;
export const DocSocial = ({ href, label, children }: { href: string; label: string; children: ReactNode }) => (
  <a className={s.social} href={href} target="_blank" rel="noreferrer" aria-label={label}>
    {children}
  </a>
);

/* Long text */
export const Prose = ({ children }: { children: ReactNode }) => <div className={s.prose}>{children}</div>;
/** A line of data text, inside a card or row, where `code` and links still read. */
export const Inline = ({ small, children }: { small?: boolean; children: ReactNode }) => <span className={cx(s.inline, small && s.inlineMuted)}>{children}</span>;
export const Anchored = ({ id, children }: { id: string; children: ReactNode }) => (
  <div id={id} className={s.anchored}>
    {children}
  </div>
);
export const DocGrid = ({ children }: { children: ReactNode }) => <div className={c.grid}>{children}</div>;

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className={s.callout}>
      <Info {...ICON} aria-hidden="true" className={b.iconSoft} />
      <Inline>{children}</Inline>
    </div>
  );
}

/* Code */
/** Copy, in a black frame's head. */
export function InkCopy({ text }: { text: string }) {
  const { copied, copy } = useCopyToClipboard(600);
  return (
    <button type="button" className={s.inkCopy} onClick={() => void copy(text)}>
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      {copied ? <Check {...ICON_SM} aria-hidden="true" /> : <Copy {...ICON_SM} aria-hidden="true" />}
    </button>
  );
}

/** The gallery's black code block, with tabs when there are several versions, and Copy. */
export function CodeTabs({ tabs }: { tabs: { label: string; code: string }[] }) {
  const [active, setActive] = useState(0);
  const current = tabs[active] ?? tabs[0];
  return (
    <div className={d.code}>
      <div className={d.codeHead}>
        {tabs.length > 1 ? (
          <div className={s.codeTabs} role="tablist">
            {tabs.map((tab, i) => (
              <button key={tab.label} type="button" role="tab" aria-selected={i === active} className={cx(s.codeTab, i === active && s.codeTabOn)} onClick={() => setActive(i)}>
                {tab.label}
              </button>
            ))}
          </div>
        ) : (
          <span className={b.onInk}>{current.label}</span>
        )}
        <InkCopy text={current.code} />
      </div>
      <pre className={cx(d.codeBody, k.codeBody)}>
        <code>{current.code}</code>
      </pre>
    </div>
  );
}

/* Reference */
export function DocEndpoint({ id, method, path }: { id: string; method: ReactNode; path: string }) {
  return (
    <h2 id={id} className={cx(s.endpoint, s.anchored)}>
      {method}
      <Text kind="mono">{path}</Text>
    </h2>
  );
}

export function ParamRow({ name, badges, children }: { name: string; badges: ReactNode; children: ReactNode }) {
  return (
    <div className={s.param}>
      <div className={s.paramHead}>
        <Text kind="mono">{name}</Text>
        {badges}
      </div>
      <Inline>{children}</Inline>
    </div>
  );
}

/** A reference table: rows grow with their text, where a DataTable's hold one line. */
export function DocTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className={s.tableWrap}>
      <table className={cx(d.dt, s.table)}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} scope="col" className={cx(d.dtHead, s.tableHead)}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={d.dtRow}>
              {row.map((cell, i) => (
                <td key={i} className={cx(d.dtCell, s.tableCell)}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Numbered steps on a rail. */
export function DocSteps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className={s.steps}>
      {items.map((item, i) => (
        <li key={item.title} className={s.step}>
          <span className={s.stepRail}>
            <span className={cx(o.stepDot, o.stepDone)}>{i + 1}</span>
            <span className={s.stepRailLine} />
          </span>
          <div className={s.stepBody}>
            <Text kind="h3" as="h3">{item.title}</Text>
            {item.body}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Boxes in order, joined by arrows. */
export function DocFlow({ label, items }: { label: string; items: { title: string; detail: string }[] }) {
  return (
    <div className={s.flow} role="list" aria-label={label}>
      {items.map((item, i) => (
        <div key={item.title} className={s.flowStep} role="listitem">
          {i > 0 && <ArrowRight {...ICON} aria-hidden="true" className={b.iconSoft} />}
          <div className={s.flowNode}>
            <Text kind="strong">{item.title}</Text>
            <Text kind="smallMuted">{item.detail}</Text>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A label beside its value, in a well. */
export function DocFacts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={s.facts}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <Text kind="muted" as="dt">{label}</Text>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Dated entries on the gallery's timeline recipe. */
export function DocLog({ entries }: { entries: { id: string; date: string; title: string; body: ReactNode }[] }) {
  return (
    <ol className={d.timeline}>
      {entries.map((entry, i) => (
        <li key={entry.id} id={entry.id} className={cx(d.tItem, s.anchored)}>
          <span className={d.tRail}>
            <span className={cx(d.tDot, i === 0 && d.tDotOn)} />
            <span className={d.tLine} />
          </span>
          <div className={s.logBody}>
            <Text kind="smallMuted">{entry.date}</Text>
            <Text kind="h3" as="h3">{entry.title}</Text>
            <Inline>{entry.body}</Inline>
          </div>
        </li>
      ))}
    </ol>
  );
}
