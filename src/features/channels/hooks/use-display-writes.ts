"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/shared/api/api-client";
import { toast } from "@/shared/ui/toast";
import { channelKeys } from "../client/query-keys";
import { failed, messagesKey } from "./use-thread-writes-shared";

/** The message's display routes (docs/specs/unified-display.md §7.2 C2). */
const displayPath = (channelId: string, messageId: string, verb: "answer" | "save") =>
  `/api/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/display/${verb}`;

/** One press on a display's `choice` — the index is THE answer (spec §3.2). */
export interface DisplayAnswerTarget {
  channelId: string;
  messageId: string;
  index: number;
}

/** Resolves `true` once the server took the answer; `false` after a failure (already toasted). */
export type AnswerDisplay = (target: DisplayAnswerTarget) => Promise<boolean>;

/**
 * **THE ONE ANSWER WRITE, FOR EVERY DISPLAY** — a decision (new or legacy escalation) and a v1
 * selectable list alike go to `POST …/display/answer {index, block_id?}`; the server picks the lane
 * (decision → the escalation answer message, which wakes the asking agent; legacy → the v1 patch).
 *
 * ⚠ **THE CLIENT NEVER NAMES AN AGENT OR A LABEL.** The index decides; the server derives the
 * answer body and who is woken off the stored message.
 *
 * ⚠ **NO OPTIMISTIC CACHE WRITE.** The answer lands as a stamp on the message (and, for a decision,
 * an answer message); the transcript re-reads on success AND on failure — a timed-out POST may
 * have stored the answer, and a stale "unanswered" card invites a second press. The card holds the
 * pressed face until the re-read lands (`display-card.tsx`).
 *
 * ⚠ HOST-OWNED: a host that cannot carry the write passes no handler and every card it draws is
 * read-only (absent-not-disabled).
 */
export function useDisplayAnswer(): AnswerDisplay {
  const client = useQueryClient();
  return useCallback<AnswerDisplay>(
    async ({ channelId, messageId, index }) => {
      try {
        await apiRequest<unknown>(displayPath(channelId, messageId, "answer"), {
          method: "POST",
          body: { index },
        });
        return true;
      } catch (err) {
        failed(err, "Couldn't send that answer");
        return false;
      } finally {
        void client.invalidateQueries({ queryKey: messagesKey(channelId) });
        void client.invalidateQueries({ queryKey: channelKeys.list().all });
      }
    },
    [client]
  );
}

/** **SAVE AS TEMPLATE** — the card's other write; the server names the template. */
export function useDisplaySave(channelId: string, messageId: string) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiRequest<unknown>(displayPath(channelId, messageId, "save"), {
        method: "POST",
        body: {},
      });
      setSaved(true);
      toast({ title: "Saved as template" });
    } catch (err) {
      failed(err, "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return { save, saved, busy };
}
