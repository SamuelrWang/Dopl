"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { InlineUnderlineField } from "@/shared/ui/form-dialog";
import { ExternalAnchor } from "@/shared/ui/external-anchor";
import { SelectMenu } from "@/shared/ui/select-menu";
import { formatIsoDate, isHttpUrl, isIsoDate } from "../field-kinds";

/**
 * The value cells of the three typed kinds (2026-10-01): select, date, link.
 *
 * ⚠ EACH ONE WRITES ONLY A VALUE THE SERVER WILL ACCEPT. The panel's save is a
 * whole-array PATCH of the attribute bag (`hooks/use-ontology.ts`), so a single
 * invalid value 400s every other edit riding the same debounce. The select can
 * only offer its options, the date input yields a full day or nothing, and the
 * link holds its draft locally until it parses as http(s).
 */

/** Sentinel for "no choice" — never a stored value (the store spells it ""). */
const NONE = "\u0000none";

export function EnumValueEditor({
  value,
  options,
  canEdit,
  onChange,
}: {
  value: string;
  options: readonly string[];
  canEdit: boolean;
  onChange: (next: string) => void;
}) {
  // A stored value the options no longer carry is still SHOWN (it is the truth
  // on the row), never offered back once moved off.
  const choices = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <span className="flex min-w-[5rem] flex-1 items-center">
      <SelectMenu
        value={value === "" ? NONE : value}
        options={[
          { value: NONE, label: "—" },
          ...choices.map((o) => ({ value: o, label: o })),
        ]}
        disabled={!canEdit}
        onChange={(next) => onChange(next === NONE ? "" : next)}
        variant="text"
        ariaLabel="Value"
      />
    </span>
  );
}

export function DateValueEditor({
  value,
  canEdit,
  onChange,
}: {
  value: string;
  canEdit: boolean;
  onChange: (next: string) => void;
}) {
  if (!canEdit) {
    return (
      <span className="min-w-[5rem] flex-1 text-body text-text-primary">
        {value ? formatIsoDate(value) : "—"}
      </span>
    );
  }
  return (
    <InlineUnderlineField
      label="Value"
      type="date"
      value={value}
      quiet
      // A browser date input reports a full `YYYY-MM-DD` or "" — anything else
      // is a half-typed day, which is held back rather than written.
      onChange={(next) => {
        if (next === "" || isIsoDate(next)) onChange(next);
      }}
      className="min-w-[5rem] flex-1"
    />
  );
}

/**
 * Saved and valid → a real hyperlink that opens in the user's browser
 * (`shared/ui/external-anchor.tsx`, the bridge path on desktop), with a pencil
 * to edit. Empty, editing or invalid → the underline input; the value is written
 * on blur / Enter and only when it is an http(s) URL (or cleared).
 */
export function LinkValueEditor({
  value,
  canEdit,
  onChange,
}: {
  value: string;
  canEdit: boolean;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const invalid = editing && draft.trim() !== "" && !isHttpUrl(draft.trim());

  if (!editing && value && isHttpUrl(value)) {
    return (
      <span className="flex min-w-[5rem] flex-1 items-center gap-1.5">
        <ExternalAnchor href={value} title={value} className="min-w-0 truncate text-body">
          {value}
        </ExternalAnchor>
        {canEdit && (
          <button
            type="button"
            aria-label="Edit link"
            onClick={() => setDraft(value)}
            className="shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary"
          >
            <Pencil size={11} />
          </button>
        )}
      </span>
    );
  }

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next !== "" && !isHttpUrl(next)) return;
    setDraft(null);
    if (next !== value) onChange(next);
  };

  return (
    <span className="flex min-w-[5rem] flex-1 flex-col">
      <InlineUnderlineField
        label="Value"
        placeholder="https://"
        type="url"
        value={draft ?? value}
        readOnly={!canEdit}
        quiet
        autoFocus={editing}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      {invalid && (
        <span role="alert" className="text-caption text-danger">
          Enter an http(s) link
        </span>
      )}
    </span>
  );
}
