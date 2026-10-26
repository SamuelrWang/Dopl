"use client";

import { ArrowRight, BookText, ExternalLink, Sparkles, Zap } from "lucide-react";
import { ExternalAnchor } from "@/shared/ui/external-anchor";
import { pendingRow } from "@/shared/ui/pending";
import { formatIsoDate, isHttpUrl } from "@/features/ontology/field-kinds";
import type { GraphState } from "@/features/ontology/graph-state";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import type { AttributeValue } from "@/features/ontology/types";
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
 * ONE OBJECT IN THE ROWS DISPLAY — THE RECORD CARD (Samuel, 2026-10-22, ask 5b:
 * "Start with just the row view. When the user is on the row view just overhaul
 * this.")
 *
 * ⚠ THIS FILE IS ONLY EVER MOUNTED BY THE ROWS BRANCH of `kanban-board.tsx`, so
 * every change here is scoped to that display by construction. Canvas renders
 * `kanban-card.tsx`, untouched this round.
 *
 * ⚠ FACE IS `.uis-ont-*` (`ontology-staging/ontology-rows.css`), NOT `.kanban-card`
 * and NOT token utilities. The proposal measured the product palette as
 * blue-slate where the approved look is neutral (`--bg-elevated` #fbfcfd for a
 * card that should be #ffffff, `--text-primary` #232a31 for ink that should be
 * #0d0d0d, `--text-muted` #98a2ad for muted that should be #8a8a8a), and the fix
 * for THAT is scoped tokens, never a retune of shared values — the orchestrator's
 * call, re #4798. The stylesheet carries the port target.
 *
 * SHAPE IS THE LANDING'S ONTOLOGY OBJECT, `.lp-ont-client`
 * (`marketing.css:2300`, `marketing/components/ontology-windows.tsx ›
 * ContextWindow`): name → description → a `<dl>` of field rows on hairlines, key
 * muted left and value ink right → a dashed provenance rule at the foot.
 *
 * THE KEY IS QUIET GREY, 13px, no fill — Samuel, channel #4801. The filled
 * `bg-text-secondary` #57606b badge with white semibold text is out; so is the
 * 50-line comment that argued for it, and so are the relationship labels'
 * italics. See `PORTING.md › Port-time notes` before carrying this to the real
 * `src/features/ontology/components/ontology-row.tsx`, whose test file PINS the
 * badge class.
 *
 * EVERY VALUE WEARS ITS OWN KIND (`FieldValue` below). The old row flattened all
 * nine kinds to `String(value)` — a knowledge entry, a link, a date, an enum and
 * a pointer at another object were the same grey sentence. On the page whose
 * subject is what links to what, a value that POINTS now looks like it points.
 *
 * `<div>` + `onClick` with the name as the accessible button, as on the card:
 * the record holds controls of its own, so it takes no `role="button"`.
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

  const rows = [
    ...object.attributes.map((attr) => ({
      key: `a:${attr.key}`,
      label: attr.label,
      value: attr.value,
      edge: false as const,
    })),
    // An edge's targets are objects, so it renders as the `ref` kind does —
    // one shape for "points at something in this graph", however it got there.
    ...object.relationships.map((rel, i) => ({
      key: `r:${rel.label}:${i}`,
      label: rel.label,
      value: { kind: "ref", value: [...rel.targetIds] } as AttributeValue,
      edge: true as const,
    })),
  ];

  return (
    <div
      onClick={(e) => {
        // A chip inside a value is its own control (a ref opens that object, a
        // link opens the browser); neither should also open this record.
        if (e.target instanceof Element && e.target.closest("a,button")) return;
        onSelect(objectId);
      }}
      // ⚠ The base layer's clickable-cursor hook, as on `kanban-card.tsx`.
      data-clickable=""
      data-selected={selected ? "true" : undefined}
      {...pendingRow(pending, "uis-ont-rec flex w-full shrink-0 flex-col")}
    >
      <div className="flex items-start">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(objectId);
          }}
          className="flex min-w-0 flex-1 flex-col items-start px-3.5 pt-3 pb-2.5 text-left"
        >
          <span className="uis-ont-rec-name w-full truncate">{object.name}</span>
          {object.subtitle && (
            <RowsCollapse open={open}>
              <span className="uis-ont-rec-sub line-clamp-2 w-full">{object.subtitle}</span>
            </RowsCollapse>
          )}
        </button>
        {onToggleOpen && (
          // Its own control: stops the click so folding never opens the panel.
          // Sits on the name's line, not floated above it.
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleOpen();
            }}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${object.name || "object"}`}
            title={open ? "Collapse" : "Expand"}
            /* ⚠ SPACING IS IN THE STYLESHEET, NOT TWO TAILWIND MARGINS. This
               was `mt-2.5 mr-2.5` and `mr-2.5` compiled to nothing, so the
               chevron sat flush against the card's right edge while the markup
               read correctly. The rule, settled on a cold rebuild 2026-10-23:
               the warm `.next` cache carries a stale scan set and a restart
               does NOT refresh it — only a cold rebuild (`.next` moved aside)
               does. ⚠ Not "present at boot compiles": this very class was
               present at the 22:49:49 boot, its sheet built 22:50:28, and was
               still dead. Boot timing is not the variable; the cache is.
               Production builds are fine. An element whose face is `.uis-ont-*` takes its
               box from `.uis-ont-*` too — literal CSS is immune. */
            className="uis-ont-icon uis-ont-rec-fold"
          >
            <RowsChevron open={open} size={13} />
          </button>
        )}
      </div>

      <RowsCollapse open={open}>
        {rows.length > 0 && (
          <dl className="uis-ont-fields">
            {rows.map((row) => (
              <div key={row.key} className="uis-ont-field">
                <dt className="uis-ont-field-key">
                  {row.edge && (
                    <ArrowRight size={11} aria-hidden className="uis-ont-edge-mark inline" />
                  )}
                  {row.label.trim() === "" ? "—" : row.label}
                </dt>
                <dd className="uis-ont-field-val">
                  <FieldValue value={row.value} graph={graph} nameOf={nameOf} onSelect={onSelect} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {object.methods.length > 0 && (
          <div className="uis-ont-acts">
            <span className="uis-ont-acts-label">Actions</span>
            {object.methods.map((m) => (
              <span key={m.name} className="uis-ont-act" title={m.description || undefined}>
                <Zap size={10} aria-hidden className="uis-ont-act-mark" />
                {m.name}
              </span>
            ))}
          </div>
        )}
      </RowsCollapse>
    </div>
  );
}

/**
 * ONE VALUE, WEARING ITS KIND. The nine `FieldKind`s fall into four faces, and
 * the grouping is the point — a reader should be able to tell at a glance which
 * values are POINTERS and which are literals:
 *
 *  - POINTS AT SOMETHING (`ref`, `knowledge`, `skill`): a chip with a mark. A
 *    `ref` chip is a button that opens that object, which is how you walk the
 *    graph without going back to the lane. Knowledge and skills get their own
 *    marks and stay inert here: the pane is the home space and has no route to
 *    an entry (`use-workspace-resources.tsx › homeSpace`).
 *  - ONE OF A CLOSED SET (`enum`): the grey state pill. §5 keeps colour for
 *    identity, green for live and amber for "needs you"; a funnel stage is none
 *    of those, so it is the well grey and nothing else.
 *  - OPENS A BROWSER (`link`): a chip showing the HOST, not 60 characters of
 *    URL. Through `ExternalAnchor`, which is the app's only external-link idiom
 *    — a bare anchor is a dead click in the packaged renderer.
 *  - A LITERAL (`text`, `pill`, `number`, `date`): ink. `date` is formatted,
 *    `number` is tabular so a column of them lines up. ⚠ `pill` renders PLAIN
 *    despite its name: it is free text (Industry, Owner, Version), and giving it
 *    the same pill face as `enum` would say "one of a set" about a value that
 *    is not. The kind's name is historical.
 */
function FieldValue({
  value,
  graph,
  nameOf,
  onSelect,
}: {
  value: AttributeValue;
  graph: GraphState;
  nameOf: (id: string) => string | null;
  onSelect: (id: string) => void;
}) {
  switch (value.kind) {
    case "ref": {
      // ⚠ UNSET FIRST, AND IT IS A REGRESSION GUARD. My own fix below removed
      // an early `<Empty/>` return and replaced it with `missing > 0`, which is
      // `0 - 0 = 0` for `value.value === []` — so a field nobody had filled in
      // rendered an EMPTY FRAGMENT: a label with a blank cell, inconsistent
      // with every other kind here. Reachable, not theoretical: the row maps
      // every relationship to a `ref` with `[...rel.targetIds]` unfiltered, so
      // a relationship with no targets picked yet hit it. Caught by Identities
      // Polish reading the fix, 2026-10-24 — the fix for "a broken pointer
      // looks unset" had made "unset" look like nothing at all, one step over.
      if (value.value.length === 0) return <Empty />;
      // ⚠ PRESENT-BUT-UNNAMED IS NOT ABSENT (Identity Cards, reading the same
      // fix). The predicate was `Boolean(name)`, so an object that EXISTS with
      // `name: ""` failed it and was counted into `missing` — and the face then
      // stated something false: it IS in this ontology, it just has no name.
      // Only a genuinely absent `graph.objects[id]` counts as missing now; a
      // nameless one renders with the sibling file's own placeholder.
      const targets = value.value
        .map((id) => {
          const object = graph.objects[id];
          if (!object) return null;
          return { id, name: object.name.trim() === "" ? "—" : object.name };
        })
        .filter((t): t is { id: string; name: string } => t !== null);
      /**
       * ⚠ UNRESOLVABLE POINTERS ARE REPRESENTED, NOT FILTERED OUT. Three reads,
       * 2026-10-24: Rail Fix seq 5204 (blind, first — no brief existed yet) and
       * Identity Cards seq 5208 (blind of 5204) reached the all-dangling half
       * independently; Identities Polish contributed the sharper partial case
       * and the root cause, on a FieldValue read they labelled informed rather
       * than independent. Two independent, one confirming — their own count,
       * corrected downward by each of them in turn.
       *
       * This branch used to keep only targets present in `graph.objects` and
       * drop the rest, which produced two different lies:
       *  - ALL dangling → `<Empty/>`, so a broken pointer read exactly like a
       *    field nobody filled in, on the page whose subject is what links to
       *    what.
       *  - SOME dangling → one chip and silence. Worse, and the sharper half of
       *    the finding (Identities Polish): the all-dangling case at least said
       *    "Empty", while a partial one looks complete and correct. Same shape
       *    as every other failure in this tree's history — it reads right.
       *
       * One mechanism covers both: render what resolved, then account for what
       * did not.
       *
       * ⚠ THIS DOCBLOCK USED TO CLAIM "at `targets.length === 0` it degrades to
       * the marker alone", AND THAT SENTENCE DEFEATED TWO INDEPENDENT
       * VERIFICATIONS. It is true only when the input array is non-empty; for
       * `value.value === []` it degraded to NOTHING. One reviewer read the
       * claim, recognised it as the exact case they would have tested, and
       * verified the comment instead of the code (their own account, seq 5230);
       * a second reviewer missed it the same way. A wrong comment does not just
       * mislead a reader — **it defeats verification**, because a reviewer reads
       * it as the specification. The guard above is now the thing that is true,
       * and `ontology-row.test.tsx` pins all four states so no comment has to
       * be trusted again.
       */
      const missing = value.value.length - targets.length;
      return (
        <>
          {targets.map((t) => (
            <button
              key={t.id}
              type="button"
              className="uis-ont-chip"
              // The NAME, not "Open <name>": the chip's visible text is already
              // the name, so a title repeating it with a verb duplicates the
              // accessible name. As the bare name it does the one job a title
              // has here — revealing the full value when the chip ellipsises.
              title={t.name}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(t.id);
              }}
            >
              <Sparkles size={11} aria-hidden className="uis-ont-chip-mark" />
              <span className="uis-ont-chip-text">{t.name}</span>
            </button>
          ))}
          {missing > 0 && <Unresolved count={missing} />}
        </>
      );
    }
    case "knowledge":
    case "skill": {
      // ⚠ KEYED BY ID, NOT NAME. `nameOf` resolves two different ids to the
      // same display name whenever two entries share a title, which duplicates
      // React keys and can mis-reconcile the row. The `ref` branch above was
      // already right; this one was not (Identities Polish's read, 2026-10-24).
      // Same two guards as the `ref` branch above, for the same two reasons:
      // an unset field is `<Empty/>` and not a blank cell, and a resource that
      // resolves to a blank NAME is present-with-no-name rather than missing.
      if (value.value.length === 0) return <Empty />;
      const entries = value.value
        .map((id) => {
          const name = nameOf(id);
          if (name === null) return null;
          return { id, name: name.trim() === "" ? "—" : name };
        })
        .filter((e): e is { id: string; name: string } => e !== null);
      const unresolved = value.value.length - entries.length;
      const Mark = value.kind === "knowledge" ? BookText : Zap;
      return (
        <>
          {entries.map((e) => (
            <span key={e.id} className="uis-ont-chip" title={e.name}>
              <Mark size={11} aria-hidden className="uis-ont-chip-mark" />
              <span className="uis-ont-chip-text">{e.name}</span>
            </span>
          ))}
          {unresolved > 0 && <Unresolved count={unresolved} />}
        </>
      );
    }
    /**
     * ⚠ `!== ""` AND NOT A TRUTHINESS TEST, ON EVERY ONE-VALUE KIND. These
     * branches read `value.value ?` until 2026-10-24. That is correct — every
     * one-value kind is a `string` with `""` for unset (`ontology/types.ts`), so
     * `"0"` is truthy — but it READS as a numeric check on a kind literally
     * named `number`, and **both blind reviewers independently drafted the same
     * false bug report against it** before opening the type and discarding it
     * (Rail Fix seq 5204, Identity Cards seq 5208; n=2, after a claimed third
     * was retracted as hearsay by the agent who posted it).
     *
     * Two readers reaching for the same wrong conclusion is not two mistakes,
     * it is a property of the code. The explicit comparison says the same thing
     * and cannot be misread, which is worth more than the keystrokes it costs.
     * This is the one finding in the review that neither reader could have
     * produced alone — it exists only because both of them nearly filed it.
     */
    case "enum":
      return value.value !== "" ? (
        <span className="uis-ont-enum">{value.value}</span>
      ) : (
        <Empty />
      );
    case "link": {
      if (value.value === "") return <Empty />;
      // The caller owns the scheme check (`external-anchor.tsx`): anything that
      // is not http(s) stays text rather than becoming a link.
      if (!isHttpUrl(value.value)) return <span>{value.value}</span>;
      return (
        <ExternalAnchor href={value.value} title={value.value} className="uis-ont-chip">
          <ExternalLink size={11} aria-hidden className="uis-ont-chip-mark" />
          <span className="uis-ont-chip-text">{hostOf(value.value)}</span>
        </ExternalAnchor>
      );
    }
    case "date":
      return value.value !== "" ? <span>{formatIsoDate(value.value)}</span> : <Empty />;
    case "number":
      return value.value !== "" ? (
        <span className="uis-ont-num">{value.value}</span>
      ) : (
        <Empty />
      );
    default:
      return value.value !== "" ? <span>{value.value}</span> : <Empty />;
  }
}

/** Nobody filled this field in. */
function Empty() {
  return <span className="uis-ont-empty">Empty</span>;
}

/**
 * The field points at `count` things this graph cannot resolve — deleted,
 * unshared, or simply not in the loaded snapshot.
 *
 * ⚠ DISTINCT FROM `Empty` ON PURPOSE, and that is the whole finding: a pointer
 * that resolves to nothing is not a field nobody filled in. Rendering both as
 * "Empty" made a broken edge indistinguishable from an unset one, on the
 * display whose entire subject is what links to what.
 */
function Unresolved({ count }: { count: number }) {
  return (
    <span className="uis-ont-empty">
      {count} not in this ontology
    </span>
  );
}

/** `https://northwind.example.com/pricing` → `northwind.example.com`. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
