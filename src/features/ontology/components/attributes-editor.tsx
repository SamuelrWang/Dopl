"use client";

import { useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { SelectMenu } from "@/shared/ui/select-menu";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import type { GraphAction, GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import { KnowledgePickMenu } from "./knowledge-pick-menu";
import { ObjectPickMenu } from "./object-pick-menu";
import { CHIP } from "./ontology-bits";
import { PANEL_ADD_ROW, PanelSection, ROW_REMOVE_BUTTON } from "./panel-section";
import { KIND_OPTIONS } from "./template-editor";
import { PickMenu } from "./pick-menu";

type AttrKind = OntologyObject["attributes"][number]["value"]["kind"];

type Attribute = OntologyObject["attributes"][number];

/**
 * Attributes section — editable key/value rows, labels edit in place. Value
 * kinds: text, tag, object refs (cascade picker), and access-gated knowledge /
 * skills (PickMenu offers only resources the caller can see).
 *
 * ⚠ **FLAT SINCE 2026-09-12** (Samuel, over the object panel: *"no more indented
 * stuff"*). What went: the `SectionBox` frame, the concave body, the resize grip,
 * the `bento` card each row sat on, and every `FIELD_WELL` — a text row is the
 * popup kit's UNDERLINE now (`board-header-bits.tsx › InlineUnderlineField`, the
 * board header's own field, imported not re-cut), the kind picker is a
 * `SelectMenu` text face, and the pickers and Add wear `SMALL_TEXT_BUTTON` at the
 * 30px scale rather than a raised `btn-light` pill. ⚠ The CHIPS stay chips: a
 * knowledge / skill / object value is a removable TOKEN, not a field.
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
  const [newLabel, setNewLabel] = useState("");
  const [newKind, setNewKind] = useState<AttrKind>("text");

  const addAttribute = () => {
    const label = newLabel.trim();
    if (!label) return;
    const value: Attribute["value"] =
      newKind === "text" || newKind === "pill"
        ? { kind: newKind, value: "" }
        : { kind: newKind, value: [] };
    dispatch({
      type: "ATTRIBUTE_UPSERT",
      id: object.id,
      index: null,
      attribute: { key: label.toLowerCase().replace(/\s+/g, "-"), label, value },
    });
    setNewLabel("");
  };

  return (
    <PanelSection label="Attributes" meta={`${object.attributes.length}`}>
      {object.attributes.map((attr, i) => (
        <div key={`${attr.key}-${i}`} className="group flex items-center gap-3">
          <InlineUnderlineField
            label="Attribute label"
            value={attr.label}
            readOnly={!canEdit}
            onChange={(label) =>
              dispatch({
                type: "ATTRIBUTE_UPSERT",
                id: object.id,
                index: i,
                attribute: { ...attr, label },
              })
            }
            className="w-32 shrink-0"
          />
          <AttrValueEditor
            attr={attr}
            object={object}
            graph={graph}
            canEdit={canEdit}
            onChange={(attribute) =>
              dispatch({ type: "ATTRIBUTE_UPSERT", id: object.id, index: i, attribute })
            }
          />
          {canEdit && (
            <button
              type="button"
              aria-label={`Remove ${attr.label}`}
              onClick={() => dispatch({ type: "ATTRIBUTE_DELETE", id: object.id, index: i })}
              className={ROW_REMOVE_BUTTON}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className={PANEL_ADD_ROW}>
          <InlineUnderlineField
            label="New attribute"
            value={newLabel}
            onChange={setNewLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") addAttribute();
            }}
            className="w-36"
          />
          <SelectMenu
            value={newKind}
            options={KIND_OPTIONS}
            onChange={setNewKind}
            variant="text"
            ariaLabel="Attribute type"
          />
          <button type="button" onClick={addAttribute} className={cn(SMALL_TEXT_BUTTON, "gap-1")}>
            <Plus size={11} /> Add
          </button>
        </div>
      )}
    </PanelSection>
  );
}

/** The 30px text face every picker trigger in this panel wears. */
const PICK_TRIGGER = cn(SMALL_TEXT_BUTTON, "gap-1");

function AttrValueEditor({
  attr,
  object,
  graph,
  canEdit,
  onChange,
}: {
  attr: Attribute;
  object: OntologyObject;
  graph: GraphState;
  canEdit: boolean;
  onChange: (attr: Attribute) => void;
}) {
  const v = attr.value;
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
                  onChange({ ...attr, value: { kind: vk.kind, value: vk.value.filter((x) => x !== id) } })
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
                onChange({ ...attr, value: { kind: "knowledge", value: [...vk.value, id] } })
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
                onChange({ ...attr, value: { kind: "skill", value: [...vk.value, id] } })
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
                    onChange({ ...attr, value: { kind: "ref", value: v.value.filter((x) => x !== id) } })
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
            onPick={(id) => onChange({ ...attr, value: { kind: "ref", value: [...v.value, id] } })}
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
        onChange={(next) => onChange({ ...attr, value: { kind: "pill", value: next } })}
        className="min-w-0 flex-1"
      />
    );
  }

  return (
    <InlineUnderlineField
      label="Value"
      value={v.value}
      readOnly={!canEdit}
      onChange={(next) => onChange({ ...attr, value: { kind: "text", value: next } })}
      className="min-w-0 flex-1"
    />
  );
}
