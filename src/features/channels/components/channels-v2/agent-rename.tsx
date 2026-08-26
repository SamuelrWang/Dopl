"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";

/**
 * RENAME ONE AGENT, IN PLACE (2026-08-25, Samuel's ruling). The card's title with a pencil that
 * appears on hover; clicking it turns the title into the field, and the field is nothing but the
 * text on a black underline.
 *
 * ⚠ NO INPUT CHROME, and that is the design, not an omission: no box, no background, no buttons.
 * The line under the text is the entire affordance, so the card does not reflow between reading
 * and editing — a bordered field would push every row below it down the moment you click.
 *
 * ⚠ ENTER AND BLUR SAVE; ESCAPE CANCELS. Blur saving is the one that needs stating: clicking
 * away from a field you have typed into means "keep it" everywhere else in this product, and a
 * rename that silently discarded on blur would read as a broken control.
 *
 * ⚠ IT PAINTS MAIN'S ANSWER, NEVER ITS OWN ASK. `sessions.rename` returns the string the
 * machine stored, and a refusal (too long, control / zero-width / bidi characters) reverts the
 * text rather than leaving a name nothing is holding. Same rule `setMode` / `setModel` follow.
 *
 * ⚠ AN EMPTY NAME CLEARS, going back to the canonical `Agent #<id>` — the same op, because
 * "unname" is not a second thing to say.
 *
 * ⚠ DESKTOP-ONLY, FEATURE-DETECTED. With no bridge (a plain browser) or an older main with no
 * handler, there is no pencil at all: a control that cannot save is worse than an absent one.
 */
export function AgentName({
  agentId,
  name,
  className,
}: {
  /** The instance address. ⚠ Absent on an older main — then there is nothing to key a name to. */
  agentId?: string | null;
  /** What the card shows today (`agentDisplayName`), already resolved. */
  name: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [shown, setShown] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // ⚠ Guards the double-save: Enter blurs the field, and the blur handler would otherwise
  // send the same rename a second time.
  const saving = useRef(false);

  // The projection is the source of truth — a summary push (a rename in another window, a
  // refusal) must win over what is on screen.
  useEffect(() => {
    setShown(name);
  }, [name]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const rename = getSpaBridge()?.sessions?.rename;
  const canRename = typeof rename === "function" && !!agentId;

  const commit = async () => {
    if (saving.current) return;
    saving.current = true;
    setEditing(false);
    const next = draft.trim();
    // Unchanged is not a write. `shown` is what the card reads, which for an unnamed agent is
    // the canonical `Agent #<id>` — sending that back would store the address as a name.
    if (!rename || !agentId || next === shown.trim()) {
      saving.current = false;
      return;
    }
    // Optimistic, and reverted below on anything but main's own value.
    setShown(next || name);
    const res = await rename(agentId, next);
    saving.current = false;
    if (!res?.ok) {
      setShown(name);
      return;
    }
    setShown(res.displayName ?? name);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label="Agent name"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            saving.current = true; // the blur that follows must not save
            setEditing(false);
            setDraft(shown);
            saving.current = false;
          }
        }}
        // ⚠ THE UNDERLINE IS THE WHOLE FIELD: no ring, no fill, no border but the bottom one,
        // and the same type as the title it replaces so nothing shifts.
        className={`min-w-0 flex-1 border-0 border-b border-text-primary bg-transparent p-0 text-body font-semibold text-text-primary outline-none ${className ?? ""}`}
      />
    );
  }

  return (
    <span className={`group/name flex min-w-0 flex-1 items-center gap-1 ${className ?? ""}`}>
      <span className="min-w-0 truncate text-body font-semibold text-text-primary">
        {shown}
      </span>
      {canRename && (
        <button
          type="button"
          aria-label={`Rename ${shown}`}
          onClick={() => {
            setDraft(shown);
            setEditing(true);
          }}
          // Hidden until the card is hovered or the button itself is focused — the name is
          // what the row is for, and a permanent pencil beside every agent is noise.
          className="shrink-0 cursor-pointer text-text-muted opacity-0 transition-opacity hover:text-text-primary focus-visible:opacity-100 group-hover/card:opacity-100"
        >
          <Pencil size={11} />
        </button>
      )}
    </span>
  );
}
