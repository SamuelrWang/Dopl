"use client";

import { useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { toast } from "@/shared/ui/toast";
import type { DisplayAnswer } from "../lib/message-device";

/** The message's display routes (docs/specs/device-aware-messages.md). */
const displayPath = (channelId: string, messageId: string, verb: "answer" | "save") =>
  `/api/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/display/${verb}`;

/**
 * **THE DISPLAY CARD'S TWO WRITES** — answer a selectable list, save the display as a template.
 *
 * ⚠ **NO CACHE WRITE.** The answer lands on the message's own `metadata.display` server-side, and
 * the `channel_messages` doorbell refetches the transcript; `pending` only holds the chosen face
 * until that arrives (and clears on a failure, so the choices come back).
 */
export function useDisplayWrites(channelId: string, messageId: string) {
  const [pending, setPending] = useState<DisplayAnswer | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>, failure: string): Promise<boolean> {
    setBusy(true);
    try {
      await work();
      return true;
    } catch (err) {
      toast({ title: userFacingMessage(err, failure) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function answer(choice: DisplayAnswer) {
    setPending(choice);
    const ok = await run(
      () =>
        apiRequest<unknown>(displayPath(channelId, messageId, "answer"), {
          method: "POST",
          body: { block_id: choice.blockId, index: choice.index, choice: choice.choice },
        }),
      "Couldn't send"
    );
    if (!ok) setPending(null);
  }

  /** The server names the template from the display's first line of text. */
  async function save() {
    const ok = await run(
      () =>
        apiRequest<unknown>(displayPath(channelId, messageId, "save"), {
          method: "POST",
          body: {},
        }),
      "Couldn't save"
    );
    if (ok) {
      setSaved(true);
      toast({ title: "Saved as template" });
    }
  }

  return { answer, save, pending, saved, busy };
}
