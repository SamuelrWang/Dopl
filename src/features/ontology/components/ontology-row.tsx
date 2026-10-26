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
                    /* The field NAME as a MID-GRAY rectangular badge (Samuel
                       #3031 → Rows view #3079 → "not black" #3162 → "still reads
                       black, go clearly gray" #3186).
                       `bg-text-secondary` = `--text-secondary` #57606b, a
                       neutral Samuel hand-darkened himself (#646d78 → #57606b,
                       2026-08-19) and the ONLY published token inside the 5.5-7:1
                       band he asked for.
                       CONTRAST, computed not eyeballed: #57606b vs #ffffff =
                       6.38:1 — AA 4.5 PASS, and roughly HALF the contrast of the
                       #2f3542 it replaces (12.29:1), which is why that one still
                       read as black. `surface-cta` #1c2127 was 16.20:1.
                       NO NEW TOKEN ON PURPOSE, though one was authorised:
                       `--home-frame-ink`/`--home-frame-hover` were added and then
                       REMOVED in Samuel's own 2026-08-30 review because "a
                       two-token pair with one consumer is an indirection that
                       says nothing" (tokens.css:363). A `--badge-gray` with one
                       consumer is that same shape, and minting would also put
                       this on `scripts/check-css-token-drift.ts`, which fails if
                       the globals.css and desktop tokens.css copies disagree.
                       A TEXT TOKEN AS A FILL IS ESTABLISHED HERE, not a liberty:
                       `bg-text-primary` paints the selected-row marker in five
                       playground panes. Defined in globals.css:209 AND
                       desktop tokens.css:234, same value, so the badge survives
                       in the desktop SPA, which never loads globals.css.
                       `text-text-on-invert` (#ffffff), NOT `text-on-cta`: the
                       badge is not a CTA surface. Still 4.5+ at this fill, which
                       is the reason the band had a ceiling at all — go lighter
                       than ~7:1 inverted and white starts to fail.
                       `rounded-[4px]` deliberately, NOT `rounded-pill`: he asked
                       for a rectangle with a small radius.
                       `inline-block max-w-full truncate` is load-bearing — the pill
                       hugs its text and the ellipsis lands INSIDE it. The old
                       `truncate` sat on the `<dt>`, which would clip an
                       inline-block child square instead of ellipsing it.
                       EDGES KEEP THE OLD LOOK: relationships are edges, not
                       fields, and he asked for field names. */
                    /* ⚠ A BLANK NAME PAINTS NOTHING, which is what it did before
                       the badge existed. `label` has no `.min(1)` in
                       `ontology/schema.ts` — `z.string().max(200)` — so an
                       attribute with `label: ""` is a valid write. As plain
                       text it was invisible; as a FILLED badge it became a
                       ~6px dark-gray nub with `px-1.5 py-px` around nothing,
                       which reads as a rendering fault rather than as missing
                       data. The `<dd>` beside it has an `Empty` placeholder and
                       the `<dt>` has none, so the conservative match is to
                       render no badge rather than to invent copy for it. */
                    row.label.trim() === "" ? null : (
                    <span className="inline-block max-w-full truncate rounded-[4px] bg-text-secondary px-1.5 py-px text-caption font-semibold text-text-on-invert">
                      {row.label}
                    </span>
                    )
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
