"use client";

/**
 * Page-level parts on top of ui.tsx: the frame, section headers, item cards, sheets and popups. Pages
 * compose these and add only their own grid widths. None takes a className. See README.md.
 */
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Undo2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { createElement, useState, type ReactNode, type Ref } from "react";
import b from "./base.module.css";
import c from "./catalog.module.css";
import { cx, ICON, ICON_SM } from "./components";
import d from "./data.module.css";
import flow from "./flow.module.css";
import f from "./forms.module.css";
import k from "./keys.module.css";
import p from "./page.module.css";
import o from "./surfaces.module.css";
import tokens from "./tokens.module.css";
import { Badge, Button, Chip } from "./ui";

/* Type */
const TEXT = { title: b.title, h3: b.h3, strong: b.strong, text: b.text, muted: b.muted, small: b.small, smallMuted: b.smallMuted, faint: b.faint, onInk: b.onInk, token: k.token, mono: flow.mono, code: flow.code };

export function Text({ kind = "text", as = "span", clip, num, nowrap, title, children }: { kind?: keyof typeof TEXT; as?: "span" | "h1" | "h2" | "h3" | "p" | "dt" | "dd"; clip?: boolean; num?: boolean; nowrap?: boolean; title?: string; children: ReactNode }) {
  return createElement(as, { className: cx(TEXT[kind], clip && c.footText, num && b.num, nowrap && b.nowrap), title }, children);
}

/* Layout */
export const Row = ({ wrap, children }: { wrap?: boolean; children: ReactNode }) => <div className={cx(b.row, wrap && b.wrap)}>{children}</div>;
export const Between = ({ children }: { children: ReactNode }) => <div className={b.between}>{children}</div>;
export const Stack = ({ end, children }: { /** Right-aligned, hugging: the end of a row. */ end?: boolean; children: ReactNode }) => <div className={cx(b.stack, end && p.stackEnd)}>{children}</div>;
export const Grow = () => <span className={b.grow} />;

/** Icon-only and unboxed: close buttons and row actions. */
export function PlainButton({ label, haspopup, buttonRef, onClick, children }: { label?: string; haspopup?: "dialog"; buttonRef?: Ref<HTMLButtonElement>; onClick?: () => void; children: ReactNode }) {
  return (
    <button ref={buttonRef} type="button" className={b.reset} aria-label={label} aria-haspopup={haspopup} onClick={onClick}>
      {children}
    </button>
  );
}

/* Page frame */
export function Page({ fit, overlays, children }: { /** Fills the window; its cards scroll inside, the page never does. */ fit?: boolean; overlays?: ReactNode; children: ReactNode }) {
  return (
    <div className={cx(p.root, tokens.scope)}>
      <div className={cx(p.scroller, fit && p.scrollerFit)}>
        <div className={cx(p.inner, fit && p.innerFit)}>{children}</div>
      </div>
      {overlays}
    </div>
  );
}

export function PageHeader({ title, test, action }: { title: string; test?: boolean; action?: ReactNode }) {
  return (
    <header className={b.between}>
      <div className={b.row}>
        <Text kind="title" as="h1">
          {title}
        </Text>
        {test && <Badge tone="warn">Test data</Badge>}
      </div>
      {action}
    </header>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className={p.crumbs} aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={item.label} className={b.row}>
          {i > 0 && <ChevronRight {...ICON_SM} aria-hidden="true" className={b.iconSoft} />}
          {item.href ? (
            <Link href={item.href} className={p.crumbLink}>
              {item.label}
            </Link>
          ) : (
            <Text kind="strong">{item.label}</Text>
          )}
        </span>
      ))}
    </nav>
  );
}

export const StatRow = ({ children }: { children: ReactNode }) => <div className={p.stats}>{children}</div>;
export const Toolbar = ({ children }: { children: ReactNode }) => <div className={b.card}>{children}</div>;
export const FilterRow = ({ children }: { children: ReactNode }) => <div className={p.filterRow}>{children}</div>;

/** The filters that are on, each removable, then one way to clear them all. Nothing while none is on. */
export function FilterChips<Patch>({ chips, onRemove, onClear }: { chips: { key: string; label: string; clear: Patch }[]; onRemove: (clear: Patch) => void; onClear: () => void }) {
  if (chips.length === 0) return null;
  return (
    <FilterRow>
      {chips.map((chip) => (
        <Chip key={chip.key} kind="tag" removeLabel={`Remove ${chip.label}`} onRemove={() => onRemove(chip.clear)}>
          {chip.label}
        </Chip>
      ))}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </FilterRow>
  );
}

export function EmptyState({ icon, title, action }: { icon: LucideIcon; title: string; action?: ReactNode }) {
  return (
    <div className={b.card}>
      <div className={o.empty}>
        <Mark icon={icon} />
        <Text kind="h3">{title}</Text>
        {action}
      </div>
    </div>
  );
}

export function Toast({ action, onAction, children }: { /** One way back, such as Undo. */ action?: string; onAction?: () => void; children: ReactNode }) {
  return (
    <div role="status" className={cx(o.toast, o.toastBlack, p.notice)}>
      <span className={cx(b.onInk, b.grow)}>{children}</span>
      {action && (
        <button type="button" className={cx(b.reset, b.row)} onClick={onAction}>
          <Undo2 {...ICON} aria-hidden="true" />
          <span className={b.onInk}>{action}</span>
        </button>
      )}
    </div>
  );
}

/* Marks */
export function Mark({ icon, tone = "ring", children }: { icon?: LucideIcon; tone?: "ring" | "ink" | "danger"; children?: ReactNode }) {
  return <span className={cx(tone === "ink" ? c.glyph : b.tile, tone === "danger" && b.tileDanger)}>{icon ? createElement(icon, { ...ICON, "aria-hidden": true }) : children}</span>;
}

/* Sections of cards */
export function CardSection({ icon, title, meta, children }: { icon: ReactNode; title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className={c.section} aria-label={title}>
      <h2 className={c.sectionHead}>
        <span className={c.sectionMark}>{icon}</span>
        <Text kind="h3">{title}</Text>
        {meta && <span className={cx(b.smallMuted, b.num, c.sectionMeta)}>{meta}</span>}
      </h2>
      <div className={c.grid}>{children}</div>
    </section>
  );
}

/* An item card's anatomy: head, chips, figures, foot. */
export function CardHead({ mark, title, sub, badges }: { mark: ReactNode; title: ReactNode; sub: ReactNode; badges?: ReactNode }) {
  return (
    <div className={c.head}>
      {mark}
      <div className={cx(b.tight, b.grow)}>
        <span className={cx(b.h3, c.footText)}>{title}</span>
        {sub}
      </div>
      {badges && <div className={c.headBadges}>{badges}</div>}
    </div>
  );
}

export const ChipRow = ({ children }: { children: ReactNode }) => <div className={c.chips}>{children}</div>;
export const FigureWell = ({ children }: { children: ReactNode }) => <div className={c.well}>{children}</div>;

export function Figure({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <span className={c.figure}>
      <span className={b.smallMuted}>{label}</span>
      <span className={cx(b.h3, b.num, b.nowrap)}>{value}</span>
      {children}
    </span>
  );
}

export function CardFoot({ main, children }: { main: ReactNode; children?: ReactNode }) {
  return (
    <div className={c.foot}>
      <div className={c.footMain}>{main}</div>
      {children}
    </div>
  );
}

export function Spark({ bars }: { bars: number[] }) {
  return (
    <span className={c.spark} aria-hidden="true">
      {bars.map((h, i) => (
        <i key={i} className={cx(c.sparkBar, i === bars.length - 1 && c.sparkOn)} style={{ height: `${h}%` }} />
      ))}
    </span>
  );
}

export function AddCard({ title, sub, wide, onClick, children }: { title: string; sub: string; wide?: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className={cx(c.add, wide && c.addWide)} onClick={onClick}>
      <span className={c.addHead}>
        <span className={b.tile}>{ADD_ICON}</span>
        <span className={b.tight}>
          <span className={b.strong}>{title}</span>
          <span className={b.smallMuted}>{sub}</span>
        </span>
      </span>
      {children && <span className={c.chips}>{children}</span>}
    </button>
  );
}
const ADD_ICON = (
  <svg width={ICON.size} height={ICON.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON.strokeWidth} strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/* Rows */
export function BoxRow({ children }: { children: ReactNode }) {
  return <div className={cx(b.box, d.fileRow)}>{children}</div>;
}

export function ListRow({ line, children }: { line?: boolean; children: ReactNode }) {
  return <div className={cx(d.listRow, line && d.rowLine)}>{children}</div>;
}

/** Figures in a well, in equal columns. */
export function FigureGrid({ children }: { children: ReactNode }) {
  return <dl className={cx(b.well, p.figures)}>{children}</dl>;
}

export function GridFigure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={d.stat}>
      <Text kind="smallMuted" as="dt">
        {label}
      </Text>
      <dd className={cx(b.h3, b.num, p.figureValue)}>{value}</dd>
    </div>
  );
}

/** Under a table: the count, then its pager. */
export function TableFoot({ children }: { children: ReactNode }) {
  return <div className={cx(b.between, b.padRow, p.tableFoot)}>{children}</div>;
}

/** Over a table in the same card: its title or filters. */
export function TableHead({ stacked, children }: { /** Rows, one under another: search, then filters. */ stacked?: boolean; children: ReactNode }) {
  return <div className={cx(stacked ? b.stack : b.between, b.padRow)}>{children}</div>;
}

/* Menus and pages */
export function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" className={cx(o.item, o.itemBtn)} onClick={onClick}>
      {children}
    </button>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const near = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  return (
    <nav className={o.pager} aria-label="Pages">
      <button type="button" className={cx(o.page, o.pageBtn, o.pageRing, page === 1 && o.pageOff)} disabled={page === 1} aria-label="Previous page" onClick={() => onPage(page - 1)}>
        <ChevronLeft {...ICON} />
      </button>
      {near.map((n, i) => (
        <span key={n} className={b.row}>
          {i > 0 && n - near[i - 1] > 1 && <span className={o.page}>…</span>}
          <button type="button" aria-current={n === page ? "page" : undefined} className={cx(o.page, o.pageBtn, n === page && o.pageOn)} onClick={() => onPage(n)}>
            {n}
          </button>
        </span>
      ))}
      <button type="button" className={cx(o.page, o.pageBtn, o.pageRing, page === pages && o.pageOff)} disabled={page === pages} aria-label="Next page" onClick={() => onPage(page + 1)}>
        <ChevronRight {...ICON} />
      </button>
    </nav>
  );
}

/** Label over value in a two-up well: a popup's review. */
export function ReviewWell({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className={cx(b.well, flow.tiles2, flow.reviewWell)}>
      {items.map(([label, value]) => (
        <span key={label} className={b.tight}>
          <span className={b.smallMuted}>{label}</span>
          <span className={cx(b.strong, b.num)}>{value}</span>
        </span>
      ))}
    </div>
  );
}

export function Alert({ tone, icon, children }: { tone: "warn" | "error"; icon: LucideIcon; children: ReactNode }) {
  return (
    <div className={cx(o.alert, tone === "warn" ? o.alertWarn : o.alertError)}>
      {createElement(icon, { ...ICON, "aria-hidden": true })}
      {children}
    </div>
  );
}

/** What the server refused, or nothing. */
export function ProblemAlert({ problem }: { problem: string | null }) {
  if (!problem) return null;
  return (
    <Alert tone="error" icon={AlertTriangle}>
      {problem}
    </Alert>
  );
}

export function TextField({ label, placeholder, value, autoFocus, grow, type, min, max, onChange, onEnter }: { label: string; placeholder?: string; value: string; autoFocus?: boolean; /** Fills its row. */ grow?: boolean; type?: "number" | "password"; min?: number; max?: number; onChange: (next: string) => void; onEnter?: () => void }) {
  return (
    <label className={cx(f.field, grow && f.fieldGrow)}>
      <input
        type={type}
        min={min}
        max={max}
        autoFocus={autoFocus}
        className={f.fieldInput}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
      />
    </label>
  );
}

/** A value to copy, with its button. */
export function SecretWell({ value, action }: { value: string; action: ReactNode }) {
  return (
    <div className={cx(b.well, k.secret)}>
      <span className={cx(flow.mono, k.secretValue)}>{value}</span>
      {action}
    </div>
  );
}

/** Copies on press and says so. Give it a `key` when what it copies can change under it. */
export function CopyButton({ text, label, idle = "Copy" }: { text: string; label?: string; idle?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text)?.catch(() => {});
        setCopied(true);
      }}
    >
      {copied ? <Check {...ICON_SM} aria-hidden="true" /> : <Copy {...ICON_SM} aria-hidden="true" />}
      {copied ? "Copied" : idle}
    </Button>
  );
}

export const CopyWell = ({ value, label }: { value: string; label: string }) => <SecretWell value={value} action={<CopyButton text={value} label={label} />} />;

export function CodeBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={d.code}>
      <div className={d.codeHead}>
        <span className={b.onInk}>{title}</span>
      </div>
      <div className={cx(d.codeBody, k.codeBody)}>{children}</div>
    </div>
  );
}
export const CodeDim = ({ children }: { children: ReactNode }) => <span className={d.codeDim}>{children}</span>;
export const CodeStrong = ({ children }: { children: ReactNode }) => <span className={d.codeStrong}>{children}</span>;
