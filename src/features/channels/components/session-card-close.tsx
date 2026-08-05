"use client";

import { useState } from "react";
import type { CloseProposal } from "../lib/group-thread";
import type { ThreadOutcome } from "../types";

/**
 * HOW A THREAD GETS CLOSED, from the card — the PROMPT an agent's proposal
 * raises, and the FORM the operator confirms it in.
 *
 * Split out of `session-card.tsx` at the §2 500-line cap (2026-08-04) when
 * DECISION 2 landed, and the seam is the decision itself: everything here is
 * about ending the exchange, while the card around it is about showing one.
 *
 * WHY THERE IS A PROMPT AT ALL. An agent may no longer close a thread — closing
 * settles the SHARED exchange for both members, and "the work looks done" is not
 * the same judgment as "I am finished with this". So when an agent believes the
 * work is done it posts a marked, non-terminal note, and this is where that note
 * stops being a line in the log and becomes a decision.
 */
export function CloseProposalPrompt({
  proposal,
  onKeepOpen,
  onClose,
}: {
  proposal: CloseProposal;
  /** Dismiss LOCALLY. Nothing is persisted — the thread staying open IS the state. */
  onKeepOpen: () => void;
  /** Open the close form, prefilled from the proposal. */
  onClose: () => void;
}) {
  const reason = proposal.message.body.trim();
  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle bg-card-surface-subtle px-3.5 py-2.5">
      <p className="text-caption text-text-secondary">
        <span className="font-medium text-text-primary">
          {proposal.message.authorName || "Your agent"}
        </span>{" "}
        thinks this thread can be closed
        {proposal.outcome === "failed" ? " as failed" : ""}. Closing settles it for
        both members.
      </p>
      {reason && <p className="text-caption text-text-secondary">{reason}</p>}
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onKeepOpen}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-secondary"
        >
          Keep open
        </button>
        <button
          type="button"
          onClick={onClose}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary"
        >
          Close thread
        </button>
      </div>
    </div>
  );
}

/**
 * The close FORM. `initialSummary` is the proposal's reason when the close came
 * from one: the agent already wrote the sentence, and making the human retype it
 * is how a good outcome summary turns into an empty one.
 */
export function ThreadCloseForm({
  initialSummary = "",
  onSubmit,
  onCancel,
}: {
  /** Prefill — the agent's own reason when this close came from a proposal. */
  initialSummary?: string;
  onSubmit: (outcome: ThreadOutcome, summary: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [busy, setBusy] = useState(false);

  async function submit(outcome: ThreadOutcome) {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(outcome, summary.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle bg-card-surface-subtle px-3.5 py-2.5">
      <input
        type="text"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        disabled={busy}
        maxLength={2000}
        placeholder="Add a closing summary (optional)"
        className="concave-field w-full rounded-[8px] px-2.5 py-1.5 text-caption text-text-primary placeholder:text-text-muted"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-secondary disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => submit("failed")}
          disabled={busy}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-danger disabled:opacity-60"
        >
          Mark failed
        </button>
        <button
          type="button"
          onClick={() => submit("completed")}
          disabled={busy}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
        >
          Mark complete
        </button>
      </div>
    </div>
  );
}

