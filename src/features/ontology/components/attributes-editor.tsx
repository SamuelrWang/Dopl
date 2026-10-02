"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { SelectMenu } from "@/shared/ui/select-menu";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import type { GraphAction, GraphState } from "../graph-state";
import { emptyValue, isHttpUrl, isIsoDate } from "../field-kinds";
import type { AttributeValue, ObjectAttribute, OntologyObject, TemplateField } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import { FieldDescription, withDescription } from "./field-description";
import { FieldMenu } from "./field-menu";
import { DateValueEditor, EnumValueEditor, LinkValueEditor } from "./field-value-editors";
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
type AttrRowValue = Omit<ObjectAttribute, "key">;

/**
 * The template field this attribute was born from — same `key`, on the object's
 * container. ⚠ A SELECT FIELD'S OPTIONS ARE THE TEMPLATE'S when it has one (the
 * field defines the choices; Samuel, 2026-10-01), so editing them on the type
 * reaches every card without rewriting each card's row. The card's own
 * `options` copy is what the server checks, and it is re-synced on every pick.
 */
function templateFieldOf(
  object: OntologyObject,
  graph: GraphState,
  key: string
): { field: TemplateField; container: OntologyObject } | null {
  for (const container of Object.values(graph.objects)) {
    if (!container.childIds.includes(object.id)) continue;
    const field = container.template.find((f) => f.key === key);
    if (field) return { field, container };
  }
  return null;
}

/**
 * Attributes section — one white bar per attribute, showing all three cells at
 * once: label, kind, value. Value kinds: text, tag, select / date / link
 * (`field-value-editors.tsx`), object refs (cascade picker), and access-gated
 * knowledge / skills (PickMenu offers only resources the caller can see). A saved
 * row's ⋯ (`field-menu.tsx`) edits its description and a select's options.
 *
 * 2026-09-13: every cell exists from the moment the row does — `+ Add` appends an
 * empty bar (`panel-section.tsx › useDraftRows`) and the value cell can be typed
 * in before the label is.
 *
 * `ObjectAttribute.key` is the label slugged at creation — the address MCP writes
 * at (`set_attribute`), not a cell, and deliberately off screen; the second
 * column a person sets is `value.kind`.
 *
 * Changing the kind empties the value unless it is still valid (`emptyValueOf`).
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
        {object.attributes.map((attr, i) => {
          const source = templateFieldOf(object, graph, attr.key);
          const upsert = (row: AttrRowValue) =>
            dispatch({
              type: "ATTRIBUTE_UPSERT",
              id: object.id,
              index: i,
              attribute: { key: attr.key, ...row },
            });
          return (
            <AttrRow
              key={`row-${i}`}
              row={attr}
              field={source?.field}
              object={object}
              graph={graph}
              canEdit={canEdit}
              onChange={upsert}
              onRemove={() => dispatch({ type: "ATTRIBUTE_DELETE", id: object.id, index: i })}
              onOptions={(options) => {
                if (source?.field.kind === "enum") {
                  // The TYPE's field owns the choices — write them there.
                  const { container, field } = source;
                  dispatch({
                    type: "OBJECT_UPDATE",
                    id: container.id,
                    patch: {
                      template: container.template.map((f) =>
                        f.key === field.key ? { ...f, options } : f
                      ),
                    },
                  });
                  return;
                }
                // A free-standing select: its own list. A value the new list
                // drops is cleared, or the whole save would 400 (`schema.ts`).
                const value =
                  attr.value.kind === "enum" && !options.includes(attr.value.value)
                    ? { kind: "enum" as const, value: "" }
                    : attr.value;
                upsert({ ...attr, options, value });
              }}
            />
          );
        })}
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
  field,
  object,
  graph,
  canEdit,
  onChange,
  onCommit,
  onRemove,
  onOptions,
}: {
  row: AttrRowValue;
  /** The template field it was born from, when the type still has one. */
  field?: TemplateField;
  object: OntologyObject;
  graph: GraphState;
  canEdit: boolean;
  onChange: (row: AttrRowValue) => void;
  onCommit?: () => void;
  onRemove: () => void;
  /** Persisted rows only — present means the ⋯ menu replaces the ✕. */
  onOptions?: (options: string[]) => void;
}) {
  const options =
    field?.kind === "enum" ? (field.options ?? []) : (row.options ?? []);
  const description = row.description || field?.description;
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
        options={options}
        object={object}
        graph={graph}
        canEdit={canEdit}
        onChange={onChange}
      />
      <SelectMenu
        value={row.value.kind}
        options={KIND_OPTIONS}
        disabled={!canEdit}
        onChange={(kind) => {
          const value = emptyValueOf(kind, row.value, options);
          onChange(kind === "enum" ? { ...row, options, value } : { ...row, value });
        }}
        variant="text"
        ariaLabel="Attribute type"
        className="shrink-0"
      />
      {canEdit && onOptions && (
        <FieldMenu
          label={row.label}
          description={description ?? ""}
          options={row.value.kind === "enum" ? options : undefined}
          onDescription={(next) => onChange(withDescription(row, next))}
          onOptions={onOptions}
          onRemove={onRemove}
        />
      )}
      {canEdit && !onOptions && (
        <button
          type="button"
          aria-label={`Remove ${row.label}`}
          onClick={onRemove}
          className={ROW_REMOVE_BUTTON}
        >
          <X size={12} />
        </button>
      )}
      <FieldDescription text={description} />
    </div>
  );
}

/**
 * A fresh value of `kind`. The four one-string kinds keep the string when it is
 * still valid in the new kind (text↔tag always; a select only if it is one of
 * the options, a date only if it is a day, a link only if it parses); every
 * other switch starts empty rather than reinterpreting one sort of id as
 * another — and rather than writing a value the server would refuse.
 */
function emptyValueOf(
  kind: AttrKind,
  from: AttributeValue,
  options: readonly string[]
): AttributeValue {
  const text = typeof from.value === "string" ? from.value : "";
  if (kind === "text" || kind === "pill") return { kind, value: text };
  if (kind === "enum") return { kind, value: options.includes(text) ? text : "" };
  if (kind === "date") return { kind, value: isIsoDate(text) ? text : "" };
  if (kind === "link") return { kind, value: isHttpUrl(text) ? text : "" };
  return emptyValue(kind);
}

function AttrValueEditor({
  row,
  options,
  object,
  graph,
  canEdit,
  onChange,
}: {
  row: AttrRowValue;
  /** The select's effective choices (`AttrRow`). */
  options: string[];
  object: OntologyObject;
  graph: GraphState;
  canEdit: boolean;
  onChange: (row: AttrRowValue) => void;
}) {
  const v = row.value;
  const workspaceResources = useWorkspaceResources();

  if (v.kind === "enum") {
    return (
      <EnumValueEditor
        value={v.value}
        options={options}
        canEdit={canEdit}
        // The choices ride along so the server checks against what was offered.
        onChange={(next) => onChange({ ...row, options, value: { kind: "enum", value: next } })}
      />
    );
  }
  if (v.kind === "date") {
    return (
      <DateValueEditor
        value={v.value}
        canEdit={canEdit}
        onChange={(next) => onChange({ ...row, value: { kind: "date", value: next } })}
      />
    );
  }
  if (v.kind === "link") {
    return (
      <LinkValueEditor
        value={v.value}
        canEdit={canEdit}
        onChange={(next) => onChange({ ...row, value: { kind: "link", value: next } })}
      />
    );
  }

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
