"use client";

/** One rule row: value, source, inline Override, and reset to the inherited value. */
import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { modelById } from "../_data/catalog";
import { ownValue, resolveField, setField, type FieldDef, type FieldValue } from "../_data/receives";
import { FactChip, ov } from "../_components/ui";
import type { ReceivesEditor } from "./receives";

function display(field: FieldDef, value: FieldValue, modelId: ReceivesEditor["modelId"]): string {
  const options = field.options?.(modelById(modelId));
  if (Array.isArray(value)) return value.join(", ") || "None";
  if (options) return options.find((o) => o.value === value)?.label ?? String(value);
  return field.unit ? `${value} ${field.unit}` : String(value);
}

function Editor({ field, value, onChange, editor }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; editor: ReceivesEditor }) {
  const model = modelById(editor.modelId);
  if (field.control === "select") {
    return (
      <SelectMenu
        variant="outline"
        ariaLabel={field.label}
        value={String(value)}
        options={field.options!(model)}
        onChange={onChange}
      />
    );
  }
  if (field.control === "chips") {
    const on = value as string[];
    return (
      <span className="flex flex-wrap gap-1">
        {field.options!(model).map((o) => {
          const active = on.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? on.filter((x) => x !== o.value) : [...on, o.value])}
              className={pillButton(active ? "ink" : "outline", "xs", { raise: false })}
            >
              {o.label}
            </button>
          );
        })}
      </span>
    );
  }
  if (field.control === "number") {
    const max = field.max?.(model);
    return (
      <span className="flex items-center gap-2">
        <input
          type="number"
          aria-label={field.label}
          value={Number(value)}
          min={field.min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isNaN(n)) return;
            onChange(Math.max(field.min ?? 0, max !== undefined ? Math.min(max, n) : n));
          }}
          className={cn(RAISED_INPUT, "h-7 w-20 px-2")}
        />
        {max !== undefined && (
          <span className="text-caption text-text-muted">
            Limit {max} on {model.name}
          </span>
        )}
      </span>
    );
  }
  if (field.control === "textarea") {
    return (
      <textarea
        aria-label={field.label}
        rows={3}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={cn(RAISED_INPUT, "resize-none px-2.5 py-1.5")}
      />
    );
  }
  return <input aria-label={field.label} value={String(value)} onChange={(e) => onChange(e.target.value)} className={cn(RAISED_INPUT, "h-7 px-2 font-mono")} />;
}

export function FieldRow({ field, editor }: { field: FieldDef; editor: ReceivesEditor }) {
  const [open, setOpen] = useState(false);
  const { modelId, scope, segment, state } = editor;
  const rules = state.draft;
  const resolved = resolveField(modelId, rules, segment, field.key);
  const own = ownValue(rules, scope, segment, field.key);
  const write = (value: FieldValue | undefined) => editor.setDraft((r) => setField(r, scope, segment, field.key, value));

  if (field.when) {
    const parent = resolveField(modelId, rules, segment, field.when.key).value;
    if (!field.when.is.includes(String(parent))) return null;
  }

  const editing = open && own !== undefined;
  return (
    <li className={cn(ov.row, "items-start")}>
      <span className="w-34 shrink-0 pt-0.5 text-body font-medium text-text-primary">{field.label}</span>
      <span className="min-w-0 flex-1 pt-0.5">
        {editing ? (
          <Editor field={field} value={own!} onChange={write} editor={editor} />
        ) : (
          <span className={cn("block text-body text-text-secondary", field.control === "text" && "font-mono text-caption")}>{display(field, resolved.value, modelId)}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <FactChip>{resolved.source}</FactChip>
        {editing ? (
          <button type="button" className={pillButton("outline", "xs")} onClick={() => setOpen(false)}>
            Done
          </button>
        ) : (
          <button
            type="button"
            className={pillButton("outline", "xs")}
            onClick={() => {
              if (own === undefined) write(resolved.value);
              setOpen(true);
            }}
          >
            {own === undefined ? "Override" : "Edit"}
          </button>
        )}
        {own !== undefined && (
          <button
            type="button"
            className={cn(TEXT_LINK_BUTTON, "text-caption text-text-muted")}
            onClick={() => {
              write(undefined);
              setOpen(false);
            }}
          >
            Reset to inherited
          </button>
        )}
      </span>
    </li>
  );
}
