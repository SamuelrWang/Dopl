"use client";

import { ExternalAnchor } from "@/shared/ui/external-anchor";
import { pendingRow } from "@/shared/ui/pending";
import { formatIsoDate, isHttpUrl } from "../field-kinds";
import type { GraphState } from "../graph-state";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import type { AttributeValue } from "../types";
import { RowsChevron, RowsCollapse } from "./rows-collapse";

interface Props {
  objectId: string;
  graph: GraphState;
  selected: boolean;
  /** Optimistically created, POST not answered: drawn dimmed and inert. */
  pending?: boolean;
  onSelect: (id: string) => void;
  /** Folded = name line only. Persisted by the board (`use-rows-collapsed.ts`). */
  open?: boolean;
  onToggleOpen?: () => void;
}

/**
 * One object in the Rows display (`use-board-display.ts`): a full-width box with
 * the name and description on top, then each attribute as its own row, label
 * left, value right. Relationships follow as rows of the same shape, so the box
 * reads like the object's record rather than a summary of it.
 *
 * Same shell and states as the canvas card (`.kanban-card`): resting, hover,
 * selected ring. No fixed height; the box hugs its rows and the board scrolls.
 * `<div>` + `onClick` with the name as the accessible button, as on the card.
 */
export function OntologyRow({
  objectId,
  graph,
  selected,
  pending = false,
  onSelect,
  open = true,
  onToggleOpen,
}: Props) {
  const { nameOf } = useWorkspaceResources();
  const object = graph.objects[objectId];
  if (!object) return null;

  const valueText = (value: AttributeValue): string => {
    switch (value.kind) {
      case "knowledge":
      case "skill":
        return value.value
          .map((id) => nameOf(id))
          .filter(Boolean)
          .join(", ");
      case "ref":
        return value.value
          .map((id) => graph.objects[id]?.name)
          .filter(Boolean)
          .join(", ");
      case "date":
        return value.value ? formatIsoDate(value.value) : "";
      default:
        return value.value;
    }
  };

  const rows = [
    ...object.attributes.map((attr) => ({
      key: `a:${attr.key}`,
      label: attr.label,
      value: valueText(attr.value),
      edge: false,
      // Only an http(s) value becomes an anchor: the caller owns the scheme
      // check (`external-anchor.tsx`).
      href:
        attr.value.kind === "link" && isHttpUrl(attr.value.value)
          ? attr.value.value
          : null,
    })),
    ...object.relationships.map((rel, i) => ({
      key: `r:${rel.label}:${i}`,
      label: rel.label,
      value: rel.targetIds
        .map((id) => graph.objects[id]?.name)
        .filter(Boolean)
        .join(", "),
      edge: true,
      href: null,
    })),
  ];

  return (
    <div
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest("a")) return;
        onSelect(objectId);
      }}
      // ⚠ The base layer's clickable-cursor hook, as on `kanban-card.tsx`.
      data-clickable=""
      data-selected={selected ? "true" : undefined}
      {...pendingRow(
        pending,
        "kanban-card flex w-full shrink-0 flex-col rounded-[10px] border bg-bg-elevated"
      )}
    >
      <div className="flex items-start">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(objectId);
          }}
          className="flex min-w-0 flex-1 flex-col items-start px-3 pt-3 pb-2 text-left"
        >
          <span className="block w-full truncate text-body font-semibold tracking-tight text-text-primary">
            {object.name}
          </span>
          {object.subtitle && (
            <RowsCollapse open={open}>
              <span className="mt-0.5 line-clamp-2 w-full text-caption text-text-secondary">
                {object.subtitle}
              </span>
            </RowsCollapse>
          )}
        </button>
        {onToggleOpen && (
          // Its own control: stops the click so folding never opens the panel.
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleOpen();
            }}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${object.name || "object"}`}
            title={open ? "Collapse" : "Expand"}
            className="mt-2 mr-2 shrink-0 rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
          >
            <RowsChevron open={open} size={13} />
          </button>
        )}
      </div>
      <RowsCollapse open={open}>
        {rows.length > 0 && (
          <dl className="border-t border-border-subtle">
            {rows.map((row) => (
              <div
                key={row.key}
                className="flex items-baseline gap-3 border-b border-border-subtle px-3 py-1.5 last:border-b-0"
              >
                {/* The `<dt>` keeps `w-40 shrink-0`, so every value below stays on
                    one left edge whichever arm draws. */}
                <dt className="w-40 shrink-0">
                  {row.edge ? (
                    <span className="block truncate text-caption italic text-text-muted">
                      {row.label}
                    </span>
                  ) : (
                    /* The field NAME as a DARK GRAY rectangular badge (Samuel
                       #3031 → Rows view #3079 → dark gray not black #3162).
                       `bg-home-frame` is the app frame's own dark gray
                       (globals.css:281, #2f3542) — the only dark gray already
                       published as a utility, so no hex is minted. It is a real
                       surface token, not a border one: `--body-bg` is built from
                       it. Its `--home-` prefix is legacy, not a page scope
                       (globals.css:276).
                       CONTRAST, computed not eyeballed: #2f3542 vs #ffffff =
                       12.29:1, well past WCAG AA 4.5:1 and past AAA 7:1, and the
                       token is defined ONCE with no dark-theme override, so the
                       white cannot be undercut by a theme flip. The step it makes
                       is real: `surface-cta` #1c2127 is 16.20:1, so this reads a
                       shade lighter without going near the floor.
                       `text-text-on-invert` (#ffffff), NOT `text-on-cta`: the
                       badge is no longer a CTA surface, and pairing on-dark text
                       with a dark surface keeps the pair readable to whoever
                       edits it next. Same white, zero visual change.
                       `rounded-[4px]` deliberately, NOT `rounded-pill`: he asked
                       for a rectangle with a small radius.
                       `inline-block max-w-full truncate` is load-bearing — the pill
                       hugs its text and the ellipsis lands INSIDE it. The old
                       `truncate` sat on the `<dt>`, which would clip an
                       inline-block child square instead of ellipsing it.
                       EDGES KEEP THE OLD LOOK: relationships are edges, not
                       fields, and he asked for field names. */
                    <span className="inline-block max-w-full truncate rounded-[4px] bg-home-frame px-1.5 py-px text-caption font-semibold text-text-on-invert">
                      {row.label}
                    </span>
                  )}
                </dt>
                <dd className="min-w-0 flex-1 truncate text-caption text-text-primary">
                  {row.href ? (
                    // Opens the browser; the row's handler skips anchor clicks,
                    // so it never opens the panel too.
                    <ExternalAnchor href={row.href} title={row.href}>
                      {row.value}
                    </ExternalAnchor>
                  ) : (
                    row.value || <span className="text-text-muted">Empty</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {object.methods.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5 border-t border-border-subtle px-3 py-2 text-micro text-text-muted">
            <span>Actions</span>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate">
              {object.methods.map((m) => m.name).join(" · ")}
            </span>
          </div>
        )}
      </RowsCollapse>
    </div>
  );
}
