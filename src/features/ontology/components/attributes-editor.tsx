"use client";

import { useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import { SectionBox } from "@/shared/ui/section-box";
import type { GraphAction, GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import { KnowledgePickMenu } from "./knowledge-pick-menu";
import { ObjectPickMenu } from "./object-pick-menu";
import { CHIP, FIELD_WELL } from "./ontology-bits";
import { PickMenu } from "./pick-menu";

type AttrKind = "text" | "pill" | "ref" | "knowledge" | "skill";

type Attribute = OntologyObject["attributes"][number];

/**
 * Attributes section — fully editable key/value rows. Labels edit in
 * place. Value kinds: text, tag, object refs (cascade picker), and
 * access-gated knowledge / skills (click-driven PickMenu — only
 * resources the caller can see are offered).
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
    <SectionBox label="Attributes" meta={`${object.attributes.length}`}>
      {object.attributes.length > 0 && (
        <div className="flex flex-col gap-2 px-3 py-3">
          {object.attributes.map((attr, i) => (
            <div key={`${attr.key}-${i}`} className="bento group flex items-center gap-3 px-3.5 py-1.5">
            <input
              type="text"
              value={attr.label}
              readOnly={!canEdit}
              onChange={(e) =>
                dispatch({
                  type: "ATTRIBUTE_UPSERT",
                  id: object.id,
                  index: i,
                  attribute: { ...attr, label: e.target.value },
                })
              }
              aria-label="Attribute label"
              className="w-32 shrink-0 bg-transparent text-lead text-text-secondary placeholder:text-text-muted focus:text-text-primary focus:outline-none"
              placeholder="label…"
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
                className="rounded-md p-1 text-text-muted opacity-0 transition hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            )}
          </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="flex items-center gap-1.5 border-t border-border-subtle bg-card-surface-subtle px-4 py-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAttribute()}
            placeholder="new attribute…"
            className={`${FIELD_WELL} h-7 w-36 px-2.5 text-body text-text-primary placeholder:text-text-muted`}
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as AttrKind)}
            aria-label="Attribute type"
            className={`${FIELD_WELL} h-7 px-1.5 text-small text-text-secondary`}
          >
            <option value="text">Text</option>
            <option value="pill">Tag</option>
            <option value="ref">Object</option>
            <option value="knowledge">Knowledge</option>
            <option value="skill">Skill</option>
          </select>
          <button
            type="button"
            onClick={addAttribute}
            className="btn-light flex h-7 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
          >
            <Plus size={11} /> Add
          </button>
        </div>
      )}
    </SectionBox>
  );
}

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
    const triggerClassName =
      "btn-light flex h-6 w-40 items-center justify-between rounded-full px-3 text-caption font-medium text-text-primary";
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
              triggerClassName={triggerClassName}
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
              triggerClassName={triggerClassName}
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
              <span className="flex items-center gap-1">
                <Plus size={10} /> Link
              </span>
            }
            triggerClassName="btn-light flex h-6 items-center rounded-full px-2 text-caption font-medium text-text-primary"
          />
        )}
      </span>
    );
  }

  if (v.kind === "pill") {
    return (
      <input
        type="text"
        value={v.value}
        readOnly={!canEdit}
        onChange={(e) => onChange({ ...attr, value: { kind: "pill", value: e.target.value } })}
        placeholder="tag…"
        className={`w-fit min-w-24 ${CHIP} placeholder:text-text-muted focus:border-border-highlight focus:outline-none`}
      />
    );
  }

  return (
    <input
      type="text"
      value={v.value}
      readOnly={!canEdit}
      onChange={(e) => onChange({ ...attr, value: { kind: "text", value: e.target.value } })}
      placeholder="value…"
      className="min-w-0 flex-1 bg-transparent text-lead text-text-primary placeholder:text-text-muted focus:outline-none"
    />
  );
}
