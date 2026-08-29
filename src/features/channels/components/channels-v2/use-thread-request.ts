"use client";

/**
 * WHAT THE NEW-THREAD PANEL HOLDS — the request half of the composer's state,
 * split out of `composer.tsx` at the 500-line cap (§1) on the seam its siblings
 * already use: `use-agents-panel.ts` took the peer poll and the launch,
 * `use-channels-v2-selection.ts` the "which surface am I looking at" pieces.
 * This takes "what request is being drafted", and nothing else.
 *
 * ⚠ THE SEAM IS THE SAME ONE `composer-request-panel.tsx` WAS SPLIT ON.
 * `composer.tsx` is about SENDING — a draft, a mention picker, a bridge spawn.
 * A REQUEST is a form with its own shape, and the shape moved on 2026-08-26
 * when the description came inside the panel; two rates of change in one file
 * is how a send button ends up re-reviewed every time a field is added.
 *
 * ⚠ THE DESCRIPTION LIVES HERE, NOT IN THE COMPOSER TEXTAREA (Samuel,
 * 2026-08-26: *"the user will solely need to edit the new thread panel"*). It
 * used to be the chat draft wearing a different placeholder, which meant ONE
 * field served two acts and the operator had to know that the box below the
 * panel had silently changed meaning. The chat draft is now only ever a chat
 * message, and `composer.tsx` hides it outright while the panel is open.
 *
 * ⚠ `ready` IS THE COURTESY HALF ONLY. The CONTRACT is
 * `schema.ts › TaskFanOutSchema`, where an empty addressee list is a 400 — a
 * UI-only refusal would be a rule that exists until somebody writes a second
 * client.
 */

import { useMemo, useState } from "react";
import { agentLabel } from "./fixtures";
import type { ChannelMember } from "../../types";

/** One addressee's agent, as the panel's pills render it. */
export interface RequestTarget {
  id: string;
  label: string;
}

export interface ThreadRequest {
  open: boolean;
  title: string;
  description: string;
  /** Every OTHER member's agent — you do not address your own. */
  targets: RequestTarget[];
  removed: ReadonlySet<string>;
  /** `targets` minus the dropped pills: exactly who this Create reaches. */
  addressed: RequestTarget[];
  /** Title, description and at least one addressee are all present. */
  ready: boolean;
  setTitle: (next: string) => void;
  setDescription: (next: string) => void;
  removeTarget: (id: string) => void;
  /** The `MessageSquarePlus` glyph — opens, or shuts what it opened. */
  toggle: () => void;
  close: () => void;
  /** Post-send: empties the form and shuts the panel. */
  reset: () => void;
}

export function useThreadRequest({
  members,
  currentUserId,
  newThreadSignal,
}: {
  members: ChannelMember[];
  currentUserId: string;
  /** Nonced ask from another column to OPEN the panel. ⚠ A COUNTER, not a
   *  boolean: the open state stays owned here, so there is no mirror to drift.
   *  Each increment is one request; the default is nobody asking. */
  newThreadSignal: number;
}): ThreadRequest {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());

  // Derived from the REAL roster, so the pills and the Info tab's members list
  // cannot disagree.
  const targets = useMemo(
    () =>
      members
        .filter((m) => m.userId !== currentUserId)
        .map((m) => ({ id: m.userId, label: agentLabel(m.displayName ?? m.email) })),
    [members, currentUserId]
  );

  // Re-opening resets the addressees to ALL. A request you dropped everyone
  // from is not a draft worth restoring — the next one starts whole.
  const toggle = () => {
    setOpen((wasOpen) => {
      if (wasOpen) return false;
      setRemoved(new Set());
      return true;
    });
  };

  // The Threads tab's "New thread" lands here (2026-08-24). It OPENS, never
  // toggles — a button in another column that shut the panel you were typing in
  // would be a trap — and resets addressees exactly as the glyph does.
  // ⚠ ADJUSTED DURING RENDER: React's "state from a changed prop" shape, as in
  // `use-channels-v2-selection.ts` and for its measured reason —
  // `react-hooks/set-state-in-effect` is an ERROR here, and a custom hook runs
  // in the owner's render pass where an effect does not.
  const [seen, setSeen] = useState(newThreadSignal);
  if (newThreadSignal !== seen) {
    setSeen(newThreadSignal);
    if (!open) {
      setOpen(true);
      setRemoved(new Set());
    }
  }

  const addressed = targets.filter((target) => !removed.has(target.id));

  return {
    open,
    title,
    description,
    targets,
    removed,
    addressed,
    ready:
      title.trim().length > 0 &&
      description.trim().length > 0 &&
      addressed.length > 0,
    setTitle,
    setDescription,
    removeTarget: (id) => setRemoved((prev) => new Set(prev).add(id)),
    toggle,
    close: () => setOpen(false),
    reset: () => {
      setTitle("");
      setDescription("");
      setOpen(false);
    },
  };
}
