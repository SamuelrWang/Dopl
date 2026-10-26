"use client";

import { X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import { SelectMenu } from "@/shared/ui/select-menu";
import type { GraphAction, GraphState } from "../graph-state";
import { convertValue, fieldKey } from "../field-kinds";
import type { OntologyObject, TemplateField } from "../types";
import { AttrValueEditor, type AttrRowValue } from "./attribute-value-editor";
import { InlineUnderlineField } from "./board-header-bits";
import { FieldDescription, withDescription } from "./field-description";
import { FieldMenu } from "./field-menu";
import {
  PANEL_GRID,
  PANEL_ROW,
  PANEL_ROWS,
  PanelAddButton,
  PanelSection,
  ROW_REMOVE_BUTTON,
  useDraftRows,
} from "./panel-section";
import { KIND_TRIGGER, useKindOptions } from "./template-editor";

/**
 * The template field this attribute was born from: same `key`, on the object's container. A select
 * field's options and every description are the TYPE's, so an edit there reaches every card; the
 * card's own `options` copy is what the server checks, re-synced on every pick.
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
 * Attributes: one hairline row per attribute — label, value, then the kind and the row's menu.
 * `+ Add` appends an empty row whose value can be typed before its label. `key` is the label slugged
 * at creation (the address MCP writes at) and stays off screen. Changing the kind keeps the value
 * only while it is still valid (`convertValue`).
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

  const commit = (index: number, row: AttrRowValue) => {
    const label = row.label.trim();
    if (!label) return;
    dispatch({
      type: "ATTRIBUTE_UPSERT",
      id: object.id,
      index: null,
      attribute: { key: fieldKey(label), label, value: row.value },
    });
    drop(index);
  };

  /** One field of the card's TYPE, rewritten in place on the container. */
  const writeField = (
    { container, field }: { field: TemplateField; container: OntologyObject },
    edit: (f: TemplateField) => TemplateField
  ) =>
    dispatch({
      type: "OBJECT_UPDATE",
      id: container.id,
      patch: { template: container.template.map((f) => (f.key === field.key ? edit(f) : f)) },
    });

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
              onDescription={
                source ? (next) => writeField(source, (f) => withDescription(f, next)) : undefined
              }
              onOptions={(options) => {
                if (source?.field.kind === "enum") {
                  writeField(source, (f) => ({ ...f, options }));
                  return;
                }
                // A free-standing select keeps its own list. A value the new list drops is
                // cleared, or the whole save would 400.
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

/**
 * One attribute, persisted or draft: one component for both, so a draft at index N reconciles into
 * the persisted row at index N and the caret stays put. `onCommit` is the draft's only extra.
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
  onDescription,
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
  /** Writes the TYPE's field — absent when the card's type has no such field. */
  onDescription?: (next: string) => void;
  /** Persisted rows only — present means the ⋯ menu replaces the ✕. */
  onOptions?: (options: string[]) => void;
}) {
  const options = field?.kind === "enum" ? (field.options ?? []) : (row.options ?? []);
  const kindOptions = useKindOptions(row.value.kind);
  return (
    <div className={cn(PANEL_ROW, PANEL_GRID)}>
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
        className="min-w-0"
        inputClassName={fieldStyles.inputSecondary}
      />
      <div className="flex min-w-0 items-center gap-1.5">
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
          options={kindOptions}
          disabled={!canEdit}
          onChange={(kind) => {
            const value = convertValue(kind, row.value, options);
            onChange(kind === "enum" ? { ...row, options, value } : { ...row, value });
          }}
          variant="bare"
          ariaLabel="Attribute type"
          className={KIND_TRIGGER}
        />
        {canEdit && onOptions && (
          <FieldMenu
            label={row.label}
            description={field?.description ?? ""}
            options={row.value.kind === "enum" ? options : undefined}
            onDescription={onDescription}
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
      </div>
      <FieldDescription text={field?.description} />
    </div>
  );
}
