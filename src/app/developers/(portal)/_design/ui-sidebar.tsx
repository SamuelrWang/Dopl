"use client";

/** A portal's sidebar on the design system: identity on top, nav that scrolls, account at the foot. */
import { Check, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cx, ICON, ICON_SM } from "./components";
import side from "./sidebar.module.css";
import o from "./surfaces.module.css";
import tokens from "./tokens.module.css";
import { Initials, PopMenu, TwoLine, initialsOf } from "./ui";
import { Text } from "./ui-page";

/** One surface: sidebar, then content. `rootClass` carries the app shell's reset. */
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

/** The current project in one box; press it to switch. */
export function ProjectSwitcher({ label, options, value, onChange }: { label: string; options: readonly { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const mark = (name: string, on: boolean) => <span className={cx(side.mark, on && side.markOn)}>{name.split(" ").at(-1)?.[0]}</span>;
  return (
    <PopMenu
      block
      label={label}
      trigger={(open, toggle) => (
        <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: ${current.label}`} className={side.switcher} onClick={toggle}>
          {mark(current.label, true)}
          <span className={side.navLabel}>{current.label}</span>
          <ChevronsUpDown {...ICON_SM} aria-hidden="true" className={side.navIcon} />
        </button>
      )}
    >
      {(close) =>
        options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={option.value === value}
            className={cx(o.item, o.itemBtn, option.value === value && o.itemOn)}
            onClick={() => {
              onChange(option.value);
              close();
            }}
          >
            {mark(option.label, option.value === value)}
            <span className={side.navLabel}>{option.label}</span>
            {option.value === value && <Check {...ICON} aria-hidden="true" />}
          </button>
        ))
      }
    </PopMenu>
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

export function SearchHit({ label, kind, active, onClick }: { label: string; kind: string; /** The arrow keys' row. */ active?: boolean; onClick: () => void }) {
  return (
    <button type="button" ref={(el) => { if (active) el?.scrollIntoView({ block: "nearest" }); }} className={cx(o.item, o.itemBtn, active && o.itemOn)} onClick={onClick}>
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
