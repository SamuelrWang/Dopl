"use client";

import { useState } from "react";
import { FileText, Paperclip, Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import type { GraphAction } from "../graph-state";
import type { OntologyObject } from "../types";
import { CHIP, FIELD_WELL, SectionBox } from "./ontology-bits";

/**
 * Attributes section — editable key/value rows. Value kinds: text, tag
 * (pill), files. Rows edit in place; ✕ removes; the footer row adds.
 */
export function AttributesEditor({
  object,
  dispatch,
}: {
  object: OntologyObject;
  dispatch: Dispatch<GraphAction>;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newKind, setNewKind] = useState<"text" | "pill" | "files">("text");

  const addAttribute = () => {
    const label = newLabel.trim();
    if (!label) return;
    dispatch({
      type: "ATTRIBUTE_UPSERT",
      id: object.id,
      index: null,
      attribute: {
        key: label.toLowerCase().replace(/\s+/g, "-"),
        label,
        value:
          newKind === "files"
            ? { kind: "files", value: [] }
            : { kind: newKind, value: "" },
      },
    });
    setNewLabel("");
  };

  return (
    <SectionBox label="Attributes" meta={`${object.attributes.length}`}>
      <div className="divide-y divide-black/[0.05]">
        {object.attributes.map((attr, i) => (
          <div key={`${attr.key}-${i}`} className="group flex items-center gap-3 px-4 py-1.5">
            <span className="w-36 shrink-0 text-[13px] text-[#646d78]">
              {attr.label}
            </span>
            <AttrValueEditor
              attr={attr}
              onChange={(attribute) =>
                dispatch({ type: "ATTRIBUTE_UPSERT", id: object.id, index: i, attribute })
              }
            />
            <button
              type="button"
              aria-label={`Remove ${attr.label}`}
              onClick={() => dispatch({ type: "ATTRIBUTE_DELETE", id: object.id, index: i })}
              className="rounded-md p-1 text-[#98a2ad] opacity-0 transition hover:bg-black/[0.05] hover:text-[#232a31] group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5 border-t border-black/[0.06] bg-[#f4f6f9] px-4 py-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAttribute()}
            placeholder="new attribute…"
            className={`${FIELD_WELL} h-7 w-40 px-2.5 text-[12.5px] text-[#232a31] placeholder:text-[#98a2ad]`}
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as typeof newKind)}
            aria-label="Attribute type"
            className={`${FIELD_WELL} h-7 px-1.5 text-[12px] text-[#646d78]`}
          >
            <option value="text">Text</option>
            <option value="pill">Tag</option>
            <option value="files">Files</option>
          </select>
          <button
            type="button"
            onClick={addAttribute}
            className="btn-light flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-[#232a31]"
          >
            <Plus size={11} /> Add
          </button>
        </div>
      </div>
    </SectionBox>
  );
}

function AttrValueEditor({
  attr,
  onChange,
}: {
  attr: OntologyObject["attributes"][number];
  onChange: (attr: OntologyObject["attributes"][number]) => void;
}) {
  const v = attr.value;

  if (v.kind === "files") {
    return (
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {v.value.map((f, i) => (
          <span
            key={`${f}-${i}`}
            className={`group/file flex items-center gap-1 ${CHIP}`}
          >
            <FileText size={10} className="text-[#98a2ad]" /> {f}
            <button
              type="button"
              aria-label={`Remove ${f}`}
              onClick={() =>
                onChange({ ...attr, value: { kind: "files", value: v.value.filter((_, j) => j !== i) } })
              }
              className="text-[#98a2ad] hover:text-[#232a31]"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...attr,
              value: { kind: "files", value: [...v.value, `upload-${v.value.length + 1}.md`] },
            })
          }
          className="btn-light flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-[#232a31]"
        >
          <Paperclip size={10} /> Upload
        </button>
      </span>
    );
  }

  if (v.kind === "pill") {
    return (
      <input
        type="text"
        value={v.value}
        onChange={(e) => onChange({ ...attr, value: { kind: "pill", value: e.target.value } })}
        placeholder="tag…"
        className={`w-fit min-w-24 ${CHIP} placeholder:text-[#98a2ad] focus:border-black/[0.3] focus:outline-none`}
      />
    );
  }

  return (
    <input
      type="text"
      value={v.value}
      onChange={(e) => onChange({ ...attr, value: { kind: "text", value: e.target.value } })}
      placeholder="value…"
      className="min-w-0 flex-1 bg-transparent text-[13px] text-[#232a31] placeholder:text-[#98a2ad] focus:outline-none"
    />
  );
}
