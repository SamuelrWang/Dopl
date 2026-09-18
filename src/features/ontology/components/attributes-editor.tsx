"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { SelectMenu } from "@/shared/ui/select-menu";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import type { GraphAction, GraphState } from "../graph-state";
import type { AttributeValue, OntologyObject } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import { KnowledgePickMenu } from "./knowledge-pick-menu";
import { ObjectPickMenu } from "./object-pick-menu";
import { CHIP } from "./ontology-bits";
import {
  PANEL_ROW,
  PANEL_ROWS,
  PanelAddButton,
  PanelSection,
  ROW_REMOVE_BUTTON,
  useDraftRows,
} from "./panel-section";
import { KIND_OPTIONS } from "./template-editor";
import { PickMenu } from "./pick-menu";

type AttrKind = AttributeValue["kind"];

/** A row's editable half. The persisted attribute carries a `key` beside it; a
 *  draft has none yet, and the two render identically. */
type AttrRowValue = { label: string; value: AttributeValue };

/**
 * Attributes section — one white bar per attribute, showing all three cells at
 * once: label, kind, value. Value kinds: text, tag, object refs (cascade picker),
 * and access-gated knowledge / skills (PickMenu offers only resources the caller
 * can see).
 *
 * 2026-09-13: every cell exists from the moment the row does — `+ Add` appends an
 * empty bar (`panel-section.tsx › useDraftRows`) and the value cell can be typed
 * in before the label is.
 *
 * `ObjectAttribute.key` is the label slugged at creation — the address MCP writes
 * at (`set_attribute`), not a cell, and deliberately off screen; the second
 * column a person sets is `value.kind`.
 *
 * Changing the kind empties the value except text↔tag: those two are one string,
 * every other pair is a list of ids of a different kind of thing.
 *
 * Flat since 2026-09-12, and the well is not a return of the frame — see
 * `panel-section.tsx › PanelSection`. Text rows are the popup kit's underline
 * (`board-header-bits.tsx › InlineUnderlineField`, imported not re-cut), kind is
 * a `SelectMenu` text face, pickers wear `SMALL_TEXT_BUTTON`. Chips stay chips: a
 * knowledge / skill / object value is a removable token, not a field.
 */
export function AttributesEditor({
  object,
  graph,
  dispatch,
  canEdit = true,
}: {
  object: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  canEdit?: boolean;
}) {
  const { drafts, add, patch, drop } = useDraftRows<AttrRowValue>(() => ({
    label: "",
    value: { kind: "text", value: "" },
  }));

  /** An unnamed row stays a draft. */
  const commit = (index: number, row: AttrRowValue) => {
    const label = row.label.trim();
    if (!label) return;
    dispatch({
      type: "ATTRIBUTE_UPSERT",
      id: object.id,
      index: null,
      attribute: { key: label.toLowerCase().replace(/\s+/g, "-"), label, value: row.value },
    });
    drop(index);
  };

  if (object.attributes.length === 0 && !canEdit) {
    return <PanelSection label="Attributes">{null}</PanelSection>;
  }

  return (
    <PanelSection label="Attributes">
      <div className={PANEL_ROWS}>
        {object.attributes.map((attr, i) => (
          <AttrRow
            key={`row-${i}`}
            row={attr}
            object={object}
            graph={graph}
            canEdit={canEdit}
            onChange={(row) =>
              dispatch({
                type: "ATTRIBUTE_UPSERT",
                id: object.id,
                index: i,
                attribute: { ...attr, ...row },
              })
            }
            onRemove={() => dispatch({ type: "ATTRIBUTE_DELETE", id: object.id, index: i })}
          />
        ))}
        {drafts.map((row, n) => (
          <AttrRow
            key={`row-${object.attributes.length + n}`}
            row={row}
            object={object}
            graph={graph}
            canEdit={canEdit}
            onChange={(next) => patch(n, next)}
            onCommit={() => commit(n, row)}
            onRemove={() => drop(n)}
          />
        ))}
        {canEdit && <PanelAddButton onClick={add} />}
      </div>
    </PanelSection>
  );
}

/** The 30px text face every picker trigger in this panel wears. */
const PICK_TRIGGER = cn(SMALL_TEXT_BUTTON, "gap-1");

/**
 * The row's `Attribute : value` colon, a glyph the panel draws. Never typed: a
 * colon appended to the label value would be slugged into `key`
 * (`attribute-name:`), written to the server and read back by MCP.
 * `aria-hidden` — two separately named fields already read fine without it.
 */
const ROW_COLON = <span aria-hidden="true" className="shrink-0 text-text-muted">:</span>;

/**
 * One attribute, persisted or draft — one component for both, which is what makes
 * the commit invisible: the draft at index N is reconciled into the persisted row
 * at index N (`panel-section.tsx › useDraftRows`), so the caret stays put.
 *
 * `onCommit` is the draft's only extra (label blur and Enter); a persisted row's
 * `onChange` already dispatches.
 *
 * Order is `label : value [kind ▾] ✕` since 2026-09-14. The value cell is
 * `AttrValueEditor` for every kind, so the colon sits in front of a text line, a
 * tag line or a chip strip without knowing which.
 *
 * Fields are `quiet` — the kit's `.inputQuiet`, a resting state of the one
 * underline recipe, never a second face. The panel's description keeps its gray line.
 */
function AttrRow({
  row,
  object,
  graph,
  canEdit,
  onChange,
  onCommit,
  onRemove,
}: {
  row: AttrRowValue;
  object: OntologyObject;
  graph: GraphState;
  canEdit: boolean;
  onChange: (row: AttrRowValue) => void;
  onCommit?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={cn(PANEL_ROW, "group flex flex-wrap items-center gap-2")}>
      <InlineUnderlineField
        label="Attribute label"
        value={row.label}
        readOnly={!canEdit}
        quiet
        onChange={(label) => onChange({ ...row, label })}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit?.();
        }}
        className="w-24 shrink-0"
      />
      {ROW_COLON}
      <AttrValueEditor
        row={row}
        object={object}
        graph={graph}
        canEdit={canEdit}
        onChange={onChange}
      />
      <SelectMenu
        value={row.value.kind}
        options={KIND_OPTIONS}
        disabled={!canEdit}
        onChange={(kind) => onChange({ ...row, value: emptyValueOf(kind, row.value) })}
        variant="text"
        ariaLabel="Attribute type"
        className="shrink-0"
      />
      {canEdit && (
        <button
          type="button"
          aria-label={`Remove ${row.label}`}
          onClick={onRemove}
          className={ROW_REMOVE_BUTTON}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/** A fresh value of `kind`. text↔tag keep the string; every other switch starts
 *  empty rather than reinterpreting one sort of id as another. */
function emptyValueOf(kind: AttrKind, from: AttributeValue): AttributeValue {
  const text = from.kind === "text" || from.kind === "pill" ? from.value : "";
  if (kind === "text") return { kind: "text", value: text };
  if (kind === "pill") return { kind: "pill", value: text };
  if (kind === "ref") return { kind: "ref", value: [] };
  if (kind === "knowledge") return { kind: "knowledge", value: [] };
  return { kind: "skill", value: [] };
}

function AttrValueEditor({
  row,
  object,
  graph,
  canEdit,
  onChange,
}: {
  row: AttrRowValue;
  object: OntologyObject;
  graph: GraphState;
  canEdit: boolean;
  onChange: (row: AttrRowValue) => void;
}) {
  const v = row.value;
  const workspaceResources = useWorkspaceResources();

  if (v.kind === "knowledge" || v.kind === "skill") {
    const vk = v;
    return (
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {vk.value.map((id) => (
          <span key={id} className={`flex items-center gap-1.5 ${CHIP}`}>
            {workspaceResources.nameOf(id) ?? "Unavailable"}
            {canEdit && (
              <button
                type="button"
                aria-label="Remove"
                onClick={() =>
                  onChange({ ...row, value: { kind: vk.kind, value: vk.value.filter((x) => x !== id) } })
                }
                className="text-text-muted hover:text-text-primary"
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
        {canEdit &&
          (vk.kind === "knowledge" ? (
            <KnowledgePickMenu
              workspaceId={workspaceResources.workspaceId}
              bases={workspaceResources.knowledge.map((r) => ({ id: r.id, name: r.name }))}
              excludeIds={vk.value}
              onPick={(id) =>
                onChange({ ...row, value: { kind: "knowledge", value: [...vk.value, id] } })
              }
              trigger={
                <>
                  <span>Select knowledge</span>
                  <ChevronDown size={11} className="text-text-muted" />
                </>
              }
              triggerClassName={PICK_TRIGGER}
            />
          ) : (
            <PickMenu
              items={workspaceResources.skills.map((r) => ({ id: r.id, name: r.name, group: r.scope }))}
              excludeIds={vk.value}
              onPick={(id) =>
                onChange({ ...row, value: { kind: "skill", value: [...vk.value, id] } })
              }
              trigger={
                <>
                  <span>Select skill</span>
                  <ChevronDown size={11} className="text-text-muted" />
                </>
              }
              triggerClassName={PICK_TRIGGER}
            />
          ))}
      </span>
    );
  }

  if (v.kind === "ref") {
    return (
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {v.value.map((id) => {
          const target = graph.objects[id];
          if (!target) return null;
          return (
            <span key={id} className={`flex items-center gap-1.5 ${CHIP}`}>
              {target.name}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${target.name}`}
                  onClick={() =>
                    onChange({ ...row, value: { kind: "ref", value: v.value.filter((x) => x !== id) } })
                  }
                  className="text-text-muted hover:text-text-primary"
                >
                  <X size={10} />
                </button>
              )}
            </span>
          );
        })}
        {canEdit && (
          <ObjectPickMenu
            graph={graph}
            excludeIds={[object.id, ...v.value]}
            onPick={(id) => onChange({ ...row, value: { kind: "ref", value: [...v.value, id] } })}
            trigger={
              <>
                <Plus size={10} /> Link
              </>
            }
            triggerClassName={PICK_TRIGGER}
          />
        )}
      </span>
    );
  }

  if (v.kind === "pill") {
    return (
      <InlineUnderlineField
        label="Tag"
        value={v.value}
        readOnly={!canEdit}
        quiet
        onChange={(next) => onChange({ ...row, value: { kind: "pill", value: next } })}
        className="min-w-[5rem] flex-1"
      />
    );
  }

  return (
    <InlineUnderlineField
      label="Value"
      value={v.value}
      readOnly={!canEdit}
      quiet
      onChange={(next) => onChange({ ...row, value: { kind: "text", value: next } })}
      className="min-w-[5rem] flex-1"
    />
  );
}
