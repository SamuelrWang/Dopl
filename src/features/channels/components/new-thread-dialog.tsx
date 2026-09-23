"use client";

/**
 * THE NEW-THREAD POPUP — the request form as a centered dialog (2026-09-08, Samuel: *"i want to
 * make a pop up for the threads creation as well"*), and the SECOND surface built on
 * `shared/ui/form-dialog.tsx` after the New agent popup it copies its shape from.
 *
 * ⚠ **THE WIRE DID NOT MOVE, AND THAT IS THE POINT.** The payload is
 * `use-thread-writes-fanout.ts › FanOutThreadsDraft`, built exactly as `composer.tsx`'s own
 * submit built it — `title.trim()`, the panel's description as `body`, one `toUserIds` entry per
 * addressee still on screen, and ONE `newClientMsgId()` minted at submit. `new-thread-dialog.test.tsx
 * › the payload is the panel's, field for field` is the standing proof; if that assertion has to
 * change to accommodate this file, the change is wrong.
 *
 * ⚠ **THE IDEMPOTENCY KEY IS MINTED HERE NOW, and it is still minted ONCE PER CREATE.** The
 * composer minted it at its own submit; the form moved and the mint moved with it, because the
 * server derives one key per addressee from it plus the group id (INVARIANTS §8) and a key minted
 * anywhere but at the press is a key that can be reused by a second press.
 *
 * ⚠ **THE ADDRESSEES ARE REMOVABLE PILLS, NOT A `PillChoice` ROW, AND THE REASON IS THE PAYLOAD.**
 * `PillChoice` is a SINGLE choice; `toUserIds` is a LIST, and a request reaching one member where
 * the panel reached four is a different write wearing the same button. So `bits.tsx ›
 * AgentTargetPill` survives as itself, dropped one at a time, under a kit `FormSection` label.
 * ⚠ ZERO IS NOT SENDABLE: "broadcast" is not a shape this product has (INVARIANTS §5) and
 * `schema.ts › TaskFanOutSchema` 400s an empty list, so disabling the button is courtesy only.
 *
 * ⚠ **THE OLD PANEL IS DELETED, AND THIS IS THE ONLY THREAD FORM (2026-09-08, Samuel: *"look
 * there is an icon in the text input bar that is supposed to spawn new threads. Why wasn't that
 * wired in"*).** The inline `AgentRequestPanel`, `use-thread-request.ts` and
 * `composer-submit-state.ts` are GONE, with the composer's `panelOpen` branch. **BOTH entries
 * land here** — the Threads tab's nonce and the composer's `MessageSquarePlus` glyph, ADDED into
 * one signal (`composer.tsx`). Do not let a second form appear; the last one survived a week
 * because it still had an opener.
 *
 * ⚠ **THE ACCESSIBLE NAMES ARE "New thread …"** and the × is "Close new thread form" — they say
 * WHICH form a reader is inside, and renaming an accessible name is a change to the surface, not
 * a tidy-up. The VISIBLE labels are the plain words.
 *
 * ⚠ **THE SIGNAL IS A COUNTER AND THE OPEN STATE IS OWNED HERE**: a boolean prop would mirror
 * state this component owns, and mirrors drift. It is adjusted DURING RENDER (React's "state from
 * a changed prop" idiom) because `react-hooks/set-state-in-effect` is an error here.
 */

import { useMemo, useState } from "react";
import { FormDialog, FormSection, UnderlineField } from "@/shared/ui/form-dialog";
import type { FanOutThreadsDraft } from "../hooks/use-thread-writes";
import { newClientMsgId } from "../lib/optimistic-cache";
import { AgentTargetPill } from "./bits";
import type { ChannelMember } from "../types";

/** The deleted panel's wording, kept — a request nobody receives says so at CREATE time.
 *  ⚠ EXPORTED because INVARIANTS §5 counts the places this rule is stated, and a doc anchor on a
 *  string literal inside a JSX body is not resolvable. */
export const NO_ADDRESSEE_NOTE = "No agent addressed — this thread reaches nobody.";

/** "Diana Taylor" → "Diana's agent". */
function agentLabel(displayName: string | null): string {
  return `${(displayName ?? "Member").split(" ")[0]}'s agent`;
}

export function NewThreadDialog({
  signal,
  channelId,
  members,
  currentUserId,
  onCreate,
}: {
  /** Nonced ask to OPEN. ⚠ THE SUM OF BOTH OPENERS (`composer.tsx`): the Threads tab's "New
   *  thread" and the composer toolbar's own glyph. Each increment is one request; `0` is nobody
   *  asking, and adding rather than choosing is what stops one source masking the other. */
  signal: number;
  /** ⚠ CAPTURED AT SUBMIT into the draft, never re-read while the write is in flight
   *  (INVARIANTS §8, rule 4). */
  channelId: string;
  members: ChannelMember[];
  currentUserId: string;
  /** The fan-out write. ⚠ The dialog hands over a FINISHED draft — it does not know, and must not
   *  learn, that the caller's mutation is optimistic. */
  onCreate: (draft: FanOutThreadsDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());

  // Derived from the REAL roster, so the pills and the Info tab's members list cannot disagree.
  // ⚠ EVERY OTHER MEMBER — you do not address your own agent.
  const targets = useMemo(
    () =>
      members
        .filter((m) => m.userId !== currentUserId)
        .map((m) => ({ id: m.userId, label: agentLabel(m.displayName ?? m.email) })),
    [members, currentUserId]
  );

  // ⚠ RE-OPENING RESETS THE ADDRESSEES TO ALL — the deleted panel's rule, kept: a request you
  // dropped everyone from is not a draft worth restoring.
  const [seen, setSeen] = useState(signal);
  if (signal !== seen) {
    setSeen(signal);
    if (!open) {
      setOpen(true);
      setRemoved(new Set());
    }
  }

  const addressed = targets.filter((t) => !removed.has(t.id));
  const ready =
    title.trim().length > 0 && description.trim().length > 0 && addressed.length > 0;

  // ⚠ DISCARD CLEARS, it does not merely hide. A dialog that came back holding a request the
  // operator dismissed would be remembering a decision they undid — the New agent popup's rule.
  const discard = () => {
    setOpen(false);
    setTitle("");
    setDescription("");
  };

  const create = () => {
    if (!ready) return;
    const draft: FanOutThreadsDraft = {
      channelId,
      clientMsgId: newClientMsgId(),
      title: title.trim(),
      // ⚠ THE WIRE FIELD IS `body` AND THE FORM'S WORD IS "Description" — that mismatch is
      // `TaskFanOutSchema`'s and predates both surfaces. Do not rename either half to match.
      body: description.trim(),
      toUserIds: addressed.map((t) => t.id),
    };
    discard();
    onCreate(draft);
  };

  return (
    <FormDialog
      open={open}
      onDiscard={discard}
      title="New thread"
      closeLabel="Close new thread form"
      primary={{
        label: "Create",
        onClick: create,
        disabled: !ready,
        hint: ready ? "Create" : "A thread needs a title, a description and an addressee",
      }}
    >
      <UnderlineField
        id="new-thread-title"
        label="Title"
        value={title}
        onChange={setTitle}
        ariaLabel="New thread title"
      />
      <UnderlineField
        id="new-thread-description"
        label="Description"
        value={description}
        onChange={setDescription}
        ariaLabel="New thread description"
        // ⚠ ENTER BREAKS THE LINE AND DOES NOT SUBMIT — `Create` is the only thing that raises
        // the thread, which is the rule the composer's own body field has carried since
        // 2026-08-26.
        multiline
      />

      <FormSection label="Addressed">
        {addressed.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {addressed.map((target) => (
              <AgentTargetPill
                key={target.id}
                label={target.label}
                onRemove={() => setRemoved((prev) => new Set(prev).add(target.id))}
              />
            ))}
          </div>
        ) : (
          // Fail-closed, said out loud — see the header.
          <p className="py-1 text-caption text-text-muted">{NO_ADDRESSEE_NOTE}</p>
        )}
      </FormSection>
    </FormDialog>
  );
}
