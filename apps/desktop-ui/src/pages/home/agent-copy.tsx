import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { agentTemplateErrorMessage } from "@/features/agent-templates/client/api";
import type { AgentTemplate } from "@/features/agent-templates/client/types";
import { useAgentTemplateWrites } from "@/features/agent-templates/hooks/use-agent-template-writes";
import {
  containerCopyDraft,
  draftToCreateBody,
} from "@/features/agent-templates/lib/template-draft";

/**
 * "USE IN THIS CHANNEL" — the one control that gets a home-workspace agent into
 * a link container (Samuel's ruling Q2, 2026-08-26;
 * `docs/specs/home-agents-tab.plan.md` §3, M4).
 *
 * ⚠ IT IS A COPY, AND IT HAD TO BE. A scope-C template CANNOT LAUNCH INTO A
 * CONTAINER: `getTemplateById` is workspace-filtered and `/resolve` passes the
 * LAUNCH workspace, so the id 404s (INVARIANTS §5A). That is a same-workspace
 * trigger, not a permission anyone lacks, so no grant table and no flag could
 * fix it — a NEW ROW in the container is the answer, and this is where the
 * scope-C caption's promise ("Use one here to make a copy in this channel")
 * becomes true.
 *
 * ⚠ CLIENT-COMPOSED OVER THE EXISTING POST — no new route, no new service, no
 * server change. `lib/template-draft.ts › containerCopyDraft` is the whole
 * composition and it is PURE, so what the copy carries and what it drops is
 * testable without rendering anything.
 *
 * THE THREE RULES, ALL OF WHICH ARE ALSO IN THE COPY THE OPERATOR READS:
 *   1. 🔒 **ATTACHED KNOWLEDGE BASES ARE DROPPED, NOT CARRIED.** A home KB is not
 *      in the container and the attach gate would 404 it; and there is **no
 *      name-match re-attach**, because that would be a second, weaker attach
 *      gate resolving by string. Stated in ONE line of the confirm step.
 *   2. **IT IS A SNAPSHOT THAT DIVERGES** — no FK, no back-pointer, no sync. The
 *      confirm step says so, because "use" sounds like a reference and this is
 *      not one.
 *   3. **THE NAME IS CARRIED UNCHANGED.** Templates have no name uniqueness,
 *      deliberately, so no "(copy)" suffix dodges a constraint that exists.
 *
 * ⚠ AND `visibility` IS FORCED TO `private`. The gesture's word is "use"; it
 * must never silently PUBLISH the operator's own agent into a room the peer is
 * standing in. Sharing it is a second, deliberate edit.
 */

/** The card control. ⚠ A `<button>` inside the card's face, never over it —
 *  see `template-section.tsx › TemplateCard`. */
export function UseInThisChannelButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="btn-light h-6 rounded-full px-2.5 text-caption font-medium disabled:opacity-60"
    >
      Use in this channel
    </button>
  );
}

/**
 * The confirm step and the write.
 *
 * ⚠ MOUNTED ONLY WHILE A COPY IS PENDING, which is what lets it hold
 * `useAgentTemplateWrites(container)` without a second always-live writes hook
 * on a pane that is usually only reading.
 *
 * ⚠ A FAILED WRITE KEEPS THE DIALOG OPEN AND PUTS THE SERVER'S OWN WORDING IN
 * IT. `ConfirmDialog` closes on a resolved `onConfirm` and stays open on a
 * throw, so the rethrow below is load-bearing: without it a refused copy would
 * close the dialog and leave nothing on screen that said anything failed.
 */
export function CopyToChannelDialog({
  source,
  containerWorkspaceId,
  onClose,
  onCopied,
}: {
  /** The HOME-workspace row being copied. */
  source: AgentTemplate;
  containerWorkspaceId: string;
  onClose: () => void;
  /** The copy landed — the pane points the scope pill back at this channel so
   *  the new row is where the operator is looking. */
  onCopied: () => void;
}) {
  const writes = useAgentTemplateWrites(containerWorkspaceId);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setError(null);
    try {
      await writes.create.mutateAsync({
        body: draftToCreateBody(containerCopyDraft(source)),
      });
      onCopied();
    } catch (err) {
      setError(
        agentTemplateErrorMessage(err, "Couldn't copy the agent into this channel")
      );
      // ⚠ RETHROWN so the dialog stays open with the line above in it.
      throw err;
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Use "${source.name}" in this channel?`}
      // ⚠ THREE SENTENCES AT MOST, AND EACH IS A RULING RATHER THAN AN EXPLAINER
      // (minimal UI copy, INVARIANTS §5). Newlines render as paragraph breaks.
      description={describe(source, error)}
      confirmLabel="Make a copy"
      onConfirm={copy}
    />
  );
}

/**
 * What the operator is told before they press.
 *
 * ⚠ THE KB LINE IS CONDITIONAL ON THERE BEING SOMETHING TO DROP, and it NAMES
 * the count. On a template with no attachments the sentence would be a rule
 * about nothing — three words of chrome for a fact the operator cannot act on.
 *
 * ⚠ `?? NO_BASES` ON A SIBLING FIELD OF A CACHE-PERSISTED PAYLOAD (INVARIANTS
 * §8). `source` is a row out of the template list's cache entry, so it can be a
 * payload written by an OLDER build of this app; a bare
 * `source.knowledgeBases.length` throws inside the render of a dialog that is
 * already open, which blanks the surface rather than showing a sentence. The
 * field predates this wave, so this is not a new stale-field hazard — it is the
 * exact spelling the rule forbids, in the position where it costs most.
 */

/** Shared frozen empty list — never a fresh `[]`, which would be a new identity
 *  on every render of a dialog that re-renders on every keystroke behind it. */
const NO_BASES: ReadonlyArray<{ id: string; name: string }> = Object.freeze([]);

function describe(source: AgentTemplate, error: string | null): string {
  const lines = [
    "This makes a private copy here. It's a snapshot — later edits to the original won't reach it.",
  ];
  const attached = (source.knowledgeBases ?? NO_BASES).length;
  if (attached > 0) {
    lines.push(
      `Its ${attached} attached knowledge ${attached === 1 ? "base stays" : "bases stay"} behind — they live in your own workspace, not in this channel.`
    );
  }
  if (error) lines.push(error);
  return lines.join("\n");
}
