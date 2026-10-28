"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { DocSectionId } from "../content";
import { NAV_ICONS } from "./docs-icons";

export type NavIconId = "home" | DocSectionId;

export interface NavRow {
  slug: string;
  label: string;
  href: string;
  /** A short tag for a row whose status differs from its folder's ("Beta", "Soon"). */
  tag?: string;
  /** Not built yet: the label is dimmed. */
  soon?: boolean;
}

export type NavNode =
  | { kind: "link"; id: NavIconId; label: string; href: string; slug: string }
  | { kind: "folder"; id: NavIconId; label: string; tag?: string; groups: { title?: string; rows: NavRow[] }[] };

export interface NavHeading {
  title: string;
  nodes: NavNode[];
}

function Icon({ id }: { id: NavIconId }) {
  const Glyph = NAV_ICONS[id];
  return (
    <span className="docs-nav-icon" aria-hidden>
      <Glyph size={16} strokeWidth={1.75} />
    </span>
  );
}

function folderHas(node: NavNode, slug?: string): boolean {
  return node.kind === "folder" && !!slug && node.groups.some((g) => g.rows.some((r) => r.slug === slug));
}

/**
 * The sidebar tree: headings over rows, where a section with more than one page is a folder that
 * opens and closes in place. The active page's folder starts open and reopens on navigation.
 */
export function DocsNavTree({
  headings,
  activeSlug,
  anchors,
}: {
  headings: NavHeading[];
  activeSlug?: string;
  anchors: { id: string; text: string }[];
}) {
  const activeFolder = headings.flatMap((h) => h.nodes).find((n) => folderHas(n, activeSlug))?.id;
  const [open, setOpen] = useState<Set<NavIconId>>(() => new Set(activeFolder ? [activeFolder] : []));
  const [openedFor, setOpenedFor] = useState(activeFolder);

  // Navigating into another folder opens it (adjusted during render, not in an effect).
  if (activeFolder !== openedFor) {
    setOpenedFor(activeFolder);
    if (activeFolder && !open.has(activeFolder)) setOpen(new Set(open).add(activeFolder));
  }

  const toggle = (id: NavIconId) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <nav className="docs-nav" aria-label="Docs navigation">
      {headings.map((h) => (
        <div key={h.title} className="docs-nav-block">
          <p className="docs-nav-heading">{h.title}</p>
          <ul>
            {h.nodes.map((n) =>
              n.kind === "link" ? (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    className="docs-nav-row"
                    data-active={n.slug === activeSlug || undefined}
                    aria-current={n.slug === activeSlug ? "page" : undefined}
                  >
                    <Icon id={n.id} />
                    <span className="docs-nav-label">{n.label}</span>
                  </Link>
                </li>
              ) : (
                <li key={n.id} className="docs-nav-folder" data-open={open.has(n.id) || undefined}>
                  <button
                    type="button"
                    className="docs-nav-row"
                    aria-expanded={open.has(n.id)}
                    onClick={() => toggle(n.id)}
                  >
                    <Icon id={n.id} />
                    <span className="docs-nav-label">{n.label}</span>
                    {n.tag && <span className="docs-nav-tag">{n.tag}</span>}
                    <ChevronRight className="docs-nav-chevron" size={14} strokeWidth={2} aria-hidden />
                  </button>
                  <div className="docs-nav-collapse" inert={!open.has(n.id)}>
                    <div className="docs-nav-collapse-inner">
                      {n.groups.map((g, i) => (
                        <div key={g.title ?? i} className="docs-nav-children">
                          {g.title && <p className="docs-nav-subheading">{g.title}</p>}
                          <ul>
                            {g.rows.map((r) => {
                              const active = r.slug === activeSlug;
                              return (
                                <li key={r.slug}>
                                  <Link
                                    href={r.href}
                                    className="docs-nav-child"
                                    data-active={active || undefined}
                                    data-soon={r.soon || undefined}
                                    aria-current={active ? "page" : undefined}
                                  >
                                    <span className="docs-nav-label">{r.label}</span>
                                    {r.tag && <span className="docs-nav-tag">{r.tag}</span>}
                                  </Link>
                                  {active && anchors.length > 0 && (
                                    <ul className="docs-nav-anchors">
                                      {anchors.map((a) => (
                                        <li key={a.id}>
                                          <a href={`#${a.id}`}>{a.text}</a>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}
