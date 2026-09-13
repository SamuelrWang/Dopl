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
  PANEL_WELL,
  PanelAddButton,
  PanelSection,
  ROW_REMOVE_BUTTON,
  useDraftRows,
} from "./panel-section";
import { KIND_OPTIONS } from "./template-editor";
import { PickMenu } from "./pick-menu";

type AttrKind = AttributeValue["kind"];

/** A row's EDITABLE HALF — what a person types. The persisted attribute carries
 *  a `key` beside it; a draft has none yet, and the two render identically. */
type AttrRowValue = { label: string; value: AttributeValue };

/**
 * Attributes section — one WHITE BAR per attribute on the section's gray well,
 * each bar showing all three cells at once: the label, the KIND, the value.
 * Value kinds: text, tag, object refs (cascade picker), and access-gated
 * knowledge / skills (PickMenu offers only resources the caller can see).
 *
 * ⚠ **EVERY CELL EXISTS FROM THE MOMENT THE ROW DOES (Samuel, 2026-09-13:
 * *"right now … I see the word 'new attribute' … I have to put text into 'new
 * attribute', and when I click 'Add', the field for value comes up. I don't like
 * this. For each line, we should see: the new attribute name, the key, the value
 * field"*).** The add COMPOSER is deleted: `+ Add` under the rows appends an empty
 * bar (`panel-section.tsx › useDraftRows`) and the value cell is there to type in
 * before the label is.
 *
 * ⚠ **"THE KEY" IS THE KIND PICKER.** `ObjectAttribute.key` is the label SLUGGED
 * at creation — the address MCP writes at (`set_attribute`), not a cell — and it
 * is deliberately still not on screen; the second column a person sees and sets
 * is `value.kind`, which every persisted row now carries too (it used to exist
 * only in the composer, so an attribute's kind could be chosen once and never
 * changed).
 *
 * ⚠ **CHANGING THE KIND EMPTIES THE VALUE, EXCEPT text↔tag.** Those two are both
 * one string and it survives; every other pair is a list of ids of a different
 * KIND of thing, and carrying ids across would keep a knowledge id in a `ref`.
 *
 * ⚠ **FLAT SINCE 2026-09-12** (Samuel: *"no more indented stuff"*), and the well
 * is not a return of the frame — see `panel-section.tsx › PanelSection`. Text
 * rows are the popup kit's UNDERLINE (`board-header-bits.tsx ›
 * InlineUnderlineField`, imported not re-cut), kind is a `SelectMenu` text face,
 * pickers wear `SMALL_TEXT_BUTTON`, and no `FIELD_WELL` survives anywhere here.
 * ⚠ The CHIPS stay chips: a knowledge / skill / object value is a removable
 * TOKEN, not a field.
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

  /** ⚠ THE SAME `ATTRIBUTE_UPSERT` THE COMPOSER DISPATCHED, key slugged the same
   *  way — the row is new, the write path is not. An unnamed row stays a draft. */
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
      <div className={PANEL_WELL}>
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
 * ONE ATTRIBUTE, PERSISTED OR DRAFT — **ONE COMPONENT FOR BOTH**, which is what
 * makes the commit invisible: the draft at index N is reconciled into the
 * persisted row at index N (`panel-section.tsx › useDraftRows`), so the caret
 * stays where it was.
 *
 * ⚠ `onCommit` is the DRAFT's only extra: it fires on the label's blur and on
 * Enter. A persisted row needs none — its `onChange` already dispatches.
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
        onChange={(label) => onChange({ ...row, label })}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit?.();
        }}
        className="w-24 shrink-0"
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
      <AttrValueEditor
        row={row}
        object={object}
        graph={graph}
        canEdit={canEdit}
        onChange={onChange}
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

/** A fresh value of `kind`. ⚠ text↔tag keep the string; every other switch
 *  starts empty rather than reinterpreting one sort of id as another. */
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
      onChange={(next) => onChange({ ...row, value: { kind: "text", value: next } })}
      className="min-w-[5rem] flex-1"
    />
  );
}
