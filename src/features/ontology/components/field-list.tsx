"use client";

import { ArrowRight, BookText, ExternalLink, Sparkles, Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ExternalAnchor } from "@/shared/ui/external-anchor";
import { StatusPill } from "@/shared/ui/status-pill";
import { formatIsoDate, isHttpUrl } from "../field-kinds";
import type { GraphState } from "../graph-state";
import type { AttributeValue, OntologyObject } from "../types";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import { CHIP_MARK, CHIP_TEXT, VALUE_CHIP } from "./ontology-bits";

interface FieldRow {
  key: string;
  label: string;
  value: AttributeValue;
  /** A relationship: its targets render as `ref`, its key carries a direction mark. */
  edge: boolean;
}

/** An object's attributes, then its relationships as `ref` values: one shape for "points at
 *  something in this graph". */
function objectFieldRows(object: OntologyObject): FieldRow[] {
  return [
    ...object.attributes.map((attr) => ({
      key: `a:${attr.key}`,
      label: attr.label,
      value: attr.value,
      edge: false,
    })),
    ...object.relationships.map((rel, i) => ({
      key: `r:${rel.label}:${i}`,
      label: rel.label,
      value: { kind: "ref", value: [...rel.targetIds] } as AttributeValue,
      edge: true,
    })),
  ];
}

/**
 * An object's fields as a key / value list on hairlines: key muted left, value ink right, each value
 * in its kind's face. `limit` keeps the first N and says how many more there are, except at the
 * canvas card's `compact` step, whose footer carries the counts.
 */
export function FieldList({
  object,
  graph,
  onSelect,
  limit,
  compact = false,
  className,
}: {
  object: OntologyObject;
  graph: GraphState;
  onSelect: (id: string) => void;
  limit?: number;
  compact?: boolean;
  className?: string;
}) {
  const { nameOf } = useWorkspaceResources();
  const rows = objectFieldRows(object);
  if (rows.length === 0) return null;
  const shown = limit === undefined ? rows : rows.slice(0, limit);
  const more = rows.length - shown.length;
  const type = compact ? "text-caption" : "text-lead";
  return (
    <dl className={cn("flex flex-col", className)}>
      {shown.map((row) => (
        <div
          key={row.key}
          className={cn(
            "flex items-baseline border-t border-border-subtle first:border-t-0",
            compact ? "min-h-7 gap-2.5 py-1" : "min-h-8.5 gap-3.5 py-1.75"
          )}
        >
          <dt
            className={cn(
              "flex-none truncate text-text-muted",
              type,
              compact ? "w-22" : "w-37"
            )}
          >
            {row.edge && (
              <ArrowRight size={11} aria-hidden className="mr-1 inline text-text-disabled" />
            )}
            {row.label.trim() === "" ? "—" : row.label}
          </dt>
          <dd
            className={cn(
              "flex min-w-0 flex-1 flex-wrap items-center gap-1 font-medium text-text-primary",
              type
            )}
          >
            <FieldValue value={row.value} graph={graph} nameOf={nameOf} onSelect={onSelect} />
          </dd>
        </div>
      ))}
      {more > 0 && !compact && (
        <p className="border-t border-border-subtle pt-1 text-caption text-text-muted">
          +{more} more
        </p>
      )}
    </dl>
  );
}

/**
 * One value in its kind's face. Pointers (`ref`, `knowledge`, `skill`) are chips with a mark, and a
 * `ref` chip opens that object; a closed set (`enum`) is the status pill; a `link` is a chip showing
 * the host; literals are ink. `pill` renders plain: it is free text, and the pill face would say "one
 * of a set" about it. A pointer that resolves to nothing is reported, never dropped, so a broken edge
 * never reads as complete or as unset.
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
      if (value.value.length === 0) return <Empty />;
      const targets = value.value.flatMap((id) => {
        const object = graph.objects[id];
        return object ? [{ id, name: object.name.trim() === "" ? "—" : object.name }] : [];
      });
      return (
        <>
          {targets.map((t) => (
            <button
              key={t.id}
              type="button"
              className={VALUE_CHIP}
              title={t.name}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(t.id);
              }}
            >
              <Sparkles size={11} aria-hidden className={CHIP_MARK} />
              <span className={CHIP_TEXT}>{t.name}</span>
            </button>
          ))}
          <Unresolved count={value.value.length - targets.length} />
        </>
      );
    }
    case "knowledge":
    case "skill": {
      if (value.value.length === 0) return <Empty />;
      // Keyed by id: two entries can share a title.
      const entries = value.value.flatMap((id) => {
        const name = nameOf(id);
        return name === null ? [] : [{ id, name: name.trim() === "" ? "—" : name }];
      });
      const Mark = value.kind === "knowledge" ? BookText : Zap;
      return (
        <>
          {entries.map((e) => (
            <span key={e.id} className={VALUE_CHIP} title={e.name}>
              <Mark size={11} aria-hidden className={CHIP_MARK} />
              <span className={CHIP_TEXT}>{e.name}</span>
            </span>
          ))}
          <Unresolved count={value.value.length - entries.length} />
        </>
      );
    }
    // Every one-value kind is a string with "" for unset, so compare, never test truthiness.
    case "enum":
      return value.value !== "" ? <StatusPill>{value.value}</StatusPill> : <Empty />;
    case "link": {
      if (value.value === "") return <Empty />;
      // The caller owns the scheme check (`external-anchor.tsx`).
      if (!isHttpUrl(value.value)) return <span>{value.value}</span>;
      return (
        <ExternalAnchor
          href={value.value}
          title={value.value}
          className={cn(VALUE_CHIP, "text-text-primary no-underline")}
        >
          <ExternalLink size={11} aria-hidden className={CHIP_MARK} />
          <span className={CHIP_TEXT}>{hostOf(value.value)}</span>
        </ExternalAnchor>
      );
    }
    case "date":
      return value.value !== "" ? <span>{formatIsoDate(value.value)}</span> : <Empty />;
    case "number":
      return value.value !== "" ? <span className="tabular-nums">{value.value}</span> : <Empty />;
    default:
      return value.value !== "" ? <span>{value.value}</span> : <Empty />;
  }
}

function Empty() {
  return <span className="font-normal text-text-muted">Empty</span>;
}

/** Targets this graph cannot resolve: deleted, unshared, or not in the loaded snapshot. */
function Unresolved({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="font-normal text-text-muted">{count} not in this ontology</span>;
}

/** `https://northwind.example.com/pricing` → `northwind.example.com`. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
