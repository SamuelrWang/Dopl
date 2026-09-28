"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { InlineEditableRow } from "@/shared/ui/inline-editable-row";
import { UNDERLINE_FIELD } from "@/shared/ui/wells";

/**
 * A device row's NAME, click-to-rename in place — one control for every kind (computers and
 * glasses). The inline-rename underline (`wells.ts › UNDERLINE_FIELD`) over the row's box face;
 * Enter or blur saves, Escape cancels, an unchanged value writes nothing.
 *
 * `detectedName` makes clearing a value: the field COMMITS `""` and the server restores the name the
 * device reported, shown as the placeholder while the field is empty.
 */
export function DeviceNameTitle({
  name,
  ariaLabel,
  maxLength,
  detectedName,
  onRename,
}: {
  name: string;
  ariaLabel: string;
  maxLength: number;
  detectedName?: string | null;
  /** Throws to stay in the field (the caller toasts); `""` only when `detectedName` is given. */
  onRename: (next: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  if (!renaming) {
    return (
      <button
        type="button"
        onClick={() => setRenaming(true)}
        title="Rename"
        className="block max-w-full truncate text-left"
      >
        {name}
      </button>
    );
  }
  return (
    <InlineEditableRow
      value={name}
      maxLength={maxLength}
      ariaLabel={ariaLabel}
      placeholder={detectedName ?? undefined}
      allowEmpty={detectedName != null}
      onCommit={async (next) => {
        await onRename(next);
        setRenaming(false);
      }}
      onExit={() => setRenaming(false)}
      inputClassName={cn(
        UNDERLINE_FIELD,
        "rounded-none font-medium focus:border-text-primary focus:bg-transparent"
      )}
    />
  );
}
