"use client";

/** One rule row: value, source, inline Override, and reset to the inherited value. */
import { useState } from "react";
import { Badge, Button, Chip, PillMenu } from "../_design/ui";
import { RuleRow } from "../_design/ui-output";
import { FilterRow, Row, Text, TextArea, TextField } from "../_design/ui-page";
import { modelById } from "../_data/catalog";
import { ownValue, resolveField, setField, type FieldDef, type FieldValue } from "../_data/receives";
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
    const options = field.options!(model);
    return <PillMenu stable label={options.find((o) => o.value === String(value))?.label ?? String(value)} value={String(value)} options={options} onChange={onChange} />;
  }
  if (field.control === "chips") {
    const on = value as string[];
    return (
      <FilterRow>
        {field.options!(model).map((o) => {
          const active = on.includes(o.value);
          return (
            <Chip key={o.value} on={active} pressed={active} onClick={() => onChange(active ? on.filter((x) => x !== o.value) : [...on, o.value])}>
              {o.label}
            </Chip>
          );
        })}
      </FilterRow>
    );
  }
  if (field.control === "number") {
    const max = field.max?.(model);
    return (
      <Row>
        <TextField
          type="number"
          label={field.label}
          value={String(value)}
          min={field.min}
          max={max}
          onChange={(raw) => {
            const n = Number(raw);
            if (Number.isNaN(n)) return;
            onChange(Math.max(field.min ?? 0, max !== undefined ? Math.min(max, n) : n));
          }}
        />
        {max !== undefined && (
          <Text kind="smallMuted" nowrap>
            Limit {max} on {model.name}
          </Text>
        )}
      </Row>
    );
  }
  if (field.control === "textarea") return <TextArea label={field.label} value={String(value)} onChange={onChange} />;
  return <TextField label={field.label} value={String(value)} onChange={onChange} />;
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
    <RuleRow
      label={field.label}
      actions={
        <>
          <Badge tone="ring">{resolved.source}</Badge>
          {editing ? (
            <Button size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                if (own === undefined) write(resolved.value);
                setOpen(true);
              }}
            >
              {own === undefined ? "Override" : "Edit"}
            </Button>
          )}
          {own !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                write(undefined);
                setOpen(false);
              }}
            >
              Reset to inherited
            </Button>
          )}
        </>
      }
    >
      {editing ? <Editor field={field} value={own!} onChange={write} editor={editor} /> : <Text kind={field.control === "text" ? "mono" : "text"}>{display(field, resolved.value, modelId)}</Text>}
    </RuleRow>
  );
}
