"use client";

/** A portal's sidebar on the design system: identity on top, nav that scrolls, account at the foot. */
import type { ReactNode } from "react";
import { cx } from "./components";
import side from "./sidebar.module.css";
import o from "./surfaces.module.css";
import tokens from "./tokens.module.css";
import { Initials, NavRow, TwoLine, initialsOf } from "./ui";
import { Text } from "./ui-page";

/** One surface: sidebar, then content. `rootClass` keeps the app's reset for pages not yet moved. */
export function PortalFrame({ rootClass, sidebar, children }: { rootClass?: string; sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className={cx(rootClass, side.portal, tokens.scope)}>
      {sidebar}
      <main className={side.main}>{children}</main>
    </div>
  );
}

/** `fontClass` carries the page-scoped font; next/font cannot load outside a Next build. */
export function Sidebar({ fontClass, label, identity, foot, children }: { fontClass?: string; label: string; identity: ReactNode; foot: ReactNode; children: ReactNode }) {
  return (
    <aside className={cx(side.sidebar, tokens.scope, fontClass)}>
      <div className={side.identity}>{identity}</div>
      <nav aria-label={label} className={side.nav}>
        {children}
      </nav>
      <div className={side.foot}>{foot}</div>
    </aside>
  );
}

export function NavGroup({ label, children }: { label?: string | null; children: ReactNode }) {
  return (
    <div className={side.group}>
      {label && <span className={side.groupLabel}>{label}</span>}
      {children}
    </div>
  );
}

/** The projects as visible rows. A choice, so the quiet selected row rather than the ink one. */
export function ProjectPicker({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className={side.projects} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const on = value === option.value;
        return <NavRow key={option.value} role="radio" checked={on} soft={on} label={option.label} leading={<span className={side.mark}>{option.label.split(" ").at(-1)?.[0]}</span>} onClick={() => onChange(option.value)} />;
      })}
    </div>
  );
}

export function AccountRow({ name, org }: { name: string; org: string }) {
  return (
    <>
      <Initials text={initialsOf(name)} small />
      <TwoLine title={name} sub={org} />
    </>
  );
}

/** A search field with its results floating under it, wider than the sidebar. */
export function SearchPanel({ open, onOpenChange, field, children }: { open: boolean; onOpenChange: (open: boolean) => void; field: ReactNode; children: ReactNode }) {
  return (
    <div className={side.find} onFocus={() => onOpenChange(true)} onBlur={() => setTimeout(() => onOpenChange(false), 120)}>
      {field}
      {open && <div className={cx(o.menu, o.popMenu, side.hits)}>{children}</div>}
    </div>
  );
}

export function SearchHit({ label, kind, onClick }: { label: string; kind: string; onClick: () => void }) {
  return (
    <button type="button" className={cx(o.item, o.itemBtn)} onClick={onClick}>
      <span className={side.navLabel}>{label}</span>
      <span className={o.itemEnd}>{kind}</span>
    </button>
  );
}

export function SearchEmpty({ children }: { children: ReactNode }) {
  return (
    <p className={side.none}>
      <Text kind="muted">{children}</Text>
    </p>
  );
}
