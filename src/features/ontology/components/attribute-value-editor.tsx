"use client";

import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { BARE_TRIGGER_FACE } from "@/shared/ui/select-menu";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import type { GraphState } from "../graph-state";
import type { ObjectAttribute, OntologyObject } from "../types";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import { InlineUnderlineField } from "@/shared/ui/form-dialog";
import {
  DateValueEditor,
  EnumValueEditor,
  LinkValueEditor,
  NumberValueEditor,
} from "./field-value-editors";
import { KnowledgePickMenu } from "./knowledge-pick-menu";
import { ObjectPickMenu } from "./object-pick-menu";
import { CHIP_TEXT, VALUE_CHIP } from "./ontology-bits";
import { ROW_ICON_BUTTON } from "./panel-section";
import { PickMenu } from "./pick-menu";

/** A row's editable half. A persisted attribute carries a `key` beside it; a draft has none. */
export type AttrRowValue = Omit<ObjectAttribute, "key">;

/** The picker trigger after a chip strip: a muted bare value, so it reads as the strip's tail. */
export const PICK_TRIGGER = cn(
  BARE_TRIGGER_FACE,
  "inline-flex shrink-0 items-center gap-0.5 text-text-muted hover:text-text-primary"
);

interface ChipItem {
  id: string;
  name: string;
}

/**
 * Removable chips, then a picker. Chips wrap as whole pills and truncate inside the cell, so a
 * long name never breaks a row. `onOpen` makes the name a button (a relationship's target).
 */
export function ChipStrip({
  items,
  canEdit,
  removeLabel,
  onRemove,
  onOpen,
  picker,
}: {
  items: readonly ChipItem[];
  canEdit: boolean;
  removeLabel: (item: ChipItem) => string;
  onRemove: (id: string) => void;
  onOpen?: (id: string) => void;
  picker: ReactNode;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
      {items.map((item) => (
        <span key={item.id} className={VALUE_CHIP} title={item.name}>
          {onOpen ? (
            <button type="button" onClick={() => onOpen(item.id)} className={cn(CHIP_TEXT, TEXT_LINK_BUTTON)}>
              {item.name}
            </button>
          ) : (
            <span className={CHIP_TEXT}>{item.name}</span>
          )}
          {canEdit && (
            <button
              type="button"
              aria-label={removeLabel(item)}
              onClick={() => onRemove(item.id)}
              className={cn(ROW_ICON_BUTTON, "-mr-1 p-0.5")}
            >
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {canEdit && picker}
    </span>
  );
}

/** `+ Add` with the kind in its accessible name, so it never collides with the section's Add. */
function AddPick({ noun }: { noun: string }) {
  return (
    <>
      <Plus size={10} aria-hidden="true" />
      Add<span className="sr-only"> {noun}</span>
    </>
  );
}

/** One attribute's value cell, for every kind. Each typed editor writes only what the server
 *  accepts (`field-value-editors.tsx`). */
export function AttrValueEditor({
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
  const resources = useWorkspaceResources();

  switch (v.kind) {
    case "enum":
      return (
        <EnumValueEditor
          value={v.value}
          options={options}
          canEdit={canEdit}
          // The choices ride along so the server checks against what was offered.
          onChange={(next) => onChange({ ...row, options, value: { kind: "enum", value: next } })}
        />
      );
    case "date":
      return (
        <DateValueEditor
          value={v.value}
          canEdit={canEdit}
          onChange={(next) => onChange({ ...row, value: { kind: "date", value: next } })}
        />
      );
    case "number":
      return (
        <NumberValueEditor
          value={v.value}
          canEdit={canEdit}
          onChange={(next) => onChange({ ...row, value: { kind: "number", value: next } })}
        />
      );
    case "link":
      return (
        <LinkValueEditor
          value={v.value}
          canEdit={canEdit}
          onChange={(next) => onChange({ ...row, value: { kind: "link", value: next } })}
        />
      );
    case "knowledge":
    case "skill": {
      const kind = v.kind;
      const write = (ids: string[]) => onChange({ ...row, value: { kind, value: ids } });
      return (
        <ChipStrip
          items={v.value.map((id) => ({ id, name: resources.nameOf(id) ?? "Unavailable" }))}
          canEdit={canEdit}
          removeLabel={() => "Remove"}
          onRemove={(id) => write(v.value.filter((x) => x !== id))}
          picker={
            kind === "knowledge" ? (
              <KnowledgePickMenu
                workspaceId={resources.workspaceId}
                bases={resources.knowledge.map((r) => ({ id: r.id, name: r.name }))}
                excludeIds={v.value}
                onPick={(id) => write([...v.value, id])}
                trigger={<AddPick noun="knowledge" />}
                triggerClassName={PICK_TRIGGER}
              />
            ) : (
              <PickMenu
                items={resources.skills.map((r) => ({ id: r.id, name: r.name, group: r.scope }))}
                excludeIds={v.value}
                onPick={(id) => write([...v.value, id])}
                trigger={<AddPick noun="skill" />}
                triggerClassName={PICK_TRIGGER}
              />
            )
          }
        />
      );
    }
    case "ref": {
      const write = (ids: string[]) => onChange({ ...row, value: { kind: "ref", value: ids } });
      return (
        <ChipStrip
          items={v.value.flatMap((id) => {
            const target = graph.objects[id];
            return target ? [{ id, name: target.name }] : [];
          })}
          canEdit={canEdit}
          removeLabel={(item) => `Remove ${item.name}`}
          onRemove={(id) => write(v.value.filter((x) => x !== id))}
          picker={
            <ObjectPickMenu
              graph={graph}
              excludeIds={[object.id, ...v.value]}
              onPick={(id) => write([...v.value, id])}
              trigger={
                <>
                  <Plus size={10} aria-hidden="true" /> Link
                </>
              }
              triggerClassName={PICK_TRIGGER}
            />
          }
        />
      );
    }
    default:
      return (
        <InlineUnderlineField
          label={v.kind === "pill" ? "Tag" : "Value"}
          value={v.value}
          readOnly={!canEdit}
          quiet
          onChange={(next) => onChange({ ...row, value: { kind: v.kind, value: next } })}
          className="min-w-0 flex-1"
        />
      );
  }
}
